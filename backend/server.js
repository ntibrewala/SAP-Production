require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const { loadSAPConfig } = require("./sapConfig");

const app = express();
app.use(cors());
app.use(express.json());

// Import routes
const authRoutes = require("./routes/auth");
const materialRoutes = require("./routes/materials");
const productionRoutes = require("./routes/production");

app.use("/api/auth", authRoutes);
app.use("/api/materials", materialRoutes);
app.use("/api/production", productionRoutes);

// Health / Config Info endpoint
app.get("/api/sap-status", (req, res) => {
  const cfg = loadSAPConfig();
  res.json({
    status: "ok",
    configPath: cfg.configPath,
    schema: cfg.schema,
    hanaServer: cfg.HANA.serverNode,
    serviceLayerUrl: cfg.ServiceLayer.url
  });
});

// Serve the frontend React build (supports either ../frontendbuilt or ../frontend/dist)
const builtDir = fs.existsSync(path.join(__dirname, "../frontendbuilt/index.html"))
  ? path.join(__dirname, "../frontendbuilt")
  : path.join(__dirname, "../frontend/dist");

app.use(express.static(builtDir));
app.use((req, res, next) => {
  res.sendFile("index.html", { root: builtDir }, (err) => {
    if (err) {
      next(err);
    }
  });
});

const PORT = process.env.PORT || 5055;
app.listen(PORT, (err) => {
  if (err) {
    console.error(`Failed to start SAP-Production Server on port ${PORT}:`, err.message);
    process.exit(1);
  }
  const cfg = loadSAPConfig();
  console.log(`SAP-Production Server running on port ${PORT} (Schema: ${cfg.schema}, Config: ${cfg.configPath})`);
});
