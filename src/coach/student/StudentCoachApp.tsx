import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { Capacitor } from "@capacitor/core";
import {
  BedDouble,
  Brain,
  Building2,
  Lightbulb,
  SendHorizontal,
  Sparkles,
  Target,
  TrendingUp
} from "lucide-react";
import { motion } from "framer-motion";
import { TabTransitionPanel } from "../../components/PageTransition";
import { demoStudents } from "../demoData";
import { useCoachStore, type CoachChatGreetingMode } from "../state/useCoachStore";
import type { Severity } from "../types";
import {
  Card,
  EmptyState,
  MetricCard,
  SectionHeader
} from "../ui/components";
import { API_BASE } from "../../lib/apiBase";
import {
  DAECHI_COACH_CHAT_STARTER_KEY,
  DAECHI_COACH_INITIAL_PANEL_KEY,
  DAECHI_COACH_LOG_SAVED_EVENT,
  DAECHI_COACH_LOG_SAVED_STORAGE_KEY
} from "../../lib/coachEvents";
import { STUDENT_PROFILE_SCHEDULES_UPDATED_EVENT } from "../../lib/studentProfileSchedules";
import {
  readCoachPanelParamFromHash,
  stripCoachPanelParamFromHash
} from "../../lib/hashRouteUtils";
import {
  getAppPath,
  setAppPath,
  replaceAppPath,
  subscribeAppPathChange
} from "../../lib/appNavigation";
import {
  getDateKeySeoul,
  getWeekDaysSeoul,
  getWeekStartKeySeoul,
  seoulDateKeyFromApiValue
} from "../../lib/weekDates";
import { useEffectiveBearer } from "../../lib/useEffectiveBearer";
import {
  buildStudentCoachPatternsCacheKey,
  buildStudentCoachStateCacheKey,
  readLocalCache,
  readStoredUserCacheScope,
  writeLocalCache
} from "../../lib/viewCache";
import type { ProgressBook, ProgressPlan, StudyBlock } from "../../types/planner";
import { StudentAdminChannelPanel } from "../admin/AdminChannelPanels";
import { CoachAvatar } from "../CoachAvatar";
import { CoachTomorrowPlanCollab } from "./CoachTomorrowPlanCollab";

export type StudentTabKey = "home" | "coach" | "analysis";

const IS_NATIVE_PLATFORM = Capacitor.isNativePlatform();
const NATIVE_KEYBOARD_DISMISS_EVENT = "daechi:native-keyboard-input-dismiss";
const NATIVE_KEYBOARD_SUBMIT_EVENT = "daechi:native-keyboard-input-submit";

type CoachPanelKey = "analysis" | "plan" | "chat" | "admin";

/** Strict Mode 이중 마운트에서도 URL·sessionStorage 기준으로 동일하게 시작 (초기화에서 storage는 제거하지 않음) */
function readInitialCoachPanelFromWindow(entryTab: StudentTabKey): CoachPanelKey {
  if (entryTab === "analysis") {
    return "analysis";
  }
  if (typeof window === "undefined") {
    return "chat";
  }
  const fromHash = readCoachPanelParamFromHash(getAppPath());
  if (fromHash && fromHash !== "analysis") return fromHash;
  try {
    const v = sessionStorage.getItem(DAECHI_COACH_INITIAL_PANEL_KEY);
    if (v === "plan" || v === "chat" || v === "admin") return v;
  } catch {
    // ignore
  }
  return "chat";
}

function formatCoachLogDateKey(raw: string | undefined | null): string {
  return seoulDateKeyFromApiValue(raw ?? "");
}

function formatMinutesAsHourLabel(minutes: number | null | undefined): string {
  const value = Number(minutes);
  if (!Number.isFinite(value) || value <= 0) return "0시간";
  const hours = value / 60;
  if (hours >= 10) return `${Math.round(hours)}시간`;
  return `${hours.toFixed(1).replace(/\.0$/, "")}시간`;
}

function AnalysisInsightCard(props: {
  title: string;
  severity: string;
  headline: string;
  evidence: string;
  action: string;
}) {
  return (
    <Card className="coach-card coach-card--padded coach-analysis-insight">
      <div className="coach-analysis-insight__top">
        <div>
          <div className="coach-analysis-insight__eyebrow">
            {renderAnalysisIcon("insight", "coach-analysis-icon coach-analysis-icon--eyebrow")}
            <span>AI 인사이트</span>
          </div>
          <div className="coach-analysis-insight__title">{props.title}</div>
        </div>
        <span className={"coach-badge " + (props.severity === "높음" ? "coach-badge--danger" : props.severity === "보통" ? "coach-badge--warn" : "coach-badge--ok")}>
          {props.severity}
        </span>
      </div>
      <div className="coach-analysis-insight__headline">{props.headline}</div>
      <div className="coach-analysis-insight__body">{props.evidence}</div>
      <div className="coach-analysis-insight__action">
        {renderAnalysisIcon("action", "coach-analysis-icon coach-analysis-icon--action")}
        <span>{props.action}</span>
      </div>
    </Card>
  );
}

type MetricTone = "neutral" | "good" | "warn";

type AnalysisMetricRow = {
  key: string;
  title: string;
  value: string;
  hint?: string;
  tone?: MetricTone;
};

type StudyRoomSeriesRow = {
  date: string;
  minutes: number;
  visitCount: number;
};

type StudyRoomSummary = {
  weeklyMinutes?: number;
  activeDays?: number;
  visitCount?: number;
  averageVisitMinutes?: number | null;
  currentStatus?: string;
  currentRoomName?: string | null;
  currentHeartbeatAt?: string | null;
  consistencyLabel?: string;
  consistencyHint?: string;
  series?: StudyRoomSeriesRow[];
};

type SnapshotAnalysis = {
  statusLabel?: string;
  headline?: string;
  body?: string;
  recommendedAction?: string;
  focusMetricKey?: string;
  highlightMetrics?: AnalysisMetricRow[];
};

function renderAnalysisIcon(key: string, className = "coach-analysis-icon") {
  switch (key) {
    case "sleepHours":
      return <BedDouble className={className} aria-hidden />;
    case "concentration":
      return <Brain className={className} aria-hidden />;
    case "studyRoomMinutes":
      return <Building2 className={className} aria-hidden />;
    case "planCompletionRate":
      return <Target className={className} aria-hidden />;
    case "trend":
      return <TrendingUp className={className} aria-hidden />;
    case "action":
      return <Lightbulb className={className} aria-hidden />;
    default:
      return <Sparkles className={className} aria-hidden />;
  }
}

