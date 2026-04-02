const fs = require("fs");
const path = require("path");
require("dotenv").config();

const { pool } = require("./db");

async function main() {
  const schemaPath = path.join(__dirname, "schema.sql");
  const sql = fs.readFileSync(schemaPath, "utf8");
  await pool.query(sql);
  console.log("Migration applied from schema.sql");

  // 기존 DB에 전체 UNIQUE가 남아 있으면 제거 후 pending 전용 인덱스만 유지
  try {
    await pool.query(`
      ALTER TABLE parent_student_link_requests
      DROP CONSTRAINT IF EXISTS parent_student_link_requests_parent_user_id_student_user_id_key;
    `);
  } catch {
    // 테이블 없음 등 무시
  }
  try {
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_pslr_pending_pair
      ON parent_student_link_requests (parent_user_id, student_user_id)
      WHERE status = 'pending';
    `);
  } catch {
    // ignore
  }
}

main()
  .catch(err => {
    console.error("Migration failed:", err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
