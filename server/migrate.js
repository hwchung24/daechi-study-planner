const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

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

  try {
    await pool.query(`
      ALTER TABLE study_blocks ADD COLUMN IF NOT EXISTS book_id BIGINT REFERENCES study_books(id) ON DELETE SET NULL;
    `);
  } catch {
    // ignore
  }
  try {
    await pool.query(`
      ALTER TABLE study_blocks ADD COLUMN IF NOT EXISTS planned_range TEXT;
    `);
  } catch {
    // ignore
  }
  try {
    await pool.query(`
      ALTER TABLE student_coach_logs ADD COLUMN IF NOT EXISTS tomorrow_practice TEXT;
    `);
  } catch {
    // ignore
  }
  try {
    await pool.query(`
      ALTER TABLE student_coach_logs ADD COLUMN IF NOT EXISTS study_evaluation TEXT;
    `);
  } catch {
    // ignore
  }
  try {
    await pool.query(`
      ALTER TABLE student_coach_logs ADD COLUMN IF NOT EXISTS metacognition_reflection TEXT;
    `);
  } catch {
    // ignore
  }
  try {
    await pool.query(`
      ALTER TABLE student_coach_logs ADD COLUMN IF NOT EXISTS tomorrow_practice_done BOOLEAN;
    `);
  } catch {
    // ignore
  }
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS parent_plan_add_requests (
        id BIGSERIAL PRIMARY KEY,
        student_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        target_date TEXT NOT NULL,
        book_id BIGINT NOT NULL REFERENCES study_books(id) ON DELETE CASCADE,
        planned_range TEXT,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        subject_snapshot TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'approved', 'rejected')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        resolved_at TIMESTAMPTZ,
        resolved_by_parent_user_id BIGINT NULL REFERENCES users(id) ON DELETE SET NULL
      );
    `);
  } catch {
    // ignore
  }
  try {
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_ppadd_pending_parent_queue
        ON parent_plan_add_requests (status, created_at);
    `);
  } catch {
    // ignore
  }
  try {
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_ppadd_student_pending
        ON parent_plan_add_requests (student_user_id)
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
