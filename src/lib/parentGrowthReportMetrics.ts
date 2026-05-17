import type { ParentGrowthReportPayload } from "../coach/parent/ParentGrowthReportTab";
import { resolveFocusEfficiencyDisplay } from "./growthReportFocusEfficiency";

export type DeltaDirection = "up" | "down" | "flat";

export type MetricDelta = {
  direction: DeltaDirection;
  label: string;
};

const RADAR_KEYS = [
  "집중 지속성",
  "집중 빈도",
  "학습 효율",
  "휴식 패턴",
  "시간대별 집중",
  "계획 실행력"
] as const;

export type RadarDimension = (typeof RADAR_KEYS)[number];

export type RadarScores = Record<RadarDimension, number>;

export function formatMetricDelta(
  current: number | null | undefined,
  prev: number | null | undefined,
  opts?: { suffix?: string; decimals?: number; invertGood?: boolean }
): MetricDelta | null {
  if (current == null || !Number.isFinite(current) || prev == null || !Number.isFinite(prev)) {
    return null;
  }
  const diff = current - prev;
  const decimals = opts?.decimals ?? 0;
  const suffix = opts?.suffix ?? "%";
  const rounded = Number(diff.toFixed(decimals));
  if (Math.abs(rounded) < (decimals > 0 ? 0.05 : 0.5)) {
    return { direction: "flat", label: `전주 대비 → 0${suffix}` };
  }
  const up = rounded > 0;
  const good = opts?.invertGood ? !up : up;
  const arrow = up ? "↑" : "↓";
  const sign = rounded > 0 ? "+" : "";
  return {
    direction: up ? "up" : "down",
    label: `전주 대비 ${arrow} ${sign}${rounded}${suffix}`
  };
}

export function deltaColorClass(delta: MetricDelta | null): string {
  if (!delta || delta.direction === "flat") return "pgr-delta--flat";
  const good = delta.direction === "up";
  return good ? "pgr-delta--good" : "pgr-delta--bad";
}

