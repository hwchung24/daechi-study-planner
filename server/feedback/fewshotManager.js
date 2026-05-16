"use strict";

const { query } = require("../db");

const MAX_FEWSHOT_PER_MODE = 3;

/**
 * coach_mode별 positive 행 중 few-shot 미선정된 것을 최대 3개 선정
 * 초과 시 가장 오래된 is_fewshot=TRUE 행을 FALSE로 교체
 * @param {string} coachMode
 */
async function refreshFewshotCandidates(coachMode) {
  const { rows: current } = await query(
    `SELECT COUNT(*)::int AS cnt FROM coach_response_log
     WHERE coach_mode = $1 AND is_fewshot = TRUE`,
    [coachMode]
  );
  const currentCount = Number(current[0]?.cnt ?? 0);

  const { rows: candidates } = await query(
    `SELECT id FROM coach_response_log
     WHERE coach_mode = $1
       AND signal = 'positive'
       AND is_fewshot = FALSE
       AND COALESCE(is_blacklisted, FALSE) = FALSE
     ORDER BY (context_snapshot IS NOT NULL) DESC, created_at DESC
     LIMIT $2`,
    [coachMode, MAX_FEWSHOT_PER_MODE]
  );

  if (candidates.length === 0) return;

  const toAdd = candidates.length;
  const overflow = currentCount + toAdd - MAX_FEWSHOT_PER_MODE;
  if (overflow > 0) {
    await query(
      `UPDATE coach_response_log SET is_fewshot = FALSE
       WHERE id IN (
         SELECT id FROM coach_response_log
         WHERE coach_mode = $1 AND is_fewshot = TRUE
         ORDER BY created_at ASC
         LIMIT $2
       )`,
      [coachMode, overflow]
    );
  }

  const ids = candidates.map(r => Number(r.id)).filter(Number.isFinite);
  if (ids.length === 0) return;

  await query(
    `UPDATE coach_response_log
     SET is_fewshot = TRUE, fewshot_selected_at = NOW()
     WHERE id = ANY($1::int[])`,
    [ids]
  );
}

/**
 * few-shot 블록 문자열 반환. 없으면 빈 문자열.
 * @param {string} coachMode
 */
async function getFewshotBlock(coachMode) {
  const { rows } = await query(
    `SELECT user_message, ai_response, context_snapshot
     FROM coach_response_log
     WHERE coach_mode = $1
       AND is_fewshot = TRUE
       AND COALESCE(is_blacklisted, FALSE) = FALSE
     ORDER BY created_at DESC`,
    [coachMode]
  );

  if (!rows || rows.length === 0) return "";

  const examples = rows.map((row, i) => {
    const ctx = row.context_snapshot ? summarizeContext(row.context_snapshot) : null;
    return [
      `예시 ${i + 1})`,
      ctx ? `학생 상황 요약: ${ctx}` : null,
      `학생 질문: ${row.user_message}`,
      `코치 답변: ${row.ai_response}`
    ]
      .filter(Boolean)
      .join("\n");
  });

  return `[좋은 답변 예시 — 실제 대화 기반]\n\n${examples.join("\n\n")}`;
}

function summarizeContext(snapshot) {
  if (snapshot == null) return "";
  let obj = snapshot;
  if (typeof snapshot === "string") {
    try {
      obj = JSON.parse(snapshot);
    } catch {
      return "";
    }
  }
  if (!obj || typeof obj !== "object") return "";

  const parts = [];
  if (obj.sleepHours != null) parts.push(`수면 ${obj.sleepHours}시간`);
  if (obj.stressScore != null) parts.push(`스트레스 ${obj.stressScore}/10`);
  if (obj.concentrationPercent != null) parts.push(`집중도 ${obj.concentrationPercent}%`);
  if (obj.planCompletionRate != null) parts.push(`계획 달성률 ${obj.planCompletionRate}%`);
  return parts.join(", ");
}

module.exports = {
  refreshFewshotCandidates,
  getFewshotBlock
};
