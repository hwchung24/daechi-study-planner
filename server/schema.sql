-- DB schema for Daechi Planner (PostgreSQL / Supabase)

-- 1. Users
CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('student', 'parent')),
  student_id    BIGINT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- Compatibility patch for old schema versions
ALTER TABLE users
ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- 2. Parents meta (for Kakao, notification prefs)
CREATE TABLE IF NOT EXISTS parents (
  id                 BIGSERIAL PRIMARY KEY,
  user_id            BIGINT NOT NULL UNIQUE,
  kakao_user_id      TEXT,
  phone              TEXT,
  notification_prefs JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 3. Mapping: parent ↔ student (many students per parent, future-proof many:many)
CREATE TABLE IF NOT EXISTS parents_students (
  parent_id  BIGINT NOT NULL,
  student_id BIGINT NOT NULL,
  PRIMARY KEY (parent_id, student_id),
  FOREIGN KEY (parent_id) REFERENCES parents(id) ON DELETE CASCADE,
  FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_parents_students_student ON parents_students(student_id);

-- 3b. Parent–student link requests (양쪽 확인 후에만 parents_students에 반영)
CREATE TABLE IF NOT EXISTS parent_student_link_requests (
  id BIGSERIAL PRIMARY KEY,
  parent_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  student_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  initiated_by TEXT NOT NULL CHECK (initiated_by IN ('parent', 'student')),
  parent_confirmed_at TIMESTAMPTZ,
  student_confirmed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 동일 부모–자녀 쌍에 대해 'pending' 요청은 하나만 (거절 후에는 다시 요청 가능)
CREATE UNIQUE INDEX IF NOT EXISTS uq_pslr_pending_pair
  ON parent_student_link_requests (parent_user_id, student_user_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_pslr_parent_pending
  ON parent_student_link_requests (parent_user_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_pslr_student_pending
  ON parent_student_link_requests (student_user_id)
  WHERE status = 'pending';

-- 4. Study days (per student, per date)
CREATE TABLE IF NOT EXISTS study_days (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL, -- student user id
  date       TEXT NOT NULL,    -- 'YYYY-MM-DD'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, date),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_study_days_user_date ON study_days(user_id, date);

-- 5. Study blocks (timeline)
CREATE TABLE IF NOT EXISTS study_blocks (
  id           BIGSERIAL PRIMARY KEY,
  study_day_id BIGINT NOT NULL,
  subject      TEXT NOT NULL,
  start_time   TEXT NOT NULL,   -- 'HH:MM'
  end_time     TEXT NOT NULL,   -- 'HH:MM'
  done         BOOLEAN NOT NULL DEFAULT false,
  focus_score  TEXT CHECK (focus_score IN ('◎', '○', '△', '✕') OR focus_score IS NULL),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (study_day_id) REFERENCES study_days(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_study_blocks_day ON study_blocks(study_day_id);

-- 6. Books used in progress tracking
CREATE TABLE IF NOT EXISTS study_books (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL, -- student owner
  name       TEXT NOT NULL,
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, name),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_study_books_user ON study_books(user_id);

-- 7. Plans / progress per day, per book
CREATE TABLE IF NOT EXISTS study_plans (
  id             BIGSERIAL PRIMARY KEY,
  study_day_id   BIGINT NOT NULL,
  book_id        BIGINT NOT NULL,
  planned_range  TEXT,       -- e.g. '10-20쪽', '2단원'
  start_time     TEXT,       -- optional: 'HH:MM'
  end_time       TEXT,       -- optional
  mid_pct        INTEGER CHECK (mid_pct BETWEEN 0 AND 100),    -- 0~100, nullable
  final_pct      INTEGER CHECK (final_pct BETWEEN 0 AND 100),  -- 0~100, nullable
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (study_day_id, book_id),
  FOREIGN KEY (study_day_id) REFERENCES study_days(id) ON DELETE CASCADE,
  FOREIGN KEY (book_id)      REFERENCES study_books(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_study_plans_day ON study_plans(study_day_id);
CREATE INDEX IF NOT EXISTS idx_study_plans_book ON study_plans(book_id);

-- 8. 학부모용 AI 일일 리포트 (자정 배치로 생성)
CREATE TABLE IF NOT EXISTS parent_ai_reports (
  id BIGSERIAL PRIMARY KEY,
  parent_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  student_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  report_date DATE NOT NULL,
  summary_text TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT 'gpt-4o-mini',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (parent_user_id, student_user_id, report_date)
);

CREATE INDEX IF NOT EXISTS idx_parent_ai_reports_lookup
  ON parent_ai_reports (parent_user_id, student_user_id, report_date DESC);

-- 9. Managed device inventory + user mapping (for MDM serial/webclip onboarding)
CREATE TABLE IF NOT EXISTS managed_devices (
  id BIGSERIAL PRIMARY KEY,
  serial_number TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_device_links (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  serial_number TEXT NOT NULL REFERENCES managed_devices(serial_number) ON DELETE RESTRICT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  unlink_reason TEXT,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  unlinked_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_device_links_active_pair
  ON user_device_links (user_id, serial_number, is_active);

CREATE INDEX IF NOT EXISTS idx_user_device_links_active_user
  ON user_device_links (user_id)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_user_device_links_active_serial
  ON user_device_links (serial_number)
  WHERE is_active = true;

-- 10. One-time webclip entry sessions (query serial -> secure cookie)
CREATE TABLE IF NOT EXISTS webclip_device_sessions (
  id BIGSERIAL PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  serial_number TEXT NOT NULL REFERENCES managed_devices(serial_number) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webclip_device_sessions_lookup
  ON webclip_device_sessions (token_hash, consumed_at, expires_at);

-- 11. 학부모가 자녀별로 설정하는 계획표 작성 시간 규칙
CREATE TABLE IF NOT EXISTS parent_planner_rules (
  parent_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  student_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT true,
  lock_time TEXT NOT NULL DEFAULT '21:00',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (parent_user_id, student_user_id)
);

-- 12. Planner lock sessions / history
CREATE TABLE IF NOT EXISTS planner_lock_sessions (
  id BIGSERIAL PRIMARY KEY,
  parent_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  student_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_link_mode TEXT NOT NULL DEFAULT 'unknown'
    CHECK (device_link_mode IN ('webview', 'native_app', 'unknown')),
  provider TEXT NOT NULL DEFAULT 'simplemdm',
  scheduled_for TIMESTAMPTZ,
  locked_at TIMESTAMPTZ,
  unlocked_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'locked', 'unlocked', 'failed', 'cancelled')),
  reason TEXT,
  mdm_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_planner_lock_sessions_student
  ON planner_lock_sessions (student_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_planner_lock_sessions_parent_student
  ON planner_lock_sessions (parent_user_id, student_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_planner_lock_sessions_status
  ON planner_lock_sessions (status, scheduled_for);

-- 13. Student study app store catalog
CREATE TABLE IF NOT EXISTS store_apps (
  id BIGSERIAL PRIMARY KEY,
  app_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  url TEXT NOT NULL,
  bundle_id TEXT,
  app_store_id BIGINT,
  simplemdm_app_id BIGINT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_store_apps_active_order
  ON store_apps (is_active, sort_order, name);

-- 14. Student-specific installed app status
CREATE TABLE IF NOT EXISTS student_store_app_status (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  store_app_id BIGINT NOT NULL REFERENCES store_apps(id) ON DELETE CASCADE,
  is_installed BOOLEAN NOT NULL DEFAULT false,
  installed_at TIMESTAMPTZ,
  removed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, store_app_id)
);

CREATE INDEX IF NOT EXISTS idx_student_store_app_status_user
  ON student_store_app_status (user_id, updated_at DESC);

ALTER TABLE store_apps
ADD COLUMN IF NOT EXISTS simplemdm_app_id BIGINT;

ALTER TABLE store_apps
ADD COLUMN IF NOT EXISTS bundle_id TEXT;

ALTER TABLE store_apps
ADD COLUMN IF NOT EXISTS app_store_id BIGINT;

-- 15. Student-specific SimpleMDM assignment groups
CREATE TABLE IF NOT EXISTS student_mdm_groups (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'simplemdm',
  assignment_group_id BIGINT NOT NULL,
  assignment_group_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 16. Student AI coach profile / memory
CREATE TABLE IF NOT EXISTS student_coach_profiles (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  name TEXT,
  school_level TEXT,
  grade INTEGER,
  goal TEXT,
  target_subjects TEXT[] NOT NULL DEFAULT '{}'::text[],
  weak_subjects TEXT[] NOT NULL DEFAULT '{}'::text[],
  sleep_time TEXT,
  wake_time TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS student_coach_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  log_date DATE NOT NULL DEFAULT CURRENT_DATE,
  sleep_hours NUMERIC(4,2),
  steps INTEGER,
  meals_regularity INTEGER,
  concentration_score INTEGER,
  stress_score INTEGER,
  phone_distractions INTEGER,
  study_minutes INTEGER,
  plan_completion_rate INTEGER,
  memo TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_student_coach_logs_user_date
  ON student_coach_logs (user_id, log_date DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS student_coach_messages (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_student_coach_messages_user
  ON student_coach_messages (user_id, created_at DESC);

