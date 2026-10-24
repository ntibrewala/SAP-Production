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

  // 2. DD-MM-YYYY or DD/MM/YYYY or DD.MM.YYYY
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) {
    let d = Number(m[1]);
    let mo = Number(m[2]);
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    if (mo > 12 && d <= 12) {
      const tmp = d;
      d = mo;
      mo = tmp;
    }
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }

  // 3. DD MMM YYYY (e.g. "22 Oct 2026", "22-Oct-2026", "22 October 26")
  m = s.match(/^(\d{1,2})[\s\-/,]+([A-Za-z]+)[\s\-/,]+(\d{2,4})$/);
  if (m) {
    const d = Number(m[1]);
    const mo = MONTH_MAP[m[2].toLowerCase()];
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    if (mo && d >= 1 && d <= 31) {
      return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }

  // 4. MMM DD, YYYY (e.g. "Oct 22, 2026")
  m = s.match(/^([A-Za-z]+)[\s\-/,]+(\d{1,2})[\s\-/,]+(\d{2,4})$/);
  if (m) {
    const mo = MONTH_MAP[m[1].toLowerCase()];
    const d = Number(m[2]);
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    if (mo && d >= 1 && d <= 31) {
      return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }

  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const mo = String(parsed.getMonth() + 1).padStart(2, "0");
    const d = String(parsed.getDate()).padStart(2, "0");
    return `${y}-${mo}-${d}`;
  }
  return null;
}

let shiftUdfCreateAttempted = false;
async function resolveShiftUdfColumns(tryCreate = false) {
  let headerCol = null;
  let lineCol = null;
  try {
    const [cols] = await db.query(`
      SELECT "TABLE_NAME", "COLUMN_NAME"
      FROM "SYS"."TABLE_COLUMNS"
      WHERE "SCHEMA_NAME" = CURRENT_SCHEMA
        AND "TABLE_NAME" IN ('OIGN', 'IGN1')
        AND UPPER("COLUMN_NAME") LIKE 'U_%SHIFT%'
      ORDER BY "COLUMN_NAME" ASC
    `);
    for (const c of cols || []) {
      if (c.TABLE_NAME === "OIGN" && !headerCol) headerCol = c.COLUMN_NAME;
      if (c.TABLE_NAME === "IGN1" && !lineCol) lineCol = c.COLUMN_NAME;
    }
  } catch (e) {
    console.warn("[Production] Shift UDF column lookup warning:", e.message);
  }

  if (!headerCol && !lineCol && tryCreate && !shiftUdfCreateAttempted) {
    shiftUdfCreateAttempted = true;
    try {
      await serviceLayer.post("/UserFieldsMD", {
        Name: "Shift",
        Type: "db_Alpha",
        Size: 20,
        Description: "Production Shift (Day / Night)",
        SubType: "st_None",
        TableName: "OIGN"
      });
      headerCol = "U_Shift";
      console.log("[ServiceLayer] Created U_Shift UDF on OIGN via /UserFieldsMD");
    } catch (createErr) {
      console.warn("[ServiceLayer] Auto-create U_Shift on OIGN skipped:", createErr.message);
    }
  }

  return { headerCol, lineCol };
}

