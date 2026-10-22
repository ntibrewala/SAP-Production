const express = require("express");
const router = express.Router();
const db = require("../db");
const serviceLayer = require("../serviceLayer");

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
      ORDER BY T0."DocEntry" DESC
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

    const receiptsSql = `
      SELECT 
        T0."DocEntry" AS "doc_entry",
        T0."DocNum" AS "doc_num",
        T0."DocDate" AS "doc_date",
        T0."Comments" AS "comments",
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
      if (!receiptsMap[r.order_doc_entry]) receiptsMap[r.order_doc_entry] = [];
      receiptsMap[r.order_doc_entry].push(r);
    }

    const enriched = (orders || []).map((o) => ({
      ...o,
      lines: linesMap[o.doc_entry] || [],
      issues: issuesMap[o.doc_entry] || [],
      receipts: receiptsMap[o.doc_entry] || []
    }));

    res.json(enriched);
  } catch (err) {
    console.error("[Production] GET /api/production error:", err.message);
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
    const createPayload = {
      ItemNo: cleanCode,
      PlannedQuantity: qty,
      ProductionOrderType: "bopotStandard",
      PostingDate: postingDate || today,
      DueDate: dueDate || today,
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
      comments,
      autoClose = false
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
      `SELECT "DocEntry", "DocNum", "ItemCode", "Status", "Warehouse" FROM "OWOR" WHERE "DocEntry" = ?`,
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
    const entryPayload = {
      DocDate: docDate || new Date().toISOString().split("T")[0],
      Comments:
        comments ||
        `Receipt from Production Order #${orderInfo.DocNum} (${orderInfo.ItemCode})`,
      DocumentLines: docLines
    };

    const result = await serviceLayer.post("/InventoryGenEntries", entryPayload);

    // 4. Optionally close the Production Order after completion
    let closedNote = "";
    if (autoClose) {
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
      message: `Received ${completeQty} Kg of ${orderInfo.ItemCode} from Production Order #${orderInfo.DocNum} (Receipt Doc #${result.DocNum})${closedNote} via SAP Service Layer`,
      receiptDocument: result
    });
  } catch (err) {
    console.error("[ServiceLayer] POST /api/production/:docEntry/receipt error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
