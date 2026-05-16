"use strict";

const { getKoFallbacks, tpl } = require("./koFallbackLoader");

/** 자정 일일 AI 리포트 (부모용) — system (성장 리포트와 동일 페르소나 베이스 + 일일 리포트 모드) */
const systemPrompt = `너는 대치동에서 10년 이상 학생 데이터를 분석하고 학부모 상담을 진행한 학습 전문 코치다.
학부모와 학생의 갈등을 줄이고, 데이터를 근거로 다음 행동을 이끄는 것이 핵심 역할이다.

[일일 리포트 모드]
- 한국어 존댓말, 4~7문장. 공감하되 근거 없는 낙관·칭찬은 하지 않는다.
- 본문에 반드시 2가지 이상 포함: (1) 계획·시간표 대비 실행/완료 맥락 (2) 기준일 vs 직전일 학습량 (3) 이번 7일 vs 직전 7일 학습량. 통계·요약 줄에 없는 비교는 쓰지 않는다.
- "매우 긍정적", "훌륭", "잘하고 있어요"처럼 목표·전주·전일 대비 없이 단정하는 표현은 금지한다.
- 수치는 낙인·판정하지 않고 관찰한다. 데이터가 부족하면 비교를 생략하고 무엇이 더 필요한지 짧게 말한다.
- 마크다운 헤딩 없이 자연스러운 단락으로 작성한다. 과장·진단명(예: ADHD)·가학적 조언 금지`;

function pdr() {
  return getKoFallbacks().parentDailyAiReport;
}

/**
 * 일일 리포트용 user 메시지 (역할·규칙·요약 줄·통계 JSON).
 * @param {string[]} summaryLines
 * @param {string} statsPrompt
 */
function buildUserContent(summaryLines, statsPrompt, meta = {}) {
  const p = pdr();
  const lines = Array.isArray(summaryLines) ? summaryLines : [];
  const reportDate = String(meta.reportDate || "").trim();
  const todayYmd = String(meta.todayYmd || "").trim();
  const previousSummary = String(meta.previousSummary || "").trim();
  const parts = [
    p.userContentRole,
    p.userContentIntro
  ];
  if (reportDate) {
    parts.push(
      tpl(p.userContentReportDateLine, { reportDate, todayYmd: todayYmd || reportDate })
    );
  }
  parts.push(p.userContentTask, "", p.userContentRulesHeader);
  for (const key of [
    "userContentRule1",
    "userContentRule2",
    "userContentRule3",
    "userContentRule4",
    "userContentRule5",
    "userContentRule6",
    "userContentRule7",
    "userContentRule8"
  ]) {
    const line = p[key];
    if (!line) continue;
    parts.push(key === "userContentRule4" && reportDate ? tpl(line, { reportDate }) : line);
  }
  if (previousSummary) {
    parts.push(
      "",
      p.userContentPreviousSummaryHeader,
      previousSummary.slice(0, 280),
      p.userContentRuleVaryFromPrevious
    );
  }
  parts.push(
    "",
    p.userContentSummaryHeader,
    ...lines.map(l => `- ${l}`),
    "",
    p.userContentStatsHeader,
    String(statsPrompt ?? "")
  );
  return parts.join("\n");
}

function timeToMinutes(value) {
  const [hours, minutes] = String(value || "").split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 0;
  return hours * 60 + minutes;
}

function minutesBetween(start, end) {
  return Math.max(0, timeToMinutes(end) - timeToMinutes(start));
}

function normalizeDateKey(value) {
  const s = String(value || "").trim();
  const match = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : "";
}

function shiftYmd(ymd, deltaDays) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  const py = dt.getUTCFullYear();
  const pm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const pd = String(dt.getUTCDate()).padStart(2, "0");
  return `${py}-${pm}-${pd}`;
}

function formatHoursMinutes(totalMinutes) {
  const m = Math.max(0, Math.floor(Number(totalMinutes) || 0));
  return { hours: String(Math.floor(m / 60)), mins: String(m % 60) };
}

/** 기준일·전일·전주·계획 실행률 등 일일 리포트 비교용 보조 통계 */
function buildDailyReportEnrichment({ days, blocks, plans, reportDate }) {
  const reportYmd = normalizeDateKey(reportDate);
  const normalizedDays = (Array.isArray(days) ? days : [])
    .map(day => ({ ...day, date: normalizeDateKey(day.date) }))
    .filter(day => day.date);

  const blockRows = Array.isArray(blocks) ? blocks : [];
  const planRows = Array.isArray(plans) ? plans : [];

  const totalBlocks = blockRows.length;
  const doneBlocks = blockRows.filter(b => Number(b.done) === 1 || b.done === true).length;
  const scheduleSlotDonePct =
    totalBlocks > 0 ? Math.round((doneBlocks / totalBlocks) * 100) : null;

  const minutesByDate = {};
  for (const block of blockRows) {
    const day = normalizedDays.find(d => Number(d.id) === Number(block.study_day_id));
    if (!day) continue;
    minutesByDate[day.date] =
      (minutesByDate[day.date] || 0) + minutesBetween(block.start_time, block.end_time);
  }

  const prevDayYmd = reportYmd ? shiftYmd(reportYmd, -1) : "";
  const reportDayStudyMinutes = reportYmd ? minutesByDate[reportYmd] || 0 : 0;
  const previousDayStudyMinutes = prevDayYmd ? minutesByDate[prevDayYmd] || 0 : 0;

  const finals = planRows
    .map(p => (p.final_pct != null ? Number(p.final_pct) : NaN))
    .filter(n => Number.isFinite(n));
  const avgPlanFinalPct =
    finals.length > 0
      ? Math.round(finals.reduce((a, b) => a + b, 0) / finals.length)
      : null;

  return {
    reportDate: reportYmd,
    scheduleSlotDonePct,
    scheduleSlotDoneCount: doneBlocks,
    scheduleSlotTotalCount: totalBlocks,
    reportDayStudyMinutes,
    previousDayStudyMinutes,
    avgPlanFinalPct,
    studyMinutesByDate: minutesByDate
  };
}

