const express = require("express");
const router = express.Router();
const db = require("../db");
const serviceLayer = require("../serviceLayer");

// --- Raw Materials (from SAP OITM) ---
router.get("/", async (req, res) => {
  try {
    const query = `
      SELECT 
        T0."ItemCode" AS "id",
        T0."ItemCode" AS "code",
        T0."ItemName" AS "name",
        COALESCE(T0."InvntryUom", 'Kg') AS "uom",
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
      WHERE T0."ItemCode" LIKE 'RM%'
      ORDER BY T0."ItemCode" ASC
    `;
    const [materials] = await db.query(query);
    res.json(materials);
  } catch (err) {
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

// --- All SAP Entries / Writes strictly via SAP Business One Service Layer ---
router.post("/bom", async (req, res) => {
  try {
    const { treeCode, treeType = "iProductionTree", quantity = 1, warehouse = "01", lines = [] } = req.body;
    const payload = {
      TreeCode: treeCode,
      TreeType: treeType,
      Quantity: Number(quantity),
      Warehouse: warehouse,
      ProductTreeLines: lines.map((l) => ({
        ItemCode: l.itemCode,
        Quantity: Number(l.quantity),
        Warehouse: l.warehouse || warehouse,
        IssueMethod: l.issueMethod || "im_Backflush"
      }))
    };
    const result = await serviceLayer.post("/ProductTrees", payload);
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/bom/:treeCode", async (req, res) => {
  try {
    const { treeCode } = req.params;
    const result = await serviceLayer.patch(`/ProductTrees('${encodeURIComponent(treeCode)}')`, req.body);
    res.json(result || { message: "BOM updated via SAP Service Layer" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