function buildFallbackAnalysis(
  snapshot: RemoteCoachState["snapshot"] | undefined,
  rows: RhythmChartRow[],
  studyRoom: StudyRoomSummary | undefined
): SnapshotAnalysis {
  const metrics = snapshot?.metrics;
  const totalStudyMinutes = rows.reduce(
    (sum, row) => sum + (row.studyMinutes != null ? row.studyMinutes : 0),
    0
  );
  const studyRoomMinutes =
    studyRoom?.weeklyMinutes != null && Number.isFinite(Number(studyRoom.weeklyMinutes))
      ? Number(studyRoom.weeklyMinutes)
      : 0;
  const sleep = metrics?.sleepHours ?? null;
  const concentrationPercent =
    metrics?.concentration != null
      ? Math.round((Number(metrics.concentration) / 5) * 100)
      : null;
  const planCompletion =
    metrics?.planCompletionRate != null
      ? Math.round(Number(metrics.planCompletionRate))
      : null;

  const highlightMetrics: AnalysisMetricRow[] = [];
  if (sleep != null && Number.isFinite(Number(sleep))) {
    highlightMetrics.push({
      key: "sleepHours",
      title: "수면",
      value: `${Number(sleep).toFixed(1)}시간`,
      hint:
        Number(sleep) >= 6.5
          ? "회복 리듬이 유지되고 있어요"
          : "수면이 짧아 집중 회복이 늦을 수 있어요",
      tone: Number(sleep) >= 6.5 ? "good" : "warn"
    });
  }
  if (concentrationPercent != null && Number.isFinite(concentrationPercent)) {
    highlightMetrics.push({
      key: "concentration",
      title: "집중",
      value: `${concentrationPercent}%`,
      hint:
        concentrationPercent >= 70
          ? "집중 흐름이 비교적 안정적이에요"
          : "시작 마찰을 줄이면 더 좋아질 수 있어요",
      tone: concentrationPercent >= 70 ? "good" : "warn"
    });
  }
  highlightMetrics.push({
    key: "studyRoomMinutes",
    title: "독서실 체류",
    value: formatMinutesAsHourLabel(studyRoomMinutes),
    hint:
      studyRoomMinutes > 0
        ? `${studyRoom?.activeDays ?? 0}일 방문 · ${studyRoom?.consistencyLabel ?? "환경 기록"}`
        : "이번 주 체류 기록이 아직 없어요",
    tone: studyRoomMinutes > 0
      ? Number(studyRoom?.activeDays ?? 0) >= 3
        ? "good"
        : "neutral"
      : "warn"
  });
  if (planCompletion != null && highlightMetrics.length < 3) {
    highlightMetrics.push({
      key: "planCompletionRate",
      title: "계획 완료",
      value: `${planCompletion}%`,
      hint:
        planCompletion >= 65
          ? "실행률이 유지되고 있어요"
          : "해야 할 일을 더 줄이는 편이 좋아요",
      tone: planCompletion >= 65 ? "good" : "warn"
    });
  }

  const hasStudyRoomGap =
    studyRoomMinutes >= 240 &&
    totalStudyMinutes > 0 &&
    totalStudyMinutes < studyRoomMinutes * 0.45;

  return {
    statusLabel: hasStudyRoomGap ? "실행 연결 필요" : "리듬 점검",
    headline:
      snapshot?.heroNarrative ||
      "이번 주 흐름을 한 번 더 정리하면 더 좋아질 구간이 보여요.",
    body: hasStudyRoomGap
      ? `독서실 체류 ${formatMinutesAsHourLabel(studyRoomMinutes)}, 기록 공부 ${formatMinutesAsHourLabel(totalStudyMinutes)}예요. 환경은 확보됐으니 시작 루틴 연결이 핵심입니다.`
      : studyRoomMinutes > 0
        ? `${studyRoom?.consistencyHint || "독서실 체류 흐름을 함께 보고 있어요."}`
        : "핵심 지표를 1~2개만 집중해서 보면 현재 상태를 더 빠르게 읽을 수 있어요.",
    recommendedAction:
      snapshot?.nextActions?.[0] || "첫 블록은 25분만 시작하기",
    focusMetricKey: hasStudyRoomGap
      ? "studyRoomMinutes"
      : studyRoomMinutes > 0
        ? "studyMinutes"
        : "sleepHours",
    highlightMetrics: highlightMetrics.slice(0, 3)
  };
}

function toInsightCopy(pattern: AiPatternRow) {
  return {
    headline: pattern.headline || pattern.explanation,
    evidence: pattern.evidence || pattern.explanation,
    action: pattern.action || pattern.recommendation
  };
}

type RemoteCoachLogRow = {
  date: string;
  sleepHours: number | null;
  concentrationScore: number | null;
  stressScore: number | null;
  steps: number | null;
  planCompletionRate: number | null;
  studyMinutes: number | null;
};

function numOrNull(a: unknown, b?: unknown): number | null {
  const n = Number(a ?? b);
  return Number.isFinite(n) ? n : null;
}

/** coach/state 응답이 camelCase가 아닐 때(프록시·구버전)에도 그래프에 매칭되게 */
function normalizeRemoteCoachLog(raw: unknown): RemoteCoachLogRow | null {
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

type AiPatternRow = {
  key: string;
  title: string;
  severity: string;
  explanation: string;
  recommendation: string;
  headline?: string;
  evidence?: string;
  action?: string;
};

const STUDENT_COACH_CACHE_TTL_MS = 2 * 60 * 1000;

type RemoteCoachState = {
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
    analysis?: SnapshotAnalysis;
  };
  studyRoom?: StudyRoomSummary;
  logs?: RemoteCoachLogRow[];
};

function normalizeCachedRemoteCoachState(raw: unknown): RemoteCoachState | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as RemoteCoachState & { logs?: unknown[]; studyRoom?: { series?: unknown[] } };
  return {
    ...data,
    studyRoom: data.studyRoom
      ? {
          ...data.studyRoom,
          series: Array.isArray(data.studyRoom.series)
            ? data.studyRoom.series
                .map(item => {
                  if (!item || typeof item !== "object") return null;
                  const row = item as Record<string, unknown>;
                  const date = formatCoachLogDateKey(String(row.date ?? ""));
                  if (!date) return null;
                  return {
                    date,
                    minutes: Number(row.minutes ?? 0) || 0,
                    visitCount: Number(row.visitCount ?? 0) || 0
                  } satisfies StudyRoomSeriesRow;
                })
                .filter((row): row is StudyRoomSeriesRow => row != null)
            : []
        }
      : undefined,
    logs: Array.isArray(data.logs)
      ? data.logs
          .map(normalizeRemoteCoachLog)
          .filter((row): row is RemoteCoachLogRow => row != null)
      : []
  };
}

function normalizeCachedPatternRows(raw: unknown): AiPatternRow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is AiPatternRow => {
      if (!item || typeof item !== "object") return false;
      const row = item as Record<string, unknown>;
      return ["key", "title", "severity", "explanation", "recommendation"].every(
        field => typeof row[field] === "string"
      );
    })
    .map(item => ({ ...item }));
}

/** DB 코치 로그 → 최근 7일(오늘-6 ~ 오늘) 리듬 그래프용 포인트 (없는 날은 null) */
type RhythmChartRow = {
  date: string;
  concentration: number | null;
  studyMinutes: number | null;
  studyRoomMinutes: number | null;
  sleepHours: number | null;
  stressScore: number | null;
  planCompletionRate: number | null;
};

