const fs = require("fs");
const path = require("path");
require("dotenv").config();

const { pool } = require("./db");

async function main() {
  const schemaPath = path.join(__dirname, "schema.sql");
  const sql = fs.readFileSync(schemaPath, "utf8");
  await pool.query(sql);
  console.log("Migration applied from schema.sql");
}

main()
  .catch(err => {
    console.error("Migration failed:", err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
