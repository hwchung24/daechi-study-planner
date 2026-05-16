"use strict";

const { query } = require("../db");
const { refreshFewshotCandidates } = require("./fewshotManager");
const { COACH_MODES } = require("./feedbackScheduler");

const MAX_FEWSHOT_PER_MODE = 3;

const COACH_MODE_LABELS = {
  learning: "학습 코칭",
  suneung: "수능",
  tomorrowPlan: "내일 계획",
  patternInsights: "패턴 인사이트",
  growthReport: "성장 리포트"
};

const PROMPT_INJECTED_MODES = new Set(["learning", "suneung"]);

let schemaReady = false;

async function ensureCoachFewshotAdminSchema() {
  if (schemaReady) return;
  const fs = require("fs");
  const path = require("path");
  const migrationsDir = path.join(__dirname, "..", "migrations");
  const baseSql = fs.readFileSync(
    path.join(migrationsDir, "create_coach_response_log.sql"),
    "utf8"
  );
  const adminSql = fs.readFileSync(
    path.join(migrationsDir, "add_coach_fewshot_admin.sql"),
    "utf8"
  );
  await query(baseSql);
  await query(adminSql);
  schemaReady = true;
}

async function appendFewshotHistory({ logId, coachMode, action, detail, adminEmail }) {
  await query(
    `INSERT INTO coach_fewshot_history (log_id, coach_mode, action, detail, admin_email)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      logId != null ? Number(logId) : null,
      String(coachMode || ""),
      String(action || ""),
      detail != null ? String(detail).slice(0, 2000) : null,
      adminEmail != null ? String(adminEmail).slice(0, 320) : null
    ]
  );
}

function mapLogRow(row) {
  return {
    id: Number(row.id),
    sessionId: String(row.session_id || ""),
    userType: String(row.user_type || ""),
    coachMode: String(row.coach_mode || ""),
    userMessage: String(row.user_message || ""),
    aiResponse: String(row.ai_response || ""),
    contextSnapshot: row.context_snapshot ?? null,
    signal: row.signal != null ? String(row.signal) : null,
    signalReason: row.signal_reason != null ? String(row.signal_reason) : null,
    isFewshot: Boolean(row.is_fewshot),
    isBlacklisted: Boolean(row.is_blacklisted),
    fewshotSelectedAt: row.fewshot_selected_at
      ? new Date(row.fewshot_selected_at).toISOString()
      : null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null
  };
}

function parseSessionUserId(sessionId) {
  const m = String(sessionId || "").match(/^user:(\d+)/);
  return m ? Number(m[1]) : null;
}

async function listCoachFewshotDashboard(coachMode) {
  const mode = String(coachMode || "learning");
  const activeRes = await query(
    `SELECT id, session_id, user_type, coach_mode, user_message, ai_response,
            context_snapshot, signal, signal_reason, is_fewshot, is_blacklisted,
            fewshot_selected_at, created_at
     FROM coach_response_log
     WHERE coach_mode = $1 AND is_fewshot = TRUE
     ORDER BY fewshot_selected_at DESC NULLS LAST, created_at DESC`,
    [mode]
  );

  const poolRes = await query(
    `SELECT id, session_id, user_type, coach_mode, user_message, ai_response,
            context_snapshot, signal, signal_reason, is_fewshot, is_blacklisted,
            fewshot_selected_at, created_at
     FROM coach_response_log
     WHERE coach_mode = $1
       AND COALESCE(is_blacklisted, FALSE) = FALSE
       AND is_fewshot = FALSE
       AND signal = 'positive'
     ORDER BY created_at DESC
     LIMIT 30`,
    [mode]
  );

  const blacklistRes = await query(
    `SELECT id, session_id, user_type, coach_mode, user_message, ai_response,
            context_snapshot, signal, signal_reason, is_fewshot, is_blacklisted,
            fewshot_selected_at, created_at
     FROM coach_response_log
     WHERE coach_mode = $1 AND COALESCE(is_blacklisted, FALSE) = TRUE
     ORDER BY created_at DESC
     LIMIT 50`,
    [mode]
  );

  return {
    coachMode: mode,
    modeLabel: COACH_MODE_LABELS[mode] || mode,
    promptInjected: PROMPT_INJECTED_MODES.has(mode),
    maxFewshot: MAX_FEWSHOT_PER_MODE,
    activeFewshots: activeRes.rows.map(mapLogRow),
    positivePool: poolRes.rows.map(mapLogRow),
    blacklisted: blacklistRes.rows.map(mapLogRow)
  };
}

async function getCoachSignalStats(coachModeFilter) {
  const mode = coachModeFilter ? String(coachModeFilter) : null;
  const params = mode ? [mode] : [];
  const whereMode = mode ? "WHERE coach_mode = $1" : "";

  const byModeRes = await query(
    `SELECT coach_mode,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE signal = 'positive')::int AS positive,
            COUNT(*) FILTER (WHERE signal = 'negative')::int AS negative,
            COUNT(*) FILTER (WHERE signal = 'neutral')::int AS neutral,
            COUNT(*) FILTER (WHERE signal IS NULL)::int AS unscored
     FROM coach_response_log
     ${whereMode}
     GROUP BY coach_mode
     ORDER BY coach_mode`,
    params
  );

  const keywordRes = await query(
    `SELECT signal, signal_reason, COUNT(*)::int AS cnt
     FROM coach_response_log
     WHERE signal IS NOT NULL
       AND signal != 'neutral'
       AND signal_reason IS NOT NULL
       AND signal_reason <> ''
       ${mode ? "AND coach_mode = $1" : ""}
     GROUP BY signal, signal_reason
     ORDER BY cnt DESC
     LIMIT 40`,
    params
  );

  const now = new Date();
  const kstOffset = 9 * 60 * 60 * 1000;
  const kstNow = new Date(now.getTime() + kstOffset);
  const endThis = new Date(
    Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate())
  );
  const startThis = new Date(endThis);
  startThis.setUTCDate(startThis.getUTCDate() - 7);
  const startPrev = new Date(startThis);
  startPrev.setUTCDate(startPrev.getUTCDate() - 7);

  const trendParams = mode
    ? [startThis.toISOString(), endThis.toISOString(), startPrev.toISOString(), mode]
    : [startThis.toISOString(), endThis.toISOString(), startPrev.toISOString()];
  const trendWhere = mode ? "WHERE coach_mode = $4" : "";

  const trendResFixed = await query(
    `SELECT coach_mode,
            COUNT(*) FILTER (
              WHERE signal = 'positive'
                AND created_at >= $1::timestamptz
                AND created_at < $2::timestamptz
            )::int AS positive_this_week,
            COUNT(*) FILTER (
              WHERE signal = 'positive'
                AND created_at >= $3::timestamptz
                AND created_at < $1::timestamptz
            )::int AS positive_prev_week,
            COUNT(*) FILTER (
              WHERE signal = 'negative'
                AND created_at >= $1::timestamptz
                AND created_at < $2::timestamptz
            )::int AS negative_this_week,
            COUNT(*) FILTER (
              WHERE signal = 'negative'
                AND created_at >= $3::timestamptz
                AND created_at < $1::timestamptz
            )::int AS negative_prev_week
     FROM coach_response_log
     ${trendWhere}
     GROUP BY coach_mode
     ORDER BY coach_mode`,
    trendParams
  );

  const modes = byModeRes.rows.map(row => {
    const total = Number(row.total) || 0;
    const positive = Number(row.positive) || 0;
    const negative = Number(row.negative) || 0;
    const neutral = Number(row.neutral) || 0;
    const scored = positive + negative + neutral;
    const trend = trendResFixed.rows.find(t => t.coach_mode === row.coach_mode);
    const posThis = Number(trend?.positive_this_week) || 0;
    const posPrev = Number(trend?.positive_prev_week) || 0;
    const negThis = Number(trend?.negative_this_week) || 0;
    const negPrev = Number(trend?.negative_prev_week) || 0;
    return {
      coachMode: String(row.coach_mode),
      modeLabel: COACH_MODE_LABELS[row.coach_mode] || row.coach_mode,
      total,
      positive,
      negative,
      neutral,
      unscored: Number(row.unscored) || 0,
      positivePct: scored ? Math.round((positive / scored) * 100) : 0,
      negativePct: scored ? Math.round((negative / scored) * 100) : 0,
      neutralPct: scored ? Math.round((neutral / scored) * 100) : 0,
      positiveTrend: {
        thisWeek: posThis,
        prevWeek: posPrev,
        delta: posThis - posPrev
      },
      negativeTrend: {
        thisWeek: negThis,
        prevWeek: negPrev,
        delta: negThis - negPrev
      }
    };
  });

  return {
    modes,
    keywords: keywordRes.rows.map(r => ({
      signal: String(r.signal),
      reason: String(r.signal_reason),
      count: Number(r.cnt) || 0
    })),
    weekRange: {
      thisWeekStart: startThis.toISOString().slice(0, 10),
      thisWeekEnd: endThis.toISOString().slice(0, 10)
    }
  };
}

async function listCoachFewshotHistory(coachMode, limit = 50) {
  const res = await query(
    `SELECT h.id, h.log_id, h.coach_mode, h.action, h.detail, h.admin_email, h.created_at,
            l.user_message, l.ai_response
     FROM coach_fewshot_history h
     LEFT JOIN coach_response_log l ON l.id = h.log_id
     WHERE ($1::text IS NULL OR h.coach_mode = $1)
     ORDER BY h.created_at DESC
     LIMIT $2`,
    [coachMode ? String(coachMode) : null, Math.min(Math.max(Number(limit) || 50, 1), 200)]
  );
  return res.rows.map(row => ({
    id: Number(row.id),
    logId: row.log_id != null ? Number(row.log_id) : null,
    coachMode: String(row.coach_mode || ""),
    modeLabel: COACH_MODE_LABELS[row.coach_mode] || row.coach_mode,
    action: String(row.action || ""),
    detail: row.detail != null ? String(row.detail) : null,
    adminEmail: row.admin_email != null ? String(row.admin_email) : null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    userMessagePreview:
      row.user_message != null ? String(row.user_message).slice(0, 120) : null
  }));
}

async function getCoachLogById(logId) {
  const res = await query(
    `SELECT id, coach_mode, is_fewshot, COALESCE(is_blacklisted, FALSE) AS is_blacklisted
     FROM coach_response_log WHERE id = $1`,
    [Number(logId)]
  );
  return res.rows[0] || null;
}

async function setCoachFewshotSelected(logId, selected, adminEmail) {
  const row = await getCoachLogById(logId);
  if (!row) return { ok: false, error: "로그를 찾을 수 없습니다." };
  if (row.is_blacklisted) {
    return { ok: false, error: "블랙리스트된 예시는 few-shot에 넣을 수 없습니다." };
  }

  const mode = String(row.coach_mode);
  if (selected) {
    const { rows: countRows } = await query(
      `SELECT COUNT(*)::int AS cnt FROM coach_response_log
       WHERE coach_mode = $1 AND is_fewshot = TRUE AND id <> $2`,
      [mode, Number(logId)]
    );
    if (Number(countRows[0]?.cnt) >= MAX_FEWSHOT_PER_MODE) {
      await query(
        `UPDATE coach_response_log SET is_fewshot = FALSE, fewshot_selected_at = NULL
         WHERE id IN (
           SELECT id FROM coach_response_log
           WHERE coach_mode = $1 AND is_fewshot = TRUE AND id <> $2
           ORDER BY fewshot_selected_at ASC NULLS FIRST, created_at ASC
           LIMIT 1
         )`,
        [mode, Number(logId)]
      );
    }
    await query(
      `UPDATE coach_response_log
       SET is_fewshot = TRUE, fewshot_selected_at = NOW()
       WHERE id = $1`,
      [Number(logId)]
    );
    await appendFewshotHistory({
      logId,
      coachMode: mode,
      action: "selected",
      detail: "관리자 수동 선정",
      adminEmail
    });
  } else {
    await query(
      `UPDATE coach_response_log
       SET is_fewshot = FALSE, fewshot_selected_at = NULL
       WHERE id = $1`,
      [Number(logId)]
    );
    await appendFewshotHistory({
      logId,
      coachMode: mode,
      action: "deselected",
      detail: "관리자 수동 해제",
      adminEmail
    });
  }
  return { ok: true, coachMode: mode };
}

async function setCoachLogBlacklisted(logId, blacklisted, adminEmail) {
  const row = await getCoachLogById(logId);
  if (!row) return { ok: false, error: "로그를 찾을 수 없습니다." };
  const mode = String(row.coach_mode);

  await query(
    `UPDATE coach_response_log
     SET is_blacklisted = $2,
         is_fewshot = CASE WHEN $2 THEN FALSE ELSE is_fewshot END,
         fewshot_selected_at = CASE WHEN $2 THEN NULL ELSE fewshot_selected_at END
     WHERE id = $1`,
    [Number(logId), Boolean(blacklisted)]
  );

  await appendFewshotHistory({
    logId,
    coachMode: mode,
    action: blacklisted ? "blacklisted" : "unblacklisted",
    detail: blacklisted ? "관리자 블랙리스트 등록" : "블랙리스트 해제",
    adminEmail
  });
  return { ok: true, coachMode: mode };
}

async function resetCoachFewshotForMode(coachMode, adminEmail) {
  const mode = String(coachMode);
  await query(
    `UPDATE coach_response_log
     SET is_fewshot = FALSE, fewshot_selected_at = NULL
     WHERE coach_mode = $1`,
    [mode]
  );
  await appendFewshotHistory({
    logId: null,
    coachMode: mode,
    action: "reset",
    detail: "모드별 few-shot 전체 초기화",
    adminEmail
  });
  return { ok: true };
}

async function runCoachFewshotRefresh(coachMode, adminEmail) {
  const mode = String(coachMode);
  await refreshFewshotCandidates(mode);
  await query(
    `UPDATE coach_response_log
     SET fewshot_selected_at = NOW()
     WHERE coach_mode = $1 AND is_fewshot = TRUE AND fewshot_selected_at IS NULL`,
    [mode]
  );
  await appendFewshotHistory({
    logId: null,
    coachMode: mode,
    action: "cron_refresh",
    detail: "관리자 수동 갱신(자동 선정 로직 실행)",
    adminEmail
  });
  return { ok: true };
}

async function addManualCoachFewshotExample(input, adminEmail) {
  const mode = String(input.coachMode || "").trim();
  if (!COACH_MODES.includes(mode)) {
    return { ok: false, error: "유효하지 않은 coach_mode입니다." };
  }
  const userMessage = String(input.userMessage || "").trim();
  const aiResponse = String(input.aiResponse || "").trim();
  if (!userMessage || !aiResponse) {
    return { ok: false, error: "학생 질문과 AI 답변이 필요합니다." };
  }

  const userType = input.userType === "parent" ? "parent" : "student";
  const sessionId =
    String(input.sessionId || "").trim() ||
    `admin:manual:${adminEmail || "unknown"}:${Date.now()}`;

  const insertRes = await query(
    `INSERT INTO coach_response_log
     (session_id, user_type, coach_mode, user_message, ai_response, context_snapshot, signal)
     VALUES ($1, $2, $3, $4, $5, $6, 'positive')
     RETURNING id`,
    [
      sessionId.slice(0, 200),
      userType,
      mode,
      userMessage.slice(0, 12000),
      aiResponse.slice(0, 12000),
      input.contextSnapshot && typeof input.contextSnapshot === "object"
        ? input.contextSnapshot
        : null
    ]
  );
  const logId = Number(insertRes.rows[0]?.id);
  if (input.selectAsFewshot !== false) {
    await setCoachFewshotSelected(logId, true, adminEmail);
  } else {
    await appendFewshotHistory({
      logId,
      coachMode: mode,
      action: "manual_add",
      detail: "관리자 수동 예시 추가(풀만)",
      adminEmail
    });
  }
  return { ok: true, logId, coachMode: mode };
}

function listCoachModesMeta() {
  return COACH_MODES.map(mode => ({
    coachMode: mode,
    modeLabel: COACH_MODE_LABELS[mode] || mode,
    promptInjected: PROMPT_INJECTED_MODES.has(mode)
  }));
}

module.exports = {
  COACH_MODE_LABELS,
  COACH_MODES,
  PROMPT_INJECTED_MODES,
  ensureCoachFewshotAdminSchema,
  listCoachModesMeta,
  listCoachFewshotDashboard,
  getCoachSignalStats,
  listCoachFewshotHistory,
  setCoachFewshotSelected,
  setCoachLogBlacklisted,
  resetCoachFewshotForMode,
  runCoachFewshotRefresh,
  addManualCoachFewshotExample,
  parseSessionUserId
};
