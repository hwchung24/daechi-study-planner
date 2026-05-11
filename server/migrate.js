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
      CREATE UNIQUE INDEX IF NOT EXISTS uq_pslr_pending_student
      ON parent_student_link_requests (student_user_id)
      WHERE status = 'pending';
    `);
  } catch (error) {
    console.warn(
      "Skipping uq_pslr_pending_student index; existing duplicate pending student requests may need cleanup.",
      error?.message || error
    );
  }
  try {
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_parents_students_single_student
      ON parents_students (student_id);
    `);
  } catch (error) {
    console.warn(
      "Skipping uq_parents_students_single_student index; existing multi-admin student links may need cleanup.",
      error?.message || error
    );
  }
  try {
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_psur_pending_pair
      ON parent_student_unlink_requests (parent_user_id, student_user_id)
      WHERE status = 'pending';
    `);
  } catch {
    // ignore
  }

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS parent_coach_customizations (
        parent_user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        persona TEXT NOT NULL DEFAULT '다정하지만 기준이 분명한 학습 코치',
        tone TEXT NOT NULL DEFAULT '따뜻하고 또렷한 존댓말로, 공감 뒤에 바로 실행 행동을 제시한다.',
        control_intensity INTEGER NOT NULL DEFAULT 3 CHECK (control_intensity BETWEEN 1 AND 5),
        focus_rules TEXT NOT NULL DEFAULT '해야 할 일을 작게 쪼개 바로 시작하게 돕고, 미루는 핑계는 부드럽지만 분명하게 바로잡는다.',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
  } catch {
    // ignore
  }
  try {
    await pool.query(`
      ALTER TABLE parent_coach_customizations
      ADD COLUMN IF NOT EXISTS persona TEXT NOT NULL DEFAULT '다정하지만 기준이 분명한 학습 코치';
    `);
  } catch {
    // ignore
  }
  try {
    await pool.query(`
      ALTER TABLE parent_coach_customizations
      ADD COLUMN IF NOT EXISTS tone TEXT NOT NULL DEFAULT '따뜻하고 또렷한 존댓말로, 공감 뒤에 바로 실행 행동을 제시한다.';
    `);
  } catch {
    // ignore
  }
  try {
    await pool.query(`
      ALTER TABLE parent_coach_customizations
      ADD COLUMN IF NOT EXISTS control_intensity INTEGER NOT NULL DEFAULT 3;
    `);
  } catch {
    // ignore
  }
  try {
    await pool.query(`
      ALTER TABLE parent_coach_customizations
      ADD COLUMN IF NOT EXISTS focus_rules TEXT NOT NULL DEFAULT '해야 할 일을 작게 쪼개 바로 시작하게 돕고, 미루는 핑계는 부드럽지만 분명하게 바로잡는다.';
    `);
  } catch {
    // ignore
  }
  try {
    await pool.query(`
      ALTER TABLE parent_coach_customizations
      DROP CONSTRAINT IF EXISTS parent_coach_customizations_control_intensity_check;
    `);
  } catch {
    // ignore
  }
  try {
    await pool.query(`
      ALTER TABLE parent_coach_customizations
      ADD CONSTRAINT parent_coach_customizations_control_intensity_check
      CHECK (control_intensity BETWEEN 1 AND 5);
    `);
  } catch {
    // ignore
  }
  try {
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_parent_coach_customizations_updated
      ON parent_coach_customizations (updated_at DESC);
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
      ALTER TABLE student_coach_profiles
      ADD COLUMN IF NOT EXISTS goal_university TEXT;
    `);
  } catch {
    // ignore
  }
  try {
    await pool.query(`
      ALTER TABLE student_coach_profiles
      ADD COLUMN IF NOT EXISTS target_grade TEXT;
    `);
  } catch {
    // ignore
  }
  try {
    await pool.query(`
      ALTER TABLE student_coach_profiles
      ADD COLUMN IF NOT EXISTS current_concern TEXT;
    `);
  } catch {
    // ignore
  }
  try {
    await pool.query(`
      ALTER TABLE student_coach_profiles
      ADD COLUMN IF NOT EXISTS weakness TEXT;
    `);
  } catch {
    // ignore
  }
  try {
    await pool.query(`
      ALTER TABLE student_coach_profiles
      ADD COLUMN IF NOT EXISTS alarm_schedule_reminders BOOLEAN NOT NULL DEFAULT true;
    `);
  } catch {
    // ignore
  }
  try {
    await pool.query(`
      ALTER TABLE student_coach_profiles
      ADD COLUMN IF NOT EXISTS alarm_parent_link_alerts BOOLEAN NOT NULL DEFAULT true;
    `);
  } catch {
    // ignore
  }
  try {
    await pool.query(`
      ALTER TABLE student_coach_profiles
      ADD COLUMN IF NOT EXISTS alarm_study_room_alerts BOOLEAN NOT NULL DEFAULT true;
    `);
  } catch {
    // ignore
  }
  try {
    await pool.query(`
      ALTER TABLE student_coach_profiles
      ADD COLUMN IF NOT EXISTS alarm_message_alerts BOOLEAN NOT NULL DEFAULT true;
    `);
  } catch {
    // ignore
  }
  try {
    await pool.query(`
      ALTER TABLE student_coach_profiles
      ADD COLUMN IF NOT EXISTS alarm_homework_alerts BOOLEAN NOT NULL DEFAULT true;
    `);
  } catch {
    // ignore
  }
  try {
    await pool.query(`
      ALTER TABLE student_coach_profiles
      ADD COLUMN IF NOT EXISTS wake_alarm_enabled BOOLEAN NOT NULL DEFAULT false;
    `);
  } catch {
    // ignore
  }
  try {
    await pool.query(`
      ALTER TABLE student_coach_profiles
      ADD COLUMN IF NOT EXISTS wake_alarm_time TEXT NOT NULL DEFAULT '06:30';
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
        radius_meters INTEGER NOT NULL DEFAULT 120 CHECK (radius_meters BETWEEN 30 AND 1000),
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
      ALTER TABLE parent_student_study_rooms
      ADD COLUMN IF NOT EXISTS radius_meters INTEGER NOT NULL DEFAULT 120;
    `);
  } catch {
    // ignore
  }
  try {
    await pool.query(`
      UPDATE parent_student_study_rooms
      SET radius_meters = 120
      WHERE radius_meters IS NULL;
    `);
  } catch {
    // ignore
  }
  try {
    await pool.query(`
      ALTER TABLE parent_student_study_rooms
      DROP CONSTRAINT IF EXISTS parent_student_study_rooms_radius_meters_check;
    `);
  } catch {
    // ignore
  }
  try {
    await pool.query(`
      ALTER TABLE parent_student_study_rooms
      ADD CONSTRAINT parent_student_study_rooms_radius_meters_check
      CHECK (radius_meters BETWEEN 30 AND 1000);
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
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS student_last_known_locations (
        student_user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        latitude DOUBLE PRECISION NOT NULL,
        longitude DOUBLE PRECISION NOT NULL,
        accuracy DOUBLE PRECISION,
        occurred_at TIMESTAMPTZ NOT NULL,
        received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
  } catch {
    // ignore
  }
  try {
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_skl_occurred_at
        ON student_last_known_locations (occurred_at DESC);
    `);
  } catch {
    // ignore
  }
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_push_tokens (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        platform TEXT NOT NULL CHECK (platform IN ('ios')),
        device_token TEXT NOT NULL,
        bundle_id TEXT,
        active BOOLEAN NOT NULL DEFAULT true,
        last_registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_sent_at TIMESTAMPTZ,
        last_error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (platform, device_token)
      );
    `);
  } catch {
    // ignore
  }
  try {
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_upt_user_active
        ON user_push_tokens (user_id, updated_at DESC)
        WHERE active = true;
    `);
  } catch {
    // ignore
  }
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS student_parent_chat_messages (
        id BIGSERIAL PRIMARY KEY,
        student_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        parent_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        sender_role TEXT NOT NULL CHECK (sender_role IN ('student', 'parent')),
        content TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
  } catch {
    // ignore
  }
  try {
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_student_parent_chat_pair
        ON student_parent_chat_messages (student_user_id, parent_user_id, created_at DESC);
    `);
  } catch {
    // ignore
  }
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS student_homework_submissions (
        id BIGSERIAL PRIMARY KEY,
        student_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        parent_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        original_name TEXT NOT NULL,
        stored_name TEXT NOT NULL,
        file_url TEXT NOT NULL,
        mime_type TEXT,
        file_size BIGINT,
        note TEXT,
        review_status TEXT NOT NULL DEFAULT 'pending'
          CHECK (review_status IN ('pending', 'approved', 'needs_revision')),
        review_comment TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        reviewed_at TIMESTAMPTZ
      );
    `);
  } catch {
    // ignore
  }
  try {
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_student_homework_pair
        ON student_homework_submissions (student_user_id, parent_user_id, created_at DESC);
    `);
  } catch {
    // ignore
  }
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS parent_student_app_mode_schedules (
        id BIGSERIAL PRIMARY KEY,
        parent_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        student_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        slots JSONB NOT NULL DEFAULT '[]'::jsonb,
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
      CREATE INDEX IF NOT EXISTS idx_psams_parent_student
        ON parent_student_app_mode_schedules (parent_user_id, student_user_id);
    `);
  } catch {
    // ignore
  }
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS parent_signup_phone_otps (
        phone_normalized TEXT PRIMARY KEY,
        code_hash        TEXT NOT NULL,
        expires_at       TIMESTAMPTZ NOT NULL,
        attempt_count    INT NOT NULL DEFAULT 0,
        last_sent_at     TIMESTAMPTZ NOT NULL DEFAULT now()
      );
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