// --- GET /api/production: All SAP Production Orders (OWOR) with Component Lines (WOR1), Issues (OIGE), and Receipts (OIGN) ---
router.get("/", async (req, res) => {
  try {
    const ordersSql = `
      SELECT 
        T0."DocEntry" AS "id",
        T0."DocEntry" AS "doc_entry",
        T0."DocNum" AS "doc_num",
        T0."ItemCode" AS "item_code",
        T0."ItemCode" AS "finished_good_id",
        COALESCE(T1."ItemName", T0."ProdName", T0."ItemCode") AS "item_name",
        COALESCE(T1."ItemName", T0."ProdName", T0."ItemCode") AS "finished_good_name",
        COALESCE(T1."InvntryUom", 'Kg') AS "uom",
        T0."Status" AS "status_code",
        CASE 
          WHEN T0."Status" = 'P' THEN 'Planned'
          WHEN T0."Status" = 'R' THEN 'Released'
          WHEN T0."Status" = 'L' THEN 'Closed'
          WHEN T0."Status" = 'C' THEN 'Cancelled'
          ELSE T0."Status"
        END AS "status",
        T0."Type" AS "type_code",
        CAST(COALESCE(T0."PlannedQty", 0) AS DOUBLE) AS "planned_qty",
        CAST(COALESCE(T0."PlannedQty", 0) AS DOUBLE) AS "quantity_planned",
        CAST(COALESCE(T0."CmpltQty", 0) AS DOUBLE) AS "completed_qty",
        CAST(COALESCE(T0."CmpltQty", 0) AS DOUBLE) AS "quantity_actual",
        CAST(COALESCE(T0."RjctQty", 0) AS DOUBLE) AS "rejected_qty",
        T0."Warehouse" AS "warehouse",
        T0."PostDate" AS "post_date",
        T0."PostDate" AS "created_at",
        T0."StartDate" AS "start_date",
        T0."DueDate" AS "due_date",
        T0."CloseDate" AS "close_date",
        T0."Comments" AS "comments",
        CASE 
          WHEN T1."Phantom" = 'Y' OR T0."ItemCode" LIKE 'SFG%' OR T1."ItmsGrpCod" = 107 THEN 1 
          ELSE 0 
        END AS "is_intermediate"
      FROM "OWOR" T0
      LEFT JOIN "OITM" T1 ON T0."ItemCode" = T1."ItemCode"
      ORDER BY T0."DueDate" ASC, T0."DocNum" ASC, T0."DocEntry" ASC
    `;

    const linesSql = `
      SELECT 
        T1."DocEntry" AS "doc_entry",
        T1."LineNum" AS "line_num",
        T1."ItemCode" AS "item_code",
        COALESCE(C."ItemName", T1."ItemCode") AS "item_name",
        COALESCE(C."InvntryUom", 'Kg') AS "uom",
        T1."ItemType" AS "item_type",
        CAST(COALESCE(T1."BaseQty", 0) AS DOUBLE) AS "base_qty",
        CAST(COALESCE(T1."PlannedQty", 0) AS DOUBLE) AS "planned_qty",
        CAST(COALESCE(T1."IssuedQty", 0) AS DOUBLE) AS "issued_qty",
        T1."wareHouse" AS "warehouse",
        T1."IssueType" AS "issue_type",
        CAST(COALESCE(W."OnHand", 0) AS DOUBLE) AS "whs_on_hand",
        CAST(COALESCE(C."OnHand", 0) AS DOUBLE) AS "total_on_hand"
      FROM "WOR1" T1
      LEFT JOIN "OITM" C ON T1."ItemCode" = C."ItemCode"
      LEFT JOIN "OITW" W ON T1."ItemCode" = W."ItemCode" AND T1."wareHouse" = W."WhsCode"
      ORDER BY T1."DocEntry" DESC, T1."LineNum" ASC
    `;

    const issuesSql = `
      SELECT 
        T0."DocEntry" AS "doc_entry",
        T0."DocNum" AS "doc_num",
        T0."DocDate" AS "doc_date",
        T0."Comments" AS "comments",
        T1."BaseEntry" AS "order_doc_entry",
        T1."BaseLine" AS "order_line_num",
        T1."ItemCode" AS "item_code",
        T1."Dscription" AS "item_name",
        CAST(COALESCE(T1."Quantity", 0) AS DOUBLE) AS "quantity",
        T1."WhsCode" AS "warehouse"
      FROM "OIGE" T0
      INNER JOIN "IGE1" T1 ON T0."DocEntry" = T1."DocEntry"
      WHERE T1."BaseType" = 202
      ORDER BY T0."DocEntry" DESC, T1."LineNum" ASC
    `;

    const { headerCol: shiftHeaderCol, lineCol: shiftLineCol } = await resolveShiftUdfColumns(false);
    const shiftSelectExpr = shiftHeaderCol
      ? `T0."${shiftHeaderCol}" AS "shift",`
      : shiftLineCol
      ? `T1."${shiftLineCol}" AS "shift",`
      : `NULL AS "shift",`;

    const receiptsSql = `
      SELECT 
        T0."DocEntry" AS "doc_entry",
        T0."DocNum" AS "doc_num",
        T0."DocDate" AS "doc_date",
        T0."Comments" AS "comments",
        ${shiftSelectExpr}
        T1."BaseEntry" AS "order_doc_entry",
        T1."ItemCode" AS "item_code",
        T1."Dscription" AS "item_name",
        CAST(COALESCE(T1."Quantity", 0) AS DOUBLE) AS "quantity",
        T1."WhsCode" AS "warehouse",
        T1."TranType" AS "tran_type"
      FROM "OIGN" T0
      INNER JOIN "IGN1" T1 ON T0."DocEntry" = T1."DocEntry"
      WHERE T1."BaseType" = 202
      ORDER BY T0."DocEntry" DESC, T1."LineNum" ASC
    `;

    const [[orders], [lines], [issues], [receipts]] = await Promise.all([
      db.query(ordersSql),
      db.query(linesSql),
      db.query(issuesSql),
      db.query(receiptsSql)
    ]);

    const linesMap = {};
    for (const l of lines || []) {
      if (!linesMap[l.doc_entry]) linesMap[l.doc_entry] = [];
      linesMap[l.doc_entry].push(l);
    }

    const issuesMap = {};
    for (const i of issues || []) {
      if (!issuesMap[i.order_doc_entry]) issuesMap[i.order_doc_entry] = [];
      issuesMap[i.order_doc_entry].push(i);
    }

    const receiptsMap = {};
    for (const r of receipts || []) {
      if (!r.shift && r.comments) {
        const m = String(r.comments).match(/\[Shift:\s*([^\]]+)\]/i);
        if (m && m[1]) r.shift = m[1].trim();
      }
      if (!receiptsMap[r.order_doc_entry]) receiptsMap[r.order_doc_entry] = [];
      receiptsMap[r.order_doc_entry].push(r);
    }

    const enriched = (orders || []).map((o) => {
      const orderLines = linesMap[o.doc_entry] || [];
      const is_fully_issued =
        orderLines.length > 0 &&
        orderLines.every(
          (l) => Number(l.issued_qty || 0) >= Number(l.planned_qty || 0) - 0.0001
        );
      const is_fully_received =
        Number(o.planned_qty || 0) > 0 &&
        Number(o.completed_qty || 0) >= Number(o.planned_qty || 0) - 0.0001;
      const is_produced = o.status_code === "L" || is_fully_received;

      return {
        ...o,
        is_fully_issued,
        is_fully_received,
        is_produced,
        lines: orderLines,
        issues: issuesMap[o.doc_entry] || [],
        receipts: receiptsMap[o.doc_entry] || []
      };
    });

    res.json(enriched);
  } catch (err) {
    console.error("[Production] GET /api/production error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- GET /api/production/mrp: Material Requirement & Purchase Shortage Calculator across all Open Production Orders via SAP B1 Service Layer ---
router.get("/mrp", async (req, res) => {
  try {
    let source = "SAP B1 Service Layer (/ProductionOrders, /Items, /ProductTrees)";
    let pendingOrders = [];
    let worLines = [];
    const itemMap = {};
    const bomByFather = {};

    try {
      const [slOrdersRes, slItemsRes, slTreesRes] = await Promise.all([
        serviceLayer.get(
          "/ProductionOrders?$filter=ProductionOrderStatus eq 'boposPlanned' or ProductionOrderStatus eq 'boposReleased'&$orderby=DueDate asc,DocumentNumber asc",
          { Prefer: "odata.maxpagesize=500" }
        ),
        serviceLayer.get(
          "/Items?$select=ItemCode,ItemName,ItemsGroupCode,InventoryUOM,QuantityOnStock,QuantityOrderedFromVendors,QuantityOrderedByCustomers,ProdStdCost,LastPurchasePrice,MovingAveragePrice,ItemWarehouseInfoCollection",
          { Prefer: "odata.maxpagesize=500" }
        ),
        serviceLayer.get(
          "/ProductTrees?$select=TreeCode,Quantity,Warehouse,ProductTreeLines",
          { Prefer: "odata.maxpagesize=500" }
        )
      ]);

      for (const item of slItemsRes?.value || []) {
        const whStocks = { "01": 0, "8": 0, "10": 0 };
        for (const wh of item.ItemWarehouseInfoCollection || []) {
          if (wh.WarehouseCode) {
            whStocks[wh.WarehouseCode] = Number(wh.InStock || 0);
          }
        }
        const onHand = Number(item.QuantityOnStock || 0);
        const onOrder = Number(item.QuantityOrderedFromVendors || 0);
        const isCommitted = Number(item.QuantityOrderedByCustomers || 0);
        const prodStdCost = Number(item.ProdStdCost || 0);
        const lastPurCost = Number(
          item.LastPurchasePrice || item.MovingAveragePrice || item.ProdStdCost || 0
        );

        itemMap[item.ItemCode] = {
          code: item.ItemCode,
          name: item.ItemName || item.ItemCode,
          uom: item.InventoryUOM || "Kg",
          item_group: Number(item.ItemsGroupCode || 0),
          phantom: "N",
          prod_std_cost: prodStdCost,
          last_purchase_cost: lastPurCost,
          on_hand: onHand,
          on_order: onOrder,
          is_committed: isCommitted,
          available_stock: onHand - isCommitted,
          wh_01_stock: Number(whStocks["01"] || 0),
          wh_8_stock: Number(whStocks["8"] || 0),
          wh_10_stock: Number(whStocks["10"] || 0),
          warehouse_stocks: whStocks
        };
      }

      for (const tree of slTreesRes?.value || []) {
        const treeCode = tree.TreeCode;
        if (!treeCode) continue;
        const headerQty = Number(tree.Quantity || 0);
        bomByFather[treeCode] = {
          headerQty,
          lines: (tree.ProductTreeLines || []).map((l) => ({
            sfg_code: treeCode,
            header_qty: headerQty,
            comp_code: l.ItemCode,
            comp_qty: Number(l.Quantity || 0),
            warehouse: l.Warehouse || tree.Warehouse || "01"
          }))
        };
      }

      const openSlOrders = (slOrdersRes?.value || [])
        .filter(
          (o) => Number(o.CompletedQuantity || 0) < Number(o.PlannedQuantity || 0) - 0.0001
        )
        .sort((a, b) => {
          const da = a.DueDate ? new Date(String(a.DueDate).split("T")[0]).getTime() : Number.MAX_SAFE_INTEGER;
          const dbTime = b.DueDate ? new Date(String(b.DueDate).split("T")[0]).getTime() : Number.MAX_SAFE_INTEGER;
          if (da !== dbTime) return da - dbTime;
          return Number(a.DocumentNumber || a.AbsoluteEntry || 0) - Number(b.DocumentNumber || b.AbsoluteEntry || 0);
        });

      for (const o of openSlOrders) {
        const parentCode = o.ItemNo;
        const parentMeta = itemMap[parentCode] || {};
        const parentName = o.ProductDescription || parentMeta.name || parentCode;
        const plannedQty = Number(o.PlannedQuantity || 0);
        const completedQty = Number(o.CompletedQuantity || 0);
        const orderPendingQty = Math.max(0, plannedQty - completedQty);
        const isIntermediate =
          String(parentCode || "").toUpperCase().startsWith("SFG") ||
          Number(parentMeta.item_group) === 107
            ? 1
            : 0;

        pendingOrders.push({
          doc_entry: o.AbsoluteEntry,
          doc_num: o.DocumentNumber,
          item_code: parentCode,
          item_name: parentName,
          uom: parentMeta.uom || "Kg",
          status_code: o.ProductionOrderStatus === "boposPlanned" ? "P" : "R",
          status: o.ProductionOrderStatus === "boposPlanned" ? "Planned" : "Released",
          planned_qty: plannedQty,
          completed_qty: completedQty,
          pending_qty: orderPendingQty,
          warehouse: o.Warehouse || "01",
          post_date: o.PostingDate,
          due_date: o.DueDate,
          is_intermediate: isIntermediate
        });

        for (const l of o.ProductionOrderLines || []) {
          const linePendingQty = Math.max(
            0,
            Number(l.PlannedQuantity || 0) - Number(l.IssuedQuantity || 0)
          );
          if (linePendingQty <= 0.0001) continue;

          worLines.push({
            item_code: l.ItemNo,
            doc_entry: o.AbsoluteEntry,
            doc_num: o.DocumentNumber,
            parent_code: parentCode,
            parent_name: parentName,
            pending_qty: linePendingQty,
            planned_qty: Number(l.PlannedQuantity || 0),
            issued_qty: Number(l.IssuedQuantity || 0),
            warehouse: l.Warehouse || o.Warehouse || "01",
            issue_type: l.ProductionOrderIssueType
          });
        }
      }
    } catch (slErr) {
      console.warn(
        "[Production MRP] Service Layer query failed, falling back to HANA SQL:",
        slErr.message
      );
      source = "SAP HANA SQL Fallback (OWOR, WOR1, OITM, OITT)";

      const openOrdersSql = `
        SELECT 
          T0."DocEntry" AS "doc_entry",
          T0."DocNum" AS "doc_num",
          T0."ItemCode" AS "item_code",
          COALESCE(T1."ItemName", T0."ProdName", T0."ItemCode") AS "item_name",
          COALESCE(T1."InvntryUom", 'Kg') AS "uom",
          T0."Status" AS "status_code",
          CASE 
            WHEN T0."Status" = 'P' THEN 'Planned'
            WHEN T0."Status" = 'R' THEN 'Released'
            ELSE T0."Status"
          END AS "status",
          CAST(COALESCE(T0."PlannedQty", 0) AS DOUBLE) AS "planned_qty",
          CAST(COALESCE(T0."CmpltQty", 0) AS DOUBLE) AS "completed_qty",
          CAST(COALESCE(T0."PlannedQty", 0) - COALESCE(T0."CmpltQty", 0) AS DOUBLE) AS "pending_qty",
          T0."Warehouse" AS "warehouse",
          T0."PostDate" AS "post_date",
          T0."DueDate" AS "due_date",
          CASE 
            WHEN T1."Phantom" = 'Y' OR T0."ItemCode" LIKE 'SFG%' OR T1."ItmsGrpCod" = 107 THEN 1 
            ELSE 0 
          END AS "is_intermediate"
        FROM "OWOR" T0
        LEFT JOIN "OITM" T1 ON T0."ItemCode" = T1."ItemCode"
        WHERE T0."Status" IN ('P', 'R')
          AND COALESCE(T0."CmpltQty", 0) < COALESCE(T0."PlannedQty", 0)
        ORDER BY T0."DueDate" ASC, T0."DocNum" ASC
      `;

      const openWorLinesSql = `
        SELECT 
          T1."ItemCode" AS "item_code",
          T0."DocEntry" AS "doc_entry",
          T0."DocNum" AS "doc_num",
          T0."ItemCode" AS "parent_code",
          COALESCE(P."ItemName", T0."ProdName", T0."ItemCode") AS "parent_name",
          CAST(T1."PlannedQty" - COALESCE(T1."IssuedQty", 0) AS DOUBLE) AS "pending_qty",
          CAST(COALESCE(T1."PlannedQty", 0) AS DOUBLE) AS "planned_qty",
          CAST(COALESCE(T1."IssuedQty", 0) AS DOUBLE) AS "issued_qty",
          T1."wareHouse" AS "warehouse"
        FROM "WOR1" T1
        INNER JOIN "OWOR" T0 ON T1."DocEntry" = T0."DocEntry"
        LEFT JOIN "OITM" P ON T0."ItemCode" = P."ItemCode"
        WHERE T0."Status" IN ('P', 'R')
          AND COALESCE(T0."CmpltQty", 0) < COALESCE(T0."PlannedQty", 0)
          AND (COALESCE(T1."PlannedQty", 0) - COALESCE(T1."IssuedQty", 0)) > 0.0001
        ORDER BY T0."DueDate" ASC, T0."DocNum" ASC, T1."LineNum" ASC
      `;

      const itemsMasterSql = `
        SELECT 
          T0."ItemCode" AS "code",
          T0."ItemName" AS "name",
          COALESCE(T0."InvntryUom", 'Kg') AS "uom",
          T0."ItmsGrpCod" AS "item_group",
          COALESCE(T0."Phantom", 'N') AS "phantom",
          CAST(COALESCE(T0."PrdStdCst", 0) AS DOUBLE) AS "prod_std_cost",
          CAST(COALESCE(LC."Price", NULLIF(T0."LastPurPrc", 0), NULLIF(T0."AvgPrice", 0), NULLIF(T0."PrdStdCst", 0), 0) AS DOUBLE) AS "last_purchase_cost",
          CAST(COALESCE(T0."OnHand", 0) AS DOUBLE) AS "on_hand",
          CAST(COALESCE(T0."IsCommited", 0) AS DOUBLE) AS "is_committed",
          CAST(COALESCE(T0."OnOrder", 0) AS DOUBLE) AS "on_order",
          CAST(COALESCE(T0."OnHand", 0) - COALESCE(T0."IsCommited", 0) AS DOUBLE) AS "available_stock",
          CAST(COALESCE(W01."OnHand", 0) AS DOUBLE) AS "wh_01_stock",
          CAST(COALESCE(W8."OnHand", 0) AS DOUBLE) AS "wh_8_stock",
          CAST(COALESCE(W10."OnHand", 0) AS DOUBLE) AS "wh_10_stock"
        FROM "OITM" T0
        LEFT JOIN (
          SELECT "ItemCode", "Price"
          FROM (
            SELECT 
              "ItemCode", 
              "Price",
              ROW_NUMBER() OVER (PARTITION BY "ItemCode" ORDER BY "TransNum" DESC) AS "rn"
            FROM "OINM"
            WHERE "InQty" > 0 AND "Price" > 0
          )
          WHERE "rn" = 1
        ) LC ON T0."ItemCode" = LC."ItemCode"
        LEFT JOIN "OITW" W01 ON T0."ItemCode" = W01."ItemCode" AND W01."WhsCode" = '01'
        LEFT JOIN "OITW" W8 ON T0."ItemCode" = W8."ItemCode" AND W8."WhsCode" = '8'
        LEFT JOIN "OITW" W10 ON T0."ItemCode" = W10."ItemCode" AND W10."WhsCode" = '10'
        WHERE T0."ItemCode" LIKE 'RM%' OR T0."ItemCode" LIKE 'SFG%' OR T0."ItmsGrpCod" IN (101, 107)
        ORDER BY T0."ItemCode" ASC
      `;

      const sfgBomsSql = `
        SELECT 
          T0."Code" AS "sfg_code",
          CAST(COALESCE(T0."Qauntity", 0) AS DOUBLE) AS "header_qty",
          T1."Code" AS "comp_code",
          CAST(COALESCE(T1."Quantity", 0) AS DOUBLE) AS "comp_qty",
          T1."Warehouse" AS "warehouse"
        FROM "OITT" T0
        INNER JOIN "ITT1" T1 ON T0."Code" = T1."Father"
      `;

      const [[dbOrders], [dbWorLines], [itemsRows], [bomRows]] = await Promise.all([
        db.query(openOrdersSql),
        db.query(openWorLinesSql),
        db.query(itemsMasterSql),
        db.query(sfgBomsSql)
      ]);

      pendingOrders = dbOrders || [];
      worLines = dbWorLines || [];

      for (const it of itemsRows || []) {
        itemMap[it.code] = it;
      }

      for (const b of bomRows || []) {
        if (!bomByFather[b.sfg_code]) {
          bomByFather[b.sfg_code] = {
            headerQty: Number(b.header_qty || 0),
            lines: []
          };
        }
        bomByFather[b.sfg_code].lines.push(b);
      }
    }

    const scheduledSfgMap = {};
    for (const o of pendingOrders || []) {
      if (o.is_intermediate === 1 || String(o.item_code || "").toUpperCase().startsWith("SFG")) {
        scheduledSfgMap[o.item_code] =
          (scheduledSfgMap[o.item_code] || 0) + Math.max(0, Number(o.pending_qty || 0));
      }
    }

    const directReqMap = {};
    const explodedReqMap = {};
    const pendingOrdersMap = {};
    const sfgDemandMap = {};

    for (const line of worLines || []) {
      const code = line.item_code;
      const pendingQty = Math.max(0, Number(line.pending_qty || 0));
      if (pendingQty <= 0.0001) continue;

      const meta = itemMap[code] || {};
      const isSfg =
        String(code || "").toUpperCase().startsWith("SFG") ||
        Number(meta.item_group) === 107 ||
        meta.phantom === "Y" ||
        Boolean(bomByFather[code]);

      directReqMap[code] = (directReqMap[code] || 0) + pendingQty;
      if (!pendingOrdersMap[code]) pendingOrdersMap[code] = [];
      pendingOrdersMap[code].push({
        doc_entry: line.doc_entry,
        doc_num: line.doc_num,
        parent_code: line.parent_code,
        parent_name: line.parent_name,
        pending_qty: pendingQty,
        warehouse: line.warehouse || "01",
        via_sfg: null
      });

      if (isSfg && bomByFather[code]) {
        if (!sfgDemandMap[code]) {
          sfgDemandMap[code] = {
            sfgCode: code,
            onHand: Number(meta.on_hand || 0),
            totalPendingQty: 0,
            orders: []
          };
        }
        sfgDemandMap[code].totalPendingQty += pendingQty;
        sfgDemandMap[code].orders.push({
          doc_entry: line.doc_entry,
          doc_num: line.doc_num,
          parent_code: line.parent_code,
          parent_name: line.parent_name,
          pending_qty: pendingQty,
          warehouse: line.warehouse || "01"
        });
      }
    }

    const explodeSfgShortage = (sfgCode, shortageQty, sourceOrders, visited = new Set()) => {
      if (shortageQty <= 0.0001 || visited.has(sfgCode)) return;
      const bom = bomByFather[sfgCode];
      if (!bom || !bom.lines || bom.lines.length === 0) return;

      const nextVisited = new Set(visited);
      nextVisited.add(sfgCode);

      const sumLineQty = bom.lines.reduce((acc, l) => acc + Number(l.comp_qty || 0), 0);
      const baseHeaderQty = bom.headerQty > 0 ? bom.headerQty : sumLineQty > 0 ? sumLineQty : 1;
      const totalSourceDemand = sourceOrders.reduce((acc, o) => acc + o.pending_qty, 0) || 1;

      for (const comp of bom.lines) {
        const compCode = comp.comp_code;
        const ratio = Number(comp.comp_qty || 0) / baseHeaderQty;
        const neededCompQty = shortageQty * ratio;
        if (neededCompQty <= 0.0001) continue;

        const compMeta = itemMap[compCode] || {};
        const compIsSfg =
          String(compCode || "").toUpperCase().startsWith("SFG") ||
          Number(compMeta.item_group) === 107 ||
          Boolean(bomByFather[compCode]);

        if (compIsSfg && bomByFather[compCode]) {
          const nestedOnHand = Number(compMeta.on_hand || 0);
          const nestedScheduled = Number(scheduledSfgMap[compCode] || 0);
          const nestedShortage = Math.max(0, neededCompQty - nestedOnHand - nestedScheduled);
          explodeSfgShortage(compCode, nestedShortage, sourceOrders, nextVisited);
        } else {
          explodedReqMap[compCode] = (explodedReqMap[compCode] || 0) + neededCompQty;
          if (!pendingOrdersMap[compCode]) pendingOrdersMap[compCode] = [];
          for (const ord of sourceOrders) {
            const share = ord.pending_qty / totalSourceDemand;
            pendingOrdersMap[compCode].push({
              doc_entry: ord.doc_entry,
              doc_num: ord.doc_num,
              parent_code: ord.parent_code,
              parent_name: ord.parent_name,
              pending_qty: neededCompQty * share,
              warehouse: comp.warehouse || ord.warehouse || "01",
              via_sfg: sfgCode
            });
          }
        }
      }
    };

    for (const sfgInfo of Object.values(sfgDemandMap)) {
      const scheduledQty = Number(scheduledSfgMap[sfgInfo.sfgCode] || 0);
      const sfgShortage = Math.max(0, sfgInfo.totalPendingQty - sfgInfo.onHand - scheduledQty);
      if (sfgShortage > 0.0001) {
        explodeSfgShortage(sfgInfo.sfgCode, sfgShortage, sfgInfo.orders);
      }
    }

    const allRequiredCodes = new Set([
      ...Object.keys(directReqMap),
      ...Object.keys(explodedReqMap)
    ]);

    const requirements = Array.from(allRequiredCodes)
      .map((code) => {
        const meta = itemMap[code] || {};
        const isSfg =
          String(code || "").toUpperCase().startsWith("SFG") ||
          Number(meta.item_group) === 107 ||
          meta.phantom === "Y";
        const directReq = Number(directReqMap[code] || 0);
        const sfgExplodedReq = Number(explodedReqMap[code] || 0);
        const requiredQty = directReq + sfgExplodedReq;
        const onHand = Number(meta.on_hand || 0);
        const onOrder = Number(meta.on_order || 0);
        const isCommitted = Number(meta.is_committed || 0);
        const availableStock = Number(meta.available_stock ?? onHand - isCommitted);
        const toPurchaseQty = Math.max(0, requiredQty - onHand);
        const netAfterPoQty = Math.max(0, toPurchaseQty - onOrder);
        const surplusQty = Math.max(0, onHand - requiredQty);
        const lastPurCost = Number(meta.last_purchase_cost || 0);
        const prodStdCost = Number(meta.prod_std_cost || 0);
        const estPurchaseCost = toPurchaseQty * lastPurCost;

        return {
          code,
          name: meta.name || code,
          uom: meta.uom || "Kg",
          item_type: isSfg ? "SFG" : "RM",
          direct_required_qty: directReq,
          sfg_exploded_qty: sfgExplodedReq,
          required_qty: requiredQty,
          on_hand: onHand,
          on_order: onOrder,
          is_committed: isCommitted,
          available_stock: availableStock,
          to_purchase_qty: toPurchaseQty,
          net_after_po_qty: netAfterPoQty,
          surplus_qty: surplusQty,
          last_purchase_cost: lastPurCost,
          prod_std_cost: prodStdCost,
          estimated_purchase_cost: estPurchaseCost,
          warehouse_stocks: meta.warehouse_stocks || {
            "01": Number(meta.wh_01_stock || 0),
            "8": Number(meta.wh_8_stock || 0),
            "10": Number(meta.wh_10_stock || 0)
          },
          pending_orders: pendingOrdersMap[code] || []
        };
      })
      .filter((r) => r.required_qty > 0.0001)
      .sort((a, b) => {
        if (b.to_purchase_qty > 0 && a.to_purchase_qty === 0) return 1;
        if (a.to_purchase_qty > 0 && b.to_purchase_qty === 0) return -1;
        if (b.to_purchase_qty !== a.to_purchase_qty) return b.to_purchase_qty - a.to_purchase_qty;
        return b.required_qty - a.required_qty;
      });

    const totalRequiredKg = requirements.reduce((acc, r) => acc + r.required_qty, 0);
    const shortageItemsCount = requirements.filter((r) => r.to_purchase_qty > 0.0001).length;
    const totalShortageKg = requirements.reduce((acc, r) => acc + r.to_purchase_qty, 0);
    const totalEstimatedPurchaseCost = requirements.reduce(
      (acc, r) => acc + r.estimated_purchase_cost,
      0
    );

    res.json({
      source,
      pendingOrdersCount: (pendingOrders || []).length,
      pendingOrders: pendingOrders || [],
      requirements,
      summary: {
        totalRequiredKg,
        shortageItemsCount,
        totalShortageKg,
        totalEstimatedPurchaseCost
      },
      totalRequiredKg,
      shortageItemsCount,
      totalShortageKg,
      totalEstimatedPurchaseCost
    });
  } catch (err) {
    console.error("[Production] GET /api/production/mrp error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- POST /api/production: Create Production Order in SAP strictly via Service Layer ---
router.post("/", async (req, res) => {
  try {
    const {
      itemCode,
      finished_good_id,
      plannedQuantity,
      quantity_planned,
      warehouse = "01",
      postingDate,
      dueDate,
      issueMethod = "BOM", // "BOM" (keep BOM default), "M" (Manual Issue), "B" (Backflush)
      autoRelease = true,
      remarks
    } = req.body;

    const cleanCode = String(itemCode || finished_good_id || "").trim();
    const qty = Number(plannedQuantity ?? quantity_planned ?? 0);

    if (!cleanCode) {
      return res.status(400).json({ error: "Please select a Product (FG or SFG) to produce." });
    }
    if (!qty || isNaN(qty) || qty <= 0) {
      return res.status(400).json({ error: "Planned Quantity must be greater than 0." });
    }

    // Verify Product has a BOM in OITT
    const [bomCheck] = await db.execute(
      `SELECT "Code", "Name" FROM "OITT" WHERE "Code" = ?`,
      [cleanCode]
    );
    if (!bomCheck || bomCheck.length === 0) {
      return res.status(400).json({
        error: `Item ${cleanCode} does not have a Bill of Materials (BOM) in SAP (OITT). Please create its BOM first.`
      });
    }

    const today = new Date().toISOString().split("T")[0];
    const parsedDue = parseFlexibleDateToIso(dueDate) || today;
    const parsedPost = parseFlexibleDateToIso(postingDate) || today;
    const createPayload = {
      ItemNo: cleanCode,
      PlannedQuantity: qty,
      ProductionOrderType: "bopotStandard",
      PostingDate: parsedPost,
      DueDate: parsedDue,
      Warehouse: warehouse || "01"
    };
    if (remarks) {
      createPayload.Remarks = String(remarks).trim();
    }

    // 1. Create Production Order in Planned status via Service Layer
    const created = await serviceLayer.post("/ProductionOrders", createPayload);
    const absEntry = created.AbsoluteEntry;

    // 2. Optionally override component Issue Method (Manual vs Backflush) while still in Planned status
    if (
      (issueMethod === "M" ||
        issueMethod === "B" ||
        issueMethod === "im_Manual" ||
        issueMethod === "im_Backflush") &&
      Array.isArray(created.ProductionOrderLines) &&
      created.ProductionOrderLines.length > 0
    ) {
      const targetIssueType =
        issueMethod === "M" || issueMethod === "im_Manual" ? "im_Manual" : "im_Backflush";
      const updatedLines = created.ProductionOrderLines.map((l) => ({
        DocumentAbsoluteEntry: absEntry,
        LineNumber: l.LineNumber,
        ProductionOrderIssueType: targetIssueType,
        Warehouse: warehouse || l.Warehouse || "01"
      }));

      await serviceLayer.patch(`/ProductionOrders(${absEntry})`, {
        ProductionOrderLines: updatedLines
      });
    }

    // 3. Optionally Release the Production Order immediately via Service Layer
    if (autoRelease) {
      await serviceLayer.patch(`/ProductionOrders(${absEntry})`, {
        ProductionOrderStatus: "boposReleased"
      });
    }

    const finalOrder = await serviceLayer.get(`/ProductionOrders(${absEntry})`);
    res.status(201).json({
      message: `Created SAP Production Order #${finalOrder.DocumentNumber} (Entry ${absEntry})${
        autoRelease ? " and Released for Production" : " in Planned status"
      } via Service Layer`,
      order: finalOrder
    });
  } catch (err) {
    console.error("[ServiceLayer] POST /api/production error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- PUT /api/production/:docEntry/status: Update Production Order Status (Release / Close / Cancel) via Service Layer ---
router.put("/:docEntry/status", async (req, res) => {
  try {
    const docEntry = Number(req.params.docEntry);
    const { status } = req.body;

    if (!docEntry || isNaN(docEntry)) {
      return res.status(400).json({ error: "Invalid Production Order DocEntry" });
    }

    const statusMap = {
      P: "boposPlanned",
      Planned: "boposPlanned",
      boposPlanned: "boposPlanned",
      R: "boposReleased",
      Released: "boposReleased",
      boposReleased: "boposReleased",
      L: "boposClosed",
      Closed: "boposClosed",
      boposClosed: "boposClosed",
      C: "boposCancelled",
      Cancelled: "boposCancelled",
      boposCancelled: "boposCancelled"
    };

    const mappedStatus = statusMap[status];
    if (!mappedStatus) {
      return res.status(400).json({
        error: `Unsupported status '${status}'. Allowed: Released (R), Closed (L), Cancelled (C).`
      });
    }

    await serviceLayer.patch(`/ProductionOrders(${docEntry})`, {
      ProductionOrderStatus: mappedStatus
    });

    const updated = await serviceLayer.get(`/ProductionOrders(${docEntry})`);
    res.json({
      message: `Production Order #${updated.DocumentNumber} status updated to ${mappedStatus.replace("bopos", "")} via SAP Service Layer`,
      order: updated
    });
  } catch (err) {
    console.error("[ServiceLayer] PUT /api/production/:docEntry/status error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- PUT /api/production/:docEntry/due-date: Modify & Update Production Order DueDate in SAP via Service Layer ---
router.put("/:docEntry/due-date", async (req, res) => {
  try {
    const docEntry = Number(req.params.docEntry);
    const { dueDate, due_date } = req.body;

    if (!docEntry || isNaN(docEntry)) {
      return res.status(400).json({ error: "Invalid Production Order DocEntry" });
    }

    const rawInput = String(dueDate ?? due_date ?? "").trim();
    const isoDueDate = parseFlexibleDateToIso(rawInput);
    if (!isoDueDate) {
      return res.status(400).json({
        error: `Invalid Due Date "${rawInput}". Please enter a valid date (e.g. 23 Oct 2026, 23-10-2026, or 2026-10-23).`
      });
    }

    try {
      await serviceLayer.patch(`/ProductionOrders(${docEntry})`, {
        DueDate: isoDueDate
      });
    } catch (patchErr) {
      // If new DueDate is earlier than existing StartDate/PostingDate in SAP, update StartDate/PostingDate along with DueDate
      await serviceLayer.patch(`/ProductionOrders(${docEntry})`, {
        StartDate: isoDueDate,
        DueDate: isoDueDate
      });
    }

    const updated = await serviceLayer.get(`/ProductionOrders(${docEntry})`);
    res.json({
      message: `Updated Production Order #${updated.DocumentNumber} Due Date to ${isoDueDate} in SAP via Service Layer`,
      due_date: isoDueDate,
      order: updated
    });
  } catch (err) {
    console.error("[ServiceLayer] PUT /api/production/:docEntry/due-date error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- PUT /api/production/:docEntry/planned-qty: Modify & Update Production Order PlannedQuantity in SAP via Service Layer ---
router.put("/:docEntry/planned-qty", async (req, res) => {
  try {
    const docEntry = Number(req.params.docEntry);
    const { plannedQuantity, planned_qty } = req.body;

    if (!docEntry || isNaN(docEntry)) {
      return res.status(400).json({ error: "Invalid Production Order DocEntry" });
    }

    const rawQty = String(plannedQuantity ?? planned_qty ?? "").replace(/,/g, "").trim();
    const newQty = Number(rawQty);
    if (isNaN(newQty) || newQty <= 0) {
      return res.status(400).json({
        error: "Please enter a valid Planned Quantity greater than 0."
      });
    }

    const [orderRows] = await db.execute(
      `SELECT "DocEntry", "DocNum", "ItemCode", "Status", CAST(COALESCE("CmpltQty", 0) AS DOUBLE) AS "CmpltQty" FROM "OWOR" WHERE "DocEntry" = ?`,
      [docEntry]
    );
    if (!orderRows || orderRows.length === 0) {
      return res.status(404).json({ error: `Production Order ${docEntry} not found in SAP.` });
    }

    const orderInfo = orderRows[0];
    if (orderInfo.Status === "L" || orderInfo.Status === "C") {
      return res.status(400).json({
        error: `Cannot change Planned Quantity on a ${
          orderInfo.Status === "L" ? "Closed" : "Cancelled"
        } Production Order (#${orderInfo.DocNum}).`
      });
    }

    const completedQty = Number(orderInfo.CmpltQty || 0);
    if (newQty < completedQty - 0.0001) {
      return res.status(400).json({
        error: `Planned Quantity (${newQty} Kg) cannot be less than Already Received Quantity (${completedQty} Kg) on Order #${orderInfo.DocNum}.`
      });
    }

    await serviceLayer.patch(`/ProductionOrders(${docEntry})`, {
      PlannedQuantity: newQty
    });

    let updated = await serviceLayer.get(`/ProductionOrders(${docEntry})`);
    const lines = updated?.ProductionOrderLines || [];
    const linesToSync = lines.filter((l) => {
      const baseRatio = Number(l.BaseQuantity || 0);
      if (baseRatio <= 0) return false;
      const expectedLinePlanned = baseRatio * newQty;
      return Math.abs(Number(l.PlannedQuantity || 0) - expectedLinePlanned) > 0.001;
    });

    if (linesToSync.length > 0) {
      try {
        await serviceLayer.patch(`/ProductionOrders(${docEntry})`, {
          ProductionOrderLines: lines.map((l) => {
            const baseRatio = Number(l.BaseQuantity || 0);
            return {
              DocumentAbsoluteEntry: docEntry,
              LineNumber: l.LineNumber,
              PlannedQuantity:
                baseRatio > 0
                  ? Number((baseRatio * newQty).toFixed(4))
                  : Number(l.PlannedQuantity || 0)
            };
          })
        });
        updated = await serviceLayer.get(`/ProductionOrders(${docEntry})`);
      } catch (lineSyncErr) {
        console.warn("[ServiceLayer] Line PlannedQuantity sync warning:", lineSyncErr.message);
      }
    }

    res.json({
      message: `Updated Production Order #${updated.DocumentNumber} Planned Quantity to ${newQty.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Kg in SAP via Service Layer`,
      planned_qty: newQty,
      order: updated
    });
  } catch (err) {
    console.error("[ServiceLayer] PUT /api/production/:docEntry/planned-qty error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- POST /api/production/:docEntry/issue: Issue Components to Production (SAP OIGE / InventoryGenExits) via Service Layer ---
router.post("/:docEntry/issue", async (req, res) => {
  try {
    const docEntry = Number(req.params.docEntry);
    const { docDate, comments, lines = [] } = req.body;

    if (!docEntry || isNaN(docEntry)) {
      return res.status(400).json({ error: "Invalid Production Order DocEntry" });
    }

    const validLines = (lines || []).filter((l) => Number(l.quantity) > 0);
    if (validLines.length === 0) {
      return res.status(400).json({
        error: "Please enter a positive Issue Quantity for at least one component line."
      });
    }

    // 1. Check current Production Order Status and Component IssueType in HANA
    const [orderRows] = await db.execute(
      `SELECT "DocEntry", "DocNum", "Status" FROM "OWOR" WHERE "DocEntry" = ?`,
      [docEntry]
    );
    if (!orderRows || orderRows.length === 0) {
      return res.status(404).json({ error: `Production Order ${docEntry} not found in SAP.` });
    }

    const orderInfo = orderRows[0];
    if (orderInfo.Status === "L" || orderInfo.Status === "C") {
      return res.status(400).json({
        error: `Production Order #${orderInfo.DocNum} is already ${
          orderInfo.Status === "L" ? "Closed" : "Cancelled"
        } and cannot receive further component issues.`
      });
    }

    // 2. Ensure any line being manually issued is set to im_Manual on the Production Order
    const [worLines] = await db.execute(
      `SELECT "LineNum", "ItemCode", "IssueType" FROM "WOR1" WHERE "DocEntry" = ?`,
      [docEntry]
    );
    const issueTypeMap = {};
    for (const wl of worLines || []) {
      issueTypeMap[Number(wl.LineNum)] = wl.IssueType;
    }

    const linesNeedingManualSwitch = validLines.filter(
      (l) => issueTypeMap[Number(l.lineNum)] === "B"
    );

    if (linesNeedingManualSwitch.length > 0) {
      await serviceLayer.patch(`/ProductionOrders(${docEntry})`, {
        ProductionOrderLines: linesNeedingManualSwitch.map((l) => ({
          DocumentAbsoluteEntry: docEntry,
          LineNumber: Number(l.lineNum),
          ProductionOrderIssueType: "im_Manual"
        }))
      });
    }

    // 3. If order is still in Planned ('P') status, auto-release it before issuing components
    if (orderInfo.Status === "P") {
      await serviceLayer.patch(`/ProductionOrders(${docEntry})`, {
        ProductionOrderStatus: "boposReleased"
      });
    }

    // 4. Post Issue for Production (InventoryGenExits / OIGE) via Service Layer
    const exitPayload = {
      DocDate: docDate || new Date().toISOString().split("T")[0],
      Comments:
        comments || `Issue for Production Order #${orderInfo.DocNum} (Entry ${docEntry})`,
      DocumentLines: validLines.map((l) => ({
        BaseType: 202,
        BaseEntry: docEntry,
        BaseLine: Number(l.lineNum),
        Quantity: Number(l.quantity),
        WarehouseCode: String(l.warehouse || "01").trim()
      }))
    };

    const result = await serviceLayer.post("/InventoryGenExits", exitPayload);
    res.status(201).json({
      message: `Issued ${validLines.length} component line(s) to Production Order #${orderInfo.DocNum} (Issue Doc #${result.DocNum}) via SAP Service Layer`,
      issueDocument: result
    });
  } catch (err) {
    console.error("[ServiceLayer] POST /api/production/:docEntry/issue error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- POST /api/production/:docEntry/receipt: Receipt from Production / Get from Production (SAP OIGN / InventoryGenEntries) via Service Layer ---
router.post("/:docEntry/receipt", async (req, res) => {
  try {
    const docEntry = Number(req.params.docEntry);
    const {
      quantity,
      rejectedQuantity = 0,
      warehouse = "01",
      docDate,
      shift,
      U_Shift,
      comments,
      autoClose
    } = req.body;

    if (!docEntry || isNaN(docEntry)) {
      return res.status(400).json({ error: "Invalid Production Order DocEntry" });
    }

    const completeQty = Number(quantity || 0);
    const rejectQty = Number(rejectedQuantity || 0);

    if (completeQty <= 0 && rejectQty <= 0) {
      return res.status(400).json({
        error: "Completed Quantity (or Rejected Quantity) must be greater than 0."
      });
    }

    // 1. Check Production Order status in HANA
    const [orderRows] = await db.execute(
      `SELECT "DocEntry", "DocNum", "ItemCode", "Status", "Warehouse", CAST(COALESCE("PlannedQty", 0) AS DOUBLE) AS "PlannedQty", CAST(COALESCE("CmpltQty", 0) AS DOUBLE) AS "CmpltQty" FROM "OWOR" WHERE "DocEntry" = ?`,
      [docEntry]
    );
    if (!orderRows || orderRows.length === 0) {
      return res.status(404).json({ error: `Production Order ${docEntry} not found in SAP.` });
    }

    const orderInfo = orderRows[0];
    if (orderInfo.Status === "L" || orderInfo.Status === "C") {
      return res.status(400).json({
        error: `Production Order #${orderInfo.DocNum} is already ${
          orderInfo.Status === "L" ? "Closed" : "Cancelled"
        }.`
      });
    }

    // 2. If order is still in Planned ('P') status, auto-release it before receiving FG/SFG
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

    // 3. Post Receipt from Production (InventoryGenEntries / OIGN) via Service Layer
    const receiptDate = String(docDate || new Date().toISOString().split("T")[0]).split("T")[0];
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
      TaxDate: receiptDate,
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
            TaxDate: receiptDate,
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
