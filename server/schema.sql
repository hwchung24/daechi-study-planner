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

-- 3c. Parent–student unlink requests (상대 확인 후 연결 해제)
CREATE TABLE IF NOT EXISTS parent_student_unlink_requests (
  id BIGSERIAL PRIMARY KEY,
  parent_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  student_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  initiated_by TEXT NOT NULL CHECK (initiated_by IN ('parent', 'student')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolved_by_user_id BIGINT NULL REFERENCES users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_psur_pending_pair
  ON parent_student_unlink_requests (parent_user_id, student_user_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_psur_parent_pending
  ON parent_student_unlink_requests (parent_user_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_psur_student_pending
  ON parent_student_unlink_requests (student_user_id)
  WHERE status = 'pending';

-- 3c. Parent-level AI coach customization applied to linked students
CREATE TABLE IF NOT EXISTS parent_coach_customizations (
  parent_user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  persona TEXT NOT NULL DEFAULT '다정하지만 기준이 분명한 학습 코치',
  tone TEXT NOT NULL DEFAULT '따뜻하고 또렷한 존댓말로, 공감 뒤에 바로 실행 행동을 제시한다.',
  control_intensity INTEGER NOT NULL DEFAULT 3 CHECK (control_intensity BETWEEN 1 AND 5),
  focus_rules TEXT NOT NULL DEFAULT '해야 할 일을 작게 쪼개 바로 시작하게 돕고, 미루는 핑계는 부드럽지만 분명하게 바로잡는다.',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE parent_coach_customizations
ADD COLUMN IF NOT EXISTS persona TEXT NOT NULL DEFAULT '다정하지만 기준이 분명한 학습 코치';

ALTER TABLE parent_coach_customizations
ADD COLUMN IF NOT EXISTS tone TEXT NOT NULL DEFAULT '따뜻하고 또렷한 존댓말로, 공감 뒤에 바로 실행 행동을 제시한다.';

ALTER TABLE parent_coach_customizations
ADD COLUMN IF NOT EXISTS control_intensity INTEGER NOT NULL DEFAULT 3;

ALTER TABLE parent_coach_customizations
ADD COLUMN IF NOT EXISTS focus_rules TEXT NOT NULL DEFAULT '해야 할 일을 작게 쪼개 바로 시작하게 돕고, 미루는 핑계는 부드럽지만 분명하게 바로잡는다.';

CREATE INDEX IF NOT EXISTS idx_parent_coach_customizations_updated
  ON parent_coach_customizations (updated_at DESC);

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

CREATE TABLE IF NOT EXISTS student_mdm_app_allowance_profiles (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'simplemdm',
  profile_id BIGINT,
  profile_name TEXT,
  profile_identifier TEXT,
  override_bundle_ids JSONB,
  override_updated_at TIMESTAMPTZ,
  last_payload_hash TEXT,
  last_synced_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_student_mdm_app_allowance_profiles_updated
  ON student_mdm_app_allowance_profiles (updated_at DESC);

ALTER TABLE student_mdm_app_allowance_profiles
  ADD COLUMN IF NOT EXISTS override_bundle_ids JSONB;

ALTER TABLE student_mdm_app_allowance_profiles
  ADD COLUMN IF NOT EXISTS override_updated_at TIMESTAMPTZ;

-- 학부모 UI·버튼과 동기화하는 허용앱 표면 모드 스냅샷(bulk_lock|schedule|utility|free|default)
ALTER TABLE student_mdm_app_allowance_profiles
  ADD COLUMN IF NOT EXISTS ui_surface_mode TEXT;

CREATE TABLE IF NOT EXISTS student_mdm_kiosk_profiles (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'simplemdm',
  profile_id BIGINT,
  profile_name TEXT,
  profile_identifier TEXT,
  locked_bundle_id TEXT,
  activation_source TEXT,
  auto_release_exempt BOOLEAN NOT NULL DEFAULT false,
  last_synced_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE student_mdm_kiosk_profiles
  ADD COLUMN IF NOT EXISTS activation_source TEXT;

ALTER TABLE student_mdm_kiosk_profiles
  ADD COLUMN IF NOT EXISTS auto_release_exempt BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE student_mdm_kiosk_profiles
  ADD COLUMN IF NOT EXISTS previous_profile_id BIGINT;

ALTER TABLE student_mdm_kiosk_profiles
  ADD COLUMN IF NOT EXISTS previous_profile_name TEXT;

ALTER TABLE student_mdm_kiosk_profiles
  ADD COLUMN IF NOT EXISTS previous_profile_identifier TEXT;

CREATE INDEX IF NOT EXISTS idx_student_mdm_kiosk_profiles_updated
  ON student_mdm_kiosk_profiles (updated_at DESC);

-- 16. Student AI coach profile / memory
CREATE TABLE IF NOT EXISTS student_coach_profiles (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  name TEXT,
  school_level TEXT,
  grade INTEGER,
  goal TEXT,
  goal_university TEXT,
  target_grade TEXT,
  current_concern TEXT,
  weakness TEXT,
  target_subjects TEXT[] NOT NULL DEFAULT '{}'::text[],
  weak_subjects TEXT[] NOT NULL DEFAULT '{}'::text[],
  sleep_time TEXT,
  wake_time TEXT,
  alarm_schedule_reminders BOOLEAN NOT NULL DEFAULT true,
  alarm_parent_link_alerts BOOLEAN NOT NULL DEFAULT true,
  alarm_study_room_alerts BOOLEAN NOT NULL DEFAULT true,
  alarm_message_alerts BOOLEAN NOT NULL DEFAULT true,
  alarm_homework_alerts BOOLEAN NOT NULL DEFAULT true,
  wake_alarm_enabled BOOLEAN NOT NULL DEFAULT false,
  wake_alarm_time TEXT NOT NULL DEFAULT '06:30',
  mdm_applied BOOLEAN NOT NULL DEFAULT false,
  initial_profile_completed BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE student_coach_profiles
ADD COLUMN IF NOT EXISTS initial_profile_completed BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE student_coach_profiles
ADD COLUMN IF NOT EXISTS goal_university TEXT;

ALTER TABLE student_coach_profiles
ADD COLUMN IF NOT EXISTS target_grade TEXT;

ALTER TABLE student_coach_profiles
ADD COLUMN IF NOT EXISTS current_concern TEXT;

ALTER TABLE student_coach_profiles
ADD COLUMN IF NOT EXISTS weakness TEXT;

ALTER TABLE student_coach_profiles
ADD COLUMN IF NOT EXISTS alarm_schedule_reminders BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE student_coach_profiles
ADD COLUMN IF NOT EXISTS alarm_parent_link_alerts BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE student_coach_profiles
ADD COLUMN IF NOT EXISTS alarm_study_room_alerts BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE student_coach_profiles
ADD COLUMN IF NOT EXISTS alarm_message_alerts BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE student_coach_profiles
ADD COLUMN IF NOT EXISTS alarm_homework_alerts BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE student_coach_profiles
ADD COLUMN IF NOT EXISTS wake_alarm_enabled BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE student_coach_profiles
ADD COLUMN IF NOT EXISTS wake_alarm_time TEXT NOT NULL DEFAULT '06:30';

ALTER TABLE student_coach_profiles
ADD COLUMN IF NOT EXISTS mdm_applied BOOLEAN NOT NULL DEFAULT false;

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
  tomorrow_practice TEXT,
  tomorrow_practice_done BOOLEAN,
  study_evaluation TEXT,
  metacognition_reflection TEXT,
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

CREATE TABLE IF NOT EXISTS student_parent_chat_messages (
  id BIGSERIAL PRIMARY KEY,
  student_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_role TEXT NOT NULL CHECK (sender_role IN ('student', 'parent')),
  content TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_student_parent_chat_pair
  ON student_parent_chat_messages (student_user_id, parent_user_id, created_at DESC);

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

CREATE INDEX IF NOT EXISTS idx_student_homework_pair
  ON student_homework_submissions (student_user_id, parent_user_id, created_at DESC);

-- 17. Student profile schedule items (date-based, AI/manual unified storage)
CREATE TABLE IF NOT EXISTS student_profile_schedules (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  schedule_date DATE NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT,
  is_recurring BOOLEAN NOT NULL DEFAULT false,
  recurrence_rule TEXT,
  excluded_dates TEXT[] NOT NULL DEFAULT '{}'::text[],
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'ai')),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS student_daily_record_completion (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  record_date DATE NOT NULL,
  study_saved_at TIMESTAMPTZ,
  life_saved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, record_date)
);

CREATE INDEX IF NOT EXISTS idx_student_daily_record_completion_recent
  ON student_daily_record_completion (record_date DESC, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_student_profile_schedules_user_date
  ON student_profile_schedules (user_id, schedule_date ASC, start_time ASC, created_at ASC);

ALTER TABLE student_profile_schedules
ADD COLUMN IF NOT EXISTS excluded_dates TEXT[] NOT NULL DEFAULT '{}'::text[];

CREATE TABLE IF NOT EXISTS student_weekly_app_allowance_slots (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  weekday_key TEXT NOT NULL CHECK (weekday_key IN ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun')),
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  allowed_apps JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_student_weekly_app_allowance_user_day
  ON student_weekly_app_allowance_slots (user_id, weekday_key ASC, start_time ASC, created_at ASC);

-- 공부 계획(시간대) 블록에 책·계획 구간 (기존 DB는 migrate 시 컬럼 추가)
ALTER TABLE study_blocks ADD COLUMN IF NOT EXISTS book_id BIGINT REFERENCES study_books(id) ON DELETE SET NULL;
ALTER TABLE study_blocks ADD COLUMN IF NOT EXISTS planned_range TEXT;

ALTER TABLE student_coach_logs ADD COLUMN IF NOT EXISTS tomorrow_practice TEXT;
ALTER TABLE student_coach_logs ADD COLUMN IF NOT EXISTS study_evaluation TEXT;
ALTER TABLE student_coach_logs ADD COLUMN IF NOT EXISTS metacognition_reflection TEXT;
ALTER TABLE student_coach_logs ADD COLUMN IF NOT EXISTS tomorrow_practice_done BOOLEAN;

-- 학생 인앱 알림 (헤더 벨 뱃지 등)
CREATE TABLE IF NOT EXISTS student_in_app_notifications (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  body TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sian_user_unread
  ON student_in_app_notifications (user_id)
  WHERE read_at IS NULL;

CREATE TABLE IF NOT EXISTS parent_in_app_notifications (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  body TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pian_user_unread
  ON parent_in_app_notifications (user_id)
  WHERE read_at IS NULL;

-- 학생 → 학부모 승인 대기: 오늘 공부 계획(시간대) 추가 요청
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

CREATE INDEX IF NOT EXISTS idx_ppadd_pending_parent_queue
  ON parent_plan_add_requests (status, created_at);

CREATE INDEX IF NOT EXISTS idx_ppadd_student_pending
  ON parent_plan_add_requests (student_user_id)
  WHERE status = 'pending';

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

CREATE INDEX IF NOT EXISTS idx_pssr_parent_student
  ON parent_student_study_rooms (parent_user_id, student_user_id);

/** 코치 학부모 — 허용앱 모드별 시간 구간(유틸·자유·일괄 차단) JSON */
CREATE TABLE IF NOT EXISTS parent_student_app_mode_schedules (
  id BIGSERIAL PRIMARY KEY,
  parent_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  student_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slots JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (parent_user_id, student_user_id)
);

CREATE INDEX IF NOT EXISTS idx_psams_parent_student
  ON parent_student_app_mode_schedules (parent_user_id, student_user_id);

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

CREATE INDEX IF NOT EXISTS idx_pssrv_student_entered
  ON parent_student_study_room_visit_sessions (student_user_id, entered_at DESC);

CREATE INDEX IF NOT EXISTS idx_pssrv_parent_student_entered
  ON parent_student_study_room_visit_sessions (parent_user_id, student_user_id, entered_at DESC);

CREATE TABLE IF NOT EXISTS student_last_known_locations (
  student_user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  accuracy DOUBLE PRECISION,
  occurred_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_skl_occurred_at
  ON student_last_known_locations (occurred_at DESC);

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

CREATE INDEX IF NOT EXISTS idx_upt_user_active
  ON user_push_tokens (user_id, updated_at DESC)
  WHERE active = true;