function buildRhythmChartRowsFromLogs(
  apiLogs: RemoteCoachLogRow[] | undefined,
  studyRoomSeries?: StudyRoomSeriesRow[]
): RhythmChartRow[] {
  const recent7Days = Array.from({ length: 7 }).map((_, idx) =>
    getDateKeySeoul(idx - 6)
  );
  const byDate = new Map<string, RemoteCoachLogRow>();
  const studyRoomByDate = new Map<string, StudyRoomSeriesRow>();
  for (const row of apiLogs || []) {
    const k = formatCoachLogDateKey(row.date);
    if (k && !byDate.has(k)) byDate.set(k, row);
  }
  for (const row of studyRoomSeries || []) {
    const k = formatCoachLogDateKey(row.date);
    if (k && !studyRoomByDate.has(k)) studyRoomByDate.set(k, row);
  }
  return recent7Days.map(dateKey => {
    const r = byDate.get(dateKey);
    const stay = studyRoomByDate.get(dateKey);
    if (!r) {
      return {
        date: dateKey,
        concentration: null,
        studyMinutes: null,
        studyRoomMinutes: stay?.minutes ?? null,
        sleepHours: null,
        stressScore: null,
        planCompletionRate: null
      };
    }
    const concRaw =
      r.concentrationScore != null && Number.isFinite(Number(r.concentrationScore))
        ? Number(r.concentrationScore)
        : null;
    const concentration =
      concRaw == null ? null : Math.round((concRaw / 5) * 100);
    const sleep =
      r.sleepHours != null && Number.isFinite(Number(r.sleepHours))
        ? Number(r.sleepHours)
        : null;
    const stress =
      r.stressScore != null && Number.isFinite(Number(r.stressScore))
        ? Number(r.stressScore)
        : null;
    const study =
      r.studyMinutes != null && Number.isFinite(Number(r.studyMinutes))
        ? Number(r.studyMinutes)
        : null;
    const plan =
      r.planCompletionRate != null &&
      Number.isFinite(Number(r.planCompletionRate))
        ? Number(r.planCompletionRate)
        : null;
    return {
      date: dateKey,
      concentration,
      studyMinutes: study,
      studyRoomMinutes:
        stay?.minutes != null && Number.isFinite(Number(stay.minutes))
          ? Number(stay.minutes)
          : null,
      sleepHours: sleep,
      stressScore: stress,
      planCompletionRate: plan
    };
  });
}

type RhythmMetricKey = Exclude<keyof RhythmChartRow, "date">;

/** Recharts 3 Line은 값이 드물 때 점/선이 안 그려지는 경우가 있어 SVG로 고정 렌더 */
function CoachRhythmSparkline(props: {
  rows: RhythmChartRow[];
  dataKey: RhythmMetricKey;
  yDomain: [number, number];
  valueFormatter: (v: number) => string;
}) {
  const { rows, dataKey, yDomain, valueFormatter } = props;
  const w = 308;
  const h = 168;
  const padL = 36;
  const padR = 6;
  const padT = 8;
  const padB = 36;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;
  const [yMin, yMax] = yDomain;
  const ySpan = Math.max(yMax - yMin, 1e-6);
  const n = Math.max(rows.length, 1);

  const pts = rows.map((row, i) => {
    const raw = row[dataKey];
    const v =
      raw == null || !Number.isFinite(Number(raw)) ? null : Number(raw);
    const x = padL + (innerW * (i + 0.5)) / n;
    const y = v == null ? null : padT + innerH * (1 - (v - yMin) / ySpan);
    return { x, y, v, date: row.date };
  });

  const pathSegments: string[] = [];
  const validPoints = pts
    .filter((point): point is { x: number; y: number; v: number; date: string } => point.y != null && point.v != null);
  const shouldRenderSinglePoint = validPoints.length === 1;

  if (validPoints.length === 1) {
    const point = validPoints[0];
    pathSegments.push(`M ${point.x} ${point.y}`);
  } else if (validPoints.length > 1) {
    let d = `M ${validPoints[0].x} ${validPoints[0].y}`;
    for (let index = 0; index < validPoints.length - 1; index += 1) {
      const current = validPoints[index];
      const next = validPoints[index + 1];
      const midX = (current.x + next.x) / 2;
      const midY = (current.y + next.y) / 2;
      d += ` Q ${current.x} ${current.y} ${midX} ${midY}`;
    }
    const last = validPoints[validPoints.length - 1];
    d += ` T ${last.x} ${last.y}`;
    pathSegments.push(d);
  }

  const labelShort = (dateKey: string) => String(dateKey).replace(/^\d{4}-/, "");

  return (
    <svg
      width="100%"
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="최근 7일 리듬"
      style={{ display: "block", maxWidth: "100%", minWidth: 280 }}
    >
      {[0, 0.5, 1].map(t => {
        const gy = padT + innerH * (1 - t);
        return (
          <line
            key={t}
            x1={padL}
            y1={gy}
            x2={padL + innerW}
            y2={gy}
            stroke="rgba(var(--neutral-rgb), 0.35)"
            strokeWidth={1}
          />
        );
      })}
      <text
        x={2}
        y={padT + 11}
        fontSize="var(--font-size-small)"
        fill="rgba(var(--neutral-rgb), 0.95)"
      >
        {yMax}
      </text>
      <text
        x={2}
        y={padT + innerH + 2}
        fontSize="var(--font-size-small)"
        fill="rgba(var(--neutral-rgb), 0.95)"
      >
        {yMin}
      </text>
      {pathSegments.map((d, i) => (
        <motion.path
          key={`seg-${i}`}
          d={d}
          fill="none"
          stroke="currentColor"
          strokeWidth={2.75}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0, opacity: 0.35 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 0.7, ease: "easeOut", delay: i * 0.04 }}
        />
      ))}
      {shouldRenderSinglePoint
        ? pts.map((p, i) =>
            p.v != null && p.y != null ? (
          <motion.circle
            key={`dot-${i}`}
            cx={p.x}
            cy={p.y}
            r={2}
            fill="currentColor"
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.24, ease: "easeOut", delay: 0.35 + i * 0.035 }}
          >
            <title>{`${labelShort(p.date)} · ${valueFormatter(p.v)}`}</title>
          </motion.circle>
            ) : null
          )
        : null}
      {pts.map((p, i) => {
        if (i % 2 !== 0 && i !== pts.length - 1) return null;
        return (
          <text
            key={`lbl-${i}`}
            x={p.x}
            y={h - 10}
            textAnchor="middle"
            fontSize="var(--font-size-small)"
            fill="rgba(var(--neutral-rgb), 0.95)"
          >
            {labelShort(p.date)}
          </text>
        );
      })}
    </svg>
  );
}

type SnapshotMetrics = NonNullable<RemoteCoachState["snapshot"]>["metrics"];

function riskLevelFromSnapshotMetrics(m: SnapshotMetrics | undefined): Severity {
  if (!m) return "낮음";
  const stress = Number(m.stress ?? 0);
  const plan =
    m.planCompletionRate != null && Number.isFinite(Number(m.planCompletionRate))
      ? Number(m.planCompletionRate)
      : null;
  const sleep =
    m.sleepHours != null && Number.isFinite(Number(m.sleepHours))
      ? Number(m.sleepHours)
      : null;
  if (stress >= 4 && plan != null && plan < 45) return "높음";
  if (stress >= 3.8) return "높음";
  if (plan != null && plan < 55 && sleep != null && sleep < 6) return "보통";
  if (stress >= 3.2 || (plan != null && plan < 60)) return "보통";
  return "낮음";
}