/** 주간 통계 → 일일 AI 리포트용 요약 줄 (GPT user에 포함) */
function buildWeeklySummaryLines(stats) {
  const p = pdr();
  const week = formatHoursMinutes(stats.totalStudyMinutes);
  const mainSubject =
    stats.subjectTimes && stats.subjectTimes.length > 0 ? stats.subjectTimes[0].subject : null;
  const bestCompletion =
    stats.completionRates && stats.completionRates.length > 0 ? stats.completionRates[0] : null;
  const worstCompletion =
    stats.completionRates && stats.completionRates.length > 0
      ? stats.completionRates[stats.completionRates.length - 1]
      : null;

  const lines = [];

  lines.push(
    tpl(p.weeklyLinePeriod, {
      weekStart: stats.weekStart,
      weekEnd: stats.weekEnd,
      hours: week.hours,
      mins: week.mins
    })
  );

  if (stats.reportDate) {
    const day = formatHoursMinutes(stats.reportDayStudyMinutes);
    lines.push(
      tpl(p.weeklyLineReportDay, {
        reportDate: stats.reportDate,
        hours: day.hours,
        mins: day.mins
      })
    );
    const reportMin = Number(stats.reportDayStudyMinutes) || 0;
    const prevMin = Number(stats.previousDayStudyMinutes) || 0;
    if (reportMin > 0 || prevMin > 0) {
      const prevDay = formatHoursMinutes(prevMin);
      const delta = reportMin - prevMin;
      const direction =
        delta > 5
          ? p.compareDirectionUp
          : delta < -5
            ? p.compareDirectionDown
            : p.compareDirectionFlat;
      lines.push(
        tpl(p.weeklyLinePrevDayCompare, {
          direction,
          prevHours: prevDay.hours,
          prevMins: prevDay.mins,
          hours: day.hours,
          mins: day.mins
        })
      );
    }
  }

  if (stats.prevWeekTotalStudyMinutes != null && Number.isFinite(Number(stats.prevWeekTotalStudyMinutes))) {
    const prevWeek = formatHoursMinutes(stats.prevWeekTotalStudyMinutes);
    const deltaMin = Number(stats.totalStudyMinutes) - Number(stats.prevWeekTotalStudyMinutes);
    const weekDeltaLabel =
      deltaMin > 30
        ? tpl(p.compareWeekMore, { hours: String(Math.floor(deltaMin / 60)), mins: String(deltaMin % 60) })
        : deltaMin < -30
          ? tpl(p.compareWeekLess, {
              hours: String(Math.floor(Math.abs(deltaMin) / 60)),
              mins: String(Math.abs(deltaMin) % 60)
            })
          : p.compareWeekSimilar;
    lines.push(
      tpl(p.weeklyLinePrevWeekCompare, {
        prevHours: prevWeek.hours,
        prevMins: prevWeek.mins,
        hours: week.hours,
        mins: week.mins,
        weekDeltaLabel
      })
    );
  }

  if (stats.scheduleSlotDonePct != null && stats.scheduleSlotTotalCount > 0) {
    lines.push(
      tpl(p.weeklyLineScheduleDone, {
        pct: String(stats.scheduleSlotDonePct),
        done: String(stats.scheduleSlotDoneCount),
        total: String(stats.scheduleSlotTotalCount)
      })
    );
  }

  if (stats.avgPlanFinalPct != null) {
    lines.push(tpl(p.weeklyLinePlanAvg, { pct: String(stats.avgPlanFinalPct) }));
  }

  if (mainSubject) {
    lines.push(tpl(p.weeklyLineMainSubject, { subject: mainSubject }));
  }

  if (bestCompletion) {
    lines.push(
      tpl(p.weeklyLineBestCompletion, {
        subject: bestCompletion.subject,
        pct: String(bestCompletion.avgFinalPct)
      })
    );
  }

  if (worstCompletion && worstCompletion !== bestCompletion) {
    lines.push(
      tpl(p.weeklyLineWorstCompletion, {
        subject: worstCompletion.subject,
        pct: String(worstCompletion.avgFinalPct)
      })
    );
  }

  if (stats.consecutiveAbsentDays >= 2) {
    lines.push(tpl(p.weeklyLineAbsent, { days: String(stats.consecutiveAbsentDays) }));
  }

  return lines;
}

function buildWeeklyReportPrompt(stats) {
  const p = pdr();
  const baseJson = JSON.stringify(stats, null, 2);
  return [p.weeklyReportPromptIntro, p.weeklyReportPromptTask, "", baseJson].join("\n");
}

module.exports = {
  systemPrompt,
  buildUserContent,
  buildDailyReportEnrichment,
  buildWeeklySummaryLines,
  buildWeeklyReportPrompt,
  shiftYmd,
  temperature: 0.52,
  maxTokens: 700
};
