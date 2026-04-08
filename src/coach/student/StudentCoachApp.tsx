import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { SendHorizontal } from "lucide-react";
import { motion } from "framer-motion";
import { TabTransitionPanel } from "../../components/PageTransition";
import { demoStudents } from "../demoData";
import { useCoachStore, type CoachChatGreetingMode } from "../state/useCoachStore";
import type { Severity } from "../types";
import { Card, EmptyState, RiskBadge, SectionHeader } from "../ui/components";
import { API_BASE } from "../../lib/apiBase";
import {
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
  replaceAppPath,
  subscribeAppPathChange
} from "../../lib/appNavigation";
import {
  getDateKeySeoul,
  getWeekDaysSeoul,
  getWeekStartKeySeoul,
  seoulDateKeyFromApiValue
} from "../../lib/weekDates";
import { useKeyboardDockInset } from "../../lib/useKeyboardDockInset";
import { useEffectiveBearer } from "../../lib/useEffectiveBearer";
import type { ProgressBook, ProgressPlan, StudyBlock } from "../../types/planner";
import { CoachAvatar } from "../CoachAvatar";
import { CoachTomorrowPlanCollab } from "./CoachTomorrowPlanCollab";

export type StudentTabKey = "home" | "coach";

type CoachPanelKey = "analysis" | "plan" | "chat";

/** Strict Mode 이중 마운트에서도 URL·sessionStorage 기준으로 동일하게 시작 (초기화에서 storage는 제거하지 않음) */
function readInitialCoachPanelFromWindow(entryTab: StudentTabKey): CoachPanelKey {
  if (typeof window === "undefined") {
    return entryTab === "coach" ? "chat" : "analysis";
  }
  const fromHash = readCoachPanelParamFromHash(getAppPath());
  if (fromHash) return fromHash;
  try {
    const v = sessionStorage.getItem(DAECHI_COACH_INITIAL_PANEL_KEY);
    if (v === "plan" || v === "analysis" || v === "chat") return v;
  } catch {
    // ignore
  }
  return entryTab === "coach" ? "chat" : "analysis";
}

function formatCoachLogDateKey(raw: string | undefined | null): string {
  return seoulDateKeyFromApiValue(raw ?? "");
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
        <span className={"coach-badge " + (props.severity === "높음" ? "coach-badge--danger" : props.severity === "보통" ? "coach-badge--warn" : "coach-badge--ok")}>
          {props.severity}
        </span>
      </div>
      <div className="coach-pattern__body">{props.explanation}</div>
      <div className="coach-pattern__rec">
        <span className="coach-pattern__rec-label">추천</span>
        <span className="coach-pattern__rec-text">{props.recommendation}</span>
      </div>
    </Card>
  );
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
};

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
  };
  logs?: RemoteCoachLogRow[];
};

/** DB 코치 로그 → 최근 7일(오늘-6 ~ 오늘) 리듬 그래프용 포인트 (없는 날은 null) */
type RhythmChartRow = {
  date: string;
  concentration: number | null;
  studyMinutes: number | null;
  sleepHours: number | null;
  stressScore: number | null;
  planCompletionRate: number | null;
};

