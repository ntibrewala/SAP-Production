require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
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

// Serve the frontend React build
app.use(express.static(path.join(__dirname, "../frontend/dist")));
app.use((req, res, next) => {
  const rootPath = path.join(__dirname, "../frontend/dist");
  res.sendFile("index.html", { root: rootPath }, (err) => {
    if (err) {
      console.error("Error sending file:", err);
      next(err);
    }
  });
});

const PORT = process.env.PORT || 5002;
app.listen(PORT, () => {
  const cfg = loadSAPConfig();
  console.log(`SAP-Production Server running on port ${PORT} (Schema: ${cfg.schema}, Config: ${cfg.configPath})`);
});
