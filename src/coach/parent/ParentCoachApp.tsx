import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Brain,
  ClipboardList,
  Lightbulb,
  ShieldAlert,
  Sparkles,
  TrendingUp
} from "lucide-react";
import { TabTransitionPanel } from "../../components/PageTransition";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { TimePickerSheet } from "../../components/TimePickerSheet";
import { setAppPath } from "../../lib/appNavigation";
import { StudyRoomPickerEditor, type StudyRoomSetting } from "../../components/parent/StudyRoomPickerModal";
import type { ParentLockStatus } from "../../types/lockStatus";
import type { Severity } from "../types";
import { getDateKeySeoul, getWeekDaysIncludingTomorrowSeoul } from "../../lib/weekDates";
import { ParentAdminChannelPanel } from "../admin/AdminChannelPanels";
import { Card, EmptyState, GradientHeroCard, MetricCard, RiskBadge, SectionHeader, StatPill } from "../ui/components";
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

export type ParentTabKey = "manage" | "aiReport" | "records" | "studentSettings";

const STUDY_ROOM_VISITS_REFRESH_INTERVAL_MS = 30000;
const PARENT_COACH_CACHE_TTL_MS = 2 * 60 * 1000;

type ParentAiDaily = {
  summary_text: string;
  report_date: string;
  model: string;
  created_at: string;
};

type ParentWeekDay = {
  id: number;
  date: string;
};

type ParentWeekBlock = {
  study_day_id: number;
  subject: string;
  start_time: string;
  end_time: string;
  done?: boolean;
  focus_score?: "◎" | "○" | "△" | "✕" | null;
};

