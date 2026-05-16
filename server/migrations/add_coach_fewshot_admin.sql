-- Few-shot 관리자 기능: 블랙리스트·선정 시각·이력
ALTER TABLE coach_response_log
  ADD COLUMN IF NOT EXISTS is_blacklisted BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE coach_response_log
  ADD COLUMN IF NOT EXISTS fewshot_selected_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_crl_blacklisted ON coach_response_log (is_blacklisted);
CREATE INDEX IF NOT EXISTS idx_crl_fewshot_selected_at ON coach_response_log (fewshot_selected_at);

CREATE TABLE IF NOT EXISTS coach_fewshot_history (
  id           SERIAL PRIMARY KEY,
  log_id       INT REFERENCES coach_response_log(id) ON DELETE SET NULL,
  coach_mode   TEXT NOT NULL,
  action       TEXT NOT NULL,
  detail       TEXT,
  admin_email  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cfh_coach_mode ON coach_fewshot_history (coach_mode);
CREATE INDEX IF NOT EXISTS idx_cfh_created_at ON coach_fewshot_history (created_at DESC);
