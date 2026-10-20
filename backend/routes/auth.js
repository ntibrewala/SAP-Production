const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");

router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ message: "Username and password required" });
    }
    const role = username.toLowerCase().includes("user") ? "User" : "Admin";
    const token = jwt.sign(
      { id: 1, username, role },
      process.env.JWT_SECRET || "supersecretkey_change_me",
      { expiresIn: "7d" }
    );
    res.json({ token, role, username });
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

module.exports = router;
