CREATE TABLE IF NOT EXISTS coach_response_log (
  id               SERIAL PRIMARY KEY,
  session_id       TEXT NOT NULL,
  user_type        TEXT NOT NULL CHECK (user_type IN ('student', 'parent')),
  coach_mode       TEXT NOT NULL,
  user_message     TEXT NOT NULL,
  ai_response      TEXT NOT NULL,
  context_snapshot JSONB,
  signal           TEXT CHECK (signal IN ('positive', 'negative', 'neutral')),
  signal_reason    TEXT,
  is_fewshot       BOOLEAN DEFAULT FALSE,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crl_coach_mode ON coach_response_log (coach_mode);
CREATE INDEX IF NOT EXISTS idx_crl_signal ON coach_response_log (signal);
CREATE INDEX IF NOT EXISTS idx_crl_is_fewshot ON coach_response_log (is_fewshot);