function buildRhythmChartRowsFromLogs(
  apiLogs: RemoteCoachLogRow[] | undefined
): RhythmChartRow[] {
  const recent7Days = Array.from({ length: 7 }).map((_, idx) =>
    getDateKeySeoul(idx - 6)
  );
  const byDate = new Map<string, RemoteCoachLogRow>();
  for (const row of apiLogs || []) {
    const k = formatCoachLogDateKey(row.date);
    if (k && !byDate.has(k)) byDate.set(k, row);
  }
  return recent7Days.map(dateKey => {
    const r = byDate.get(dateKey);
    if (!r) {
      return {
        date: dateKey,
        concentration: null,
        studyMinutes: null,
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
  let currentChunk: { x: number; y: number }[] = [];
  const flushChunk = () => {
    if (currentChunk.length === 0) return;
    if (currentChunk.length === 1) {
      const p = currentChunk[0];
      pathSegments.push(`M ${p.x} ${p.y}`);
      currentChunk = [];
      return;
    }
    let d = `M ${currentChunk[0].x} ${currentChunk[0].y}`;
    for (let i = 0; i < currentChunk.length - 1; i++) {
      const a = currentChunk[i];
      const b = currentChunk[i + 1];
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      d += ` Q ${a.x} ${a.y} ${midX} ${midY}`;
    }
    const last = currentChunk[currentChunk.length - 1];
    d += ` T ${last.x} ${last.y}`;
    pathSegments.push(d);
    currentChunk = [];
  };

  for (const p of pts) {
    if (p.y == null) {
      flushChunk();
      continue;
    }
    currentChunk.push({ x: p.x, y: p.y });
  }
  flushChunk();

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
        <path
          key={`seg-${i}`}
          d={d}
          fill="none"
          stroke="currentColor"
          strokeWidth={2.75}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {pts.map((p, i) =>
        p.v != null && p.y != null ? (
          <circle
            key={`dot-${i}`}
            cx={p.x}
            cy={p.y}
            r={2.25}
            fill="currentColor"
          >
            <title>{`${labelShort(p.date)} · ${valueFormatter(p.v)}`}</title>
          </circle>
        ) : null
      )}
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
      if (v === "plan" || v === "analysis" || v === "chat") {
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

  useLayoutEffect(() => {
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
      setPanel(props.entryTab === "coach" ? "chat" : "analysis");
    }
  }, [props.entryTab, tryApplyCoachPanelDeepLink]);

  useEffect(() => {
    const onHash = () => {
      tryApplyCoachPanelDeepLink();
    };
    return subscribeAppPathChange(onHash);
  }, [tryApplyCoachPanelDeepLink]);

  useEffect(() => {
    props.onLayoutModeChange?.(
      panel === "chat" || panel === "plan" ? "chat" : "scroll"
    );
  }, [panel, props.onLayoutModeChange]);
  const activeStudentId = useCoachStore(s => s.activeStudentId);
  const student = useMemo(
    () => demoStudents.find(s => s.id === activeStudentId) || demoStudents[0],
    [activeStudentId]
  );
  const [remote, setRemote] = useState<RemoteCoachState | null>(null);
  const [aiPatterns, setAiPatterns] = useState<AiPatternRow[]>([]);
  const [patternsLoading, setPatternsLoading] = useState(false);
  const [patternsError, setPatternsError] = useState<string | null>(null);
  const [patternsUsedOpenAi, setPatternsUsedOpenAi] = useState(false);
  const coachStateFetchRef = useRef<AbortController | null>(null);
  const patternFetchRef = useRef<AbortController | null>(null);

  const refreshCoachHomeData = useCallback(() => {
    if (!token) return;
    coachStateFetchRef.current?.abort();
    const ac = new AbortController();
    coachStateFetchRef.current = ac;
    const weekStart = encodeURIComponent(getDateKeySeoul(-6));
    fetch(`${API_BASE}/api/student/coach/state?weekStart=${weekStart}`, {
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
        setRemote({
          ...d,
          logs: rawLogs
            .map(normalizeRemoteCoachLog)
            .filter((x): x is RemoteCoachLogRow => x != null)
        });
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        if (ac.signal.aborted) return;
        setRemote(null);
      });
  }, [token]);

  const refreshPatternInsights = useCallback(() => {
    if (!token) return;
    patternFetchRef.current?.abort();
    const ac = new AbortController();
    patternFetchRef.current = ac;
    setPatternsLoading(true);
    setPatternsError(null);
    const weekStart = encodeURIComponent(getDateKeySeoul(-6));
    fetch(`${API_BASE}/api/student/coach/pattern-insights?weekStart=${weekStart}`, {
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
        setAiPatterns(Array.isArray(list) ? list : []);
        setPatternsError(null);
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        if (ac.signal.aborted) return;
        setPatternsError("네트워크 오류로 패턴을 불러오지 못했습니다.");
        setAiPatterns([]);
        setPatternsUsedOpenAi(false);
      })
      .finally(() => {
        if (!ac.signal.aborted) {
          setPatternsLoading(false);
        }
      });
  }, [token]);

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
    if (patternsLoading) return [];
    return aiPatterns;
  }, [patternsLoading, aiPatterns]);

  const rhythmChartData = useMemo((): RhythmChartRow[] => {
    if (!token || !remote) return buildRhythmChartRowsFromLogs(undefined);
    return buildRhythmChartRowsFromLogs(remote.logs);
  }, [token, remote]);

  const studyMinutesMax = useMemo(() => {
    const nums = rhythmChartData
      .map(r => r.studyMinutes)
      .filter((n): n is number => n != null && Number.isFinite(n));
    return Math.max(240, nums.length ? Math.max(...nums) : 0);
  }, [rhythmChartData]);

  const weeklyCharts = useMemo(
    () =>
      [
        {
          key: "sleep",
          title: "수면 패턴",
          dataKey: "sleepHours" as const,
          color: "var(--text-strong)",
          yDomain: [0, 10] as [number, number],
          tooltipLabel: "수면 시간",
          valueFormatter: (v: number) => `${v.toFixed(1)}시간`
        },
        {
          key: "stress",
          title: "스트레스 점수",
          dataKey: "stressScore" as const,
          color: "var(--text-strong)",
          yDomain: [1, 5] as [number, number],
          tooltipLabel: "스트레스 점수",
          valueFormatter: (v: number) => `${v.toFixed(1)}/5`
        },
        {
          key: "concentration",
          title: "학습 집중도",
          dataKey: "concentration" as const,
          color: "var(--text-strong)",
          yDomain: [0, 100] as [number, number],
          tooltipLabel: "집중도",
          valueFormatter: (v: number) => `${Math.round(v)}%`
        },
        {
          key: "studyMinutes",
          title: "공부 시간",
          dataKey: "studyMinutes" as const,
          color: "var(--text-strong)",
          yDomain: [0, studyMinutesMax] as [number, number],
          tooltipLabel: "공부 시간(분)",
          valueFormatter: (v: number) => `${Math.round(v)}분`
        },
        {
          key: "planCompletionRate",
          title: "목표 달성률",
          dataKey: "planCompletionRate" as const,
          color: "var(--text-strong)",
          yDomain: [0, 100] as [number, number],
          tooltipLabel: "목표 달성률",
          valueFormatter: (v: number) => `${Math.round(v)}%`
        }
      ] as const,
    [studyMinutesMax]
  );

  const coachRiskLevel: Severity = token
    ? riskLevelFromSnapshotMetrics(remote?.snapshot?.metrics)
    : "낮음";

  const heroNarrative = token
    ? remote?.snapshot?.heroNarrative ||
      "현재 학습 흐름은 유지되고 있어요. 오늘은 우선순위 한 가지부터 시작해 보세요."
    : "로그인하고 오늘 공부 탭에서 기록을 남기면 맞춤 요약과 그래프가 표시돼요.";
  const profile = remote?.snapshot?.profile;

  /** 로그인 시 데모(현우) 이름이 잠깐 보였다가 서버 기본값으로 바뀌는 깜빡임 방지 */
  const displayName = token
    ? remote
      ? String(profile?.name ?? "").trim() || "학생"
      : "학생"
    : profile?.name || student.name;

  return (
    <div className="coach-page coach-page--unified">
      <div
        className="store-filter-row coach-subtab-row"
        role="tablist"
        aria-label="코치 구분"
      >
        <button
          type="button"
          role="tab"
          aria-selected={panel === "analysis"}
          className={
            "store-filter-btn" +
            (panel === "analysis" ? " store-filter-btn--active" : "")
          }
          onClick={() => selectCoachPanel("analysis")}
        >
          분석
        </button>
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
      </div>

      <TabTransitionPanel
        tabKey={panel}
        className={
          panel === "chat" || panel === "plan"
            ? "coach-shell__tab-panel coach-unified-tab-panel--fill"
            : "coach-unified-tab-panel"
        }
      >
        {panel === "analysis" ? (
          <>
            <Card className="coach-card coach-card--padded coach-home-insight-card">
              <div className="coach-home-insight-card__top">
                <span className="coach-home-insight-card__eyebrow">AI 분석 결과</span>
                <RiskBadge level={coachRiskLevel} />
              </div>
              <div className="coach-home-insight-card__title">
                {displayName}님을 위한 한 줄 요약
              </div>
              <p className="coach-home-insight-card__body">{heroNarrative}</p>
              <button
                type="button"
                className="coach-primary-btn coach-home-insight-card__cta"
                onClick={() => selectCoachPanel("plan")}
              >
                내일 계획 같이 짜기
              </button>
            </Card>

            <Card className="coach-card coach-card--padded">
              <SectionHeader title="최근 7일 리듬" />
              <div
                className="coach-rhythm-scroll"
                style={{
                  display: "flex",
                  overflowX: "auto",
                  gap: 12,
                  paddingBottom: 6,
                  marginTop: 4
                }}
                aria-label="최근 7일 리듬 상세 그래프"
              >
                {weeklyCharts.map(chart => (
                  <div
                    key={chart.key}
                    className="coach-rhythm-scroll__item"
                    style={{
                      flex: "0 0 auto",
                      minWidth: 300
                    }}
                  >
                    <div
                      className="coach-rhythm-scroll__title"
                      style={{
                        fontSize: "var(--font-size-medium)",
                        fontWeight: "var(--font-weight-semibold)",
                        marginBottom: 6
                      }}
                    >
                      {chart.title}
                    </div>
                    <div className="coach-chart" style={{ color: chart.color }}>
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
              <SectionHeader title="감지된 기록 패턴" />
              {patternsLoading && (
                <p
                  className="coach-muted"
                  style={{ padding: "0 4px 10px", fontSize: "var(--font-size-medium)" }}
                >
                  이번 주 기록을 바탕으로 패턴을 분석하는 중…
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
                <div className="coach-pattern-grid">
                  {displayPatterns.map(p => (
                    <PatternCard
                      key={p.key}
                      title={p.title}
                      severity={p.severity}
                      explanation={p.explanation}
                      recommendation={p.recommendation}
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
        ) : panel === "plan" ? (
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
        ) : (
          <CoachChatTabConnected apiToken={token} />
        )}
      </TabTransitionPanel>
    </div>
  );
}

function CoachChatTabConnected(props: { apiToken: string }) {
  const token = props.apiToken;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const inputDockRef = useRef<HTMLDivElement | null>(null);

  const messages = useCoachStore(s => s.messages);
  const addMessage = useCoachStore(s => s.addMessage);
  const coachMode = useCoachStore(s => s.chatMode);
  const setCoachMode = useCoachStore(s => s.setChatMode);
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState(false);
  const [coachAiMode, setCoachAiMode] = useState<"unknown" | "live" | "template">("unknown");
  const [lastResponseType, setLastResponseType] = useState<string>("");

  const hasUserTurn = messages.some(m => m.role === "user");

  useKeyboardDockInset({
    rootRef,
    scrollerRef: chatScrollRef,
    dockRef: inputDockRef
  });

  const scrollChatToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const element = chatScrollRef.current;
    if (!element) return;
    element.scrollTo({
      top: element.scrollHeight,
      behavior: behavior === "smooth" ? "auto" : behavior
    });
  }, []);

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
                <button
                  type="button"
                  className="coach-tomorrow-collab__coach-pick"
                  onClick={() => void send("일정을 관리하고 싶어요", "schedule")}
                >
                  일정 관리
                </button>
              </div>
            </motion.div>
          </div>
        )}
        <div id="coach-chat-bottom" />
      </div>

      {hasUserTurn && (
        <div className="coach-chat-starters" aria-label="추천 질문">
          {starters.map(s => (
            <button key={s} type="button" className="coach-starter" onClick={() => send(s)}>
              {s}
            </button>
          ))}
        </div>
      )}

      <div ref={inputDockRef} className="coach-chat-input keyboard-dock">
        <input
          className="coach-chat-text"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter") send(draft);
          }}
        />
        <button
          type="button"
          className="coach-primary-btn coach-primary-btn--sm"
          onClick={() => send(draft)}
          disabled={typing}
          aria-label="메시지 보내기"
          title="보내기"
        >
          <SendHorizontal size={15} strokeWidth={2.2} aria-hidden />
        </button>
      </div>
    </div>
  );
}

export function StudentCoachApp(props: {
  tab: StudentTabKey;
  authToken: string | null;
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

