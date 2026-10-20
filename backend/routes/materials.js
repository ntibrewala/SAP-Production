const express = require("express");
const router = express.Router();
const db = require("../db");
const serviceLayer = require("../serviceLayer");

// --- Raw Materials (from SAP OITM + OINM) ---
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
        CAST(COALESCE(T0."OnHand", 0) AS DOUBLE) AS "stock_level"
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
      WHERE T0."ItemCode" LIKE 'RM%' OR T0."ItmsGrpCod" = 101
      ORDER BY T0."ItemCode" ASC
    `;
    const [materials] = await db.query(query);
    res.json(materials);
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
        CASE WHEN B."Code" IS NOT NULL THEN 1 ELSE 0 END AS "has_bom",
        CASE 
          WHEN T0."Phantom" = 'Y' OR T0."ItemCode" LIKE 'SFG%' OR T0."ItmsGrpCod" = 107 THEN 1 
          ELSE 0 
        END AS "is_intermediate"
      FROM "OITM" T0
      LEFT JOIN "OITT" B ON T0."ItemCode" = B."Code"
      WHERE T0."ItmsGrpCod" IN (102, 107) OR T0."ItemCode" LIKE 'FG%' OR T0."ItemCode" LIKE 'SFG%'
      ORDER BY "has_bom" ASC, "is_intermediate" ASC, T0."ItemCode" ASC
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

    const result = await serviceLayer.post("/ProductTrees", payload);
    res.status(201).json({
      message: "Created BOM for " + cleanCode + " in SAP via Service Layer",
      result
    });
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
