const express = require("express");
const router = express.Router();
const db = require("../db");
const serviceLayer = require("../serviceLayer");

// Read Production Orders from SAP OWOR
router.get("/", async (req, res) => {
  try {
    const [runs] = await db.query(`
      SELECT 
        T0."DocEntry" AS "id",
        T0."DocNum" AS "doc_num",
        T0."ItemCode" AS "finished_good_id",
        T1."ItemName" AS "finished_good_name",
        CAST(T0."PlannedQty" AS DOUBLE) AS "quantity_planned",
        CAST(T0."CmpltQty" AS DOUBLE) AS "quantity_actual",
        T0."Status" AS "status",
        T0."PostDate" AS "created_at"
      FROM "OWOR" T0
      LEFT JOIN "OITM" T1 ON T0."ItemCode" = T1."ItemCode"
      ORDER BY T0."DocEntry" DESC
    `);
    res.json(runs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create Production Order in SAP strictly via Service Layer
router.post("/", async (req, res) => {
  try {
    const { finished_good_id, quantity_planned, warehouse = "01", dueDate } = req.body;
    const payload = {
      ItemNo: finished_good_id,
      PlannedQuantity: Number(quantity_planned),
      Warehouse: warehouse,
      DueDate: dueDate || new Date().toISOString().split("T")[0]
    };
    const result = await serviceLayer.post("/ProductionOrders", payload);
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
