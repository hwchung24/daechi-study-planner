import ModeScheduleSettings from "./ModeScheduleSettings";
import type { ModeScheduleSlot } from "./ModeScheduleGrid";
import React, {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  BookOpen,
  Brain,
  CalendarClock,
  CalendarRange,
  CheckCircle2,
  ClipboardList,
  LayoutGrid,
  Library,
  Lightbulb,
  ListChecks,
  MapPin,
  NotebookPen,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  UserRound
} from "lucide-react";
import { TabTransitionPanel } from "../../components/PageTransition";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { TimePickerSheet } from "../../components/TimePickerSheet";
import { setAppPath } from "../../lib/appNavigation";
import {
  StudyRoomPickerModal,
  type StudyRoomSetting
} from "../../components/parent/StudyRoomPickerModal";
import type { ParentLockStatus } from "../../types/lockStatus";
import type { Severity } from "../types";
import {
  getDateKeySeoul,
  getWeekDaysIncludingTomorrowSeoul,
  seoulDateKeyFromApiValue
} from "../../lib/weekDates";
import { ParentAdminChannelPanel } from "../admin/AdminChannelPanels";
import { StudentCoachApp } from "../student/StudentCoachApp";
import { Card, EmptyState, GradientHeroCard, MetricCard, RiskBadge, SectionHeader } from "../ui/components";
import { formatMinutes } from "../utils/format";
import type { ParentStudentRow } from "../../types/parent";
import type { StudyRoomVisitSession } from "../../types/studyRoomTracking";
import {
  buildParentCoachPatternsCacheKey,
  buildParentCoachStateCacheKey,
  readLocalCache,
  readStoredUserCacheScope,
  writeLocalCache
} from "../../lib/viewCache";
import { ParentHomeTab } from "./ParentHomeTab";
import {
  PARENT_MDM_SURFACE_LABEL,
  parseParentMdmSurfaceMode,
  type ParentMdmSurfaceMode
} from "./parentDeviceModeDisplay";
import { ParentStudentSelector, formatStudentLabel } from "./ParentStudentSelector";
import { useParentStudyRoomLive } from "./useParentStudyRoomLive";

export type ParentTabKey =
  | "home"
  | "manage"
  | "records"
  | "studentSettings"
  | "analysis";

const PARENT_COACH_CACHE_TTL_MS = 2 * 60 * 1000;

type ParentAiDaily = {
  summary_text: string;
  report_date: string;
  model: string;
  created_at: string;
};

type ParentWeekDay = {
  id: number | string;
  date: string;
};

type ParentWeekBlock = {
  study_day_id: number | string;
  subject: string;
  start_time: string;
  end_time: string;
  done?: boolean;
  focus_score?: "◎" | "○" | "△" | "✕" | null;
  planned_range?: string | null;
};

type ParentWeekPlan = {
  id: number | string;
  study_day_id: number | string;
  book_name?: string | null;
  planned_range?: string | null;
  start_time?: string | null;
  end_time?: string | null;
};

type ParentCoachLog = {
  date: string;
  sleepHours?: number | null;
  concentrationScore?: number | null;
  stressScore?: number | null;
  steps?: number | null;
  planCompletionRate?: number | null;
  studyMinutes?: number | null;
  memo?: string | null;
  tomorrowPractice?: string | null;
  tomorrowPracticeDone?: boolean | null;
  studyEvaluation?: string | null;
  metacognitionReflection?: string | null;
};

type ParentCoachAnalysisLog = {
  date: string;
  sleepHours: number | null;
  concentrationScore: number | null;
  stressScore: number | null;
  steps: number | null;
  planCompletionRate: number | null;
  studyMinutes: number | null;
};

type ParentCoachAnalysisState = {
  snapshot?: {
    profile?: {
      name?: string;
      schoolLevel?: string | null;
      grade?: number | null;
      goal?: string;
      targetSubjects?: string[];
    };
    heroNarrative?: string;
    metrics?: {
      sleepHours?: number | null;
      steps?: number | null;
      stress?: number | null;
      mealsRegularity?: number | null;
      concentration?: number | null;
      studyMinutes?: number | null;
      planCompletionRate?: number | null;
    };
    nextActions?: string[];
  };
  logs?: ParentCoachAnalysisLog[];
};

function normalizeCachedParentCoachAnalysisState(
  raw: unknown
): ParentCoachAnalysisState | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as ParentCoachAnalysisState & { logs?: unknown[] };
  return {
    ...data,
    logs: Array.isArray(data.logs)
      ? data.logs
          .map(normalizeParentCoachAnalysisLog)
          .filter((row): row is ParentCoachAnalysisLog => row != null)
      : []
  };
}

function normalizeCachedParentPatterns(raw: unknown): ParentAiPatternRow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is ParentAiPatternRow => {
      if (!item || typeof item !== "object") return false;
      const row = item as Record<string, unknown>;
      return ["key", "title", "severity", "explanation", "recommendation"].every(
        field => typeof row[field] === "string"
      );
    })
    .map(item => ({ ...item }));
}

type ParentAiPatternRow = {
  key: string;
  title: string;
  severity: string;
  explanation: string;
  recommendation: string;
};

type ParentRhythmChartRow = {
  date: string;
  concentration: number | null;
  studyMinutes: number | null;
  sleepHours: number | null;
  stressScore: number | null;
  planCompletionRate: number | null;
};

type ParentRhythmMetricKey = Exclude<keyof ParentRhythmChartRow, "date">;

type ParentWeeklyReport = {
  days?: ParentWeekDay[];
  blocks?: ParentWeekBlock[];
  plans?: ParentWeekPlan[];
  logs?: ParentCoachLog[];
  stats?: {
    totalStudyMinutes?: number;
    consecutiveAbsentDays?: number;
    focusDistribution?: {
      best: number;
      good: number;
      ok: number;
      bad: number;
    };
  };
  summaryLines?: string[];
};

type ParentGuide = {
  urgency: Severity;
  intervention: "관찰" | "칭찬" | "질문 1개" | "루틴 도움" | "상담 권장";
  headline: string;
  guidanceLines: string[];
  suggestedPhrases: string[];
};

function timeToMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 0;
  return hours * 60 + minutes;
}

function minutesBetween(start: string, end: string) {
  return Math.max(0, timeToMinutes(end) - timeToMinutes(start));
}

function buildDailyChart(report: ParentWeeklyReport | null) {
  const days = Array.isArray(report?.days) ? report.days : [];
  const blocks = Array.isArray(report?.blocks) ? report.blocks : [];

  return days.map(day => {
    const dayId = Number(day.id);
    const dayBlocks = blocks.filter(
      block => Number(block.study_day_id) === dayId
    );
    const studyMinutes = dayBlocks.reduce(
      (sum, block) => sum + minutesBetween(block.start_time, block.end_time),
      0
    );
    return {
      id: day.id,
      date: day.date,
      label: day.date.slice(5),
      studyMinutes,
      subjects: Array.from(new Set(dayBlocks.map(block => block.subject).filter(Boolean)))
    };
  });
}

const SLEEP_HOURS_MAX = 14;
const STUDY_HOURS_MAX = SLEEP_HOURS_MAX;

function recordLifeSliderFillPct(value: string | number | null | undefined): string {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return "0%";
  const clamped = Math.max(1, Math.min(5, numericValue));
  const pct = ((clamped - 1) / 4) * 100;
  return `${pct}%`;
}

function recordSleepSliderFillPct(value: string | number | null | undefined): string {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return "0%";
  const clamped = Math.max(0, Math.min(SLEEP_HOURS_MAX, numericValue));
  const pct = (clamped / SLEEP_HOURS_MAX) * 100;
  return `${pct}%`;
}

function recordStudyHoursSliderFillPctFromMinutes(value: string | number | null | undefined): string {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return "0%";
  const clamped = Math.max(0, Math.min(STUDY_HOURS_MAX * 60, numericValue));
  const pct = ((clamped / 60) / STUDY_HOURS_MAX) * 100;
  return `${pct}%`;
}

function formatNumericHours(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const clamped = Math.max(0, Math.min(SLEEP_HOURS_MAX, Number(value)));
  return Number.isInteger(clamped) ? `${clamped}시간` : `${clamped.toFixed(1)}시간`;
}

function formatStudyHoursLabel(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const hours = Math.max(0, Math.min(STUDY_HOURS_MAX, Number(value) / 60));
  return Number.isInteger(hours) ? `${hours}시간` : `${hours.toFixed(1)}시간`;
}

function normalizeDateKey(value: string | null | undefined): string {
  return String(value || "").trim().slice(0, 10);
}

