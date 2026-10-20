const hana = require("@sap/hana-client");
const { loadSAPConfig } = require("./sapConfig");

function execHana(sql, params = [], customSchema = null) {
  const cfg = loadSAPConfig();
  const schema = customSchema || cfg.schema;
  const connOptions = {
    serverNode: cfg.HANA.serverNode,
    uid: cfg.HANA.readOnly.uid,
    pwd: cfg.HANA.readOnly.pwd
  };

  const connection = hana.createConnection();

  return new Promise((resolve, reject) => {
    connection.connect(connOptions, (connErr) => {
      if (connErr) {
        return reject(new Error("SAP HANA connection error: " + connErr.message));
      }

      connection.exec(`SET SCHEMA "${schema}"`, (schemaErr) => {
        if (schemaErr) {
          connection.disconnect(() => {});
          return reject(new Error("SAP HANA SET SCHEMA error: " + schemaErr.message));
        }

        const cb = (execErr, rows) => {
          connection.disconnect(() => {});
          if (execErr) {
            return reject(new Error("SAP HANA query error: " + execErr.message));
          }
          resolve([rows || []]);
        };

        if (params && params.length > 0) {
          connection.exec(sql, params, cb);
        } else {
          connection.exec(sql, cb);
        }
      });
    });
  });
}

module.exports = {
  query: (sql, params, schema) => execHana(sql, params, schema),
  execute: (sql, params, schema) => execHana(sql, params, schema)
};