export function scoreToLetter(score: number): string {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

export function computeCompositeScore(data: ParentGrowthReportPayload): {
  score: number;
  grade: string;
} {
  const plan = data.planExecution.achievementPct;
  const focus = resolveFocusEfficiencyDisplay(data.studyEfficiency);
  const goalH = data.meta?.weeklyStudyGoalHours ?? 14;
  const studyPct = Math.min(
    100,
    goalH > 0 ? (data.studyEfficiency.actualStudyHours / goalH) * 100 : 0
  );
  const focusScore =
    focus.kind === "rate" && focus.donutPct != null
      ? focus.donutPct
      : focus.kind === "low" && focus.donutPct != null
        ? focus.donutPct * 0.85
        : 50;
  const planScore = plan != null ? plan : 50;
  const score = Math.round(planScore * 0.35 + focusScore * 0.35 + studyPct * 0.3);
  const clamped = Math.max(0, Math.min(100, score));
  return { score: clamped, grade: scoreToLetter(clamped) };
}

export function computeStudyVolumePct(data: ParentGrowthReportPayload): number {
  const goalH = data.meta?.weeklyStudyGoalHours ?? 14;
  if (goalH <= 0) return 0;
  return Math.min(100, Math.round((data.studyEfficiency.actualStudyHours / goalH) * 100));
}

export function computeFocusAttentionPct(data: ParentGrowthReportPayload): number {
  const focus = resolveFocusEfficiencyDisplay(data.studyEfficiency);
  if (focus.kind === "rate" && focus.donutPct != null) return Math.round(focus.donutPct);
  if (focus.kind === "low" && focus.donutPct != null) return Math.round(focus.donutPct);
  return 0;
}

function clampScore(n: number): number {
  return Math.max(0, Math.min(10, Math.round(n * 10) / 10));
}

function studyDaysWithLog(daily: ParentGrowthReportPayload["daily"]): number {
  return daily.filter(d => (d.studyMinutesFromLog ?? 0) > 0).length;
}

function avgSleepHours(daily: ParentGrowthReportPayload["daily"]): number | null {
  const vals = daily.map(d => d.sleepHours).filter((v): v is number => v != null);
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function dailyStudyVarianceScore(daily: ParentGrowthReportPayload["daily"]): number {
  const mins = daily.map(d => d.studyMinutesFromLog ?? 0);
  const active = mins.filter(m => m > 0);
  if (active.length < 2) return 5;
  const mean = active.reduce((a, b) => a + b, 0) / active.length;
  const variance =
    active.reduce((sum, m) => sum + (m - mean) ** 2, 0) / active.length;
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 1;
  return clampScore(10 - cv * 8);
}

export function buildRadarScores(data: ParentGrowthReportPayload): {
  thisWeek: RadarScores;
  prevWeek: RadarScores;
} {
  const se = data.studyEfficiency;
  const actual = Math.max(se.actualStudyHours, 0.1);
  const focusRatio = se.focusBandHours / actual;
  const focusPct = se.focusEfficiencyPct;
  const daysLogged = studyDaysWithLog(data.daily);
  const sleepAvg = avgSleepHours(data.daily);
  const sleepGoal = data.sleepGoalHours;
  const planPct = data.planExecution.achievementPct ?? 50;

  const thisWeek: RadarScores = {
    "집중 지속성": clampScore(focusRatio * 12),
    "집중 빈도": clampScore((daysLogged / 7) * 10),
    "학습 효율": clampScore(focusPct != null ? focusPct / 10 : 5),
    "휴식 패턴":
      sleepAvg != null && sleepGoal > 0
        ? clampScore((sleepAvg / sleepGoal) * 10)
        : 5,
    "시간대별 집중": dailyStudyVarianceScore(data.daily),
    "계획 실행력": clampScore(planPct / 10)
  };

  const prevFocus = data.prevWeek?.focusEfficiencyPct;
  const prevPlan = data.prevWeek?.achievementPct;
  const prevStudy = data.prevWeek?.actualStudyHours ?? 0;
  const prevFocusH = prevFocus != null ? (prevFocus / 100) * prevStudy : prevStudy * 0.5;

  const prevWeek: RadarScores = {
    "집중 지속성": clampScore((prevFocusH / Math.max(prevStudy, 0.1)) * 12),
    "집중 빈도": clampScore((Math.min(daysLogged, 5) / 7) * 9),
    "학습 효율": clampScore(prevFocus != null ? prevFocus / 10 : 5),
    "휴식 패턴": thisWeek["휴식 패턴"] * 0.92,
    "시간대별 집중": thisWeek["시간대별 집중"] * 0.9,
    "계획 실행력": clampScore((prevPlan ?? planPct * 0.9) / 10)
  };

  return { thisWeek, prevWeek };
}

export function radarToChartData(scores: RadarScores, layer: "thisWeek" | "prevWeek") {
  return RADAR_KEYS.map(key => ({
    subject: key,
    score: scores[key],
    layer
  }));
}

export const RADAR_DIMENSIONS = RADAR_KEYS;

export function buildCoachBlocks(
  narrative: ParentGrowthReportPayload["narrative"],
  data: ParentGrowthReportPayload
): {
  observation: string;
  diagnosisGood: string;
  diagnosisImprove: string;
  prescriptions: string[];
} {
  const observation = narrative.weeklySummary.trim();
  const efficiency = narrative.studyEfficiencyInsight.trim();
  const plan = narrative.planExecutionSummary.trim();
  const sentences = efficiency.split(/(?<=[.!?])\s+/).filter(Boolean);
  const diagnosisGood =
    sentences[0]?.trim() ||
    (data.planExecution.completedCount > 0
      ? `이번 주 계획 ${data.planExecution.completedCount}개를 완료하며 실행력을 보였습니다.`
      : "기록된 학습 시간을 바탕으로 꾸준히 학습에 참여했습니다.");
  const diagnosisImprove =
    sentences.slice(1).join(" ").trim() ||
    plan ||
    "집중 구간 비율을 높이고, 계획 대비 실제 학습 시간의 격차를 줄이는 것이 필요합니다.";
  const prescriptions = splitBulletLines(narrative.nextWeekForStudent);
  return { observation, diagnosisGood, diagnosisImprove, prescriptions };
}

export function splitBulletLines(text: string): string[] {
  const raw = text.trim();
  if (!raw) return [];
  const lines = raw
    .split(/\n|(?:\d+[\.)]\s*)|(?:[-•]\s*)/)
    .map(s => s.trim())
    .filter(s => s.length > 4);
  if (lines.length >= 2) return lines.slice(0, 5);
  const bySentence = raw.split(/(?<=[.!?])\s+/).filter(s => s.length > 6);
  return bySentence.length ? bySentence.slice(0, 4) : [raw];
}

export type SuggestionCard = {
  title: string;
  body: string;
  effect: string;
  priority: "high" | "medium" | "low";
};

export function parseSuggestionCards(text: string): SuggestionCard[] {
  const items = splitBulletLines(text);
  return items.map((body, i) => {
    const titleMatch = body.match(/^([^:：]+)[:：]\s*(.+)$/);
    const title = titleMatch ? titleMatch[1].trim() : `제안 ${i + 1}`;
    const rest = titleMatch ? titleMatch[2].trim() : body;
    const priority: SuggestionCard["priority"] =
      /중요|필수|반드시|우선/.test(body) ? "high" : /권장|추천/.test(body) ? "medium" : "low";
    return {
      title,
      body: rest,
      effect: "꾸준히 실천하면 학습 루틴 안정에 도움이 됩니다.",
      priority
    };
  });
}

export function formatIssuedLabel(issuedAt: string | undefined, headerBadgeWeek: string): string {
  if (issuedAt) {
    try {
      const d = new Date(issuedAt);
      const y = d.getFullYear();
      const m = d.getMonth() + 1;
      return `${y}년 ${m}월 · ${headerBadgeWeek}`;
    } catch {
      // fall through
    }
  }
  return headerBadgeWeek;
}

export function formatStudentSubtitle(data: ParentGrowthReportPayload): string {
  const parts: string[] = [];
  if (data.gradeLine) parts.push(data.gradeLine.replace(/\s*·\s*$/, ""));
  const goal = data.meta?.studentGoal;
  const grade = data.meta?.targetGrade;
  if (grade) parts.push(`목표: ${grade}`);
  else if (goal) parts.push(`목표: ${goal}`);
  return parts.join(" · ");
}

export function sleepQualityStars(daily: ParentGrowthReportPayload["daily"], goal: number): number {
  const vals = daily
    .map(d => d.brainRecoveryIndex ?? (d.sleepHours != null ? (d.sleepHours / goal) * 100 : null))
    .filter((v): v is number => v != null && Number.isFinite(v));
  if (!vals.length) return 0;
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  if (avg >= 85) return 5;
  if (avg >= 70) return 4;
  if (avg >= 55) return 3;
  if (avg >= 40) return 2;
  return 1;
}

export function planGaugeColor(pct: number): string {
  if (pct >= 70) return "#2E7D5E";
  if (pct >= 40) return "#E8A020";
  return "#C0392B";
}
