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

