-- DB schema for Daechi Planner (AI-friendly)
-- SQLite syntax

PRAGMA foreign_keys = ON;

-- 1. Users
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  role          TEXT NOT NULL CHECK (role IN ('student', 'parent')),
  student_id    INTEGER NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- 2. Parents meta (for Kakao, notification prefs)
CREATE TABLE IF NOT EXISTS parents (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id            INTEGER NOT NULL UNIQUE,
  kakao_user_id      TEXT,
  phone              TEXT,
  notification_prefs TEXT DEFAULT '{}', -- JSON: { "weekly": true, "daily": false, ... }
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 3. Mapping: parent ↔ student (many students per parent, future-proof many:many)
CREATE TABLE IF NOT EXISTS parents_students (
  parent_id  INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  PRIMARY KEY (parent_id, student_id),
  FOREIGN KEY (parent_id) REFERENCES parents(id) ON DELETE CASCADE,
  FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_parents_students_student ON parents_students(student_id);

-- 4. Study days (per student, per date)
CREATE TABLE IF NOT EXISTS study_days (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL, -- student user id
  date       TEXT NOT NULL,    -- 'YYYY-MM-DD'
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, date),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_study_days_user_date ON study_days(user_id, date);

-- 5. Study blocks (timeline)
CREATE TABLE IF NOT EXISTS study_blocks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  study_day_id INTEGER NOT NULL,
  subject      TEXT NOT NULL,
  start_time   TEXT NOT NULL,   -- 'HH:MM'
  end_time     TEXT NOT NULL,   -- 'HH:MM'
  done         INTEGER NOT NULL DEFAULT 0, -- 0/1
  focus_score  TEXT CHECK (focus_score IN ('◎', '○', '△', '✕') OR focus_score IS NULL),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (study_day_id) REFERENCES study_days(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_study_blocks_day ON study_blocks(study_day_id);

-- 6. Books used in progress tracking
CREATE TABLE IF NOT EXISTS study_books (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL, -- student owner
  name       TEXT NOT NULL,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, name),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_study_books_user ON study_books(user_id);

-- 7. Plans / progress per day, per book
CREATE TABLE IF NOT EXISTS study_plans (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  study_day_id   INTEGER NOT NULL,
  book_id        INTEGER NOT NULL,
  planned_range  TEXT,       -- e.g. '10-20쪽', '2단원'
  start_time     TEXT,       -- optional: 'HH:MM'
  end_time       TEXT,       -- optional
  mid_pct        INTEGER,    -- 0~100, nullable
  final_pct      INTEGER,    -- 0~100, nullable
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (study_day_id, book_id),
  FOREIGN KEY (study_day_id) REFERENCES study_days(id) ON DELETE CASCADE,
  FOREIGN KEY (book_id)      REFERENCES study_books(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_study_plans_day ON study_plans(study_day_id);
CREATE INDEX IF NOT EXISTS idx_study_plans_book ON study_plans(book_id);