function CoachStudentUnified(props: {
  apiToken: string;
  entryTab: StudentTabKey;
  apiScope?: "student" | "parent";
  parentStudentId?: number | null;
  analysisActionTextOverride?: string;
  onLayoutModeChange?: (mode: "scroll" | "chat") => void;
  blocks?: StudyBlock[];
  progressBooks?: ProgressBook[];
  tomorrowPlan?: ProgressPlan;
  todayStudyEvaluation?: string;
  todayMetacognitionReflection?: string;
  todayMemo?: string;
  draftTomorrowPractice?: string;
  todayStudyMinutes?: number | null;
  onApplyTomorrowPlanAndGoRecords?: (next: ProgressPlan) => Promise<boolean>;
  onApplyTomorrowPracticeAndGoRecords?: (text: string) => Promise<boolean>;
}) {
  const token = props.apiToken;
  const apiScope = props.apiScope === "parent" ? "parent" : "student";
  const actionLabel = apiScope === "parent" ? "지금 추천하는 한마디" : "지금 추천하는 한 가지";
  const scopedStudentId =
    apiScope === "parent" && Number.isFinite(Number(props.parentStudentId))
      ? Number(props.parentStudentId)
      : null;
  const isStandaloneAnalysis = props.entryTab === "analysis";
  const [panel, setPanel] = useState<CoachPanelKey>(() =>
    readInitialCoachPanelFromWindow(props.entryTab)
  );
  const prevEntryTabRef = useRef<StudentTabKey | null>(null);

  /** `?panel=` / sessionStorage만 반영. URL은 사용자가 세그먼트를 누를 때까지 유지(Strict Mode 재마운트·hashchange 오동작 방지). */
  const tryApplyCoachPanelDeepLink = useCallback((): boolean => {
    if (typeof window === "undefined") return false;
    const h = getAppPath();
    const fromHash = readCoachPanelParamFromHash(h);
    if (fromHash) {
      setPanel(fromHash);
      try {
        sessionStorage.removeItem(DAECHI_COACH_INITIAL_PANEL_KEY);
      } catch {
        // ignore
      }
      return true;
    }
    try {
      const v = sessionStorage.getItem(DAECHI_COACH_INITIAL_PANEL_KEY);
      if (v === "plan" || v === "analysis" || v === "chat" || v === "admin") {
        sessionStorage.removeItem(DAECHI_COACH_INITIAL_PANEL_KEY);
        setPanel(v);
        return true;
      }
    } catch {
      // ignore
    }
    return false;
  }, []);

  const selectCoachPanel = useCallback((next: CoachPanelKey) => {
    if (typeof window !== "undefined") {
      const h = getAppPath();
      const stripped = stripCoachPanelParamFromHash(h);
      if (stripped !== h) {
        replaceAppPath(stripped);
      }
    }
    setPanel(next);
  }, []);

  const openScheduleManagerInCoachChat = useCallback(() => {
    try {
      sessionStorage.setItem(DAECHI_COACH_CHAT_STARTER_KEY, "schedule");
    } catch {
      // ignore
    }
    selectCoachPanel("chat");
  }, [selectCoachPanel]);

  useLayoutEffect(() => {
    if (isStandaloneAnalysis) {
      prevEntryTabRef.current = props.entryTab;
      return;
    }
    if (tryApplyCoachPanelDeepLink()) {
      prevEntryTabRef.current = props.entryTab;
      return;
    }
    if (prevEntryTabRef.current === null) {
      prevEntryTabRef.current = props.entryTab;
      return;
    }
    if (prevEntryTabRef.current !== props.entryTab) {
      prevEntryTabRef.current = props.entryTab;
      setPanel("analysis");
    }
  }, [props.entryTab, tryApplyCoachPanelDeepLink]);

  useEffect(() => {
    if (!isStandaloneAnalysis && panel === "analysis") {
      setPanel("chat");
    }
  }, [isStandaloneAnalysis, panel]);

  useEffect(() => {
    const onHash = () => {
      tryApplyCoachPanelDeepLink();
    };
    return subscribeAppPathChange(onHash);
  }, [tryApplyCoachPanelDeepLink]);

  useEffect(() => {
    props.onLayoutModeChange?.(
      panel === "chat" || panel === "plan" || panel === "admin"
        ? "chat"
        : "scroll"
    );
  }, [panel, props.onLayoutModeChange]);
  const activeStudentId = useCoachStore(s => s.activeStudentId);
  const student = useMemo(
    () => demoStudents.find(s => s.id === activeStudentId) || demoStudents[0],
    [activeStudentId]
  );
  const recentWeekStart = getDateKeySeoul(-6);
  const coachCacheScope =
    apiScope === "parent" && scopedStudentId
      ? `${readStoredUserCacheScope()}:parent:${scopedStudentId}`
      : readStoredUserCacheScope();
  const coachStateCacheKey = buildStudentCoachStateCacheKey(
    coachCacheScope,
    recentWeekStart
  );
  const coachPatternsCacheKey = buildStudentCoachPatternsCacheKey(
    coachCacheScope,
    recentWeekStart
  );
  const [remote, setRemote] = useState<RemoteCoachState | null>(() =>
    normalizeCachedRemoteCoachState(
      readLocalCache<unknown>(
        buildStudentCoachStateCacheKey(readStoredUserCacheScope(), getDateKeySeoul(-6)),
        STUDENT_COACH_CACHE_TTL_MS
      )?.value
    )
  );
  const [aiPatterns, setAiPatterns] = useState<AiPatternRow[]>(() =>
    normalizeCachedPatternRows(
      readLocalCache<unknown>(
        buildStudentCoachPatternsCacheKey(readStoredUserCacheScope(), getDateKeySeoul(-6)),
        STUDENT_COACH_CACHE_TTL_MS
      )?.value
    )
  );
  const [patternsLoading, setPatternsLoading] = useState(false);
  const [patternsError, setPatternsError] = useState<string | null>(null);
  const [patternsUsedOpenAi, setPatternsUsedOpenAi] = useState(false);
  const coachStateFetchRef = useRef<AbortController | null>(null);
  const patternFetchRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!token) return;
    const cachedState = normalizeCachedRemoteCoachState(
      readLocalCache<unknown>(coachStateCacheKey, STUDENT_COACH_CACHE_TTL_MS)?.value
    );
    if (cachedState) {
      setRemote(cachedState);
    }
    const cachedPatterns = normalizeCachedPatternRows(
      readLocalCache<unknown>(coachPatternsCacheKey, STUDENT_COACH_CACHE_TTL_MS)?.value
    );
    if (cachedPatterns.length > 0) {
      setAiPatterns(cachedPatterns);
    }
  }, [token, coachPatternsCacheKey, coachStateCacheKey]);

  const refreshCoachHomeData = useCallback(() => {
    if (!token) return;
    if (apiScope === "parent" && !scopedStudentId) return;
    coachStateFetchRef.current?.abort();
    const ac = new AbortController();
    coachStateFetchRef.current = ac;
    const weekStart = encodeURIComponent(recentWeekStart);
    const query = `weekStart=${weekStart}${
      apiScope === "parent" && scopedStudentId ? `&studentId=${encodeURIComponent(String(scopedStudentId))}` : ""
    }`;
    fetch(`${API_BASE}/api/${apiScope}/coach/state?${query}`, {
      signal: ac.signal,
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(r => {
        if (ac.signal.aborted) return Promise.reject(new DOMException("aborted", "AbortError"));
        return r.ok ? r.json() : Promise.reject(new Error("coach state fetch failed"));
      })
      .then(data => {
        if (ac.signal.aborted) return;
        const d = data as RemoteCoachState;
        const rawLogs = Array.isArray(d.logs) ? d.logs : [];
        const nextState = {
          ...d,
          logs: rawLogs
            .map(normalizeRemoteCoachLog)
            .filter((x): x is RemoteCoachLogRow => x != null)
        };
        setRemote(nextState);
        writeLocalCache(coachStateCacheKey, nextState);
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        if (ac.signal.aborted) return;
      });
  }, [token, coachStateCacheKey, recentWeekStart, apiScope, scopedStudentId]);

  const refreshPatternInsights = useCallback(() => {
    if (!token) return;
    if (apiScope === "parent" && !scopedStudentId) return;
    patternFetchRef.current?.abort();
    const ac = new AbortController();
    patternFetchRef.current = ac;
    setPatternsLoading(true);
    setPatternsError(null);
    const weekStart = encodeURIComponent(recentWeekStart);
    const query = `weekStart=${weekStart}${
      apiScope === "parent" && scopedStudentId ? `&studentId=${encodeURIComponent(String(scopedStudentId))}` : ""
    }`;
    fetch(`${API_BASE}/api/${apiScope}/coach/pattern-insights?${query}`, {
      signal: ac.signal,
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(async r => {
        if (ac.signal.aborted) return;
        const data = await r.json().catch(() => ({}));
        if (ac.signal.aborted) return;
        if (!r.ok) {
          setPatternsError(String((data as { error?: string }).error || "").trim() || "패턴을 불러오지 못했습니다.");
          setAiPatterns([]);
          setPatternsUsedOpenAi(false);
          return;
        }
        setPatternsUsedOpenAi(Boolean((data as { usedOpenAi?: boolean }).usedOpenAi));
        const list = (data as { patterns?: AiPatternRow[] }).patterns;
        const nextPatterns = Array.isArray(list) ? list : [];
        setAiPatterns(nextPatterns);
        writeLocalCache(coachPatternsCacheKey, nextPatterns);
        setPatternsError(null);
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        if (ac.signal.aborted) return;
        setPatternsError("네트워크 오류로 패턴을 불러오지 못했습니다.");
        setPatternsUsedOpenAi(false);
      })
      .finally(() => {
        if (!ac.signal.aborted) {
          setPatternsLoading(false);
        }
      });
  }, [token, coachPatternsCacheKey, recentWeekStart, apiScope, scopedStudentId]);

  useEffect(() => {
    if (!token) {
      setRemote(null);
      setAiPatterns([]);
      setPatternsError(null);
      setPatternsUsedOpenAi(false);
      setPatternsLoading(false);
      return;
    }
    let cancelled = false;
    const runState = () => {
      if (cancelled) return;
      refreshCoachHomeData();
    };
    const runPatterns = () => {
      if (cancelled) return;
      refreshPatternInsights();
    };
    runState();
    runPatterns();
    const onLogSaved = () => {
      if (cancelled) return;
      runState();
      runPatterns();
    };
    const onVisible = () => {
      if (cancelled || document.visibilityState !== "visible") return;
      runState();
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key !== DAECHI_COACH_LOG_SAVED_STORAGE_KEY || cancelled) return;
      runState();
      runPatterns();
    };
    window.addEventListener(DAECHI_COACH_LOG_SAVED_EVENT, onLogSaved);
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      coachStateFetchRef.current?.abort();
      patternFetchRef.current?.abort();
      window.removeEventListener(DAECHI_COACH_LOG_SAVED_EVENT, onLogSaved);
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [token, refreshCoachHomeData, refreshPatternInsights]);

  const displayPatterns = useMemo((): AiPatternRow[] => {
    return aiPatterns;
  }, [aiPatterns]);

  const rhythmChartData = useMemo((): RhythmChartRow[] => {
    if (!token || !remote) return buildRhythmChartRowsFromLogs(undefined);
    return buildRhythmChartRowsFromLogs(remote.logs, remote.studyRoom?.series);
  }, [token, remote]);

  const studyMinutesMax = useMemo(() => {
    const nums = rhythmChartData
      .map(r => r.studyMinutes)
      .filter((n): n is number => n != null && Number.isFinite(n));
    return Math.max(240, nums.length ? Math.max(...nums) : 0);
  }, [rhythmChartData]);

  const studyRoomMinutesMax = useMemo(() => {
    const nums = rhythmChartData
      .map(r => r.studyRoomMinutes)
      .filter((n): n is number => n != null && Number.isFinite(n));
    return Math.max(180, nums.length ? Math.max(...nums) : 0);
  }, [rhythmChartData]);

  const weeklyCharts = useMemo(
    () =>
      [
        {
          key: "sleep",
          title: "수면 패턴",
          dataKey: "sleepHours" as const,
          color: "var(--accent-strong)",
          yDomain: [0, 10] as [number, number],
          tooltipLabel: "수면 시간",
          valueFormatter: (v: number) => `${v.toFixed(1)}시간`
        },
        {
          key: "concentration",
          title: "학습 집중도",
          dataKey: "concentration" as const,
          color: "var(--accent-strong)",
          yDomain: [0, 100] as [number, number],
          tooltipLabel: "집중도",
          valueFormatter: (v: number) => `${Math.round(v)}%`
        },
        {
          key: "studyMinutes",
          title: "공부 시간",
          dataKey: "studyMinutes" as const,
          color: "var(--accent-strong)",
          yDomain: [0, studyMinutesMax] as [number, number],
          tooltipLabel: "공부 시간(분)",
          valueFormatter: (v: number) => `${Math.round(v)}분`
        },
        {
          key: "planCompletionRate",
          title: "목표 달성률",
          dataKey: "planCompletionRate" as const,
          color: "var(--accent-strong)",
          yDomain: [0, 100] as [number, number],
          valueFormatter: (v: number) => `${Math.round(v)}%`
        },
        {
          key: "studyRoomMinutes",
          title: "독서실 체류",
          dataKey: "studyRoomMinutes" as const,
          color: "var(--accent-strong)",
          yDomain: [0, studyRoomMinutesMax] as [number, number],
          valueFormatter: (v: number) => `${Math.round(v)}분`
        }
      ] as const,
    [studyMinutesMax, studyRoomMinutesMax]
  );
  const availableCharts = weeklyCharts;

  const [selectedTrendKey, setSelectedTrendKey] = useState<string>("");

  const heroNarrative = token
    ? remote?.snapshot?.heroNarrative ||
      "현재 학습 흐름은 유지되고 있어요. 오늘은 우선순위 한 가지부터 시작해 보세요."
    : "로그인하고 오늘 공부 탭에서 기록을 남기면 맞춤 요약과 그래프가 표시돼요.";
  const profile = remote?.snapshot?.profile;
  const analysis = useMemo(
    () =>
      remote?.snapshot?.analysis ||
      buildFallbackAnalysis(remote?.snapshot, rhythmChartData, remote?.studyRoom),
    [remote?.snapshot, remote?.studyRoom, rhythmChartData]
  );
  const selectedChart =
    availableCharts.find(chart => chart.key === selectedTrendKey) || availableCharts[0] || null;
  const highlightMetrics = analysis.highlightMetrics || [];

  useEffect(() => {
    const preferredKey = analysis.focusMetricKey || availableCharts[0]?.key || "sleep";
    if (!selectedTrendKey || !availableCharts.some(chart => chart.key === selectedTrendKey)) {
      setSelectedTrendKey(preferredKey);
    }
  }, [analysis.focusMetricKey, availableCharts, selectedTrendKey]);

  /** 로그인 시 데모(현우) 이름이 잠깐 보였다가 서버 기본값으로 바뀌는 깜빡임 방지 */
  const displayName = token
    ? remote
      ? String(profile?.name ?? "").trim() || "학생"
      : "학생"
    : profile?.name || student.name;

  const analysisContent = (
    <>
      <Card className="coach-card coach-card--padded coach-analysis-hero">
        <div className="coach-home-insight-card__top">
          <span className="coach-home-insight-card__eyebrow coach-home-insight-card__eyebrow--icon">
            {renderAnalysisIcon("insight", "coach-analysis-icon coach-analysis-icon--eyebrow")}
            <span>오늘의 학습 상태</span>
          </span>
        </div>
        <div className="coach-analysis-hero__title">
          {displayName}님은 {analysis.statusLabel || "리듬 점검"} 상태예요
        </div>
        <p className="coach-home-insight-card__body">{analysis.headline || heroNarrative}</p>
        <div className="coach-analysis-hero__action-box">
          <div className="coach-analysis-hero__action-label">
            {renderAnalysisIcon("action", "coach-analysis-icon coach-analysis-icon--action-label")}
            <span>{actionLabel}</span>
          </div>
          <div className="coach-analysis-hero__action-text">
            {String(props.analysisActionTextOverride || "").trim() ||
              analysis.recommendedAction ||
              "오늘 할 일 한 가지부터 시작해 보세요."}
          </div>
        </div>
      </Card>

      {highlightMetrics.length > 0 ? (
        <div className="coach-grid coach-analysis-metric-grid">
          {highlightMetrics.map(metric => (
            <MetricCard
              key={metric.key}
              title={metric.title}
              value={metric.value}
              hint={metric.hint}
              tone={metric.tone}
              icon={renderAnalysisIcon(metric.key)}
            />
          ))}
        </div>
      ) : null}

      <Card className="coach-card coach-card--padded coach-analysis-trend-card">
        <SectionHeader title={selectedChart?.title || "이번 주 변화"} />
        <div className="coach-analysis-trend-tabs" role="tablist" aria-label="분석 추세 지표 선택">
          {availableCharts.map(chart => (
            <button
              key={chart.key}
              type="button"
              role="tab"
              aria-selected={selectedTrendKey === chart.key}
              className={
                "coach-analysis-trend-tab" +
                (selectedTrendKey === chart.key ? " coach-analysis-trend-tab--active" : "")
              }
              onClick={() => setSelectedTrendKey(chart.key)}
            >
              {renderAnalysisIcon(chart.key, "coach-analysis-icon coach-analysis-icon--tab")}
              <span>{chart.title}</span>
            </button>
          ))}
        </div>
        {selectedChart ? (
          <div className="coach-chart coach-analysis-trend-card__chart" style={{ color: selectedChart.color }}>
            <CoachRhythmSparkline
              key={selectedChart.key}
              rows={rhythmChartData}
              dataKey={selectedChart.dataKey}
              yDomain={selectedChart.yDomain}
              valueFormatter={selectedChart.valueFormatter}
            />
          </div>
        ) : (
          <p className="coach-muted" style={{ marginTop: 10 }}>
            추세를 보여줄 기록이 아직 충분하지 않아요.
          </p>
        )}
      </Card>

      <div className="coach-stack">
        <SectionHeader title="AI가 본 이번 주 패턴" />
        {patternsLoading && (
          <p
            className="coach-muted"
            style={{ padding: "0 4px 10px", fontSize: "var(--font-size-medium)" }}
          >
            {displayPatterns.length > 0
              ? "최신 패턴으로 동기화하는 중…"
              : "이번 주 기록을 바탕으로 패턴을 분석하는 중…"}
          </p>
        )}
        {!patternsLoading && patternsError && token && (
          <p
            className="coach-muted"
            style={{ padding: "0 4px 10px", fontSize: "var(--font-size-medium)" }}
          >
            {patternsError}
          </p>
        )}
        {displayPatterns.length > 0 ? (
          <div className="coach-pattern-grid coach-analysis-insight-grid">
            {displayPatterns.map(p => (
              <AnalysisInsightCard
                key={p.key}
                title={p.title}
                severity={p.severity}
                headline={toInsightCopy(p).headline}
                evidence={toInsightCopy(p).evidence}
                action={toInsightCopy(p).action}
              />
            ))}
          </div>
        ) : (
          !patternsLoading && (
            <EmptyState
              title="표시할 패턴이 없어요"
              body={
                !token
                  ? "로그인하면 저장된 이번 주 기록을 바탕으로 패턴을 불러옵니다."
                  : patternsError
                    ? undefined
                    : !patternsUsedOpenAi
                      ? "서버에 OPENAI_API_KEY가 설정되어 있어야 이번 주 DB 기록으로 AI 패턴 분석이 됩니다."
                      : "이번 주 오늘 공부 탭 기록을 더 남기면 분석이 풍부해져요."
              }
            />
          )
        )}
      </div>
    </>
  );

  const coachShellContent = (
    <>
      <div
        className="store-filter-row coach-subtab-row"
        role="tablist"
        aria-label="코치 구분"
      >
        <button
          type="button"
          role="tab"
          aria-selected={panel === "plan"}
          className={
            "store-filter-btn" +
            (panel === "plan" ? " store-filter-btn--active" : "")
          }
          onClick={() => selectCoachPanel("plan")}
        >
          계획
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={panel === "chat"}
          className={
            "store-filter-btn" +
            (panel === "chat" ? " store-filter-btn--active" : "")
          }
          onClick={() => selectCoachPanel("chat")}
        >
          학습 코칭
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={panel === "admin"}
          className={
            "store-filter-btn" +
            (panel === "admin" ? " store-filter-btn--active" : "")
          }
          onClick={() => selectCoachPanel("admin")}
        >
          관리자 1:1
        </button>
      </div>

      <TabTransitionPanel
        tabKey={panel}
        className={
          panel === "chat" || panel === "plan" || panel === "admin"
            ? "coach-shell__tab-panel coach-unified-tab-panel--fill"
            : "coach-unified-tab-panel"
        }
      >
        {panel === "plan" ? (
          props.blocks != null &&
          props.progressBooks != null &&
          props.tomorrowPlan != null &&
          props.onApplyTomorrowPlanAndGoRecords != null &&
          props.onApplyTomorrowPracticeAndGoRecords != null ? (
            <CoachTomorrowPlanCollab
              apiToken={token}
              blocks={props.blocks}
              progressBooks={props.progressBooks}
              tomorrowPlan={props.tomorrowPlan}
              studyEvaluation={props.todayStudyEvaluation ?? ""}
              metacognitionReflection={props.todayMetacognitionReflection ?? ""}
              todayMemo={props.todayMemo ?? ""}
              draftTomorrowPractice={props.draftTomorrowPractice ?? ""}
              todayStudyMinutes={props.todayStudyMinutes ?? null}
              onOpenScheduleManager={openScheduleManagerInCoachChat}
              onApplyAndReturnToRecords={props.onApplyTomorrowPlanAndGoRecords}
              onApplyTomorrowPracticeAndGoRecords={
                props.onApplyTomorrowPracticeAndGoRecords
              }
            />
          ) : (
            <div className="coach-stack">
              <EmptyState
                title="내일 계획 협업을 불러올 수 없어요"
                body="앱 메인에서 학생으로 로그인한 뒤 다시 시도해 주세요."
              />
            </div>
          )
        ) : panel === "chat" ? (
          <CoachChatTabConnected apiToken={token} />
        ) : (
          <StudentAdminChannelPanel authToken={token} />
        )}
      </TabTransitionPanel>
    </>
  );

  return isStandaloneAnalysis ? (
    <div className="coach-page coach-page--unified coach-page--analysis-standalone">
      <motion.div
        key="student-analysis-page"
        className="coach-analysis-standalone-content"
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        transition={{ duration: 0.29, ease: [0.2, 0.88, 0.22, 1] }}
        style={{ width: "100%" }}
      >
        {analysisContent}
      </motion.div>
    </div>
  ) : (
    <div className="coach-page coach-page--unified">{coachShellContent}</div>
  );
}

function CoachChatTabConnected(props: { apiToken: string }) {
  const token = props.apiToken;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const inputDockRef = useRef<HTMLDivElement | null>(null);
  const composerInputRef = useRef<HTMLInputElement | null>(null);
  const analysisPreviewTimerRef = useRef<number | null>(null);

  const messages = useCoachStore(s => s.messages);
  const addMessage = useCoachStore(s => s.addMessage);
  const coachMode = useCoachStore(s => s.chatMode);
  const setCoachMode = useCoachStore(s => s.setChatMode);
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState(false);
  const [coachAiMode, setCoachAiMode] = useState<"unknown" | "live" | "template">("unknown");
  const [lastResponseType, setLastResponseType] = useState<string>("");

  const hasUserTurn = messages.some(m => m.role === "user");

  const scrollChatToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const element = chatScrollRef.current;
    if (!element) return;
    element.scrollTo({
      top: element.scrollHeight,
      behavior: behavior === "smooth" ? "auto" : behavior
    });
  }, []);

  const openAnalysisReport = useCallback(() => {
    setAppPath("#/student/analysis");
  }, []);

  const queueAnalysisPreview = useCallback(() => {
    if (typing) return;
    if (analysisPreviewTimerRef.current != null) {
      window.clearTimeout(analysisPreviewTimerRef.current);
      analysisPreviewTimerRef.current = null;
    }
    addMessage({
      id: `u_${Date.now()}`,
      role: "user",
      createdAt: Date.now(),
      text: "학습 분석"
    });
    setCoachMode("learning");
    setTyping(true);
    requestAnimationFrame(() => {
      scrollChatToBottom("auto");
    });
    analysisPreviewTimerRef.current = window.setTimeout(() => {
      analysisPreviewTimerRef.current = null;
      addMessage({
        id: `c_${Date.now()}`,
        role: "coach",
        createdAt: Date.now(),
        text: "이번 주 학습 리포트를 정리했어요. 아래 버튼을 누르면 바로 확인할 수 있어요.",
        cta: {
          label: "학습 리포트 보기",
          action: "open-analysis-report"
        }
      });
      setTyping(false);
      requestAnimationFrame(() => {
        scrollChatToBottom("auto");
      });
    }, 20000);
  }, [addMessage, scrollChatToBottom, setCoachMode, typing]);

  const send = async (text: string, modeOverride?: CoachChatGreetingMode) => {
    const trimmed = text.trim();
    if (!trimmed || typing) return;
    const effectiveMode = modeOverride ?? coachMode;
    setCoachMode(effectiveMode);
    addMessage({ id: `u_${Date.now()}`, role: "user", createdAt: Date.now(), text: trimmed });
    setDraft("");
    setTyping(true);
    try {
      if (!token) throw new Error("로그인이 필요합니다.");
      const res = await fetch(`${API_BASE}/api/student/coach/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          message: trimmed,
          mode:
            effectiveMode === "suneung"
              ? "suneung"
              : effectiveMode === "schedule"
                ? "schedule"
                : "learning"
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(data?.error || "코치 응답을 받지 못했습니다."));
      setLastResponseType(String(data.responseType || ""));
      setCoachAiMode(data.usedOpenAi ? "live" : "template");
      if (data.schedule || data.scheduleChanged) {
        window.dispatchEvent(new Event(STUDENT_PROFILE_SCHEDULES_UPDATED_EVENT));
      }
      addMessage({
        id: `c_${Date.now()}`,
        role: "coach",
        createdAt: Date.now(),
        text: String(data.reply || "")
      });
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.message
          : "네트워크 또는 서버 오류입니다. API 서버와 OPENAI_API_KEY 설정을 확인해 주세요.";
      addMessage({
        id: `c_${Date.now()}`,
        role: "coach",
        createdAt: Date.now(),
        text: msg
      });
    } finally {
      setTyping(false);
    }
    requestAnimationFrame(() => {
      scrollChatToBottom("auto");
    });
  };

  const startersLearning = [
    "오늘 집중이 안 된 이유가 뭐야?",
    "내일은 뭘 먼저 하면 좋을까?",
    "왜 계획은 세우는데 실행이 안 될까?",
    "시험 전에는 루틴을 어떻게 유지해?"
  ];
  const startersSuneung = [
    "수학에서 극한이랑 연속이 헷갈려요. 차이를 설명해 주세요",
    "영어 도치 동사랑 5형식이 비슷해 보이는데 어떻게 구분해요?",
    "이차함수 그래프 문제에서 식 세우는 게 막혀요. 접근 순서 알려 주세요",
    "탐구에서 반응 속도식 세우는 유형이 안 풀려요. 개념부터 짚어 주세요"
  ];
  const startersSchedule = [
    "매주 일요일 15:00~18:00 지구과학 수업이 있어요",
    "이번 주 금요일 19:00에 영어 학원 보강 있어요",
    "매주 화목 16:30 수학 학원 일정 추가해 주세요"
  ];
  const starters =
    coachMode === "suneung"
      ? startersSuneung
      : coachMode === "schedule"
        ? startersSchedule
        : startersLearning;
  const autoChatStarterDoneRef = useRef(false);

  useEffect(() => {
    if (!IS_NATIVE_PLATFORM) {
      return;
    }

    const handleNativeDismiss = (event: Event) => {
      const detail = (event as CustomEvent<{ source?: EventTarget | null }>).detail;
      if (detail?.source !== composerInputRef.current) {
        return;
      }
    };

    const handleNativeSubmit = (event: Event) => {
      const detail = (event as CustomEvent<{ source?: EventTarget | null; value?: string }>).detail;
      if (detail?.source !== composerInputRef.current) {
        return;
      }

      void send(String(detail?.value || draft));
    };

    window.addEventListener(NATIVE_KEYBOARD_DISMISS_EVENT, handleNativeDismiss);
    window.addEventListener(NATIVE_KEYBOARD_SUBMIT_EVENT, handleNativeSubmit);
    return () => {
      window.removeEventListener(NATIVE_KEYBOARD_DISMISS_EVENT, handleNativeDismiss);
      window.removeEventListener(NATIVE_KEYBOARD_SUBMIT_EVENT, handleNativeSubmit);
    };
  }, [draft, send]);

  useEffect(() => {
    if (autoChatStarterDoneRef.current) return;
    if (!String(token || "").trim()) return;
    let kind: string | null = null;
    try {
      kind = sessionStorage.getItem(DAECHI_COACH_CHAT_STARTER_KEY);
    } catch {
      return;
    }
    if (kind !== "schedule" && kind !== "app-allowance") return;
    autoChatStarterDoneRef.current = true;
    try {
      sessionStorage.removeItem(DAECHI_COACH_CHAT_STARTER_KEY);
    } catch {
      // ignore
    }
    void send(
      kind === "app-allowance" ? "허용 앱을 관리하고 싶어요" : "일정을 관리하고 싶어요",
      "schedule"
    );
  }, [send, token]);

  useEffect(() => {
    return () => {
      if (analysisPreviewTimerRef.current != null) {
        window.clearTimeout(analysisPreviewTimerRef.current);
      }
    };
  }, []);

  const handleComposerBlur = () => {
    window.requestAnimationFrame(() => {
      if (composerInputRef.current?.dataset.nativeKeyboardSource === "true") {
        return;
      }
    });
  };

  return (
    <div ref={rootRef} className="coach-chat-embedded keyboard-dock-root">
      {coachAiMode === "template" && (
        <p
          className="coach-muted"
          style={{
            padding: "0 4px 10px",
            fontSize: "var(--font-size-medium)",
            lineHeight: 1.45
          }}
        >
          GPT 연결 없이 규칙 기반 답변입니다. 실제 GPT를 쓰려면 서버 폴더의{" "}
          <code style={{ fontSize: "var(--font-size-small)" }}>.env</code>에{" "}
          <code style={{ fontSize: "var(--font-size-small)" }}>OPENAI_API_KEY</code>를 넣고 서버를 다시 실행하세요.
        </p>
      )}
      <div ref={chatScrollRef} className="coach-chat">
        {messages.map(m => (
          <div key={m.id} className={"coach-bubble-row " + (m.role === "user" ? "is-user" : "is-coach")}>
            {m.role === "coach" && <CoachAvatar />}
            <motion.div
              className={"coach-bubble " + (m.role === "user" ? "coach-bubble--user" : "coach-bubble--coach")}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18 }}
            >
              {m.text.split("\n").map((line, idx) => (
                <div key={idx} className="coach-bubble__line">
                  {line || "\u00A0"}
                </div>
              ))}
              {m.role === "coach" && m.cta?.action === "open-analysis-report" ? (
                <div className="coach-chat-cta-row">
                  <button
                    type="button"
                    className="coach-tomorrow-collab__coach-pick coach-chat-cta"
                    onClick={openAnalysisReport}
                  >
                    {m.cta.label}
                  </button>
                </div>
              ) : null}
            </motion.div>
          </div>
        ))}
        {typing && (
          <div className="coach-bubble-row is-coach">
            <CoachAvatar />
            <div className="coach-bubble coach-bubble--coach">
              <span className="coach-typing">
                <span className="dot" />
                <span className="dot" />
                <span className="dot" />
              </span>
            </div>
          </div>
        )}
        {!hasUserTurn && !typing && (
          <div
            className="coach-bubble-row is-coach coach-tomorrow-collab__coach-offer-row"
            aria-label="코치 선택지"
          >
            <CoachAvatar />
            <motion.div
              className="coach-bubble coach-bubble--coach coach-tomorrow-collab__coach-offer"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18 }}
            >
              <div className="coach-bubble__line">
                학습 습관·루틴 코칭과 수능 과목 질의응답 중에서 골라 주세요. 직접 입력하셔도
                돼요.
              </div>
              <div className="coach-tomorrow-collab__coach-picks">
                <button
                  type="button"
                  className="coach-tomorrow-collab__coach-pick"
                  onClick={queueAnalysisPreview}
                >
                  학습 분석
                </button>
                <button
                  type="button"
                  className="coach-tomorrow-collab__coach-pick"
                  disabled={!token}
                  onClick={() =>
                    void send("학습 코칭으로 이야기하고 싶어요", "learning")
                  }
                >
                  학습 코칭
                </button>
                <button
                  type="button"
                  className="coach-tomorrow-collab__coach-pick"
                  disabled={!token}
                  onClick={() =>
                    void send("수능 과목 질문이 있어요", "suneung")
                  }
                >
                  수능 질의응답
                </button>
              </div>
            </motion.div>
          </div>
        )}
        <div id="coach-chat-bottom" />
      </div>

      <div ref={inputDockRef} className="coach-chat-bottom-rail keyboard-dock">
        {hasUserTurn && (
          <div className="coach-chat-starters" aria-label="추천 질문">
            {starters.map(s => (
              <button key={s} type="button" className="coach-starter" onClick={() => send(s)}>
                {s}
              </button>
            ))}
          </div>
        )}

        <div className="coach-chat-composer" onMouseDown={e => e.stopPropagation()}>
          <div className="coach-chat-input coach-chat-input--composer">
            <input
              ref={composerInputRef}
              className="coach-chat-text"
              value={draft}
              enterKeyHint="send"
              data-native-keyboard-submit="custom"
              onBlur={handleComposerBlur}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") {
                  send(draft);
                }
              }}
            />
            <button
              type="button"
              className="coach-primary-btn coach-primary-btn--sm"
              onMouseDown={e => e.preventDefault()}
              onClick={() => {
                send(draft);
              }}
              disabled={typing}
              aria-label="메시지 보내기"
              title="보내기"
            >
              <SendHorizontal size={15} strokeWidth={2.2} aria-hidden />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function StudentCoachApp(props: {
  tab: StudentTabKey;
  authToken: string | null;
  apiScope?: "student" | "parent";
  parentStudentId?: number | null;
  analysisActionTextOverride?: string;
  onLayoutModeChange?: (mode: "scroll" | "chat") => void;
  blocks?: StudyBlock[];
  progressBooks?: ProgressBook[];
  tomorrowPlan?: ProgressPlan;
  todayStudyEvaluation?: string;
  todayMetacognitionReflection?: string;
  todayMemo?: string;
  draftTomorrowPractice?: string;
  todayStudyMinutes?: number | null;
  onApplyTomorrowPlanAndGoRecords?: (next: ProgressPlan) => Promise<boolean>;
  onApplyTomorrowPracticeAndGoRecords?: (text: string) => Promise<boolean>;
}) {
  const apiToken = useEffectiveBearer(props.authToken);

  return (
    <div className="coach-shell coach-shell--unified">
      <CoachStudentUnified
        apiToken={apiToken}
        entryTab={props.tab}
        apiScope={props.apiScope}
        parentStudentId={props.parentStudentId}
        analysisActionTextOverride={props.analysisActionTextOverride}
        onLayoutModeChange={props.onLayoutModeChange}
        blocks={props.blocks}
        progressBooks={props.progressBooks}
        tomorrowPlan={props.tomorrowPlan}
        todayStudyEvaluation={props.todayStudyEvaluation}
        todayMetacognitionReflection={props.todayMetacognitionReflection}
        todayMemo={props.todayMemo}
        draftTomorrowPractice={props.draftTomorrowPractice}
        todayStudyMinutes={props.todayStudyMinutes}
        onApplyTomorrowPlanAndGoRecords={props.onApplyTomorrowPlanAndGoRecords}
        onApplyTomorrowPracticeAndGoRecords={
          props.onApplyTomorrowPracticeAndGoRecords
        }
      />
    </div>
  );
}