type ParentWeekPlan = {
  id: number;
  study_day_id: number;
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

type ParentStudyRoomLiveStatus = {
  currentDistanceMeters: number | null;
  currentWithinRadius: boolean | null;
  currentHeartbeatAt: string | null;
  currentAccuracyMeters: number | null;
  currentRadiusMeters: number | null;
  studyRoomName: string | null;
};

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

function formatStudentLabel(student: ParentStudentRow | null) {
  if (!student) return "학생";
  const email = String(student.email || "").trim();
  const localPart = email.split("@")[0]?.trim();
  return localPart || email || `학생 ${student.id}`;
}

function buildDailyChart(report: ParentWeeklyReport | null) {
  const days = Array.isArray(report?.days) ? report.days : [];
  const blocks = Array.isArray(report?.blocks) ? report.blocks : [];

  return days.map(day => {
    const dayBlocks = blocks.filter(block => block.study_day_id === day.id);
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
    return <div className="record-readonly-empty">{props.emptyText || "타임라인 기록이 없습니다."}</div>;
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
              {block.focus_score ? `집중도 ${block.focus_score}` : block.done ? "완료" : "미완료"}
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

function formatStudyRoomVisitPeriod(visit: StudyRoomVisitSession) {
  const enteredAt = formatStudyRoomVisitDateTime(visit.enteredAt);
  const exitedAt = visit.exitedAt
    ? formatStudyRoomVisitDateTime(visit.exitedAt)
    : "현재 체크인 상태";
  return `${enteredAt} - ${exitedAt}`;
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
    guidanceLines.push("연결된 학생 데이터를 불러오면 이번 주 흐름을 기반으로 관리자 가이드를 보여드립니다.");
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

function StudentSelectorCard(props: {
  parentStudents: ParentStudentRow[];
  parentStudentId: number | null;
  setParentStudentId: (id: number | null) => void;
}) {
  const selectedStudent =
    props.parentStudents.find(student => student.id === props.parentStudentId) ||
    props.parentStudents[0] ||
    null;

  if (props.parentStudents.length === 0) {
    return null;
  }

  return (
    <div className="coach-student-switcher" role="region" aria-label="관리 학생 선택">
      <div className="store-filter-row" role="tablist" aria-label="관리 학생 목록">
        {props.parentStudents.map(student => {
          const isSelected = student.id === selectedStudent?.id;
          return (
            <button
              key={student.id}
              type="button"
              role="tab"
              className={
                "store-filter-btn" +
                (isSelected ? " store-filter-btn--active" : "")
              }
              aria-selected={isSelected}
              aria-label={`${formatStudentLabel(student)} 학생 선택`}
              onClick={() => props.setParentStudentId(student.id)}
            >
              {formatStudentLabel(student)}
            </button>
          );
        })}
      </div>
    </div>
  );
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
  const totalStudyMinutes = props.parentReport?.stats?.totalStudyMinutes || 0;
  const focusDistribution = props.parentReport?.stats?.focusDistribution;
  const stableFocus = (focusDistribution?.best || 0) + (focusDistribution?.good || 0);
  const consecutiveAbsentDays = props.parentReport?.stats?.consecutiveAbsentDays || 0;

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
    setAnalysisLoading(true);
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
    setPatternsLoading(true);
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
      <StudentSelectorCard
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
            {aiPatterns.length > 0 ? "최신 패턴으로 동기화하는 중입니다." : "패턴을 분석하는 중입니다."}
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
          title="AI 관리자 가이드"
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
  const [studyRoomVisits, setStudyRoomVisits] = useState<StudyRoomVisitSession[]>([]);
  const [studyRoomVisitsLoading, setStudyRoomVisitsLoading] = useState(false);
  const [studyRoomLiveStatus, setStudyRoomLiveStatus] = useState<ParentStudyRoomLiveStatus>({
    currentDistanceMeters: null,
    currentWithinRadius: null,
    currentHeartbeatAt: null,
    currentAccuracyMeters: null,
    currentRadiusMeters: null,
    studyRoomName: null
  });

  const refreshStudyRoomVisits = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!props.authToken || !props.selectedStudent?.studyRoom) {
        setStudyRoomVisits([]);
        setStudyRoomVisitsLoading(false);
        setStudyRoomLiveStatus({
          currentDistanceMeters: null,
          currentWithinRadius: null,
          currentHeartbeatAt: null,
          currentAccuracyMeters: null,
          currentRadiusMeters: null,
          studyRoomName: null
        });
        return;
      }

      if (!options?.silent) {
        setStudyRoomVisitsLoading(true);
      }

      try {
        const res = await fetch(
          `${props.apiBase}/api/parent/students/${encodeURIComponent(String(props.selectedStudent.id))}/study-room-visits?limit=6`,
          {
            cache: "no-store",
            headers: {
              Authorization: `Bearer ${props.authToken}`
            }
          }
        );
        const data = (await res.json().catch(() => ({}))) as {
          visits?: StudyRoomVisitSession[];
          currentDistanceMeters?: number | null;
          currentWithinRadius?: boolean | null;
          currentHeartbeatAt?: string | null;
          currentAccuracyMeters?: number | null;
          currentRadiusMeters?: number | null;
          studyRoomName?: string | null;
        };
        setStudyRoomVisits(Array.isArray(data.visits) ? data.visits : []);
        setStudyRoomLiveStatus({
          currentDistanceMeters:
            data.currentDistanceMeters != null && Number.isFinite(Number(data.currentDistanceMeters))
              ? Number(data.currentDistanceMeters)
              : null,
          currentWithinRadius:
            typeof data.currentWithinRadius === "boolean" ? data.currentWithinRadius : null,
          currentHeartbeatAt:
            data.currentHeartbeatAt != null ? String(data.currentHeartbeatAt) : null,
          currentAccuracyMeters:
            data.currentAccuracyMeters != null && Number.isFinite(Number(data.currentAccuracyMeters))
              ? Number(data.currentAccuracyMeters)
              : null,
          currentRadiusMeters:
            data.currentRadiusMeters != null && Number.isFinite(Number(data.currentRadiusMeters))
              ? Number(data.currentRadiusMeters)
              : null,
          studyRoomName: data.studyRoomName != null ? String(data.studyRoomName) : null
        });
      } catch {
        setStudyRoomVisits([]);
        setStudyRoomLiveStatus({
          currentDistanceMeters: null,
          currentWithinRadius: null,
          currentHeartbeatAt: null,
          currentAccuracyMeters: null,
          currentRadiusMeters: null,
          studyRoomName: null
        });
      } finally {
        if (!options?.silent) {
          setStudyRoomVisitsLoading(false);
        }
      }
    },
    [props.apiBase, props.authToken, props.selectedStudent?.id, props.selectedStudent?.studyRoom]
  );

  useEffect(() => {
    void refreshStudyRoomVisits();
  }, [refreshStudyRoomVisits]);

  useEffect(() => {
    if (!props.authToken || !props.selectedStudent?.studyRoom) {
      return;
    }

    const run = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      void refreshStudyRoomVisits({ silent: true });
    };

    const timerId = window.setInterval(run, STUDY_ROOM_VISITS_REFRESH_INTERVAL_MS);
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      run();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.clearInterval(timerId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [props.authToken, props.selectedStudent?.studyRoom, refreshStudyRoomVisits]);

  const daysByDate = useMemo(
    () =>
      new Map(
        days.map(day => [normalizeDateKey(day.date), day] as const)
      ),
    [days]
  );
  const blocksByDayId = useMemo(() => {
    const next = new Map<number, ParentWeekBlock[]>();
    for (const block of blocks) {
      const list = next.get(block.study_day_id) || [];
      list.push(block);
      next.set(block.study_day_id, list);
    }
    return next;
  }, [blocks]);
  const plansByDayId = useMemo(() => {
    const next = new Map<number, ParentWeekPlan[]>();
    for (const plan of plans) {
      const list = next.get(plan.study_day_id) || [];
      list.push(plan);
      next.set(plan.study_day_id, list);
    }
    return next;
  }, [plans]);
  const logsByDate = useMemo(() => {
    const next = new Map<string, ParentCoachLog>();
    for (const log of logs) {
      const key = normalizeDateKey(log.date);
      if (key && !next.has(key)) next.set(key, log);
    }
    return next;
  }, [logs]);

  const todayKey = getDateKeySeoul(0);
  const tomorrowKey = getDateKeySeoul(1);
  const todayDay = daysByDate.get(todayKey) || null;
  const tomorrowDay = daysByDate.get(tomorrowKey) || null;
  const todayBlocks = todayDay ? sortBlocks(blocksByDayId.get(todayDay.id) || []) : [];
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
    const dayBlocks = day ? sortBlocks(blocksByDayId.get(day.id) || []) : [];
    const tomorrowPlans = tomorrowDay ? plansByDayId.get(tomorrowDay.id) || [] : [];
    const dayPlans = day ? plansByDayId.get(day.id) || [] : [];
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
            <h3 className="record-life-group-title">오늘 기록</h3>
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
                label="오늘 공부한 내용을 설명해보세요"
                value={dayLog?.metacognitionReflection}
                className="record-day-memo"
              />
            </div>
          </div>
        ) : null}
        {dayBlocks.length > 0 ? (
          <div className="record-life-group">
            <h3 className="record-life-group-title">학생 타임라인</h3>
            <TimelineListView blocks={dayBlocks} emptyText="타임라인이 없습니다." />
          </div>
        ) : null}
        {isToday ? (
          <div className="record-life-group">
            <h3 className="record-life-group-title">내일 계획</h3>
            <PlanList plans={tomorrowPlans} emptyText="내일 계획이 아직 없습니다." />
          </div>
        ) : null}
        {isTomorrow ? (
          <div className="record-life-group">
            <h3 className="record-life-group-title">내일 계획</h3>
            <PlanList plans={dayPlans} emptyText="내일 계획이 아직 없습니다." />
          </div>
        ) : null}
        {!isToday && !isTomorrow && dayPlans.length > 0 ? (
          <div className="record-life-group">
            <h3 className="record-life-group-title">저장된 계획</h3>
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
            <h3 className="record-life-group-title">오늘 기록</h3>
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
            <h3 className="record-life-group-title">내일 계획</h3>
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
            <h3 className="record-life-group-title">이행여부</h3>
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

  return (
    <div className="coach-page">
      <StudentSelectorCard
        parentStudents={props.parentStudents}
        parentStudentId={props.parentStudentId}
        setParentStudentId={props.setParentStudentId}
      />
      <SectionHeader
        title="학생 기록"
        subtitle={`${formatStudentLabel(props.selectedStudent)} 학생이 기록 페이지에 저장한 내용을 학생 화면과 같은 흐름으로 확인합니다.`}
      />
      {!props.selectedStudent ? (
        <EmptyState title="학생을 먼저 선택해 주세요." body="학생을 선택하면 기록과 타임라인을 확인할 수 있습니다." />
      ) : (
        <>
          <div className="coach-grid coach-records-summary-grid" style={{ marginTop: 12 }}>
            <MetricCard
              title="목표달성률"
              value={goalRate != null ? `${goalRate}%` : "—"}
              hint={
                totalTargets > 0
                  ? `완료 ${achievedTargets}/${totalTargets}`
                  : "오늘 확인할 계획이 없습니다."
              }
              tone={goalRate != null && goalRate >= 70 ? "good" : goalRate != null ? "warn" : "neutral"}
            />
            <MetricCard
              title="오늘의 집중 과목"
              value={focusSubject?.subject || "기록 없음"}
              hint={
                focusSubject
                  ? `${formatMinutes(focusSubject.minutes)} · ${focusSubject.sessions}세션`
                  : "오늘 타임라인이 없습니다."
              }
            />
            <MetricCard
              title="오늘 학습 시간"
              value={todayStudyMinutes > 0 ? formatStudyHoursLabel(todayStudyMinutes) : "—"}
              hint={todayStudyMinutes > 0 ? formatMinutes(todayStudyMinutes) : "아직 저장된 시간이 없습니다."}
            />
          </div>

          <div className="coach-records-overview-grid">
            <Card className="coach-card coach-card--padded coach-records-overview-card">
              <SectionHeader
                title="학생 타임라인"
                subtitle={todayBlocks.length > 0 ? "오늘 완료 여부까지 함께 확인합니다." : "오늘 저장된 타임라인이 없습니다."}
              />
              <div style={{ marginTop: 12 }}>
                <TimelineListView
                  blocks={todayBlocks}
                  emptyText="오늘 타임라인이 없습니다."
                />
              </div>
            </Card>
            <Card className="coach-card coach-card--padded coach-records-overview-card">
              <SectionHeader
                title="이행여부 카드"
                subtitle={todayCommitment ? "어제 정한 실천과 오늘 체크 결과를 같이 봅니다." : "어제 기록한 실천이 아직 없습니다."}
              />
              <div className="coach-records-commitment-body">
                <div
                  className={
                    "coach-records-status" +
                    (todayCommitmentDone === true
                      ? " coach-records-status--done"
                      : todayCommitmentDone === false
                        ? " coach-records-status--wait"
                        : " coach-records-status--empty")
                  }
                >
                  {todayCommitmentDone === true
                    ? "실천 완료"
                    : todayCommitmentDone === false
                      ? "미실천"
                      : "기록 없음"}
                </div>
                <div className="coach-records-card-subtitle">오늘의 핵심</div>
                <div className="record-readonly-value" style={{ marginTop: 8 }}>
                  {todayCommitment || "어제 기록한 실천 내용이 없습니다."}
                </div>
              </div>
            </Card>
          </div>

          <Card className="coach-card coach-card--padded" style={{ marginTop: 12 }}>
            <SectionHeader
              title="독서실 체크인 기록"
              subtitle={
                props.selectedStudent.studyRoom
                  ? "최근 독서실 체크인과 체크아웃 흐름을 확인합니다."
                  : "독서실 설정이 아직 없습니다."
              }
            />
            <div style={{ marginTop: 12 }}>
              {props.selectedStudent.studyRoom ? (
                <div className="parent-study-room-item__visit-empty" style={{ marginBottom: 10 }}>
                  {studyRoomLiveStatus.currentDistanceMeters != null
                    ? `현재 거리 ${Math.round(studyRoomLiveStatus.currentDistanceMeters)}m · ${studyRoomLiveStatus.currentWithinRadius ? "체크인됨" : "체크아웃됨"}`
                    : "아직 실시간 거리 정보가 없습니다."}
                  {studyRoomLiveStatus.currentHeartbeatAt
                    ? ` · 기준 ${formatStudyRoomVisitDateTime(studyRoomLiveStatus.currentHeartbeatAt)}`
                    : ""}
                </div>
              ) : null}
              {!props.selectedStudent.studyRoom ? (
                <EmptyState
                  title="등록된 독서실이 없습니다."
                  body="학생 설정 탭에서 독서실 위치를 먼저 설정해 주세요."
                />
              ) : studyRoomVisitsLoading && studyRoomVisits.length === 0 ? (
                <div className="parent-study-room-item__visit-empty">불러오는 중...</div>
              ) : studyRoomVisits.length === 0 ? (
                <div className="parent-study-room-item__visit-empty">체크인 기록 없음</div>
              ) : (
                <div className="parent-study-room-item__visit-list">
                  {studyRoomVisits.map(visit => (
                    <div key={visit.id} className="parent-study-room-item__visit-item">
                      <div className="parent-study-room-item__visit-row">
                        <span className="parent-study-room-item__visit-name">{visit.studyRoomName}</span>
                        <span className="parent-study-room-item__visit-pill">
                          {visit.exitedAt ? "체크아웃" : "체크인"}
                        </span>
                      </div>
                      <div className="parent-study-room-item__visit-meta">
                        {formatStudyRoomVisitPeriod(visit)}
                      </div>
                      <div className="parent-study-room-item__visit-meta">
                        {visit.lastDistanceMeters != null
                          ? `마지막 거리 ${Math.round(visit.lastDistanceMeters)}m`
                          : "-"}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>

          <section className="section records-study-section" style={{ marginTop: 12 }}>
            <div className="section-header records-section-header">
              <h2 className="section-title">학습 기록</h2>
            </div>
            <div className="week-frame">
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
          </section>

          <section className="section records-life-section" style={{ marginTop: 12 }}>
            <div className="section-header records-section-header">
              <h2 className="section-title">생활 기록</h2>
            </div>
            <div className="week-frame">
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
          </section>
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
  const [studyRoomSaving, setStudyRoomSaving] = useState(false);
  const [studyRoomMessage, setStudyRoomMessage] = useState("");
  const [plannerTimeSheetOpen, setPlannerTimeSheetOpen] = useState(false);

  useEffect(() => {
    setStudyRoomMessage("");
  }, [props.selectedStudent?.id]);

  const refreshStudents = async () => {
    if (!props.authToken) return;
    const res = await fetch(`${props.apiBase}/api/parent/students`, {
      headers: {
        Authorization: `Bearer ${props.authToken}`
      }
    });
    if (!res.ok) return;
    const data = await res.json().catch(() => ({}));
    const next = Array.isArray(data.students) ? data.students : [];
    props.setParentStudents(next);
    const preserved = next.find(student => student.id === props.parentStudentId) || next[0] || null;
    props.setParentStudentId(preserved?.id ?? null);
  };

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

  const savePlannerRule = async () => {
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
          enabled: props.parentPlannerEnabled,
          lockTime: props.parentPlannerTime
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

  return (
    <div className="coach-page">
      <StudentSelectorCard
        parentStudents={props.parentStudents}
        parentStudentId={props.parentStudentId}
        setParentStudentId={props.setParentStudentId}
      />
      <Card className="coach-card coach-card--padded">
        <SectionHeader title="독서실 설정" />
        {!props.selectedStudent ? (
          <EmptyState title="학생을 먼저 선택해 주세요." />
        ) : (
          <div className="parent-study-room-list" style={{ marginTop: 12 }}>
            <div className="parent-study-room-item">
              <div className="parent-study-room-item__editor">
                <StudyRoomPickerEditor
                  student={props.selectedStudent}
                  initialValue={props.selectedStudent.studyRoom || undefined}
                  authToken={props.authToken}
                  saving={studyRoomSaving}
                  onSave={saveStudyRoomSetting}
                />
              </div>
            </div>
          </div>
        )}
        {studyRoomMessage ? (
          <p className="settings-hint" style={{ marginTop: 12 }}>
            {studyRoomMessage}
          </p>
        ) : null}
      </Card>

      <Card className="coach-card coach-card--padded" style={{ marginTop: 12 }}>
        <SectionHeader title="계획표 작성 시간 설정" />
        {!props.selectedStudent ? (
          <EmptyState title="학생을 먼저 선택해 주세요." body="학생을 선택하면 계획표 작성 시간과 잠금 상태를 설정할 수 있습니다." />
        ) : (
          <div className="student-profile-alarm-list" style={{ marginTop: 12 }}>
            <div className="settings-item settings-item--stack student-profile-alarm-item student-profile-alarm-item--detail">
              <div className="student-profile-alarm-item__row">
                <span className="student-profile-alarm-item__body">
                  <span className="student-profile-alarm-item__label">계획표 작성 시간</span>
                  <span className="student-profile-alarm-item__copy">
                    학생이 계획표를 쓰는 시간을 정하고 잠금 여부를 제어합니다.
                  </span>
                </span>
                <button
                  type="button"
                  className={
                    "student-profile-alarm-item__toggle student-profile-alarm-item__toggle-button" +
                    (props.parentPlannerEnabled
                      ? " student-profile-alarm-item__toggle--on"
                      : " student-profile-alarm-item__toggle--off")
                  }
                  onClick={() => props.setParentPlannerEnabled(!props.parentPlannerEnabled)}
                  aria-pressed={props.parentPlannerEnabled}
                >
                  {props.parentPlannerEnabled ? "켜짐" : "꺼짐"}
                </button>
              </div>
              <button
                type="button"
                className="student-profile-alarm-item__time-trigger"
                onClick={() => setPlannerTimeSheetOpen(true)}
                disabled={!props.parentPlannerEnabled}
              >
                <span className="student-profile-alarm-item__time-label">작성 시간</span>
                <span className="student-profile-alarm-item__time-value">
                  {props.parentPlannerTime}
                </span>
              </button>
            </div>
            <div className="student-profile-link-status student-profile-link-status--first">
              <div className="student-profile-link-request-row">
                <div className="student-profile-link-request-row__actions">
                  <button
                    type="button"
                    className="student-profile-link-action-btn"
                    disabled={props.parentPlannerSaving}
                    onClick={() => {
                      void savePlannerRule();
                    }}
                  >
                    {props.parentPlannerSaving ? "저장 중..." : "설정 저장"}
                  </button>
                  {props.parentLockStatus ? (
                    <>
                      <button
                        type="button"
                        className="student-profile-link-action-btn"
                        onClick={() => {
                          void toggleLockNow(true);
                        }}
                      >
                        지금 잠그기
                      </button>
                      <button
                        type="button"
                        className="student-profile-link-action-btn"
                        onClick={() => {
                          void toggleLockNow(false);
                        }}
                      >
                        지금 해제
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
            {props.parentPlannerMessage ? (
              <p className="student-profile-link-feedback settings-hint">
                {props.parentPlannerMessage}
              </p>
            ) : null}
            {props.parentLockStatus ? (
              <div className="student-profile-link-status student-profile-link-status--first">
                <span className="student-profile-link-status__title">
                  현재 상태: {props.parentLockStatus.locked ? "잠김" : "열림"}
                </span>
                <span className="student-profile-link-status__hint">
                  마지막 변경: {props.parentLockStatus.session?.unlocked_at || props.parentLockStatus.session?.locked_at || "아직 없음"}
                </span>
              </div>
            ) : null}
          </div>
        )}
      </Card>

      {props.selectedStudent && props.parentPlannerEnabled ? (
        <TimePickerSheet
          open={plannerTimeSheetOpen}
          title="계획표 작성 시간"
          value={props.parentPlannerTime}
          onClose={() => setPlannerTimeSheetOpen(false)}
          onConfirm={time => {
            props.setParentPlannerTime(time || "21:00");
            setPlannerTimeSheetOpen(false);
          }}
        />
      ) : null}

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
      <StudentSelectorCard
        parentStudents={props.parentStudents}
        parentStudentId={props.parentStudentId}
        setParentStudentId={props.setParentStudentId}
      />

      {!props.selectedStudent ? (
        <EmptyState
          title="학생을 먼저 선택해 주세요."
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

export function ParentCoachApp(props: {
  tab: ParentTabKey;
  apiBase: string;
  authToken: string | null;
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

  const view = useMemo(() => {
    const map: Record<ParentTabKey, React.ReactNode> = {
      manage: (
        <ManageTab
          authToken={props.authToken}
          parentStudents={props.parentStudents}
          selectedStudent={selectedStudent}
          parentStudentId={props.parentStudentId}
          setParentStudentId={props.setParentStudentId}
        />
      ),
      aiReport: (
        <AiReportTab
          apiBase={props.apiBase}
          authToken={props.authToken}
          parentStudents={props.parentStudents}
          parentStudentId={props.parentStudentId}
          setParentStudentId={props.setParentStudentId}
          parentReport={props.parentReport}
          parentAiDaily={props.parentAiDaily}
        />
      ),
      records: (
        <RecordsTab
          apiBase={props.apiBase}
          authToken={props.authToken}
          parentStudents={props.parentStudents}
          selectedStudent={selectedStudent}
          parentStudentId={props.parentStudentId}
          setParentStudentId={props.setParentStudentId}
          parentReport={props.parentReport}
        />
      ),
      studentSettings: (
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
      )
    };
    return map[props.tab] || map.manage;
  }, [
    props.authToken,
    props.apiBase,
    props.parentAiDaily,
    props.hapticSuccess,
    props.hapticWarning,
    props.parentLockStatus,
    props.parentPlannerEnabled,
    props.parentPlannerMessage,
    props.parentPlannerSaving,
    props.parentPlannerTime,
    props.parentReport,
    props.parentStudentId,
    props.parentStudents,
    props.setParentLockStatus,
    props.setParentPlannerEnabled,
    props.setParentPlannerMessage,
    props.setParentPlannerSaving,
    props.setParentPlannerTime,
    props.setParentStudentId,
    props.setParentStudents,
    props.tab,
    selectedStudent
  ]);

  return (
    <div className="coach-shell">
      <TabTransitionPanel
        tabKey={props.tab}
        className={
          props.tab === "manage"
            ? "coach-shell__tab-panel coach-unified-tab-panel--fill"
            : "coach-shell__tab-panel"
        }
      >
        {view}
      </TabTransitionPanel>
    </div>
  );
}

