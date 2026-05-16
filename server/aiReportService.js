const OpenAI = require("openai");
const {
  getWeekData,
  listAllParentStudentPairs,
  upsertParentAiReport,
  getParentAiReportForDate,
  createParentNotificationForAlarm
} = require("./db");
const { sendPushToUser } = require("./pushService");
const { sendParentKakaoIfEnabled } = require("./parentKakaoNotify");
const { computeWeeklyStats } = require("./analytics");
const { parentDailyAiReport } = require("./prompts");

const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

/** KST 기준 YYYY-MM-DD (한국은 DST 없음) */
function getKstYmd(d = new Date()) {
  const t = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const y = t.getUTCFullYear();
  const m = String(t.getUTCMonth() + 1).padStart(2, "0");
  const day = String(t.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** KST 기준 '어제' 날짜 */
function getKstYesterdayYmd() {
  const t = new Date(Date.now() + 9 * 60 * 60 * 1000);
  t.setUTCDate(t.getUTCDate() - 1);
  const y = t.getUTCFullYear();
  const m = String(t.getUTCMonth() + 1).padStart(2, "0");
  const day = String(t.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatReportDateKey(value) {
  if (value == null) return "";
  if (value instanceof Date) {
    return getKstYmd(value);
  }
  const s = String(value);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

function getPreviousReportDateYmd(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  const py = dt.getUTCFullYear();
  const pm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const pd = String(dt.getUTCDate()).padStart(2, "0");
  return `${py}-${pm}-${pd}`;
}

/** 어제를 끝으로 하는 7일 구간 (학습 계획·진도표 기반 통계용) */
function rolling7RangeEnding(endYmd) {
  const [y, m, d] = endYmd.split("-").map(Number);
  const end = new Date(Date.UTC(y, m - 1, d));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 6);
  const sy = start.getUTCFullYear();
  const sm = String(start.getUTCMonth() + 1).padStart(2, "0");
  const sd = String(start.getUTCDate()).padStart(2, "0");
  return { weekStart: `${sy}-${sm}-${sd}`, weekEnd: endYmd };
}

/**
 * 학생 학습 데이터로 gpt-4o-mini 리포트 생성
 */
async function generateAiReportText(studentUserId, weekStart, weekEnd, meta = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !String(apiKey).trim()) {
    throw new Error("OPENAI_API_KEY가 설정되어 있지 않습니다.");
  }

  const { days, blocks, plans } = await getWeekData(
    studentUserId,
    weekStart,
    weekEnd
  );
  const stats = computeWeeklyStats({ days, blocks, plans });
  const summaryLines = parentDailyAiReport.buildWeeklySummaryLines(stats);
  const statsPrompt = parentDailyAiReport.buildWeeklyReportPrompt(stats);

  const userContent = parentDailyAiReport.buildUserContent(summaryLines, statsPrompt, meta);

  const openai = new OpenAI({ apiKey });
  const completion = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: "system",
        content: parentDailyAiReport.systemPrompt
      },
      { role: "user", content: userContent }
    ],
    max_tokens: parentDailyAiReport.maxTokens,
    temperature: parentDailyAiReport.temperature
  });

  const text = completion.choices[0]?.message?.content?.trim();
  if (!text) throw new Error("OpenAI 응답이 비어 있습니다.");
  return text;
}

/**
 * 한 부모–자녀 쌍에 대해 '어제' 기준 리포트 생성 후 저장
 */
async function runOnePair(parentUserId, studentUserId, options = {}) {
  const reportDate = options.reportDate || getKstYesterdayYmd();
  const { weekStart, weekEnd } = rolling7RangeEnding(reportDate);
  const prevRow = await getParentAiReportForDate(
    parentUserId,
    studentUserId,
    getPreviousReportDateYmd(reportDate)
  );
  const previousSummary = prevRow?.summary_text
    ? String(prevRow.summary_text).slice(0, 280)
    : "";
  const summaryText = await generateAiReportText(studentUserId, weekStart, weekEnd, {
    reportDate,
    todayYmd: getKstYmd(),
    previousSummary
  });
  await upsertParentAiReport(
    parentUserId,
    studentUserId,
    reportDate,
    summaryText,
    MODEL
  );
  if (options.notifyParent !== false) {
    const notification = await createParentNotificationForAlarm(
      parentUserId,
      "reportAlerts",
      "일일 AI 리포트 도착",
      `${reportDate} 기준 새로운 일일 AI 리포트가 도착했습니다.`
    ).catch(() => {});
    if (notification) {
      const pushTitle = "일일 AI 리포트 도착";
      const pushBody = `${reportDate} 기준 새로운 일일 AI 리포트가 도착했습니다.`;
      await sendPushToUser(parentUserId, {
        title: pushTitle,
        body: pushBody
      }).catch(() => {});
      await sendParentKakaoIfEnabled(parentUserId, pushTitle, pushBody).catch(() => {});
    }
  }
  return { reportDate, weekStart, weekEnd };
}

/**
 * 연결된 모든 부모–자녀에 대해 일일 리포트 생성 (자정 크론에서 호출)
 */
async function runDailyReportsForAllPairs() {
  const key = process.env.OPENAI_API_KEY;
  if (!key || !String(key).trim()) {
    console.warn(
      "[ai-report] OPENAI_API_KEY 없음 — 일일 AI 리포트를 건너뜁니다."
    );
    return { skipped: true, reason: "no_openai_key" };
  }

  const pairs = await listAllParentStudentPairs();
  let ok = 0;
  let fail = 0;

  for (const row of pairs) {
    try {
      await runOnePair(row.parent_user_id, row.student_user_id);
      ok += 1;
      console.log(
        `[ai-report] OK parent=${row.parent_user_id} student=${row.student_user_id}`
      );
    } catch (e) {
      fail += 1;
      console.error(
        `[ai-report] FAIL parent=${row.parent_user_id} student=${row.student_user_id}`,
        e.message || e
      );
    }
  }

  return { skipped: false, pairs: pairs.length, ok, fail };
}

module.exports = {
  getKstYmd,
  getKstYesterdayYmd,
  formatReportDateKey,
  rolling7RangeEnding,
  generateAiReportText,
  runOnePair,
  runDailyReportsForAllPairs,
  MODEL
};
