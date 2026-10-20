const fs = require("fs");
const path = require("path");
require("dotenv").config();

const CANDIDATE_PATHS = [
  process.env.SAP_CONFIG_PATH,
  "D:\\BHV\\Config\\SAPConfig.json",
  "D:/BHV/Config/SAPConfig.json",
  "D:\\bhv\\config\\SAPConfig.json",
  "D:\\BHV\\Config\\SapConfig.gs.json",
  path.join(__dirname, "SAPConfig.json"),
  path.join(__dirname, "..", "SAPConfig.json")
].filter(Boolean);

let cachedConfig = null;

function loadSAPConfig(forceReload = false) {
  if (cachedConfig && !forceReload) return cachedConfig;

  let rawData = null;
  let loadedPath = null;

  for (const candidate of CANDIDATE_PATHS) {
    try {
      if (fs.existsSync(candidate)) {
        rawData = fs.readFileSync(candidate);
        loadedPath = candidate;
        break;
      }
    } catch (_) {
      // Continue checking next candidate path
    }
  }

  let parsed = {};
  if (rawData) {
    // Strip UTF-8 BOM if present
    if (rawData.length >= 3 && rawData[0] === 0xef && rawData[1] === 0xbb && rawData[2] === 0xbf) {
      rawData = rawData.subarray(3);
    }
    parsed = JSON.parse(rawData.toString("utf8"));
    console.log(`[SAPConfig] Loaded configuration from ${loadedPath}`);
  } else {
    console.warn("[SAPConfig] D:\\BHV\\Config\\SAPConfig.json not found locally, using environment/fallback values.");
  }

  const hanaSection = parsed.HANA || {};
  const sapSection = parsed.SAP || {};
  const slSection = parsed.ServiceLayer || {};
  const jaySection =
    parsed.JAY_EXTRUTECH ||
    parsed.JayExtrutech ||
    sapSection.JAY_EXTRUTECH ||
    sapSection.JayExtrutech ||
    {};
  const roConfig = hanaSection.ReadOnlyConfig || {};
  const rwConfig = hanaSection.ReadWrite || {};

  const hanaServer = (
    process.env.HANA_SERVER_NODE ||
    hanaSection.Server ||
    "10.10.0.12:30015"
  ).trim();

  const hanaRoUser = (
    process.env.HANA_USER_ID ||
    roConfig.UserID ||
    rwConfig.UserID ||
    "HANA_RO"
  ).trim();

  const hanaRoPassword = (
    process.env.HANA_PASSWORD ||
    roConfig.Password ||
    rwConfig.Password ||
    "Whybhav@1234"
  ).trim();

  const hanaRwUser = (rwConfig.UserID || hanaRoUser).trim();
  const hanaRwPassword = (rwConfig.Password || hanaRoPassword).trim();

  const schema = (
    process.env.HANA_SCHEMA ||
    process.env.SAP_COMPANY_DB ||
    hanaSection.JaySchema ||
    sapSection.JaySchema ||
    parsed.CompanyDB ||
    "JAY_EXTRUTECH"
  ).trim();

  const serviceLayerUrl = (
    process.env.SERVICE_LAYER_URL ||
    slSection.URL ||
    "https://10.10.0.12:50000/b1s/v1"
  ).trim().replace(/\/+$/, "");

  const isJay = schema.toUpperCase() === "JAY_EXTRUTECH";

  const sapUser = (
    process.env.SAP_USER ||
    (isJay && (
      sapSection.JayUserName ||
      sapSection.JayUser ||
      sapSection.JayExtrutechUser ||
      sapSection.JayExtrutechUserName ||
      sapSection.JAY_EXTRUTECH_UserName ||
      sapSection.JAY_EXTRUTECH_User ||
      jaySection.UserName ||
      jaySection.User ||
      parsed.JayUserName ||
      parsed.JayExtrutechUser
    )) ||
    sapSection.UserName ||
    "manager"
  ).trim();

  const sapPassword = (
    process.env.SAP_PASSWORD ||
    (isJay && (
      sapSection.JayPassword ||
      sapSection.JayExtrutechPassword ||
      sapSection.JAY_EXTRUTECH_Password ||
      jaySection.Password ||
      (sapSection.Passwords && sapSection.Passwords.JAY_EXTRUTECH) ||
      parsed.JayPassword ||
      parsed.JayExtrutechPassword
    )) ||
    sapSection.Password ||
    ""
  ).trim();

  cachedConfig = {
    configPath: loadedPath || "D:\\BHV\\Config\\SAPConfig.json",
    schema,
    companyDB: schema,
    HANA: {
      serverNode: hanaServer,
      readOnly: {
        uid: hanaRoUser,
        pwd: hanaRoPassword
      },
      readWrite: {
        uid: hanaRwUser,
        pwd: hanaRwPassword
      }
    },
    SAP: {
      userName: sapUser,
      password: sapPassword
    },
    ServiceLayer: {
      url: serviceLayerUrl
    }
  };

  return cachedConfig;
}

module.exports = {
  loadSAPConfig
};
