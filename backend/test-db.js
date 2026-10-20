const db = require('./db');
async function test() {
  try {
    const [rows] = await db.execute('SELECT 1');
    console.log("DB connection successful");
  } catch (err) {
    console.log("DB connection failed:", err.message);
  }
  process.exit();
}
test();