function shiftDateKey(dateKey: string, offsetDays: number): string {
  const base = new Date(`${normalizeDateKey(dateKey)}T12:00:00+09:00`);
  if (Number.isNaN(base.getTime())) return normalizeDateKey(dateKey);
  base.setDate(base.getDate() + offsetDays);
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}-${String(base.getDate()).padStart(2, "0")}`;
}

function sortBlocks(blocks: ParentWeekBlock[]) {
  return [...blocks].sort((left, right) => {
    const start = timeToMinutes(left.start_time) - timeToMinutes(right.start_time);
    if (start !== 0) return start;
    return String(left.subject || "").localeCompare(String(right.subject || ""), "ko");
  });
}

function trimText(value: string | null | undefined): string {
  return String(value || "").trim();
}

function formatCoachLogDateKey(raw: string | undefined | null): string {
  return normalizeDateKey(raw);
}

function numOrNull(a: unknown, b?: unknown): number | null {
  const n = Number(a ?? b);
  return Number.isFinite(n) ? n : null;
}

function normalizeParentCoachAnalysisLog(raw: unknown): ParentCoachAnalysisLog | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const date = formatCoachLogDateKey(String(o.date ?? o.log_date ?? ""));
  if (!date) return null;
  return {
    date,
    sleepHours: numOrNull(o.sleepHours, o.sleep_hours),
    concentrationScore: numOrNull(o.concentrationScore, o.concentration_score),
    stressScore: numOrNull(o.stressScore, o.stress_score),
    steps: numOrNull(o.steps),
    planCompletionRate: numOrNull(o.planCompletionRate, o.plan_completion_rate),
    studyMinutes: numOrNull(o.studyMinutes, o.study_minutes)
  };
}

function buildRhythmChartRowsFromLogs(
  apiLogs: ParentCoachAnalysisLog[] | undefined
): ParentRhythmChartRow[] {
  const recent7Days = Array.from({ length: 7 }).map((_, idx) =>
    getDateKeySeoul(idx - 6)
  );
  const byDate = new Map<string, ParentCoachAnalysisLog>();
  for (const row of apiLogs || []) {
    const key = formatCoachLogDateKey(row.date);
    if (key && !byDate.has(key)) byDate.set(key, row);
  }
  return recent7Days.map(dateKey => {
    const row = byDate.get(dateKey);
    if (!row) {
      return {
        date: dateKey,
        concentration: null,
        studyMinutes: null,
        sleepHours: null,
        stressScore: null,
        planCompletionRate: null
      };
    }
    const concentrationRaw =
      row.concentrationScore != null && Number.isFinite(Number(row.concentrationScore))
        ? Number(row.concentrationScore)
        : null;
    return {
      date: dateKey,
      concentration:
        concentrationRaw == null ? null : Math.round((concentrationRaw / 5) * 100),
      studyMinutes:
        row.studyMinutes != null && Number.isFinite(Number(row.studyMinutes))
          ? Number(row.studyMinutes)
          : null,
      sleepHours:
        row.sleepHours != null && Number.isFinite(Number(row.sleepHours))
          ? Number(row.sleepHours)
          : null,
      stressScore:
        row.stressScore != null && Number.isFinite(Number(row.stressScore))
          ? Number(row.stressScore)
          : null,
      planCompletionRate:
        row.planCompletionRate != null && Number.isFinite(Number(row.planCompletionRate))
          ? Number(row.planCompletionRate)
          : null
    };
  });
}

function labelShort(dateKey: string) {
  const normalized = normalizeDateKey(dateKey);
  return normalized ? normalized.slice(5) : "";
}

function riskLevelFromSnapshotMetrics(
  metrics: ParentCoachAnalysisState["snapshot"] extends { metrics?: infer T } ? T : never
): Severity {
  if (!metrics) return "낮음";
  const stress = Number(metrics.stress ?? 0);
  const plan =
    metrics.planCompletionRate != null && Number.isFinite(Number(metrics.planCompletionRate))
      ? Number(metrics.planCompletionRate)
      : null;
  const sleep =
    metrics.sleepHours != null && Number.isFinite(Number(metrics.sleepHours))
      ? Number(metrics.sleepHours)
      : null;
  if (stress >= 4 && plan != null && plan < 45) return "높음";
  if (stress >= 3.8) return "높음";
  if (plan != null && plan < 55 && sleep != null && sleep < 6) return "보통";
  if (stress >= 3.2 || (plan != null && plan < 60)) return "보통";
  return "낮음";
}

function PatternCard(props: {
  title: string;
  severity: string;
  explanation: string;
  recommendation: string;
}) {
  return (
    <Card className="coach-pattern">
      <div className="coach-pattern__top">
        <div className="coach-pattern__title">{props.title}</div>
        <span
          className={
            "coach-badge " +
            (props.severity === "높음"
              ? "coach-badge--danger"
              : props.severity === "보통"
                ? "coach-badge--warn"
                : "coach-badge--ok")
          }
        >
          {props.severity}
        </span>
      </div>
      <div className="coach-pattern__body">{props.explanation}</div>
      <div className="coach-pattern__rec">
        <span className="coach-pattern__rec-label coach-pattern__rec-label--icon">
          <Lightbulb className="coach-analysis-icon coach-analysis-icon--eyebrow" aria-hidden />
          <span>추천</span>
        </span>
        <span className="coach-pattern__rec-text">{props.recommendation}</span>
      </div>
    </Card>
  );
}

function CoachRhythmSparkline(props: {
  rows: ParentRhythmChartRow[];
  dataKey: ParentRhythmMetricKey;
  yDomain: [number, number];
  valueFormatter: (v: number) => string;
}) {
  const { rows, dataKey, yDomain, valueFormatter } = props;
  const width = 308;
  const height = 168;
  const padL = 36;
  const padR = 6;
  const padT = 8;
  const padB = 36;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const [yMin, yMax] = yDomain;
  const ySpan = Math.max(yMax - yMin, 1e-6);
  const count = Math.max(rows.length, 1);

  const points = rows.map((row, index) => {
    const raw = row[dataKey];
    const value = raw == null || !Number.isFinite(Number(raw)) ? null : Number(raw);
    const x = padL + (innerW * (index + 0.5)) / count;
    const y = value == null ? null : padT + innerH * (1 - (value - yMin) / ySpan);
    return { x, y, value, date: row.date };
  });

  const pathSegments: string[] = [];
  const validPoints = points.filter(
    (point): point is { x: number; y: number; value: number; date: string } =>
      point.y != null && point.value != null
  );

  if (validPoints.length === 1) {
    const point = validPoints[0];
    pathSegments.push(`M ${point.x.toFixed(2)} ${point.y.toFixed(2)}`);
  } else if (validPoints.length > 1) {
    let path = `M ${validPoints[0].x.toFixed(2)} ${validPoints[0].y.toFixed(2)}`;
    for (let index = 0; index < validPoints.length - 1; index += 1) {
      const current = validPoints[index];
      const next = validPoints[index + 1];
      const midX = (current.x + next.x) / 2;
      const midY = (current.y + next.y) / 2;
      path += ` Q ${current.x.toFixed(2)} ${current.y.toFixed(2)} ${midX.toFixed(2)} ${midY.toFixed(2)}`;
    }
    const last = validPoints[validPoints.length - 1];
    path += ` T ${last.x.toFixed(2)} ${last.y.toFixed(2)}`;
    pathSegments.push(path);
  }

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="168" role="img" aria-label="주간 리듬 차트">
      <line x1={padL} y1={padT + innerH} x2={width - padR} y2={padT + innerH} stroke="rgba(var(--neutral-rgb), 0.24)" strokeWidth="1" />
      <line x1={padL} y1={padT} x2={padL} y2={padT + innerH} stroke="rgba(var(--neutral-rgb), 0.18)" strokeWidth="1" />
      {pathSegments.map((segment, index) => (
        <path
          key={`path-${index}`}
          d={segment}
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {points.map((point, index) => {
        if (point.y == null || point.value == null) return null;
        return (
          <g key={`point-${index}`}>
            <circle cx={point.x} cy={point.y} r="2" fill="currentColor" />
            <title>{`${labelShort(point.date)} ${valueFormatter(point.value)}`}</title>
          </g>
        );
      })}
      {points.map((point, index) => (
        <text
          key={`lbl-${index}`}
          x={point.x}
          y={height - 10}
          textAnchor="middle"
          fontSize="var(--font-size-small)"
          fill="rgba(var(--neutral-rgb), 0.95)"
        >
          {labelShort(point.date)}
        </text>
      ))}
    </svg>
  );
}

function deriveFocusSubject(blocks: ParentWeekBlock[]) {
  const source = blocks.filter(block => block.done);
  const candidates = source.length > 0 ? source : blocks;
  if (!candidates.length) return null;

  const bySubject = new Map<string, { subject: string; minutes: number; sessions: number }>();
  for (const block of candidates) {
    const subject = trimText(block.subject) || "과목 미기록";
    const prev = bySubject.get(subject) || { subject, minutes: 0, sessions: 0 };
    prev.minutes += minutesBetween(block.start_time, block.end_time);
    prev.sessions += 1;
    bySubject.set(subject, prev);
  }

  return [...bySubject.values()].sort((left, right) => {
    if (right.minutes !== left.minutes) return right.minutes - left.minutes;
    if (right.sessions !== left.sessions) return right.sessions - left.sessions;
    return left.subject.localeCompare(right.subject, "ko");
  })[0];
}

function hasStudyLogContent(log: ParentCoachLog | null | undefined) {
  if (!log) return false;
  return (
    log.studyMinutes != null ||
    trimText(log.studyEvaluation).length > 0 ||
    trimText(log.metacognitionReflection).length > 0
  );
}

function hasLifeLogContent(log: ParentCoachLog | null | undefined) {
  if (!log) return false;
  return (
    log.sleepHours != null ||
    log.stressScore != null ||
    log.concentrationScore != null ||
    trimText(log.memo).length > 0 ||
    trimText(log.tomorrowPractice).length > 0 ||
    typeof log.tomorrowPracticeDone === "boolean"
  );
}

function ReadonlySliderField(props: {
  label: string;
  fillWidth: string;
  valueLabel: string;
  className?: string;
}) {
  return (
    <div className={"field record-day-field" + (props.className ? ` ${props.className}` : "")}>
      <label className="field-label">{props.label}</label>
      <div className="record-slider-row" aria-label={`${props.label} ${props.valueLabel}`}>
        <div className="record-slider-pill" aria-hidden="true">
          <div className="record-slider-pill__fill" style={{ width: props.fillWidth }} />
        </div>
        <span className="record-slider-value">{props.valueLabel}</span>
      </div>
    </div>
  );
}

function ReadonlyTextField(props: {
  label: string;
  value: string | null | undefined;
  className?: string;
  emptyText?: string;
}) {
  const text = trimText(props.value);
  const empty = text.length === 0;
  return (
    <div className={"field record-day-field" + (props.className ? ` ${props.className}` : "")}>
      <label className="field-label">{props.label}</label>
      <div className={"record-readonly-value" + (empty ? " record-readonly-value--empty" : "") }>
        {empty ? props.emptyText || "미입력" : text}
      </div>
    </div>
  );
}

function RecordSubgroupHeading(props: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <h3 className="record-life-group-title record-life-group-title--with-icon">
      <span className="record-life-group-title__glyph" aria-hidden>
        {props.icon}
      </span>
      <span>{props.children}</span>
    </h3>
  );
}

function PlanList(props: { plans: ParentWeekPlan[]; emptyText?: string }) {
  if (!props.plans.length) {
    return <div className="record-readonly-empty">{props.emptyText || "저장된 계획이 없습니다."}</div>;
  }

  return (
    <>
      {props.plans.map(plan => {
        const range = trimText(plan.planned_range);
        const start = trimText(plan.start_time);
        const end = trimText(plan.end_time);
        const timePart = start || end ? `${start || "—"} ~ ${end || "—"}` : "";
        return (
          <div key={plan.id} className="progress-day-book">
            <div className="progress-day-book-name">{trimText(plan.book_name) || "과목 미기록"}</div>
            <div className="progress-day-book-plan">
              내일 계획: {range || "미설정"}
              {timePart ? ` · ${timePart}` : ""}
            </div>
          </div>
        );
      })}
    </>
  );
}

function TimelineListView(props: {
  blocks: ParentWeekBlock[];
  commitmentText?: string;
  commitmentDone?: boolean | null;
  emptyText?: string;
}) {
  const commitmentText = trimText(props.commitmentText);
  const hasCommitment = commitmentText.length > 0;
  const blocks = sortBlocks(props.blocks);

  if (!hasCommitment && blocks.length === 0) {
    return <div className="record-readonly-empty">{props.emptyText || "등록된 계획이 없습니다."}</div>;
  }

  return (
    <div className="timeline-list">
      {hasCommitment ? (
        <div
          className={
            "timeline-item timeline-item--commitment" +
            (props.commitmentDone === true ? " timeline-item-done" : "")
          }
        >
          <div className="time-col">
            <span className="time-main">오늘의 핵심</span>
            <span className="timeline-book-name">{commitmentText}</span>
            <span className="timeline-plan-range">
              {props.commitmentDone === true
                ? "실천했어요"
                : props.commitmentDone === false
                  ? "미실천"
                  : "기록 없음"}
            </span>
          </div>
          <div className="check-col" aria-hidden="true">
            <span className="check-circle">
              {props.commitmentDone === true ? <span className="check-dot" /> : null}
            </span>
          </div>
        </div>
      ) : null}
      {blocks.map((block, index) => (
        <div
          key={`${block.study_day_id}-${block.start_time}-${block.end_time}-${block.subject}-${index}`}
          className={"timeline-item" + (block.done ? " timeline-item-done" : "")}
        >
          <div className="time-col">
            <span className="time-main">
              {block.start_time} - {block.end_time}
            </span>
            <span className="timeline-book-name">{trimText(block.subject) || "과목 미기록"}</span>
            <span className="timeline-plan-range">
              {trimText(block.planned_range)
                ? trimText(block.planned_range)
                : block.focus_score
                  ? `집중도 ${block.focus_score}`
                  : block.done
                    ? "완료"
                    : "미완료"}
            </span>
          </div>
          <div className="check-col" aria-hidden="true">
            <span className="check-circle">{block.done ? <span className="check-dot" /> : null}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function formatStudyRoomVisitDateTime(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatStudyRoomVisitDateLabel(value: string | null) {
  if (!value) return "날짜 미확인";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "날짜 미확인";
  const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
  return `${date.getMonth() + 1}.${date.getDate()} ${weekdays[date.getDay()]}요일`;
}

function formatStudyRoomVisitTimeRange(visit: StudyRoomVisitSession) {
  const formatTime = (raw: string | null) => {
    if (!raw) return null;
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleTimeString("ko-KR", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    });
  };

  const start = formatTime(visit.enteredAt) || "--:--";
  const end = visit.exitedAt ? formatTime(visit.exitedAt) || "--:--" : "현재 체크인";
  return `${start} ~ ${end}`;
}

function deriveGuide(report: ParentWeeklyReport | null, aiDaily: ParentAiDaily | null): ParentGuide {
  const totalStudyMinutes = report?.stats?.totalStudyMinutes || 0;
  const consecutiveAbsentDays = report?.stats?.consecutiveAbsentDays || 0;
  const focus = report?.stats?.focusDistribution;
  const badFocus = focus?.bad || 0;
  const stableFocus = (focus?.best || 0) + (focus?.good || 0);

  let urgency: Severity = "낮음";
  if (consecutiveAbsentDays >= 2 || badFocus >= 4) {
    urgency = "높음";
  } else if (consecutiveAbsentDays === 1 || totalStudyMinutes < 600 || badFocus >= 2) {
    urgency = "보통";
  }

  const intervention: ParentGuide["intervention"] =
    urgency === "높음"
      ? consecutiveAbsentDays >= 2
        ? "상담 권장"
        : "루틴 도움"
      : urgency === "보통"
        ? totalStudyMinutes < 600
          ? "질문 1개"
          : "루틴 도움"
        : stableFocus > 0
          ? "칭찬"
          : "관찰";

  const guidanceLines: string[] = [];
  const aiHeadline = String(aiDaily?.summary_text || "")
    .split(/\n+/)
    .map(line => line.trim())
    .find(Boolean);
  if (aiHeadline) guidanceLines.push(aiHeadline);
  if (consecutiveAbsentDays >= 2) {
    guidanceLines.push("최근 기록 공백이 길어져서 공부량보다 먼저 시작 여부와 루틴 이탈 원인을 확인하는 편이 좋습니다.");
  }
  if (totalStudyMinutes > 0 && totalStudyMinutes < 600) {
    guidanceLines.push("이번 주 총 학습 시간이 짧습니다. 목표를 늘리기보다 첫 시작 문턱을 낮추는 쪽이 효과적입니다.");
  }
  if (badFocus >= stableFocus && badFocus > 0) {
    guidanceLines.push("집중 흔들림이 큰 주입니다. 긴 피드백보다 20~30분 단위의 짧은 루틴 점검이 더 잘 먹힙니다.");
  }
  if (!guidanceLines.length && report?.summaryLines?.length) {
    guidanceLines.push(...report.summaryLines.slice(0, 3));
  }
  if (!guidanceLines.length) {
    guidanceLines.push("연결된 학생 데이터를 불러오면 이번 주 흐름을 기반으로 학부모 가이드를 보여드립니다.");
  }

  const headline =
    urgency === "높음"
      ? "지적보다 회복과 루틴 재정렬이 먼저인 구간입니다"
      : urgency === "보통"
        ? "조언을 줄이되, 시작을 돕는 질문이 필요한 주입니다"
        : "지금은 흐름을 유지하도록 구체적으로 칭찬하기 좋은 상태입니다";

  const suggestedPhrases =
    intervention === "칭찬"
      ? [
          "이번 주는 흐름을 잘 지켰어. 특히 이어서 한 점이 좋았어.",
          "결과보다 꾸준히 기록 남긴 게 정말 크다. 그 리듬 유지해보자."
        ]
      : intervention === "질문 1개"
        ? [
            "이번 주에 제일 막혔던 한 순간만 꼽으면 언제였어?",
            "내일 시작을 더 쉽게 하려면 한 가지만 바꾼다면 뭐가 좋을까?"
          ]
        : intervention === "루틴 도움"
          ? [
              "오늘은 조언보다 시작 준비를 같이 도와줄게. 첫 20분만 해보자.",
              "해야 할 걸 늘리기보다, 지금은 시작 시간을 고정하는 데 집중해보자."
            ]
          : intervention === "상담 권장"
            ? [
                "최근 흐름이 많이 무거워 보여. 혼자 버티기보다 같이 도움 받을 방법을 찾자.",
                "통제하려는 게 아니라 회복을 돕고 싶어. 지금 제일 부담인 지점을 말해줄래?"
              ]
            : [
                "지금은 내가 많이 말하지 않아도 괜찮아 보여. 필요한 순간만 바로 도와줄게.",
                "이번 주는 유지가 핵심이야. 하던 흐름만 계속 가져가 보자."
              ];

  return {
    urgency,
    intervention,
    headline,
    guidanceLines: guidanceLines.slice(0, 3),
    suggestedPhrases
  };
}

function AiReportTab(props: {
  apiBase: string;
  authToken: string | null;
  parentStudents: ParentStudentRow[];
  parentStudentId: number | null;
  setParentStudentId: (id: number | null) => void;
  parentReport: ParentWeeklyReport | null;
  parentAiDaily: ParentAiDaily | null;
}) {
  const selectedStudent =
    props.parentStudents.find(student => student.id === props.parentStudentId) ||
    props.parentStudents[0] ||
    null;
  const chartData = useMemo(() => buildDailyChart(props.parentReport), [props.parentReport]);
  const guide = useMemo(
    () => deriveGuide(props.parentReport, props.parentAiDaily),
    [props.parentAiDaily, props.parentReport]
  );
  const recentWeekStart = getDateKeySeoul(-6);
  const parentCoachCacheScope = readStoredUserCacheScope();
  const parentCoachStateCacheKey = buildParentCoachStateCacheKey(
    parentCoachCacheScope,
    props.parentStudentId,
    recentWeekStart
  );
  const parentCoachPatternsCacheKey = buildParentCoachPatternsCacheKey(
    parentCoachCacheScope,
    props.parentStudentId,
    recentWeekStart
  );
  const [analysisState, setAnalysisState] = useState<ParentCoachAnalysisState | null>(() =>
    normalizeCachedParentCoachAnalysisState(
      readLocalCache<unknown>(
        buildParentCoachStateCacheKey(
          readStoredUserCacheScope(),
          props.parentStudentId,
          getDateKeySeoul(-6)
        ),
        PARENT_COACH_CACHE_TTL_MS
      )?.value
    )
  );
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [aiPatterns, setAiPatterns] = useState<ParentAiPatternRow[]>(() =>
    normalizeCachedParentPatterns(
      readLocalCache<unknown>(
        buildParentCoachPatternsCacheKey(
          readStoredUserCacheScope(),
          props.parentStudentId,
          getDateKeySeoul(-6)
        ),
        PARENT_COACH_CACHE_TTL_MS
      )?.value
    )
  );
  const [patternsLoading, setPatternsLoading] = useState(false);
  const [patternsError, setPatternsError] = useState<string | null>(null);
  const [patternsUsedOpenAi, setPatternsUsedOpenAi] = useState(false);
  const analysisHasDataRef = useRef(Boolean(analysisState));
  const patternsHasDataRef = useRef(aiPatterns.length > 0);
  const totalStudyMinutes = props.parentReport?.stats?.totalStudyMinutes || 0;
  const focusDistribution = props.parentReport?.stats?.focusDistribution;
  const stableFocus = (focusDistribution?.best || 0) + (focusDistribution?.good || 0);
  const consecutiveAbsentDays = props.parentReport?.stats?.consecutiveAbsentDays || 0;

  useEffect(() => {
    analysisHasDataRef.current = Boolean(analysisState);
  }, [analysisState]);

  useEffect(() => {
    patternsHasDataRef.current = aiPatterns.length > 0;
  }, [aiPatterns]);

  useEffect(() => {
    if (!props.authToken || !props.parentStudentId) return;
    const cachedAnalysis = normalizeCachedParentCoachAnalysisState(
      readLocalCache<unknown>(parentCoachStateCacheKey, PARENT_COACH_CACHE_TTL_MS)?.value
    );
    if (cachedAnalysis) {
      setAnalysisState(cachedAnalysis);
    }
    const cachedPatterns = normalizeCachedParentPatterns(
      readLocalCache<unknown>(parentCoachPatternsCacheKey, PARENT_COACH_CACHE_TTL_MS)?.value
    );
    if (cachedPatterns.length > 0) {
      setAiPatterns(cachedPatterns);
    }
  }, [
    parentCoachPatternsCacheKey,
    parentCoachStateCacheKey,
    props.authToken,
    props.parentStudentId
  ]);

  useEffect(() => {
    if (!props.authToken || !props.parentStudentId) {
      setAnalysisState(null);
      setAnalysisLoading(false);
      setAnalysisError(null);
      return;
    }
    let cancelled = false;
    const ac = new AbortController();
    setAnalysisLoading(!analysisHasDataRef.current);
    setAnalysisError(null);
    const weekStart = encodeURIComponent(recentWeekStart);
    void fetch(
      `${props.apiBase}/api/parent/coach/state?studentId=${encodeURIComponent(String(props.parentStudentId))}&weekStart=${weekStart}`,
      {
        signal: ac.signal,
        cache: "no-store",
        headers: { Authorization: `Bearer ${props.authToken}` }
      }
    )
      .then(async response => {
        const data = (await response.json().catch(() => ({}))) as ParentCoachAnalysisState & {
          error?: string;
          logs?: unknown[];
        };
        if (!response.ok) {
          throw new Error(String(data.error || "학생 AI 분석을 불러오지 못했습니다."));
        }
        if (cancelled) return;
        const nextState = {
          ...data,
          logs: Array.isArray(data.logs)
            ? data.logs
                .map(normalizeParentCoachAnalysisLog)
                .filter((row): row is ParentCoachAnalysisLog => row != null)
            : []
        };
        setAnalysisState(nextState);
        writeLocalCache(parentCoachStateCacheKey, nextState);
      })
      .catch((error: unknown) => {
        if (cancelled || (error instanceof DOMException && error.name === "AbortError")) return;
        setAnalysisError(
          error instanceof Error && error.message
            ? error.message
            : "학생 AI 분석을 불러오지 못했습니다."
        );
      })
      .finally(() => {
        if (!cancelled) setAnalysisLoading(false);
      });

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [parentCoachStateCacheKey, props.apiBase, props.authToken, props.parentStudentId, recentWeekStart]);

  useEffect(() => {
    if (!props.authToken || !props.parentStudentId) {
      setAiPatterns([]);
      setPatternsLoading(false);
      setPatternsError(null);
      setPatternsUsedOpenAi(false);
      return;
    }
    let cancelled = false;
    const ac = new AbortController();
    setPatternsLoading(!patternsHasDataRef.current);
    setPatternsError(null);
    const weekStart = encodeURIComponent(recentWeekStart);
    void fetch(
      `${props.apiBase}/api/parent/coach/pattern-insights?studentId=${encodeURIComponent(String(props.parentStudentId))}&weekStart=${weekStart}`,
      {
        signal: ac.signal,
        cache: "no-store",
        headers: { Authorization: `Bearer ${props.authToken}` }
      }
    )
      .then(async response => {
        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
          usedOpenAi?: boolean;
          patterns?: ParentAiPatternRow[];
        };
        if (!response.ok) {
          throw new Error(String(data.error || "학생 AI 패턴을 불러오지 못했습니다."));
        }
        if (cancelled) return;
        setPatternsUsedOpenAi(Boolean(data.usedOpenAi));
        const nextPatterns = Array.isArray(data.patterns) ? data.patterns : [];
        setAiPatterns(nextPatterns);
        writeLocalCache(parentCoachPatternsCacheKey, nextPatterns);
      })
      .catch((error: unknown) => {
        if (cancelled || (error instanceof DOMException && error.name === "AbortError")) return;
        setPatternsUsedOpenAi(false);
        setPatternsError(
          error instanceof Error && error.message
            ? error.message
            : "학생 AI 패턴을 불러오지 못했습니다."
        );
      })
      .finally(() => {
        if (!cancelled) setPatternsLoading(false);
      });

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [
    parentCoachPatternsCacheKey,
    props.apiBase,
    props.authToken,
    props.parentStudentId,
    recentWeekStart
  ]);

  const rhythmChartData = useMemo(
    () => buildRhythmChartRowsFromLogs(analysisState?.logs),
    [analysisState?.logs]
  );
  const studyMinutesMax = useMemo(() => {
    const values = rhythmChartData
      .map(row => row.studyMinutes)
      .filter((value): value is number => value != null && Number.isFinite(value));
    return Math.max(240, values.length ? Math.max(...values) : 0);
  }, [rhythmChartData]);
  const weeklyCharts = useMemo(
    () =>
      [
        {
          key: "sleep",
          title: "수면 패턴",
          dataKey: "sleepHours" as const,
          yDomain: [0, 10] as [number, number],
          valueFormatter: (value: number) => `${value.toFixed(1)}시간`
        },
        {
          key: "stress",
          title: "스트레스 점수",
          dataKey: "stressScore" as const,
          yDomain: [1, 5] as [number, number],
          valueFormatter: (value: number) => `${value.toFixed(1)}/5`
        },
        {
          key: "concentration",
          title: "학습 집중도",
          dataKey: "concentration" as const,
          yDomain: [0, 100] as [number, number],
          valueFormatter: (value: number) => `${Math.round(value)}%`
        },
        {
          key: "studyMinutes",
          title: "공부 시간",
          dataKey: "studyMinutes" as const,
          yDomain: [0, studyMinutesMax] as [number, number],
          valueFormatter: (value: number) => `${Math.round(value)}분`
        },
        {
          key: "planCompletionRate",
          title: "목표 달성률",
          dataKey: "planCompletionRate" as const,
          yDomain: [0, 100] as [number, number],
          valueFormatter: (value: number) => `${Math.round(value)}%`
        }
      ] as const,
    [studyMinutesMax]
  );
  const heroNarrative =
    analysisState?.snapshot?.heroNarrative ||
    `${formatStudentLabel(selectedStudent)} 학생의 최근 학습 흐름을 바탕으로 요약을 준비 중입니다.`;
  const coachRiskLevel = riskLevelFromSnapshotMetrics(analysisState?.snapshot?.metrics);
  const nextActions = Array.isArray(analysisState?.snapshot?.nextActions)
    ? analysisState?.snapshot?.nextActions.filter(action => trimText(action).length > 0).slice(0, 3)
    : [];

  const metrics = [
    { title: "개입 필요도", value: guide.urgency, hint: guide.intervention },
    { title: "이번 주 총 학습", value: totalStudyMinutes > 0 ? formatMinutes(totalStudyMinutes) : "—" }
  ];

  return (
    <div className="coach-page coach-page--manage">
      <ParentStudentSelector
        parentStudents={props.parentStudents}
        parentStudentId={props.parentStudentId}
        setParentStudentId={props.setParentStudentId}
      />

      <Card className="coach-card coach-card--padded coach-home-insight-card">
        <div className="coach-home-insight-card__top">
          <span className="coach-home-insight-card__eyebrow coach-home-insight-card__eyebrow--icon">
            <Sparkles className="coach-analysis-icon coach-analysis-icon--eyebrow" aria-hidden />
            <span>학생 AI 분석</span>
          </span>
          <RiskBadge level={coachRiskLevel} />
        </div>
        <div className="coach-home-insight-card__title">
          {formatStudentLabel(selectedStudent)} 학생 한 줄 요약
        </div>
        <p className="coach-home-insight-card__body">{heroNarrative}</p>
        <button
          type="button"
          className="coach-primary-btn coach-home-insight-card__cta"
          onClick={() => {
            setAppPath("#/parent/records");
          }}
        >
          학생 기록 보기
        </button>
      </Card>

      <div className="coach-grid">
        {metrics.map(m => (
          <MetricCard
            key={m.title}
            title={m.title}
            value={m.value}
            hint={m.hint}
            icon={
              m.title === "개입 필요도" ? (
                <ShieldAlert className="coach-analysis-icon" aria-hidden />
              ) : (
                <ClipboardList className="coach-analysis-icon" aria-hidden />
              )
            }
          />
        ))}
      </div>

      <Card className="coach-card coach-card--padded" style={{ marginTop: 12 }}>
        <SectionHeader title="최근 7일 리듬" />
        <div
          className="coach-rhythm-scroll"
          style={{
            display: "flex",
            overflowX: "auto",
            gap: 12,
            paddingBottom: 6,
            marginTop: 8
          }}
          aria-label="최근 7일 리듬 상세 그래프"
        >
          {weeklyCharts.map(chart => (
            <div
              key={chart.key}
              className="coach-rhythm-scroll__item"
              style={{ flex: "0 0 auto", minWidth: 300 }}
            >
              <div
                className="coach-rhythm-scroll__title"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: "var(--font-size-medium)",
                  fontWeight: "var(--font-weight-semibold)",
                  marginBottom: 6
                }}
              >
                {chart.dataKey === "concentration" ? (
                  <Brain className="coach-analysis-icon coach-analysis-icon--summary" aria-hidden />
                ) : chart.dataKey === "studyMinutes" ? (
                  <ClipboardList className="coach-analysis-icon coach-analysis-icon--summary" aria-hidden />
                ) : (
                  <TrendingUp className="coach-analysis-icon coach-analysis-icon--summary" aria-hidden />
                )}
                <span>{chart.title}</span>
              </div>
              <div className="coach-chart" style={{ color: "var(--text-strong)", marginTop: 0 }}>
                <CoachRhythmSparkline
                  rows={rhythmChartData}
                  dataKey={chart.dataKey}
                  yDomain={chart.yDomain}
                  valueFormatter={chart.valueFormatter}
                />
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div className="coach-stack">
        <SectionHeader
          title="감지된 기록 패턴"
          right={<Sparkles className="coach-analysis-icon coach-analysis-icon--summary" aria-hidden />}
        />
        {patternsLoading ? (
          <p className="coach-muted" style={{ padding: "10px 4px 0", fontSize: "var(--font-size-medium)" }}>
            {aiPatterns.length > 0 ? "최신 기록을 반영하는 중…" : "패턴을 분석하는 중…"}
          </p>
        ) : patternsError ? (
          <p className="coach-muted" style={{ padding: "10px 4px 0", fontSize: "var(--font-size-medium)" }}>
            {patternsError}
          </p>
        ) : aiPatterns.length > 0 ? (
          <div className="coach-pattern-grid">
            {aiPatterns.map(pattern => (
              <PatternCard
                key={pattern.key}
                title={pattern.title}
                severity={pattern.severity}
                explanation={pattern.explanation}
                recommendation={pattern.recommendation}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            title="표시할 패턴이 없어요"
            body={
              patternsUsedOpenAi
                ? "기록이 더 쌓이면 패턴이 표시됩니다."
                : "AI 패턴 분석을 사용할 수 없습니다."
            }
          />
        )}
      </div>

      <Card className="coach-card coach-card--padded" style={{ marginTop: 12 }}>
        <SectionHeader
          title="AI 학부모 가이드"
          right={<Lightbulb className="coach-analysis-icon coach-analysis-icon--summary" aria-hidden />}
        />
        <div className="coach-guide-lines">
          {guide.guidanceLines.slice(0, 3).map((l, i) => (
            <div key={i} className="coach-guide-line">
              <span className="coach-guide-dot" aria-hidden />
              <span className="coach-muted">{l}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card className="coach-card coach-card--padded" style={{ marginTop: 12 }}>
        <SectionHeader title="바로 쓸 수 있는 문장" />
        <div className="coach-phrases">
          {guide.suggestedPhrases.map((phrase, index) => (
            <button
              key={index}
              type="button"
              className="coach-phrase"
              onClick={() => {
                try {
                  navigator.clipboard.writeText(phrase);
                  alert("문장을 복사했어요.");
                } catch {
                  alert(phrase);
                }
              }}
            >
              {phrase}
              <span className="coach-phrase__hint">탭해서 복사</span>
            </button>
          ))}
        </div>
      </Card>
    </div>
  );
}

function RecordsTab(props: {
  apiBase: string;
  authToken: string | null;
  parentStudents: ParentStudentRow[];
  selectedStudent: ParentStudentRow | null;
  parentStudentId: number | null;
  setParentStudentId: (id: number | null) => void;
  parentReport: ParentWeeklyReport | null;
}) {
  const days = Array.isArray(props.parentReport?.days) ? props.parentReport.days : [];
  const blocks = Array.isArray(props.parentReport?.blocks) ? props.parentReport.blocks : [];
  const plans = Array.isArray(props.parentReport?.plans) ? props.parentReport.plans : [];
  const logs = Array.isArray(props.parentReport?.logs) ? props.parentReport.logs : [];
  const [aiReportRefreshing, setAiReportRefreshing] = useState(false);
  const [aiReportMessage, setAiReportMessage] = useState("");
  const {
    studyRoomVisits,
    studyRoomVisitsLoading,
    studyRoomLiveStatus,
    hasStudyRoomConfig,
    displayDistanceMeters,
    studyRoomVisitsByDate
  } = useParentStudyRoomLive({
    apiBase: props.apiBase,
    authToken: props.authToken,
    studentId: props.selectedStudent?.id ?? null,
    hasStudyRoomSettingHint: Boolean(props.selectedStudent?.studyRoom)
  });

  useEffect(() => {
    setAiReportMessage("");
  }, [props.selectedStudent?.id]);

  const daysByDate = useMemo(
    () =>
      new Map(
        days.map(day => [seoulDateKeyFromApiValue(day.date), day] as const)
      ),
    [days]
  );
  const blocksByDayId = useMemo(() => {
    const next = new Map<number, ParentWeekBlock[]>();
    for (const block of blocks) {
      const sid = Number(block.study_day_id);
      if (!Number.isFinite(sid)) continue;
      const list = next.get(sid) || [];
      list.push(block);
      next.set(sid, list);
    }
    return next;
  }, [blocks]);
  const plansByDayId = useMemo(() => {
    const next = new Map<number, ParentWeekPlan[]>();
    for (const plan of plans) {
      const sid = Number(plan.study_day_id);
      if (!Number.isFinite(sid)) continue;
      const list = next.get(sid) || [];
      list.push(plan);
      next.set(sid, list);
    }
    return next;
  }, [plans]);
  const logsByDate = useMemo(() => {
    const next = new Map<string, ParentCoachLog>();
    for (const log of logs) {
      const key = seoulDateKeyFromApiValue(log.date);
      if (key && !next.has(key)) next.set(key, log);
    }
    return next;
  }, [logs]);

  const todayKey = getDateKeySeoul(0);
  const tomorrowKey = getDateKeySeoul(1);
  const todayDay = daysByDate.get(todayKey) || null;
  const tomorrowDay = daysByDate.get(tomorrowKey) || null;
  const todayDayId = todayDay != null ? Number(todayDay.id) : NaN;
  const todayBlocks =
    todayDay && Number.isFinite(todayDayId)
      ? sortBlocks(blocksByDayId.get(todayDayId) || [])
      : [];
  const todayLog = logsByDate.get(todayKey) || null;
  const yesterdayLog = logsByDate.get(shiftDateKey(todayKey, -1)) || null;
  const todayCommitment = trimText(yesterdayLog?.tomorrowPractice);
  const todayCommitmentDone = todayLog?.tomorrowPracticeDone ?? null;
  const totalTargets = todayBlocks.length + (todayCommitment ? 1 : 0);
  const achievedTargets =
    todayBlocks.filter(block => block.done).length +
    (todayCommitment && todayCommitmentDone === true ? 1 : 0);
  const goalRate = totalTargets > 0 ? Math.round((achievedTargets / totalTargets) * 100) : null;
  const focusSubject = deriveFocusSubject(todayBlocks);
  const todayStudyMinutes =
    todayLog?.studyMinutes != null
      ? Number(todayLog.studyMinutes)
      : todayBlocks.reduce(
          (sum, block) => sum + minutesBetween(block.start_time, block.end_time),
          0
        );

  const renderStudyCard = (dayKey: string) => {
    const day = daysByDate.get(dayKey) || null;
    const dayLog = logsByDate.get(dayKey) || null;
    const dayIdNum = day != null ? Number(day.id) : NaN;
    const dayBlocks =
      day && Number.isFinite(dayIdNum)
        ? sortBlocks(blocksByDayId.get(dayIdNum) || [])
        : [];
    const tomorrowDayId = tomorrowDay != null ? Number(tomorrowDay.id) : NaN;
    const tomorrowPlans =
      tomorrowDay && Number.isFinite(tomorrowDayId)
        ? plansByDayId.get(tomorrowDayId) || []
        : [];
    const dayPlans =
      day && Number.isFinite(dayIdNum) ? plansByDayId.get(dayIdNum) || [] : [];
    const isToday = dayKey === todayKey;
    const isTomorrow = dayKey === tomorrowKey;
    const hasAnyContent = hasStudyLogContent(dayLog) || dayBlocks.length > 0 || dayPlans.length > 0;

    if (!isToday && !isTomorrow && !hasAnyContent) {
      return <div className="record-readonly-empty">저장된 학습 기록이 없습니다.</div>;
    }

    return (
      <>
        {hasStudyLogContent(dayLog) ? (
          <div className="record-life-group">
            <RecordSubgroupHeading icon={<BookOpen />}>오늘 기록</RecordSubgroupHeading>
            <div className="record-study-reflection-card">
              <ReadonlySliderField
                label="오늘 학습 시간"
                fillWidth={recordStudyHoursSliderFillPctFromMinutes(dayLog?.studyMinutes)}
                valueLabel={formatStudyHoursLabel(dayLog?.studyMinutes)}
              />
              <ReadonlyTextField
                label="오늘 공부 좋았던 점과 나빴던 점"
                value={dayLog?.studyEvaluation}
                className="record-day-memo"
              />
              <ReadonlyTextField
                label="오늘의 공부 메모"
                value={dayLog?.metacognitionReflection}
                className="record-day-memo"
              />
            </div>
          </div>
        ) : null}
        {dayBlocks.length > 0 ? (
          <div className="record-life-group">
            <RecordSubgroupHeading icon={<ListChecks />}>공부 계획</RecordSubgroupHeading>
            <TimelineListView blocks={dayBlocks} emptyText="등록된 계획이 없습니다." />
          </div>
        ) : null}
        {isToday ? (
          <div className="record-life-group">
            <RecordSubgroupHeading icon={<CalendarRange />}>내일 계획</RecordSubgroupHeading>
            <PlanList plans={tomorrowPlans} emptyText="내일 계획이 아직 없습니다." />
          </div>
        ) : null}
        {isTomorrow ? (
          <div className="record-life-group">
            <RecordSubgroupHeading icon={<CalendarRange />}>내일 계획</RecordSubgroupHeading>
            <PlanList plans={dayPlans} emptyText="내일 계획이 아직 없습니다." />
          </div>
        ) : null}
        {!isToday && !isTomorrow && dayPlans.length > 0 ? (
          <div className="record-life-group">
            <RecordSubgroupHeading icon={<CalendarRange />}>저장된 계획</RecordSubgroupHeading>
            <PlanList plans={dayPlans} emptyText="저장된 계획이 없습니다." />
          </div>
        ) : null}
      </>
    );
  };

  const renderLifeCard = (dayKey: string) => {
    const dayLog = logsByDate.get(dayKey) || null;
    const prevLog = logsByDate.get(shiftDateKey(dayKey, -1)) || null;
    const commitmentText = trimText(prevLog?.tomorrowPractice);
    const commitmentDone = dayLog?.tomorrowPracticeDone ?? null;
    const hasAnyContent = hasLifeLogContent(dayLog) || commitmentText.length > 0;

    if (!hasAnyContent) {
      return <div className="record-readonly-empty">저장된 생활 기록이 없습니다.</div>;
    }

    return (
      <>
        {dayLog ? (
          <div className="record-life-group">
            <RecordSubgroupHeading icon={<NotebookPen />}>오늘 기록</RecordSubgroupHeading>
            <div className="record-day-block">
              <ReadonlySliderField
                label="수면시간"
                fillWidth={recordSleepSliderFillPct(dayLog.sleepHours)}
                valueLabel={formatNumericHours(dayLog.sleepHours)}
              />
              <ReadonlySliderField
                label="스트레스"
                fillWidth={recordLifeSliderFillPct(dayLog.stressScore)}
                valueLabel={dayLog.stressScore != null ? String(dayLog.stressScore) : "—"}
              />
              <ReadonlySliderField
                label="집중도"
                fillWidth={recordLifeSliderFillPct(dayLog.concentrationScore)}
                valueLabel={dayLog.concentrationScore != null ? String(dayLog.concentrationScore) : "—"}
              />
              <ReadonlyTextField
                label="오늘 생활 좋았던 점과 나빴던 점"
                value={dayLog.memo}
                className="record-day-memo"
              />
            </div>
          </div>
        ) : null}
        {trimText(dayLog?.tomorrowPractice) ? (
          <div className="record-life-group">
            <RecordSubgroupHeading icon={<CalendarRange />}>내일 계획</RecordSubgroupHeading>
            <div className="record-day-block">
              <ReadonlyTextField
                label="내일 실천할 한 가지"
                value={dayLog?.tomorrowPractice}
                className="record-day-memo"
              />
            </div>
          </div>
        ) : null}
        {commitmentText ? (
          <div className="record-life-group">
            <RecordSubgroupHeading icon={<CheckCircle2 />}>이행여부</RecordSubgroupHeading>
            <div className="record-day-block">
              <ReadonlyTextField
                label="어제 정한 실천"
                value={commitmentText}
                className="record-day-memo"
              />
              <ReadonlyTextField
                label="오늘 이행 상태"
                value={
                  commitmentDone === true
                    ? "실천했어요"
                    : commitmentDone === false
                      ? "미실천"
                      : "기록 없음"
                }
              />
            </div>
          </div>
        ) : null}
      </>
    );
  };

  const renderTimelineOverviewCard = (dayKey: string) => {
    const day = daysByDate.get(dayKey) || null;
    const dayIdNum = day != null ? Number(day.id) : NaN;
    const dayBlocks =
      day && Number.isFinite(dayIdNum)
        ? sortBlocks(blocksByDayId.get(dayIdNum) || [])
        : [];
    const prevLog = logsByDate.get(shiftDateKey(dayKey, -1)) || null;
    const commitmentText = trimText(prevLog?.tomorrowPractice);
    const commitmentDone = logsByDate.get(dayKey)?.tomorrowPracticeDone ?? null;

    return (
      <TimelineListView
        blocks={dayBlocks}
        commitmentText={commitmentText}
        commitmentDone={commitmentDone}
        emptyText="등록된 계획이 없습니다."
      />
    );
  };

  const renderStudyRoomVisitOverviewCard = (dayKey: string) => {
    const dayVisits = studyRoomVisitsByDate.get(dayKey) || [];
    if (!hasStudyRoomConfig) {
      return <div className="record-readonly-empty">등록된 독서실이 없습니다.</div>;
    }
    if (studyRoomVisitsLoading && studyRoomVisits.length === 0) {
      return <div className="record-readonly-empty">불러오는 중...</div>;
    }
    if (dayVisits.length === 0) {
      return <div className="record-readonly-empty">해당 날짜 체크인 기록이 없습니다.</div>;
    }
    return (
      <div className="parent-study-room-item__visit-list">
        {dayVisits.map(visit => (
          <div key={visit.id} className="parent-study-room-item__visit-item">
            <div className="parent-study-room-item__visit-row">
              <span className="parent-study-room-item__visit-name">{visit.studyRoomName}</span>
              <span className="parent-study-room-item__visit-pill">
                {visit.exitedAt ? "체크아웃" : "체크인"}
              </span>
            </div>
            <div className="parent-study-room-item__visit-meta">{formatStudyRoomVisitTimeRange(visit)}</div>
            <div className="parent-study-room-item__visit-meta">
              {visit.lastDistanceMeters != null ? `마지막 거리 ${Math.round(visit.lastDistanceMeters)}m` : "-"}
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="coach-page">
      <ParentStudentSelector
        parentStudents={props.parentStudents}
        parentStudentId={props.parentStudentId}
        setParentStudentId={props.setParentStudentId}
      />
      {!props.selectedStudent ? (
        <EmptyState title="학생을 선택하세요" />
      ) : (
        <>
          <div className="coach-records-page-grid">
            <Card className="coach-card coach-card--padded coach-records-overview-card">
              <SectionHeader
                title="공부 계획"
                icon={<ListChecks aria-hidden />}
                right={(
                  <button
                    type="button"
                    className={
                      "parent-settings-header-toggle" +
                      (aiReportRefreshing ? " parent-settings-header-toggle--loading" : "")
                    }
                    disabled={aiReportRefreshing}
                    onClick={() => {
                      if (!props.authToken || !props.selectedStudent?.id) return;
                      setAiReportRefreshing(true);
                      setAiReportMessage("");
                      void (async () => {
                        try {
                          const res = await fetch(`${props.apiBase}/api/parent/ai-daily-report/refresh`, {
                            method: "POST",
                            headers: {
                              "Content-Type": "application/json",
                              Authorization: `Bearer ${props.authToken}`
                            },
                            body: JSON.stringify({ studentId: props.selectedStudent?.id })
                          });
                          const data = (await res.json().catch(() => ({}))) as {
                            error?: string;
                            result?: { message?: string };
                          };
                          if (!res.ok) {
                            setAiReportMessage(data.error || "AI 리포트 생성에 실패했습니다.");
                            return;
                          }
                          setAiReportMessage(
                            data.result?.message || "리포트가 준비됐어요. 리포트 탭에서 확인하세요."
                          );
                        } catch (error) {
                          setAiReportMessage(
                            error instanceof Error && error.message
                              ? `AI 리포트 생성 중 오류가 발생했습니다. (${error.message})`
                              : "AI 리포트 생성 중 오류가 발생했습니다."
                          );
                        } finally {
                          setAiReportRefreshing(false);
                          setAppPath("#/parent/analysis");
                        }
                      })();
                    }}
                  >
                    <span>{aiReportRefreshing ? "생성 중..." : "AI 리포트 생성"}</span>
                  </button>
                )}
              />
              {aiReportMessage ? (
                <p className="settings-hint" style={{ margin: "8px 2px 0" }}>
                  {aiReportMessage}
                </p>
              ) : null}
              <div className="week-frame coach-records-week-frame">
                <div className="progress-cards-scroll">
                  <div className="progress-cards-container">
                    {getWeekDaysIncludingTomorrowSeoul(0).map(day => (
                      <div
                        key={`parent-overview-timeline-${day.key}`}
                        className={
                          "progress-day-card" + (day.key === todayKey ? " progress-day-card--today" : "")
                        }
                      >
                        <div className="progress-day-card-header">{day.label}</div>
                        <div className="progress-day-card-body">
                          {renderTimelineOverviewCard(day.key)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </Card>

            <Card className="coach-card coach-card--padded coach-records-overview-card">
              <SectionHeader
                title="독서실 체크인 기록"
                icon={<Library aria-hidden />}
              />
              <div style={{ marginTop: 12 }}>
                {hasStudyRoomConfig ? (
                  <div className="parent-study-room-item__visit-empty" style={{ marginBottom: 10 }}>
                    {displayDistanceMeters != null
                      ? `${studyRoomLiveStatus.currentDistanceMeters != null ? "현재 거리" : "최근 거리"} ${Math.round(displayDistanceMeters)}m${
                          typeof studyRoomLiveStatus.currentWithinRadius === "boolean"
                            ? ` · ${studyRoomLiveStatus.currentWithinRadius ? "체크인됨" : "체크아웃됨"}`
                            : ""
                        }`
                      : "아직 실시간 거리 정보가 없습니다."}
                    {studyRoomLiveStatus.currentHeartbeatAt
                      ? ` · 기준 ${formatStudyRoomVisitDateTime(studyRoomLiveStatus.currentHeartbeatAt)}`
                      : ""}
                    {studyRoomLiveStatus.currentLatitude != null &&
                    studyRoomLiveStatus.currentLongitude != null &&
                    Number.isFinite(Number(studyRoomLiveStatus.currentLatitude)) &&
                    Number.isFinite(Number(studyRoomLiveStatus.currentLongitude)) ? (
                      <div style={{ marginTop: 10, lineHeight: 1.45 }}>
                        마지막 보고 좌표(WGS84): 위도{" "}
                        {Number(studyRoomLiveStatus.currentLatitude).toFixed(6)}°, 경도{" "}
                        {Number(studyRoomLiveStatus.currentLongitude).toFixed(6)}° ·{" "}
                        <a
                          href={`https://www.google.com/maps?q=${encodeURIComponent(
                            `${studyRoomLiveStatus.currentLatitude},${studyRoomLiveStatus.currentLongitude}`
                          )}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          지도에서 보기
                        </a>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <div className="week-frame coach-records-week-frame">
                  <div className="progress-cards-scroll">
                    <div className="progress-cards-container">
                      {getWeekDaysIncludingTomorrowSeoul(0).map(day => (
                        <div
                          key={`parent-overview-checkin-${day.key}`}
                          className={
                            "progress-day-card" + (day.key === todayKey ? " progress-day-card--today" : "")
                          }
                        >
                          <div className="progress-day-card-header">{day.label}</div>
                          <div className="progress-day-card-body">
                            {renderStudyRoomVisitOverviewCard(day.key)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </Card>

            <section className="records-study-section coach-records-week-outer" aria-label="학습 기록">
              <Card className="coach-card coach-card--padded coach-records-overview-card">
                <SectionHeader title="학습 기록" icon={<ClipboardList aria-hidden />} />
                <div className="week-frame coach-records-week-frame">
                  <div className="progress-cards-scroll">
                    <div className="progress-cards-container">
                      {getWeekDaysIncludingTomorrowSeoul(0).map(day => (
                        <div
                          key={`parent-study-${day.key}`}
                          className={
                            "progress-day-card" +
                            (day.key === todayKey ? " progress-day-card--today" : "")
                          }
                        >
                          <div className="progress-day-card-header">{day.label}</div>
                          <div className="progress-day-card-body">{renderStudyCard(day.key)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </Card>
            </section>

            <section className="records-life-section coach-records-week-outer" aria-label="생활 기록">
              <Card className="coach-card coach-card--padded coach-records-overview-card">
                <SectionHeader title="생활 기록" icon={<NotebookPen aria-hidden />} />
                <div className="week-frame coach-records-week-frame">
                  <div className="progress-cards-scroll">
                    <div className="progress-cards-container">
                      {getWeekDaysIncludingTomorrowSeoul(0).map(day => (
                        <div
                          key={`parent-life-${day.key}`}
                          className={
                            "progress-day-card" +
                            (day.key === todayKey ? " progress-day-card--today" : "")
                          }
                        >
                          <div className="progress-day-card-header">{day.label}</div>
                          <div className="progress-day-card-body">{renderLifeCard(day.key)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </Card>
            </section>
          </div>
        </>
      )}
    </div>
  );
}

function StudentSettingsTab(props: {
  apiBase: string;
  authToken: string | null;
  parentStudents: ParentStudentRow[];
  setParentStudents: React.Dispatch<React.SetStateAction<ParentStudentRow[]>>;
  selectedStudent: ParentStudentRow | null;
  parentStudentId: number | null;
  setParentStudentId: (id: number | null) => void;
  parentPlannerEnabled: boolean;
  setParentPlannerEnabled: (value: boolean) => void;
  parentPlannerTime: string;
  setParentPlannerTime: (value: string) => void;
  parentPlannerSaving: boolean;
  setParentPlannerSaving: (value: boolean) => void;
  parentPlannerMessage: string;
  setParentPlannerMessage: (value: string) => void;
  parentLockStatus: ParentLockStatus | null;
  setParentLockStatus: React.Dispatch<React.SetStateAction<ParentLockStatus | null>>;
  hapticWarning: () => void;
  hapticSuccess: () => void;
}) {
  type AppAllowanceModeKey = "utility" | "free";

  const [studyRoomSaving, setStudyRoomSaving] = useState(false);
  const [studyRoomMessage, setStudyRoomMessage] = useState("");
  const [studyRoomModalOpen, setStudyRoomModalOpen] = useState(false);
  const [plannerTimeSheetOpen, setPlannerTimeSheetOpen] = useState(false);
  const [allowanceScheduleModalOpen, setAllowanceScheduleModalOpen] = useState(false);
  const [bulkDaechiRootLockSaving, setBulkDaechiRootLockSaving] = useState(false);
  const [bulkKioskSaving, setBulkKioskSaving] = useState(false);
  const [isBulkKioskEnabled, setIsBulkKioskEnabled] = useState(false);
  const [activeAppAllowanceMode, setActiveAppAllowanceMode] =
    useState<AppAllowanceModeKey | null>(null);
  const [mdmSurfaceMode, setMdmSurfaceMode] = useState<ParentMdmSurfaceMode | null>(null);
  /** 서버가 직접 내려주는 일괄잠금(override) — surface 문자열과 불일치할 때 배너 보정 */
  const [bulkLockOverrideFromApi, setBulkLockOverrideFromApi] = useState(false);
  /** 학생 전환·Strict Mode에서 옛 요청이 상태를 덮어쓰지 않도록 세대 번호 */
  const deviceUiLoadGenerationRef = useRef(0);
  /** 이전에 기기 UI를 불러온 학생 id — 콜백 참조 변경만으로는 상태를 비우지 않기 위함 */
  const deviceUiPrevStudentIdRef = useRef<number | null>(null);
  const [activatingAppMode, setActivatingAppMode] = useState<"utility" | "free" | "default" | null>(null);
  /** block 프로파일(일괄잠금) — 계획표 수동 잠금과 별개 */
  const isBulkDaechiRootLockActive =
    mdmSurfaceMode === "block" || bulkLockOverrideFromApi;

  /**
   * API가 `mdmSurfaceMode`는 default인데 `bulkLockOverride`만 true인 경우가 있어,
   * 라벨은 일괄잠금으로 통일한다.
   */
  const mdmDisplaySurfaceMode = (
    isBulkDaechiRootLockActive ? "block" : (mdmSurfaceMode ?? "default")
  ) as ParentMdmSurfaceMode;

  const allowanceScheduleBusy = bulkDaechiRootLockSaving || activatingAppMode != null;

  const [modeScheduleInitialSlots, setModeScheduleInitialSlots] = useState<ModeScheduleSlot[]>([]);
  const [modeScheduleGridKey, setModeScheduleGridKey] = useState(0);

  useEffect(() => {
    if (!allowanceScheduleModalOpen || !props.selectedStudent?.id || !props.authToken) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `${props.apiBase}/api/parent/students/${encodeURIComponent(String(props.selectedStudent!.id))}/app-mode-schedule`,
          { headers: { Authorization: `Bearer ${props.authToken}` } }
        );
        const data = (await res.json().catch(() => ({}))) as { slots?: unknown };
        if (cancelled) return;
        const slots = Array.isArray(data.slots) ? (data.slots as ModeScheduleSlot[]) : [];
        setModeScheduleInitialSlots(slots);
        setModeScheduleGridKey(k => k + 1);
      } catch {
        if (!cancelled) {
          setModeScheduleInitialSlots([]);
          setModeScheduleGridKey(k => k + 1);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [allowanceScheduleModalOpen, props.apiBase, props.authToken, props.selectedStudent?.id]);

  const persistModeSchedule = useCallback(
    async (slots: ModeScheduleSlot[]) => {
      if (!props.selectedStudent?.id || !props.authToken) return;
      const res = await fetch(
        `${props.apiBase}/api/parent/students/${encodeURIComponent(String(props.selectedStudent.id))}/app-mode-schedule`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${props.authToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ slots })
        }
      );
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        props.setParentPlannerMessage(data.error || "허용앱 시간표를 저장하지 못했습니다.");
        throw new Error("save failed");
      }
      props.setParentPlannerMessage("허용앱 시간표를 저장했습니다.");
      props.hapticSuccess();
    },
    [props.apiBase, props.authToken, props.hapticSuccess, props.selectedStudent?.id, props.setParentPlannerMessage]
  );

  useEffect(() => {
    setStudyRoomMessage("");
  }, [props.selectedStudent?.id]);

  useEffect(() => {
    if (!props.selectedStudent) setAllowanceScheduleModalOpen(false);
  }, [props.selectedStudent]);

  const refreshStudents = useCallback(
    async (preferStudentId?: number | null) => {
      if (!props.authToken) return;
      const res = await fetch(`${props.apiBase}/api/parent/students`, {
        headers: {
          Authorization: `Bearer ${props.authToken}`
        }
      });
      if (!res.ok) return;
      const data = await res.json().catch(() => ({}));
      const next = (Array.isArray(data.students) ? data.students : []) as ParentStudentRow[];
      props.setParentStudents(next);
      const want = preferStudentId ?? props.parentStudentId;
      const preserved =
        next.find(student => Number(student.id) === Number(want)) ||
        next.find(student => Number(student.id) === Number(props.parentStudentId)) ||
        next[0] ||
        null;
      props.setParentStudentId(preserved?.id ?? null);
    },
    [
      props.apiBase,
      props.authToken,
      props.parentStudentId,
      props.setParentStudentId,
      props.setParentStudents
    ]
  );

  const reloadStudentDeviceUi = useCallback(
    async (options?: {
      targetStudentId?: number | null;
      /** effect에서만 넘김 — 마지막 요청만 UI 반영 */
      loadGeneration?: number;
    }) => {
      if (!props.authToken) return;
      const sid = options?.targetStudentId ?? props.parentStudentId;
      if (!sid) return;

      const res = await fetch(
        `${props.apiBase}/api/parent/students/${encodeURIComponent(String(sid))}/device-control-state`,
        {
          headers: {
            Authorization: `Bearer ${props.authToken}`
          }
        }
      );

      const data = (await res.json().catch(() => ({}))) as {
        appAllowanceMode?: "default" | AppAllowanceModeKey;
        mdmSurfaceMode?: string;
        kioskEnabled?: boolean;
        bulkLockOverride?: boolean;
      };

      if (
        options?.loadGeneration !== undefined &&
        options.loadGeneration !== deviceUiLoadGenerationRef.current
      ) {
        return;
      }

      if (!res.ok) {
        startTransition(() => {
          setBulkLockOverrideFromApi(false);
          setMdmSurfaceMode("default");
        });
        return;
      }

      const parsedSurface = parseParentMdmSurfaceMode(data.mdmSurfaceMode);
      const effectiveSurface: ParentMdmSurfaceMode = parsedSurface ?? "default";
      startTransition(() => {
        setMdmSurfaceMode(effectiveSurface);
        setBulkLockOverrideFromApi(
          effectiveSurface === "block" || Boolean(data.bulkLockOverride)
        );

        setActiveAppAllowanceMode(
          data.appAllowanceMode === "utility" || data.appAllowanceMode === "free"
            ? data.appAllowanceMode
            : null
        );
        setIsBulkKioskEnabled(Boolean(data.kioskEnabled));
      });

      if (
        options?.loadGeneration !== undefined &&
        options.loadGeneration !== deviceUiLoadGenerationRef.current
      ) {
        return;
      }
      await refreshStudents(sid);
    },
    [props.apiBase, props.authToken, props.parentStudentId, refreshStudents]
  );

  const reloadStudentDeviceUiRef = useRef(reloadStudentDeviceUi);
  reloadStudentDeviceUiRef.current = reloadStudentDeviceUi;

  useEffect(() => {
    if (!props.authToken || !props.parentStudentId) {
      setActiveAppAllowanceMode(null);
      setIsBulkKioskEnabled(false);
      setMdmSurfaceMode(null);
      setBulkLockOverrideFromApi(false);
      setActivatingAppMode(null);
      deviceUiPrevStudentIdRef.current = null;
      return;
    }
    const sid = props.parentStudentId;
    const switched =
      deviceUiPrevStudentIdRef.current !== null && deviceUiPrevStudentIdRef.current !== sid;
    deviceUiPrevStudentIdRef.current = sid;

    const loadGeneration = ++deviceUiLoadGenerationRef.current;
    if (switched) {
      startTransition(() => {
        setMdmSurfaceMode(null);
        setBulkLockOverrideFromApi(false);
        setIsBulkKioskEnabled(false);
        setActiveAppAllowanceMode(null);
      });
    }

    void (async () => {
      try {
        await reloadStudentDeviceUiRef.current({
          targetStudentId: sid,
          loadGeneration
        });
      } catch {
        /* 네트워크 오류는 조용히 무시 — 다음 동작 시 재시도 */
      }
    })();
  }, [props.authToken, props.parentStudentId]);

  const saveStudyRoomSetting = (value: StudyRoomSetting) => {
    if (!props.authToken) return;
    setStudyRoomSaving(true);
    setStudyRoomMessage("");
    void (async () => {
      try {
        const res = await fetch(
          `${props.apiBase}/api/parent/students/${encodeURIComponent(String(value.studentId))}/study-room`,
          {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${props.authToken}`
            },
            body: JSON.stringify({
              name: value.name,
              address: value.address || null,
              latitude: value.latitude,
              longitude: value.longitude,
              radiusMeters: value.radiusMeters
            })
          }
        );
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(String(data.error || "독서실 위치 저장에 실패했습니다."));
        }
        await refreshStudents();
        props.hapticSuccess();
        setStudyRoomMessage("독서실 위치를 저장했습니다.");
      } catch (error) {
        setStudyRoomMessage(
          error instanceof Error && error.message
            ? error.message
            : "독서실 위치 저장 중 오류가 발생했습니다."
        );
        props.hapticWarning();
      } finally {
        setStudyRoomSaving(false);
      }
    })();
  };

  // 자동 저장용 파라미터 받는 함수로 변경
  const savePlannerRule = async ({ enabled, lockTime }: { enabled: boolean; lockTime: string }) => {
    if (!props.authToken || !props.parentStudentId) return;
    props.setParentPlannerSaving(true);
    props.setParentPlannerMessage("");
    try {
      const res = await fetch(`${props.apiBase}/api/parent/planner-rule`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${props.authToken}`
        },
        body: JSON.stringify({
          studentId: props.parentStudentId,
          enabled,
          lockTime
        })
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        lockStatus?: ParentLockStatus | null;
      };
      if (!res.ok) {
        props.setParentPlannerMessage(data.error || "시간 설정 저장에 실패했습니다.");
        props.hapticWarning();
        return;
      }
      props.setParentLockStatus(data.lockStatus || null);
      props.setParentPlannerMessage("설정이 저장되었습니다.");
      props.hapticSuccess();
    } catch {
      props.setParentPlannerMessage("서버와 통신 중 오류가 발생했습니다.");
      props.hapticWarning();
    } finally {
      props.setParentPlannerSaving(false);
    }
  };

  const toggleLockNow = async (nextLocked: boolean) => {
    if (!props.authToken || !props.parentStudentId) return;
    try {
      const res = await fetch(
        `${props.apiBase}/api/parent/${nextLocked ? "lock-now" : "unlock-now"}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${props.authToken}`
          },
          body: JSON.stringify({ studentId: props.parentStudentId })
        }
      );
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        lockStatus?: ParentLockStatus | null;
      };
      if (!res.ok) {
        props.setParentPlannerMessage(
          data.error || (nextLocked ? "수동 잠금에 실패했습니다." : "수동 해제에 실패했습니다.")
        );
        props.hapticWarning();
        return;
      }
      props.setParentLockStatus(data.lockStatus || null);
      props.setParentPlannerMessage(
        nextLocked ? "학생 기기를 잠금 상태로 전환했습니다." : "학생 기기 잠금을 해제했습니다."
      );
      props.hapticSuccess();
    } catch {
      props.setParentPlannerMessage("수동 제어 중 오류가 발생했습니다.");
      props.hapticWarning();
    }
  };

  // 선택된 학생에게만 적용하도록 수정
  const toggleBulkDaechiRootLock = async (nextLocked: boolean) => {
    if (!props.authToken || !props.parentStudentId) return;
    setBulkDaechiRootLockSaving(true);
    props.setParentPlannerMessage("");
    try {
      const res = await fetch(
        `${props.apiBase}/api/parent/app-allowance/${nextLocked ? "bulk-daechiroot-lock" : "bulk-daechiroot-unlock"}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${props.authToken}`
          },
          body: JSON.stringify({ studentIds: [props.parentStudentId] })
        }
      );
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        summary?: { total?: number; success?: number; failed?: number };
      };
      if (!res.ok) {
        props.setParentPlannerMessage(
          data.error || (nextLocked ? "일괄 잠금에 실패했습니다." : "일괄 해제에 실패했습니다.")
        );
        props.hapticWarning();
        return;
      }
      props.setParentPlannerMessage(
        data.message ||
          (nextLocked
            ? "관리 학생 기기를 대치루트 전용 허용 상태로 전환했습니다."
            : "관리 학생 기기를 주간 허용 시간표 기준으로 복원했습니다.")
      );
      if ((data.summary?.failed || 0) > 0) {
        props.hapticWarning();
      } else {
        props.hapticSuccess();
        await reloadStudentDeviceUi();
      }
    } catch (error) {
      const detail =
        error instanceof Error && error.message
          ? ` (${error.message})`
          : "";
      props.setParentPlannerMessage(
        `일괄 제어 중 오류가 발생했습니다. 서버: ${props.apiBase}${detail}`
      );
      props.hapticWarning();
    } finally {
      setBulkDaechiRootLockSaving(false);
    }
  };

  const activateAppAllowanceMode = async (mode: "utility" | "free" | "default") => {
    if (!props.authToken || !props.parentStudentId) return;
    setActivatingAppMode(mode);
    props.setParentPlannerMessage("");
    try {
      const res = await fetch(`${props.apiBase}/api/parent/app-allowance/activate-mode`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${props.authToken}`
        },
        body: JSON.stringify({
          mode,
          studentIds: [props.parentStudentId]
        })
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        ok?: boolean;
        summary?: { failed?: number };
        results?: Array<{ ok?: boolean; error?: string }>;
      };
      if (!res.ok) {
        props.setParentPlannerMessage(data.error || "허용앱 프로파일 적용에 실패했습니다.");
        props.hapticWarning();
        return;
      }
      const failed = Number(data.summary?.failed ?? 0) > 0 || data.ok === false;
      if (failed) {
        const rowErr = data.results?.find(r => r && r.ok === false)?.error;
        props.setParentPlannerMessage(
          rowErr || data.message || "허용앱 프로파일 적용에 실패했습니다."
        );
        props.hapticWarning();
        return;
      }
      props.setParentPlannerMessage(data.message || "허용앱 프로파일을 적용했습니다.");
      props.hapticSuccess();
      await reloadStudentDeviceUi();
    } catch (error) {
      const detail = error instanceof Error && error.message ? ` (${error.message})` : "";
      props.setParentPlannerMessage(`허용앱 프로파일 적용 중 오류가 발생했습니다.${detail}`);
      props.hapticWarning();
    } finally {
      setActivatingAppMode(null);
    }
  };

  const surfaceModeLabel =
    PARENT_MDM_SURFACE_LABEL[mdmDisplaySurfaceMode] ?? PARENT_MDM_SURFACE_LABEL.default;

  const toggleBulkKioskMode = async (nextEnabled: boolean) => {
    if (!props.authToken || !props.parentStudentId) return;
    setBulkKioskSaving(true);
    props.setParentPlannerMessage("");
    try {
      const res = await fetch(
        `${props.apiBase}/api/parent/kiosk-mode/${nextEnabled ? "bulk-enable" : "bulk-disable"}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${props.authToken}`
          },
          body: JSON.stringify({ studentIds: [props.parentStudentId] })
        }
      );
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        summary?: { total?: number; success?: number; failed?: number };
      };
      if (!res.ok) {
        props.setParentPlannerMessage(
          data.error || (nextEnabled ? "키오스크 모드 적용에 실패했습니다." : "키오스크 모드 해제에 실패했습니다.")
        );
        props.hapticWarning();
        return;
      }
      props.setParentPlannerMessage(
        data.message ||
          (nextEnabled
            ? "관리 학생 기기를 대치루트 키오스크 모드로 전환했습니다."
            : "관리 학생 기기의 키오스크 모드를 해제했습니다.")
      );
      if ((data.summary?.failed || 0) > 0) {
        props.hapticWarning();
      } else {
        props.hapticSuccess();
        await reloadStudentDeviceUi();
      }
    } catch (error) {
      const detail =
        error instanceof Error && error.message
          ? ` (${error.message})`
          : "";
      props.setParentPlannerMessage(
        `키오스크 모드 제어 중 오류가 발생했습니다. 서버: ${props.apiBase}${detail}`
      );
      props.hapticWarning();
    } finally {
      setBulkKioskSaving(false);
    }
  };

  return (
    <div className="coach-page">
      <ParentStudentSelector
        parentStudents={props.parentStudents}
        parentStudentId={props.parentStudentId}
        setParentStudentId={props.setParentStudentId}
      />
      {props.selectedStudent ? (
        <Card className="coach-card coach-card--padded coach-settings-status-card" style={{ marginTop: 12 }}>
          <div className="coach-settings-banner">
            <div className="coach-settings-banner__text-stack">
              <p className="coach-settings-banner__body">
                학생 휴대폰은 현재{" "}
                <span className="coach-settings-banner__mode">{surfaceModeLabel}</span> 모드입니다.
              </p>
              {isBulkKioskEnabled ? (
                <p className="coach-settings-banner__body">
                  현재 <span className="coach-settings-banner__mode">계획표</span> 작성 시간입니다.
                </p>
              ) : null}
            </div>
          </div>
        </Card>
      ) : null}
      {!props.selectedStudent ? (
        <Card className="coach-card coach-card--padded">
          <SectionHeader title="학생 설정" icon={<UserRound />} />
          <EmptyState title="학생을 선택하세요" body="선택하면 설정을 바꿀 수 있어요." />
        </Card>
      ) : (
        <>
          <div className="parent-student-settings__location-planner-row">
            <Card className="coach-card coach-card--padded">
              <SectionHeader title="학습 위치 설정" icon={<MapPin />} />
              <div className="parent-settings-primary-action" style={{ marginTop: 12 }}>
                <button
                  type="button"
                  className="timeline-save-button study-room-editor__save-button parent-mode-schedule-item__activate"
                  onClick={() => setStudyRoomModalOpen(true)}
                >
                  독서실 선택
                </button>
              </div>
              {studyRoomMessage ? (
                <p className="settings-hint" style={{ marginTop: 12 }}>
                  {studyRoomMessage}
                </p>
              ) : null}
              <StudyRoomPickerModal
                open={studyRoomModalOpen}
                student={props.selectedStudent}
                initialValue={props.selectedStudent?.studyRoom || undefined}
                authToken={props.authToken}
                saving={studyRoomSaving}
                onClose={() => setStudyRoomModalOpen(false)}
                onSave={value => {
                  setStudyRoomModalOpen(false);
                  saveStudyRoomSetting(value);
                }}
              />
            </Card>

            <Card className="coach-card coach-card--padded parent-student-settings__planner-card">
              <SectionHeader
                title="계획표 작성 시간"
                titleNarrow="계획표 작성"
                titleMinimal="계획표"
                icon={<CalendarClock />}
                right={
                  <div className="parent-student-settings__planner-controls parent-student-settings__planner-controls--header">
                    <button
                      type="button"
                      className="student-profile-alarm-item__time-btn parent-student-settings__time-btn"
                      style={{
                        fontSize: "1.05em",
                        borderRadius: "var(--radius-2xs)",
                        border: "1px solid var(--stroke)",
                        background: "#fff",
                        cursor: props.parentPlannerEnabled ? "pointer" : "not-allowed",
                        opacity: props.parentPlannerEnabled ? 1 : 0.5
                      }}
                      disabled={!props.parentPlannerEnabled}
                      onClick={() => props.parentPlannerEnabled && setPlannerTimeSheetOpen(true)}
                      aria-label="계획표 작성 강제 시각"
                    >
                      {props.parentPlannerTime}
                    </button>
                    <button
                      type="button"
                      className={
                        "student-profile-alarm-item__toggle student-profile-alarm-item__toggle-button" +
                        (props.parentPlannerEnabled
                          ? " student-profile-alarm-item__toggle--on"
                          : " student-profile-alarm-item__toggle--off")
                      }
                      onClick={async () => {
                        const nextEnabled = !props.parentPlannerEnabled;
                        props.setParentPlannerEnabled(nextEnabled);
                        await savePlannerRule({
                          enabled: nextEnabled,
                          lockTime: props.parentPlannerTime
                        });
                      }}
                      aria-pressed={props.parentPlannerEnabled}
                      aria-label={props.parentPlannerEnabled ? "강제 잠금 켜짐" : "강제 잠금 꺼짐"}
                    >
                      {props.parentPlannerEnabled ? "켜짐" : "꺼짐"}
                    </button>
                  </div>
                }
              />
              <TimePickerSheet
                open={plannerTimeSheetOpen}
                value={props.parentPlannerTime}
                onClose={() => setPlannerTimeSheetOpen(false)}
                onSave={async (newTime: string) => {
                  setPlannerTimeSheetOpen(false);
                  props.setParentPlannerTime(newTime);
                  await savePlannerRule({
                    enabled: props.parentPlannerEnabled,
                    lockTime: newTime
                  });
                }}
                disabled={!props.parentPlannerEnabled}
              />
              <div className="parent-settings-primary-action" style={{ marginTop: 12 }}>
                <button
                  type="button"
                  className={
                    ("timeline-save-button study-room-editor__save-button parent-mode-schedule-item__activate") +
                    (isBulkKioskEnabled ? " student-profile-link-action-btn--danger" : "") +
                    (bulkKioskSaving ? " parent-settings-btn--spinner-only" : "")
                  }
                  disabled={bulkKioskSaving}
                  onClick={() => {
                    void toggleBulkKioskMode(!isBulkKioskEnabled);
                  }}
                  aria-busy={bulkKioskSaving}
                  aria-label={isBulkKioskEnabled ? "지금 끄기" : "지금 켜기"}
                >
                  {bulkKioskSaving ? (
                    <span className="parent-settings-inline-spinner parent-settings-inline-spinner--inverse" aria-hidden />
                  ) : isBulkKioskEnabled ? (
                    "지금 끄기"
                  ) : (
                    "지금 켜기"
                  )}
                </button>
              </div>
            </Card>
          </div>
        </>
      )}

      {/* 모드별 시간 예약 설정 카드 */}
      <Card className="coach-card coach-card--padded" style={{ marginTop: 12 }}>
        <SectionHeader
          title="허용앱 설정"
          icon={<LayoutGrid />}
          right={
            props.selectedStudent ? (
              <button
                type="button"
                className="parent-mode-schedule-header__schedule-btn"
                disabled={allowanceScheduleBusy}
                onClick={() => setAllowanceScheduleModalOpen(true)}
              >
                <CalendarRange aria-hidden />
                시간표
              </button>
            ) : null
          }
        />
        {!props.selectedStudent ? (
          <EmptyState title="학생을 선택하세요" body="선택하면 설정을 바꿀 수 있어요." />
        ) : (
          <div style={{ marginTop: 12 }}>
            <ModeScheduleSettings
              activeMode={activeAppAllowanceMode}
              activatingMode={activatingAppMode === "default" ? null : activatingAppMode}
              blockActive={isBulkDaechiRootLockActive}
              blockActivating={bulkDaechiRootLockSaving}
              scheduleModalOpen={allowanceScheduleModalOpen}
              onScheduleModalClose={() => setAllowanceScheduleModalOpen(false)}
              initialScheduleSlots={modeScheduleInitialSlots}
              scheduleGridRemountKey={modeScheduleGridKey}
              onScheduleSave={persistModeSchedule}
              onToggleBlockNow={nextLocked => {
                void toggleBulkDaechiRootLock(nextLocked);
              }}
              onToggleModeNow={(mode, nextEnabled) => {
                void activateAppAllowanceMode(nextEnabled ? mode : "default");
              }}
            />
          </div>
        )}
      </Card>



    </div>
  );
}

function ManageTab(props: {
  authToken: string | null;
  parentStudents: ParentStudentRow[];
  selectedStudent: ParentStudentRow | null;
  parentStudentId: number | null;
  setParentStudentId: (id: number | null) => void;
}) {
  return (
    <div className="coach-page coach-page--chat coach-page--manage">
      <ParentStudentSelector
        parentStudents={props.parentStudents}
        parentStudentId={props.parentStudentId}
        setParentStudentId={props.setParentStudentId}
      />

      {!props.selectedStudent ? (
        <EmptyState
          title="학생을 선택하세요"
          body="학생을 선택하면 관리 채널을 확인할 수 있습니다."
        />
      ) : (
        <ParentAdminChannelPanel
          authToken={props.authToken}
          studentId={props.parentStudentId ?? props.selectedStudent.id}
          studentLabel={props.selectedStudent.email || "학생"}
        />
      )}
    </div>
  );
}

function ParentAnalysisTab(props: {
  authToken: string | null;
  selectedStudent: ParentStudentRow | null;
  parentReport: ParentWeeklyReport | null;
  parentAiDaily: ParentAiDaily | null;
}) {
  if (!props.selectedStudent) {
    return <EmptyState title="학생을 선택하세요" />;
  }
  const parentSuggestedPhrase = deriveGuide(props.parentReport, props.parentAiDaily).suggestedPhrases[0];
  return (
    <StudentCoachApp
      tab="analysis"
      authToken={props.authToken}
      apiScope="parent"
      parentStudentId={props.selectedStudent.id}
      analysisActionTextOverride={parentSuggestedPhrase}
    />
  );
}

export function ParentCoachApp(props: {
  tab: ParentTabKey;
  apiBase: string;
  authToken: string | null;
  userEmail: string | null;
  parentNotificationUnreadCount: number;
  hapticSelection: () => void;
  parentStudents: ParentStudentRow[];
  setParentStudents: React.Dispatch<React.SetStateAction<ParentStudentRow[]>>;
  parentStudentId: number | null;
  setParentStudentId: (id: number | null) => void;
  parentReport: ParentWeeklyReport | null;
  parentAiDaily: ParentAiDaily | null;
  parentPlannerEnabled: boolean;
  setParentPlannerEnabled: (value: boolean) => void;
  parentPlannerTime: string;
  setParentPlannerTime: (value: string) => void;
  parentPlannerSaving: boolean;
  setParentPlannerSaving: (value: boolean) => void;
  parentPlannerMessage: string;
  setParentPlannerMessage: (value: string) => void;
  parentLockStatus: ParentLockStatus | null;
  setParentLockStatus: React.Dispatch<React.SetStateAction<ParentLockStatus | null>>;
  hapticWarning: () => void;
  hapticSuccess: () => void;
}) {
  const selectedStudent =
    props.parentStudents.find(student => student.id === props.parentStudentId) ||
    props.parentStudents[0] ||
    null;

  let view: React.ReactNode;
  if (props.tab === "home") {
    view = (
      <ParentHomeTab
        apiBase={props.apiBase}
        authToken={props.authToken}
        userEmail={props.userEmail}
        parentStudents={props.parentStudents}
        parentStudentId={props.parentStudentId}
        setParentStudentId={props.setParentStudentId}
        selectedStudent={selectedStudent}
        parentLockStatus={props.parentLockStatus}
        notificationUnreadCount={props.parentNotificationUnreadCount}
        hapticSelection={props.hapticSelection}
      />
    );
  } else if (props.tab === "records") {
    view = (
      <RecordsTab
        apiBase={props.apiBase}
        authToken={props.authToken}
        parentStudents={props.parentStudents}
        selectedStudent={selectedStudent}
        parentStudentId={props.parentStudentId}
        setParentStudentId={props.setParentStudentId}
        parentReport={props.parentReport}
      />
    );
  } else if (props.tab === "studentSettings") {
    view = (
      <StudentSettingsTab
        apiBase={props.apiBase}
        authToken={props.authToken}
        parentStudents={props.parentStudents}
        setParentStudents={props.setParentStudents}
        selectedStudent={selectedStudent}
        parentStudentId={props.parentStudentId}
        setParentStudentId={props.setParentStudentId}
        parentPlannerEnabled={props.parentPlannerEnabled}
        setParentPlannerEnabled={props.setParentPlannerEnabled}
        parentPlannerTime={props.parentPlannerTime}
        setParentPlannerTime={props.setParentPlannerTime}
        parentPlannerSaving={props.parentPlannerSaving}
        setParentPlannerSaving={props.setParentPlannerSaving}
        parentPlannerMessage={props.parentPlannerMessage}
        setParentPlannerMessage={props.setParentPlannerMessage}
        parentLockStatus={props.parentLockStatus}
        setParentLockStatus={props.setParentLockStatus}
        hapticWarning={props.hapticWarning}
        hapticSuccess={props.hapticSuccess}
      />
    );
  } else if (props.tab === "analysis") {
    view = (
      <ParentAnalysisTab
        authToken={props.authToken}
        selectedStudent={selectedStudent}
        parentReport={props.parentReport}
        parentAiDaily={props.parentAiDaily}
      />
    );
  } else {
    view = (
      <ManageTab
        authToken={props.authToken}
        parentStudents={props.parentStudents}
        selectedStudent={selectedStudent}
        parentStudentId={props.parentStudentId}
        setParentStudentId={props.setParentStudentId}
      />
    );
  }

  return (
    <div className="coach-shell">
      <TabTransitionPanel
        tabKey={props.tab}
        className={
          props.tab === "manage" || props.tab === "home"
            ? "coach-shell__tab-panel coach-unified-tab-panel--fill"
            : "coach-shell__tab-panel"
        }
      >
        {view}
      </TabTransitionPanel>
    </div>
  );
}

