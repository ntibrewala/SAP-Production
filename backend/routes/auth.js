const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const db = require("../db");
const serviceLayer = require("../serviceLayer");
const { loadSAPConfig } = require("../sapConfig");

// GET /api/auth/users - List SAP Business One users from JAY_EXTRUTECH.OUSR
router.get("/users", async (req, res) => {
  try {
    const cfg = loadSAPConfig();
    const sql = `
      SELECT 
        "USERID" AS "id",
        "USER_CODE" AS "user_code",
        COALESCE("U_NAME", "USER_CODE") AS "user_name",
        COALESCE("SUPERUSER", 'N') AS "superuser",
        COALESCE("Locked", 'N') AS "locked"
      FROM "OUSR"
      WHERE "USER_CODE" NOT IN ('B1i', 'Workflow', 'Support', 'AlertSvc', 'EDsUser')
      ORDER BY "USERID" ASC
    `;
    const [rows] = await db.query(sql);
    res.json({
      schema: cfg.schema,
      users: rows || []
    });
  } catch (err) {
    console.error("[Auth] GET /api/auth/users error:", err.message);
    res.status(500).json({
      message: "Failed to load SAP users from OUSR",
      error: err.message
    });
  }
});

// POST /api/auth/login - Authenticate SAP Business One user against JAY_EXTRUTECH (OUSR + Service Layer)
router.post("/login", async (req, res) => {
  try {
    const cfg = loadSAPConfig();
    const rawUsername = req.body?.username;
    const password = req.body?.password;

    const username = String(rawUsername || "").trim();
    if (!username || password === undefined || password === null || String(password) === "") {
      return res.status(400).json({ message: "SAP User Code and Password are required." });
    }

    const lookupSql = `
      SELECT "USERID", "USER_CODE", "U_NAME", "SUPERUSER", "Locked"
      FROM "OUSR"
      WHERE UPPER("USER_CODE") = UPPER(?) OR UPPER("U_NAME") = UPPER(?)
    `;
    const [rows] = await db.query(lookupSql, [username, username]);

    if (!rows || rows.length === 0) {
      return res.status(401).json({
        message: "User '" + username + "' does not exist in SAP JAY_EXTRUTECH (OUSR)."
      });
    }

    // Prefer exact USER_CODE match if multiple rows match U_NAME
    const userRow =
      rows.find((r) => String(r.USER_CODE || "").toUpperCase() === username.toUpperCase()) ||
      rows[0];

    if (userRow.Locked === "Y") {
      return res.status(403).json({
        message: "SAP User '" + userRow.USER_CODE + "' is currently locked in SAP Business One."
      });
    }

    try {
      await serviceLayer.verifyUserLogin(userRow.USER_CODE, password);
    } catch (slErr) {
      console.error("[Auth] Service Layer login failed for " + userRow.USER_CODE + ":", slErr.message);
      return res.status(401).json({
        message: "Invalid SAP password for user '" + userRow.USER_CODE + "' (or Service Layer login rejected)."
      });
    }

    const role = userRow.SUPERUSER === "Y" ? "Superuser" : "User";
    const displayName = userRow.U_NAME || userRow.USER_CODE;

    const token = jwt.sign(
      {
        userId: userRow.USERID,
        username: userRow.USER_CODE,
        displayName,
        superuser: userRow.SUPERUSER,
        role,
        schema: cfg.schema
      },
      process.env.JWT_SECRET || "supersecretkey_change_me",
      { expiresIn: "7d" }
    );

    return res.json({
      token,
      userId: userRow.USERID,
      username: userRow.USER_CODE,
      displayName,
      superuser: userRow.SUPERUSER,
      role,
      schema: cfg.schema
    });
  } catch (err) {
    console.error("[Auth] POST /api/auth/login error:", err.message);
    res.status(500).json({ message: "Server error during SAP authentication", error: err.message });
  }
});

module.exports = router;
