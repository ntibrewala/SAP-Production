const express = require("express");
const router = express.Router();
const db = require("../db");
const serviceLayer = require("../serviceLayer");

// --- Raw Materials (from SAP OITM + OINM + OITW + Open OWOR/WOR1 MRP) ---
router.get("/", async (req, res) => {
  try {
    const query = `
      SELECT 
        T0."ItemCode" AS "id",
        T0."ItemCode" AS "code",
        T0."ItemName" AS "name",
        COALESCE(T0."InvntryUom", 'Kg') AS "uom",
        CAST(COALESCE(T0."PrdStdCst", 0) AS DOUBLE) AS "prod_std_cost",
        CAST(COALESCE(LC."Price", NULLIF(T0."LastPurPrc", 0), NULLIF(T0."AvgPrice", 0), 0) AS DOUBLE) AS "last_purchase_cost",
        CAST(COALESCE(LC."Price", NULLIF(T0."LastPurPrc", 0), NULLIF(T0."AvgPrice", 0), 0) AS DOUBLE) AS "unit_cost",
        CAST(COALESCE(T0."OnHand", 0) AS DOUBLE) AS "on_hand",
        CAST(COALESCE(T0."OnHand", 0) AS DOUBLE) AS "stock_level",
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
      WHERE T0."ItemCode" LIKE 'RM%' OR T0."ItmsGrpCod" = 101
      ORDER BY T0."ItemCode" ASC
    `;

    const whsQuery = `
      SELECT 
        W."ItemCode" AS "code", 
        W."WhsCode" AS "whs_code", 
        CAST(COALESCE(W."OnHand", 0) AS DOUBLE) AS "on_hand"
      FROM "OITW" W
      INNER JOIN "OITM" T0 ON W."ItemCode" = T0."ItemCode"
      WHERE (T0."ItemCode" LIKE 'RM%' OR T0."ItmsGrpCod" = 101) AND W."OnHand" <> 0
    `;

    const openWorLinesQuery = `
      SELECT 
        T1."ItemCode" AS "item_code",
        T0."DocEntry" AS "doc_entry",
        T0."DocNum" AS "doc_num",
        T0."ItemCode" AS "parent_code",
        COALESCE(P."ItemName", T0."ProdName", T0."ItemCode") AS "parent_name",
        CAST(T1."PlannedQty" - COALESCE(T1."IssuedQty", 0) AS DOUBLE) AS "pending_qty",
        T1."wareHouse" AS "warehouse",
        C."ItmsGrpCod" AS "item_group",
        COALESCE(C."Phantom", 'N') AS "phantom",
        CAST(COALESCE(C."OnHand", 0) AS DOUBLE) AS "item_on_hand"
      FROM "WOR1" T1
      INNER JOIN "OWOR" T0 ON T1."DocEntry" = T0."DocEntry"
      LEFT JOIN "OITM" P ON T0."ItemCode" = P."ItemCode"
      LEFT JOIN "OITM" C ON T1."ItemCode" = C."ItemCode"
      WHERE T0."Status" IN ('P', 'R')
        AND COALESCE(T0."CmpltQty", 0) < COALESCE(T0."PlannedQty", 0)
        AND (COALESCE(T1."PlannedQty", 0) - COALESCE(T1."IssuedQty", 0)) > 0.0001
      ORDER BY T0."DocNum" ASC
    `;

    const sfgBomsQuery = `
      SELECT 
        T0."Code" AS "sfg_code",
        CAST(COALESCE(T0."Qauntity", 0) AS DOUBLE) AS "header_qty",
        T1."Code" AS "comp_code",
        CAST(COALESCE(T1."Quantity", 0) AS DOUBLE) AS "comp_qty",
        T1."Warehouse" AS "warehouse",
        C."ItmsGrpCod" AS "comp_group",
        CAST(COALESCE(C."OnHand", 0) AS DOUBLE) AS "comp_on_hand"
      FROM "OITT" T0
      INNER JOIN "ITT1" T1 ON T0."Code" = T1."Father"
      LEFT JOIN "OITM" C ON T1."Code" = C."ItemCode"
    `;

    const openSfgOrdersQuery = `
      SELECT 
        T0."ItemCode" AS "sfg_code",
        SUM(CAST(COALESCE(T0."PlannedQty", 0) - COALESCE(T0."CmpltQty", 0) AS DOUBLE)) AS "scheduled_qty"
      FROM "OWOR" T0
      WHERE T0."Status" IN ('P', 'R')
        AND COALESCE(T0."CmpltQty", 0) < COALESCE(T0."PlannedQty", 0)
      GROUP BY T0."ItemCode"
    `;

    const [[materials], [whsRows], [openWorLines], [sfgBomRows], [openSfgOrders]] = await Promise.all([
      db.query(query),
      db.query(whsQuery),
      db.query(openWorLinesQuery),
      db.query(sfgBomsQuery),
      db.query(openSfgOrdersQuery)
    ]);

    const whsMap = {};
    for (const r of whsRows || []) {
      if (!whsMap[r.code]) whsMap[r.code] = {};
      whsMap[r.code][r.whs_code] = Number(r.on_hand || 0);
    }

    const bomByFather = {};
    for (const b of sfgBomRows || []) {
      if (!bomByFather[b.sfg_code]) {
        bomByFather[b.sfg_code] = {
          headerQty: Number(b.header_qty || 0),
          lines: []
        };
      }
      bomByFather[b.sfg_code].lines.push(b);
    }

    const scheduledSfgMap = {};
    for (const o of openSfgOrders || []) {
      scheduledSfgMap[o.sfg_code] = Number(o.scheduled_qty || 0);
    }

    const directReqMap = {};
    const explodedReqMap = {};
    const pendingOrdersMap = {};
    const sfgDemandMap = {};

    for (const line of openWorLines || []) {
      const code = line.item_code;
      const pendingQty = Math.max(0, Number(line.pending_qty || 0));
      if (pendingQty <= 0.0001) continue;

      const isSfg =
        String(code || "").toUpperCase().startsWith("SFG") ||
        Number(line.item_group) === 107 ||
        line.phantom === "Y" ||
        Boolean(bomByFather[code]);

      if (isSfg && bomByFather[code]) {
        if (!sfgDemandMap[code]) {
          sfgDemandMap[code] = {
            sfgCode: code,
            onHand: Number(line.item_on_hand || 0),
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
      } else {
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

        const compIsSfg =
          String(compCode || "").toUpperCase().startsWith("SFG") ||
          Number(comp.comp_group) === 107 ||
          Boolean(bomByFather[compCode]);

        if (compIsSfg && bomByFather[compCode]) {
          const nestedOnHand = Number(comp.comp_on_hand || 0);
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

    const enriched = (materials || []).map((m) => {
      const onHand = Number(m.on_hand || 0);
      const onOrder = Number(m.on_order || 0);
      const directReq = Number(directReqMap[m.code] || 0);
      const sfgExplodedReq = Number(explodedReqMap[m.code] || 0);
      const requiredQty = directReq + sfgExplodedReq;
      const toPurchaseQty = Math.max(0, requiredQty - onHand);
      const netAfterPoQty = Math.max(0, toPurchaseQty - onOrder);
      const surplusQty = Math.max(0, onHand - requiredQty);

      return {
        ...m,
        direct_required_qty: directReq,
        sfg_exploded_qty: sfgExplodedReq,
        required_qty: requiredQty,
        to_purchase_qty: toPurchaseQty,
        net_after_po_qty: netAfterPoQty,
        surplus_qty: surplusQty,
        pending_orders: pendingOrdersMap[m.code] || [],
        warehouse_stocks: {
          "01": Number(m.wh_01_stock || 0),
          "8": Number(m.wh_8_stock || 0),
          "10": Number(m.wh_10_stock || 0),
          ...(whsMap[m.code] || {})
        }
      };
    });

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Warehouses from SAP OWHS ---
router.get("/warehouses", async (req, res) => {
  try {
    const query = `
      SELECT 
        "WhsCode" AS "code",
        "WhsName" AS "name"
      FROM "OWHS"
      ORDER BY "WhsCode" ASC
    `;
    const [rows] = await db.execute(query);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Available FG & SFG Items in SAP OITM (including those without a BOM yet) ---
router.get("/available-items", async (req, res) => {
  try {
    const query = `
      SELECT 
        T0."ItemCode" AS "code",
        T0."ItemName" AS "name",
        T0."ItmsGrpCod" AS "item_group",
        COALESCE(T0."Phantom", 'N') AS "phantom",
        CAST(COALESCE(T0."OnHand", 0) AS DOUBLE) AS "on_hand",
        CASE WHEN B."Code" IS NOT NULL THEN 1 ELSE 0 END AS "has_bom",
        CASE 
          WHEN T0."Phantom" = 'Y' OR T0."ItemCode" LIKE 'SFG%' OR T0."ItmsGrpCod" = 107 THEN 1 
          ELSE 0 
        END AS "is_intermediate"
      FROM "OITM" T0
      LEFT JOIN "OITT" B ON T0."ItemCode" = B."Code"
      WHERE T0."ItmsGrpCod" IN (102, 107) OR T0."ItemCode" LIKE 'FG%' OR T0."ItemCode" LIKE 'SFG%'
      ORDER BY "is_intermediate" ASC, T0."ItemCode" ASC
    `;
    const [rows] = await db.execute(query);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Update Production Standard Cost in SAP Item Master strictly via Service Layer ---
router.put("/std-cost/batch", async (req, res) => {
  try {
    const { updates } = req.body;
    if (!Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({ error: "No updates provided" });
    }

    const results = [];
    for (const item of updates) {
      const itemCode = item.code || item.itemCode || item.id;
      const numericCost = Number(item.prod_std_cost);
      if (!itemCode || isNaN(numericCost) || numericCost < 0) {
        throw new Error("Invalid Production Standard Cost for item " + itemCode);
      }
      await serviceLayer.patch("/Items('" + encodeURIComponent(itemCode) + "')", {
        ProdStdCost: numericCost
      });
      results.push({ code: itemCode, prod_std_cost: numericCost });
    }

    res.json({
      message: "Updated Production Standard Cost for " + results.length + " item(s) via SAP Service Layer",
      results
    });
  } catch (err) {
    console.error("[ServiceLayer] Batch ProdStdCost update error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.put("/:itemCode/std-cost", async (req, res) => {
  try {
    const { itemCode } = req.params;
    const { prod_std_cost } = req.body;
    const numericCost = Number(prod_std_cost);

    if (prod_std_cost === undefined || prod_std_cost === null || isNaN(numericCost) || numericCost < 0) {
      return res.status(400).json({ error: "Valid Production Standard Cost is required" });
    }

    await serviceLayer.patch("/Items('" + encodeURIComponent(itemCode) + "')", {
      ProdStdCost: numericCost
    });

    res.json({
      message: "Updated Production Standard Cost for " + itemCode + " to ₹" + numericCost.toFixed(2) + " via SAP Service Layer",
      code: itemCode,
      prod_std_cost: numericCost
    });
  } catch (err) {
    console.error("[ServiceLayer] Failed to update ProdStdCost for " + req.params.itemCode + ":", err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- Finished Goods & Sub-Assemblies with BOMs in SAP (OITT + OITM) ---
router.get("/goods", async (req, res) => {
  try {
    const query = `
      SELECT 
        T0."Code" AS "id",
        T0."Code" AS "code",
        COALESCE(P."ItemName", T0."Name", T0."Code") AS "name",
        CAST(T0."Qauntity" AS DOUBLE) AS "batch_qty",
        T0."TreeType" AS "bom_type",
        T0."ToWH" AS "warehouse",
        COALESCE(P."Phantom", 'N') AS "phantom",
        CAST(COALESCE(P."OnHand", 0) AS DOUBLE) AS "on_hand",
        CAST(COALESCE(P."PrdStdCst", 0) AS DOUBLE) AS "prod_std_cost",
        CAST(COALESCE(P."LastPurPrc", 0) AS DOUBLE) AS "last_purchase_cost",
        CASE 
          WHEN P."Phantom" = 'Y' OR T0."Code" LIKE 'SFG%' OR P."ItmsGrpCod" = 107 THEN 1 
          ELSE 0 
        END AS "is_intermediate"
      FROM "OITT" T0
      LEFT JOIN "OITM" P ON T0."Code" = P."ItemCode"
      ORDER BY "is_intermediate" ASC, T0."Code" ASC
    `;
    const [rows] = await db.execute(query);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Bill of Materials (BOM) Rows from SAP (ITT1 + OITT + OITM + OINM) ---
router.get("/boms/all", async (req, res) => {
  try {
    const query = `
      SELECT 
        T1."Father" || '_' || CAST(T1."ChildNum" AS VARCHAR) AS "id",
        T1."Father" AS "finished_good_id",
        T1."ChildNum" AS "line_num",
        CASE 
          WHEN CHILD_BOM."Code" IS NOT NULL OR C."Phantom" = 'Y' OR T1."Code" LIKE 'SFG%' OR C."ItmsGrpCod" = 107 THEN NULL 
          ELSE T1."Code" 
        END AS "raw_material_id",
        CASE 
          WHEN CHILD_BOM."Code" IS NOT NULL OR C."Phantom" = 'Y' OR T1."Code" LIKE 'SFG%' OR C."ItmsGrpCod" = 107 THEN T1."Code" 
          ELSE NULL 
        END AS "child_good_id",
        CAST(T1."Quantity" AS DOUBLE) AS "quantity_required",
        T1."Code" AS "item_code",
        COALESCE(C."ItemName", T1."Code") AS "raw_name",
        COALESCE(C."ItemName", T1."Code") AS "child_name",
        COALESCE(C."InvntryUom", 'Kg') AS "raw_uom",
        T1."Warehouse" AS "warehouse",
        T1."IssueMthd" AS "issue_method",
        COALESCE(C."Phantom", 'N') AS "phantom",
        CAST(COALESCE(C."OnHand", 0) AS DOUBLE) AS "on_hand",
        CAST(COALESCE(C."PrdStdCst", 0) AS DOUBLE) AS "prod_std_cost",
        CAST(COALESCE(LC."Price", NULLIF(C."LastPurPrc", 0), NULLIF(C."AvgPrice", 0), 0) AS DOUBLE) AS "last_purchase_cost",
        CAST(COALESCE(LC."Price", NULLIF(C."LastPurPrc", 0), NULLIF(C."AvgPrice", 0), 0) AS DOUBLE) AS "raw_cost",
        CASE WHEN CHILD_BOM."Code" IS NOT NULL THEN 1 ELSE 0 END AS "has_child_bom"
      FROM "ITT1" T1
      INNER JOIN "OITT" T0 ON T1."Father" = T0."Code"
      LEFT JOIN "OITM" C ON T1."Code" = C."ItemCode"
      LEFT JOIN "OITT" CHILD_BOM ON T1."Code" = CHILD_BOM."Code"
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
      ) LC ON T1."Code" = LC."ItemCode"
      ORDER BY T1."Father" ASC, T1."ChildNum" ASC
    `;
    const [rows] = await db.execute(query);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Create New BOM for an existing SAP FG or SFG Item strictly via SAP Service Layer ---
router.post("/bom", async (req, res) => {
  try {
    const {
      treeCode,
      treeType = "iProductionTree",
      quantity = 1,
      warehouse = "01",
      lines = []
    } = req.body;

    if (!treeCode || !String(treeCode).trim()) {
      return res.status(400).json({ error: "Please select an existing Finished Good (FG) or Semi-Finished Good (SFG) from SAP Item Master." });
    }
    if (!Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ error: "At least one BOM component line (RM or SFG) is required." });
    }

    const cleanCode = String(treeCode).trim();

    // 1. Verify Parent Item exists in OITM and is strictly FG (102) or SFG (107)
    const [parentRows] = await db.execute(
      `SELECT "ItemCode", "ItmsGrpCod" FROM "OITM" WHERE "ItemCode" = ?`,
      [cleanCode]
    );

    if (!parentRows || parentRows.length === 0) {
      return res.status(400).json({
        error: "Item " + cleanCode + " does not exist in SAP Item Master (OITM). Please create the Item Master in SAP first."
      });
    }

    const parentGrp = Number(parentRows[0].ItmsGrpCod);
    const isValidParent = parentGrp === 102 || parentGrp === 107 || cleanCode.toUpperCase().startsWith("FG") || cleanCode.toUpperCase().startsWith("SFG");
    if (!isValidParent) {
      return res.status(400).json({
        error: "BOM can only be created for Finished Goods (FG) or Semi-Finished Goods (SFG)."
      });
    }

    // 2. Verify all Component Lines are strictly Raw Materials (101 / RM%) or Semi-Finished Goods (107 / SFG%)
    for (const l of lines) {
      const compCode = String(l.itemCode || "").trim();
      if (!compCode) {
        return res.status(400).json({ error: "Every component line must have a valid RM or SFG item code." });
      }
      if (compCode === cleanCode) {
        return res.status(400).json({ error: "Parent item " + cleanCode + " cannot be a component of its own BOM." });
      }
      const [compRows] = await db.execute(
        `SELECT "ItemCode", "ItmsGrpCod" FROM "OITM" WHERE "ItemCode" = ?`,
        [compCode]
      );
      if (!compRows || compRows.length === 0) {
        return res.status(400).json({ error: "Component " + compCode + " does not exist in SAP Item Master." });
      }
      const compGrp = Number(compRows[0].ItmsGrpCod);
      const isValidComp = compGrp === 101 || compGrp === 107 || compCode.toUpperCase().startsWith("RM") || compCode.toUpperCase().startsWith("SFG");
      if (!isValidComp) {
        return res.status(400).json({
          error: "Component " + compCode + " is not allowed. BOM components must be Raw Materials (RM) or Semi-Finished Goods (SFG) only."
        });
      }
    }

    const totalLineQty = lines.reduce((sum, l) => sum + (Number(l.quantity) || 0), 0);
    const headerQty = Number(quantity) > 0 ? Number(quantity) : (totalLineQty > 0 ? totalLineQty : 1);

    const payload = {
      TreeCode: cleanCode,
      TreeType: treeType,
      Quantity: headerQty,
      Warehouse: warehouse || "01",
      ProductTreeLines: lines.map((l) => ({
        ItemCode: String(l.itemCode).trim(),
        Quantity: Number(l.quantity),
        Warehouse: l.warehouse || warehouse || "01",
        IssueMethod: l.issueMethod || "im_Backflush"
      }))
    };

    const [existingBom] = await db.execute(
      `SELECT "Code" FROM "OITT" WHERE "Code" = ?`,
      [cleanCode]
    );

    let result;
    if (existingBom && existingBom.length > 0) {
      result = await serviceLayer.patch(
        "/ProductTrees('" + encodeURIComponent(cleanCode) + "')",
        {
          Quantity: headerQty,
          Warehouse: warehouse || "01",
          ProductTreeLines: payload.ProductTreeLines
        },
        { "B1S-ReplaceCollectionsOnPatch": "true" }
      );
      return res.status(200).json({
        message: "Updated BOM for " + cleanCode + " in SAP via Service Layer",
        result
      });
    } else {
      result = await serviceLayer.post("/ProductTrees", payload);
      return res.status(201).json({
        message: "Created BOM for " + cleanCode + " in SAP via Service Layer",
        result
      });
    }
  } catch (err) {
    console.error("[ServiceLayer] Create BOM error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- Update Existing BOM strictly via SAP Service Layer ---
router.put("/bom/:treeCode", async (req, res) => {
  try {
    const { treeCode } = req.params;
    const { quantity, warehouse = "01", lines } = req.body;

    if (Array.isArray(lines)) {
      for (const l of lines) {
        const compCode = String(l.itemCode || "").trim();
        const [compRows] = await db.execute(
          `SELECT "ItemCode", "ItmsGrpCod" FROM "OITM" WHERE "ItemCode" = ?`,
          [compCode]
        );
        if (!compRows || compRows.length === 0) {
          return res.status(400).json({ error: "Component " + compCode + " does not exist in SAP Item Master." });
        }
        const compGrp = Number(compRows[0].ItmsGrpCod);
        const isValidComp = compGrp === 101 || compGrp === 107 || compCode.toUpperCase().startsWith("RM") || compCode.toUpperCase().startsWith("SFG");
        if (!isValidComp) {
          return res.status(400).json({
            error: "Component " + compCode + " is not allowed. BOM components must be Raw Materials (RM) or Semi-Finished Goods (SFG) only."
          });
        }
      }
    }

    const payload = {};
    if (quantity !== undefined && Number(quantity) > 0) {
      payload.Quantity = Number(quantity);
    }
    if (warehouse) {
      payload.Warehouse = warehouse;
    }
    if (Array.isArray(lines) && lines.length > 0) {
      payload.ProductTreeLines = lines.map((l) => ({
        ItemCode: String(l.itemCode).trim(),
        Quantity: Number(l.quantity),
        Warehouse: l.warehouse || warehouse || "01",
        IssueMethod: l.issueMethod || "im_Backflush"
      }));
    }

    const result = await serviceLayer.patch(
      "/ProductTrees('" + encodeURIComponent(treeCode) + "')",
      payload,
      { "B1S-ReplaceCollectionsOnPatch": "true" }
    );
    res.json(result || { message: "Updated BOM for " + treeCode + " via SAP Service Layer" });
  } catch (err) {
    console.error("[ServiceLayer] Update BOM error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
