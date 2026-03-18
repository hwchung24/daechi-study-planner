// Analytics utilities for Daechi Planner
// Pure functions that compute weekly stats which can be:
// 1) 그대로 API 응답(JSON)으로 내려가고
// 2) LLM 프롬프트에 넣어 요약 텍스트를 생성하는 데 사용됨

export type FocusScore = "◎" | "○" | "△" | "✕" | null;

export interface StudyBlockRow {
  id: number;
  study_day_id: number;
  subject: string;
  start_time: string; // "HH:MM"
  end_time: string; // "HH:MM"
  done: 0 | 1;
  focus_score: FocusScore;
}

export interface StudyPlanRow {
  id: number;
  study_day_id: number;
  book_id: number;
  planned_range: string | null;
  start_time: string | null;
  end_time: string | null;
  mid_pct: number | null;
  final_pct: number | null;
}

export interface StudyDayRow {
  id: number;
  user_id: number;
  date: string; // "YYYY-MM-DD"
}

export interface WeeklyStatsInput {
  days: StudyDayRow[]; // 주간 날짜 7일
  blocks: StudyBlockRow[]; // 해당 7일에 속한 모든 블록
  plans: StudyPlanRow[]; // 해당 7일에 속한 모든 계획
}

export interface SubjectTimeStat {
  subject: string;
  minutes: number;
}

export interface FocusDistribution {
  best: number; // ◎
  good: number; // ○
  ok: number; // △
  bad: number; // ✕
}

export interface CompletionRateBySubject {
  subject: string;
  avgFinalPct: number; // 0~100
}

export interface DeferredSubject {
  subject: string;
  lowCompletionCount: number;
}

