const express = require("express");
const router = express.Router();
const db = require("../db");
const serviceLayer = require("../serviceLayer");

const MONTH_MAP = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12
};

function parseFlexibleDateToIso(val) {
  if (!val) return null;
  const s = String(val).trim();
  if (!s) return null;

  // 1. YYYY-MM-DD or YYYY/MM/DD
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }

      // 2. Check Backflush vs Manual and Live Warehouse Stock Shortage before releasing or receiving
    const [worLines] = await db.execute(
      `SELECT 
         T1."LineNum",
         T1."ItemCode",
         COALESCE(C."ItemName", T1."ItemCode") AS "ItemName",
         COALESCE(C."InvntryUom", 'Kg') AS "Uom",
         T1."IssueType",
         CAST(COALESCE(T1."BaseQty", 0) AS DOUBLE) AS "BaseQty",
         CAST(COALESCE(T1."PlannedQty", 0) AS DOUBLE) AS "PlannedQty",
         CAST(COALESCE(T1."IssuedQty", 0) AS DOUBLE) AS "IssuedQty",
         COALESCE(T1."wareHouse", '01') AS "Warehouse",
         CAST(COALESCE(W."OnHand", C."OnHand", 0) AS DOUBLE) AS "WhsOnHand"
       FROM "WOR1" T1
       LEFT JOIN "OITM" C ON T1."ItemCode" = C."ItemCode"
       LEFT JOIN "OITW" W ON T1."ItemCode" = W."ItemCode" AND T1."wareHouse" = W."WhsCode"
       WHERE T1."DocEntry" = ?
       ORDER BY T1."LineNum" ASC`,
      [docEntry]
    );

    // A. If any component is set to Manual ('M'), stop immediately with an error
    const manualLines = (worLines || []).filter((wl) => wl.IssueType === "M");
    if (manualLines.length > 0) {
      const manualNames = manualLines
        .map((wl) => `${wl.ItemCode} (${wl.ItemName})`)
        .join(", ");
      return res.status(400).json({
        error: `Cannot Receive from Production on Order #${orderInfo.DocNum}: The following raw material(s) are set to Manual Issue (M) instead of Backflush (B): ${manualNames}.`
      });
    }

    // B. All components are Backflush ('B') — verify live warehouse stock covers required quantity
    const orderPlannedQty = Number(orderInfo.PlannedQty || 0);
    const totalReceiptQty = completeQty + rejectQty;
    const reqByItemWh = {};

    for (const wl of worLines || []) {
      const baseRatio =
        Number(wl.BaseQty || 0) > 0
          ? Number(wl.BaseQty)
          : orderPlannedQty > 0
          ? Number(wl.PlannedQty || 0) / orderPlannedQty
          : 0;
      const reqQty = baseRatio * totalReceiptQty;
      if (reqQty <= 0.0001) continue;

      const wh = String(wl.Warehouse || orderInfo.Warehouse || "01").trim();
      const key = `${wl.ItemCode}__${wh}`;
      if (!reqByItemWh[key]) {
        reqByItemWh[key] = {
          itemCode: wl.ItemCode,
          itemName: wl.ItemName,
          uom: wl.Uom || "Kg",
          warehouse: wh,
          requiredQty: 0,
          availableQty: Number(wl.WhsOnHand || 0)
        };
      }
      reqByItemWh[key].requiredQty += reqQty;
    }

    const shortages = [];
    for (const info of Object.values(reqByItemWh)) {
      if (info.availableQty < info.requiredQty - 0.0001) {
        const shortBy = info.requiredQty - info.availableQty;
        shortages.push(
          `${info.itemCode} (${info.itemName}) in WH ${info.warehouse}: Required ${info.requiredQty.toFixed(2)} ${info.uom}, Available ${info.availableQty.toFixed(2)} ${info.uom} — Short by ${shortBy.toFixed(2)} ${info.uom}`
        );
      }
    }

    if (shortages.length > 0) {
      return res.status(400).json({
        error: `Order #${orderInfo.DocNum} (${orderInfo.ItemCode}) is short on Raw Material stock: ${shortages.join(" | ")}`
      });
    }

    // C. Stock is sufficient & all lines are Backflush — 1st Release Order (if Planned), then Receive & Backflush
    if (orderInfo.Status === "P") {
      await serviceLayer.patch(`/ProductionOrders(${docEntry})`, {
        ProductionOrderStatus: "boposReleased"
      });
    }
    const targetWhs = String(warehouse || orderInfo.Warehouse || "01").trim();
    const docLines = [];

    if (completeQty > 0) {
      docLines.push({
        BaseType: 202,
        BaseEntry: docEntry,
        Quantity: completeQty,
        TransactionType: "botrntComplete",
        WarehouseCode: targetWhs
      });
    }

    if (rejectQty > 0) {
      docLines.push({
        BaseType: 202,
        BaseEntry: docEntry,
        Quantity: rejectQty,
        TransactionType: "botrntReject",
        WarehouseCode: targetWhs
      });
    }

    // 4. Post Receipt from Production (InventoryGenEntries / OIGN) via Service Layer
    const cleanShift = String(shift || U_Shift || "Day").trim();
    const { headerCol: shiftHeaderCol, lineCol: shiftLineCol } = await resolveShiftUdfColumns(true);

    const baseComments =
      comments ||
      `Receipt from Production Order #${orderInfo.DocNum} (${orderInfo.ItemCode})`;
    const finalComments =
      cleanShift && !String(baseComments).toLowerCase().includes("shift:")
        ? `${baseComments} [Shift: ${cleanShift}]`
        : baseComments;

    if (shiftLineCol && cleanShift) {
      for (const dl of docLines) {
        dl[shiftLineCol] = cleanShift;
      }
    }

    const entryPayload = {
      DocDate: receiptDate,
      Comments: finalComments,
      DocumentLines: docLines
    };

    const targetHeaderShiftProp = shiftHeaderCol || "U_Shift";
    if (cleanShift) {
      entryPayload[targetHeaderShiftProp] = cleanShift;
    }

    let result;
    try {
      result = await serviceLayer.post("/InventoryGenEntries", entryPayload);
    } catch (slPostErr) {
      const errMsg = String(slPostErr.message || "");
      const isShiftPropErr =
        errMsg.toLowerCase().includes("shift") ||
        errMsg.toLowerCase().includes("property") ||
        errMsg.toLowerCase().includes("valid value");
      if (isShiftPropErr && cleanShift) {
        try {
          // Try single-char valid value (D / N) in case SAP UDF was configured with D/N valid values
          const shortShift = cleanShift.toUpperCase().startsWith("N") ? "N" : "D";
          const retryShortPayload = {
            ...entryPayload,
            [targetHeaderShiftProp]: shortShift
          };
          result = await serviceLayer.post("/InventoryGenEntries", retryShortPayload);
        } catch (_) {
          // Fallback without unknown UDF property if U_Shift has not yet been added to OIGN
          const fallbackPayload = {
            DocDate: receiptDate,
            Comments: finalComments,
            DocumentLines: docLines.map((dl) => {
              const copy = { ...dl };
              if (shiftLineCol) delete copy[shiftLineCol];
              return copy;
            })
          };
          result = await serviceLayer.post("/InventoryGenEntries", fallbackPayload);
        }
      } else {
        throw slPostErr;
      }
    }

    // 4. Only close the Production Order if explicitly requested (autoClose === true)
    let closedNote = "";
    if (autoClose === true) {
      try {
        await serviceLayer.patch(`/ProductionOrders(${docEntry})`, {
          ProductionOrderStatus: "boposClosed"
        });
        closedNote = " and Closed Production Order";
      } catch (closeErr) {
        console.warn(
          `[ServiceLayer] Receipt succeeded for Order #${orderInfo.DocNum}, but auto-close returned warning:`,
          closeErr.message
        );
        closedNote = ` (Note: Auto-close skipped: ${closeErr.message})`;
      }
    }

    res.status(201).json({
      message: `Received ${completeQty} Kg of ${orderInfo.ItemCode} on ${receiptDate} (${cleanShift} Shift) from Production Order #${orderInfo.DocNum} (Receipt Doc #${result.DocNum})${closedNote} via SAP Service Layer`,
      receiptDocument: result
    });
  } catch (err) {
    console.error("[ServiceLayer] POST /api/production/:docEntry/receipt error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
