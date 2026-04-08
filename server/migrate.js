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
      ALTER TABLE student_coach_profiles
      ADD COLUMN IF NOT EXISTS initial_profile_completed BOOLEAN NOT NULL DEFAULT false;
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
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS parent_in_app_notifications (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL DEFAULT '',
        body TEXT,
        read_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
  } catch {
    // ignore
  }
  try {
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_pian_user_unread
        ON parent_in_app_notifications (user_id)
        WHERE read_at IS NULL;
    `);
  } catch {
    // ignore
  }
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS parent_student_study_rooms (
        id BIGSERIAL PRIMARY KEY,
        parent_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        student_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        address TEXT,
        latitude DOUBLE PRECISION NOT NULL,
        longitude DOUBLE PRECISION NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (parent_user_id, student_user_id)
      );
    `);
  } catch {
    // ignore
  }
  try {
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_pssr_parent_student
        ON parent_student_study_rooms (parent_user_id, student_user_id);
    `);
  } catch {
    // ignore
  }
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS parent_student_study_room_visit_sessions (
        id BIGSERIAL PRIMARY KEY,
        parent_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        student_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        study_room_id BIGINT REFERENCES parent_student_study_rooms(id) ON DELETE SET NULL,
        entered_at TIMESTAMPTZ NOT NULL,
        last_seen_at TIMESTAMPTZ NOT NULL,
        exited_at TIMESTAMPTZ,
        exit_reason TEXT,
        last_distance_meters DOUBLE PRECISION,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
  } catch {
    // ignore
  }
  try {
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_pssrv_student_entered
        ON parent_student_study_room_visit_sessions (student_user_id, entered_at DESC);
    `);
  } catch {
    // ignore
  }
  try {
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_pssrv_parent_student_entered
        ON parent_student_study_room_visit_sessions (parent_user_id, student_user_id, entered_at DESC);
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