export interface WeeklyStats {
  weekStart: string;
  weekEnd: string;
  totalStudyMinutes: number;
  totalStudyMinutesPrevWeek?: number;
  subjectTimes: SubjectTimeStat[];
  completionRates: CompletionRateBySubject[];
  focusDistribution: FocusDistribution;
  consecutiveAbsentDays: number;
  mostDeferredSubjects: DeferredSubject[];
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function minutesDiff(start: string, end: string): number {
  return Math.max(0, timeToMinutes(end) - timeToMinutes(start));
}

export function computeWeeklyStats(input: WeeklyStatsInput): WeeklyStats {
  const { days, blocks, plans } = input;
  if (days.length === 0) {
    return {
      weekStart: "",
      weekEnd: "",
      totalStudyMinutes: 0,
      subjectTimes: [],
      completionRates: [],
      focusDistribution: { best: 0, good: 0, ok: 0, bad: 0 },
      consecutiveAbsentDays: 0,
      mostDeferredSubjects: []
    };
  }

  const sortedDays = [...days].sort((a, b) =>
    a.date.localeCompare(b.date)
  );
  const weekStart = sortedDays[0].date;
  const weekEnd = sortedDays[sortedDays.length - 1].date;

  // 1) 총 학습 시간 + 과목별 학습 시간
  const subjectMinutes = new Map<string, number>();
  let totalStudyMinutes = 0;

  for (const b of blocks) {
    const minutes = minutesDiff(b.start_time, b.end_time);
    totalStudyMinutes += minutes;
    subjectMinutes.set(
      b.subject,
      (subjectMinutes.get(b.subject) || 0) + minutes
    );
  }

  const subjectTimes: SubjectTimeStat[] = Array.from(
    subjectMinutes.entries()
  )
    .map(([subject, minutes]) => ({ subject, minutes }))
    .sort((a, b) => b.minutes - a.minutes);

  // 2) 계획 대비 완료율(최종 pct 평균, 과목 기준)
  // 계획은 book 기준이라, book 이름 join이 필요하지만
  // 여기서는 subject 정보가 없다고 가정하고 "전체 평균" 대신
  // 주어진 plans에서 final_pct 평균만 계산.
  const subjectCompletion = new Map<string, { sum: number; count: number }>();

  for (const p of plans) {
    if (p.final_pct == null) continue;
    // subject 대신 book_id를 문자열로 사용 (추후 join으로 교체)
    const key = String(p.book_id);
    const agg = subjectCompletion.get(key) || { sum: 0, count: 0 };
    agg.sum += p.final_pct;
    agg.count += 1;
    subjectCompletion.set(key, agg);
  }

  const completionRates: CompletionRateBySubject[] = Array.from(
    subjectCompletion.entries()
  )
    .map(([key, { sum, count }]) => ({
      subject: `book#${key}`,
      avgFinalPct: count > 0 ? Math.round(sum / count) : 0
    }))
    .sort((a, b) => b.avgFinalPct - a.avgFinalPct);

  // 3) 집중도 분포
  const focusDistribution: FocusDistribution = {
    best: 0,
    good: 0,
    ok: 0,
    bad: 0
  };
  for (const b of blocks) {
    if (b.focus_score === "◎") focusDistribution.best += 1;
    else if (b.focus_score === "○") focusDistribution.good += 1;
    else if (b.focus_score === "△") focusDistribution.ok += 1;
    else if (b.focus_score === "✕") focusDistribution.bad += 1;
  }

  // 4) 연속 결석일 수 (마지막 날 기준, 뒤에서부터)
  const dayHasStudy = new Map<string, boolean>();
  for (const d of days) {
    dayHasStudy.set(d.date, false);
  }
  for (const b of blocks) {
    const day = days.find(d => d.id === b.study_day_id);
    if (!day) continue;
    if (minutesDiff(b.start_time, b.end_time) > 0) {
      dayHasStudy.set(day.date, true);
    }
  }

  let consecutiveAbsentDays = 0;
  for (let i = sortedDays.length - 1; i >= 0; i--) {
    const d = sortedDays[i];
    if (dayHasStudy.get(d.date)) break;
    consecutiveAbsentDays += 1;
  }

  // 5) 자주 미루는 과목 (완료율이 낮은 book 기준)
  const deferred: DeferredSubject[] = completionRates
    .filter(c => c.avgFinalPct <= 60)
    .map(c => ({
      subject: c.subject,
      lowCompletionCount: 1
    }));

  return {
    weekStart,
    weekEnd,
    totalStudyMinutes,
    subjectTimes,
    completionRates,
    focusDistribution,
    consecutiveAbsentDays,
    mostDeferredSubjects: deferred
  };
}

// 주간 통계를 한국어 설명형 문장으로 변환하는 템플릿 함수
export function buildWeeklySummaryLines(
  stats: WeeklyStats
): string[] {
  const hours = Math.floor(stats.totalStudyMinutes / 60);
  const mins = stats.totalStudyMinutes % 60;

  const mainSubject =
    stats.subjectTimes.length > 0 ? stats.subjectTimes[0].subject : null;

  const bestCompletion =
    stats.completionRates.length > 0 ? stats.completionRates[0] : null;

  const worstCompletion =
    stats.completionRates.length > 0
      ? stats.completionRates[stats.completionRates.length - 1]
      : null;

  const lines: string[] = [];

  lines.push(
    `이번 주 학습 기간은 ${stats.weekStart} ~ ${stats.weekEnd}이며, 총 학습 시간은 약 ${hours}시간 ${mins}분입니다.`
  );

  if (mainSubject) {
    lines.push(
      `가장 많은 시간을 투자한 과목은 「${mainSubject}」입니다.`
    );
  }

  if (bestCompletion) {
    lines.push(
      `계획 대비 완료율이 가장 높은 교재는 ${bestCompletion.subject}로 평균 ${bestCompletion.avgFinalPct}%를 기록했습니다.`
    );
  }

  if (worstCompletion && worstCompletion !== bestCompletion) {
    lines.push(
      `완료율이 상대적으로 낮은 교재는 ${worstCompletion.subject}로 평균 ${worstCompletion.avgFinalPct}% 수준입니다.`
    );
  }

  if (stats.consecutiveAbsentDays >= 2) {
    lines.push(
      `최근 ${stats.consecutiveAbsentDays}일 연속으로 학습 기록이 없어, 일정 관리에 추가적인 점검이 필요해 보입니다.`
    );
  }

  return lines;
}

// LLM 프롬프트 예시 생성
export function buildWeeklyReportPrompt(
  stats: WeeklyStats
): string {
  const baseJson = JSON.stringify(stats, null, 2);
  return [
    "다음은 한 학생의 1주일 학습 통계입니다.",
    "이 내용을 바탕으로 학부모에게 보내는 4~5줄짜리 리포트를 한국어로 작성해 주세요.",
    "",
    baseJson
  ].join("\n");
}

