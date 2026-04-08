import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Pencil } from "lucide-react";
import { DatePickerScroll } from "../DatePickerScroll";
import { TimePickerSheet } from "../TimePickerSheet";
import { TabTransitionPanel } from "../PageTransition";
import { AppAllowanceCoachCollab } from "./AppAllowanceCoachCollab";
import {
  getDateKeySeoul,
  getWeekDaysIncludingTomorrowSeoul,
  getWeekTitleSeoul,
  seoulDateKeyFromApiValue
} from "../../lib/weekDates";
import { TAB_TRANSITION_SETTLE_MS } from "../../lib/uiTiming";

/** 탭 전환이 거의 마무리될 시점에 기록 스크롤을 다시 정렬 */
const RECORDS_TAB_ENTER_MS = TAB_TRANSITION_SETTLE_MS + 40;
import type { StudentLockStatus } from "../../types/lockStatus";
import type {
  ProgressBook,
  ProgressPlan,
  StudyBlock
} from "../../types/planner";
import {
  DAECHI_COACH_INITIAL_PANEL_KEY,
  DAECHI_COACH_LOG_SAVED_EVENT,
  DAECHI_COACH_LOG_SAVED_STORAGE_KEY,
  DAECHI_COACH_TOMORROW_STARTER_KEY
} from "../../lib/coachEvents";
import { useModalReveal } from "../../lib/useModalReveal";

const COMMITMENT_DONE_STORAGE_PREFIX = "daechi_commitment_done_";

function commitmentDoneStorageKey(dayKey: string) {
  return `${COMMITMENT_DONE_STORAGE_PREFIX}${dayKey}`;
}

function readStoredCommitmentDone(dayKey: string): boolean | null {
  try {
    const value = localStorage.getItem(commitmentDoneStorageKey(dayKey));
    if (value === "1") return true;
    if (value === "0") return false;
  } catch {
    // ignore
  }
  return null;
}

function writeStoredCommitmentDone(dayKey: string, done: boolean) {
  try {
    localStorage.setItem(commitmentDoneStorageKey(dayKey), done ? "1" : "0");
  } catch {
    // ignore
  }
}

function mergeCommitmentDoneFromServer(
  serverValue: boolean | null | undefined,
  dayKey: string
): boolean | null {
  if (serverValue === true || serverValue === false) return serverValue;
  return readStoredCommitmentDone(dayKey);
}

const SLEEP_HOURS_MAX = 14;

function recordLifeSliderFillPct(value: string | number): string {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return "0%";
  const clamped = Math.max(1, Math.min(5, numericValue));
  const pct = ((clamped - 1) / 4) * 100;
  return `${pct}%`;
}

/** 생활 기록 수면 0–14h 슬라이더 → 필 너비 % */
function recordSleepSliderFillPct(v: string | number): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return "0%";
  const clamped = Math.max(0, Math.min(SLEEP_HOURS_MAX, n));
  const pct = (clamped / SLEEP_HOURS_MAX) * 100;
  return `${pct}%`;
}

/** 오늘 학습 시간: UI는 시간, 저장/API는 분(정수). 수면과 동일 0~14h, 기본 7h */
const STUDY_HOURS_MAX = SLEEP_HOURS_MAX;
const STUDY_HOURS_STEP = 0.5;
const STUDY_MINUTES_MAX = STUDY_HOURS_MAX * 60;
const STUDY_MINUTES_STEP = STUDY_HOURS_STEP * 60;
const DEFAULT_STUDY_MINUTES = 7 * 60;

/** 분 → 슬라이더 값(시간) */
function studyMinutesToHoursSlider(minStr: string): number {
  const t = minStr.trim();
  if (t === "") return 0;
  const min = Number(t);
  if (!Number.isFinite(min)) return 0;
  const h = min / 60;
  return Math.max(0, Math.min(STUDY_HOURS_MAX, h));
}

/** 분 → 'N시간' / 미입력 '—' */
function formatStudyHoursLabel(minStr: string): string {
  const t = minStr.trim();
  if (t === "") return "—";
  const min = Number(t);
  if (!Number.isFinite(min)) return "—";
  const h = Math.max(0, Math.min(STUDY_HOURS_MAX, min / 60));
  if (h % 1 === 0) return `${h}시간`;
  return `${h.toFixed(1)}시간`;
}

/** 오늘 학습 0–14h(분 저장) 슬라이더 → 필 너비 % */
function recordStudyHoursSliderFillPctFromMinutes(minStr: string | number): string {
  const s = typeof minStr === "string" ? minStr.trim() : String(minStr);
  if (s === "") return "0%";
  const min = Number(s);
  if (!Number.isFinite(min)) return "0%";
  const clamped = Math.max(0, Math.min(STUDY_MINUTES_MAX, min));
  const h = clamped / 60;
  const pct = (h / STUDY_HOURS_MAX) * 100;
  return `${pct}%`;
}

export type TabKey =
  | "today"
  | "records"
  | "store"
  | "profile";

type StudyStoreApp = {
  id: string;
  name: string;
  category: string;
  description?: string | null;
  url: string;
  installed: boolean;
  installedAt?: string | null;
  removedAt?: string | null;
};

type AppAllowanceCandidate = {
  id: string;
  name: string;
  category: string;
  description?: string | null;
  bundleId?: string | null;
};

type AppAllowanceSlot = {
  localId: string;
  title: string;
  source: "schedule" | "plan" | "free";
  startTime: string;
  endTime: string;
  reason: string;
  allowedApps: AppAllowanceCandidate[];
};

type AppAllowancePlan = {
  targetDate: string;
  summary: string;
  slots: AppAllowanceSlot[];
  usedOpenAi: boolean;
  model: string | null;
  availableApps: AppAllowanceCandidate[];
};

const DAECHI_ROOT_APP_ID = "com.daechiroot.ios";
const DAECHI_ROOT_APP_NAME = "대치루트";
const DAECHI_ROOT_APP: AppAllowanceCandidate = {
  id: DAECHI_ROOT_APP_ID,
  name: DAECHI_ROOT_APP_NAME,
  category: "필수 앱",
  description: "대치루트 앱은 항상 허용됩니다.",
  bundleId: DAECHI_ROOT_APP_ID
};

function isDaechiRootApp(app: AppAllowanceCandidate | null | undefined) {
  const id = String(app?.id || "").trim().toLowerCase();
  const bundleId = String(app?.bundleId || "").trim().toLowerCase();
  const name = String(app?.name || "").trim();
  return id === DAECHI_ROOT_APP_ID || bundleId === DAECHI_ROOT_APP_ID || name === DAECHI_ROOT_APP_NAME;
}

let appAllowanceSlotSequence = 0;

function createAppAllowanceSlotId() {
  appAllowanceSlotSequence += 1;
  return `app-allowance-slot-${appAllowanceSlotSequence}`;
}

function hhmmToMinutesAllow24(value: string): number | null {
  const trimmed = String(value || "").trim();
  if (trimmed === "24:00") return 24 * 60;
  const match = trimmed.match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function minutesToHhmmAllow24(totalMinutes: number): string {
  const clamped = Math.max(0, Math.min(24 * 60, Math.round(totalMinutes)));
  if (clamped >= 24 * 60) return "24:00";
  const hour = Math.floor(clamped / 60);
  const minute = clamped % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function getEditableTimeValue(value: string): string {
  return String(value || "").trim() === "24:00" ? "23:59" : String(value || "").trim();
}

function sanitizeTimeInput(value: string): string | null {
  const trimmed = String(value || "").trim();
  return /^\d{2}:\d{2}$/.test(trimmed) ? trimmed : null;
}

function sortAppAllowanceSlots(slots: AppAllowanceSlot[]): AppAllowanceSlot[] {
  return [...slots].sort((a, b) => {
    const aMin = hhmmToMinutesAllow24(a.startTime) ?? Number.MAX_SAFE_INTEGER;
    const bMin = hhmmToMinutesAllow24(b.startTime) ?? Number.MAX_SAFE_INTEGER;
    if (aMin !== bMin) return aMin - bMin;
    const aEnd = hhmmToMinutesAllow24(a.endTime) ?? Number.MAX_SAFE_INTEGER;
    const bEnd = hhmmToMinutesAllow24(b.endTime) ?? Number.MAX_SAFE_INTEGER;
    return aEnd - bEnd;
  });
}

function normalizeAppAllowanceCandidates(rows: AppAllowanceCandidate[]): AppAllowanceCandidate[] {
  const seen = new Set<string>();
  const next = (rows || []).filter(app => {
    const id = String(app?.id || "").trim();
    const name = String(app?.name || "").trim();
    if (!id || !name) return false;
    const key = `${id}::${name.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (!next.some(isDaechiRootApp)) {
    next.unshift({ ...DAECHI_ROOT_APP });
  }
  return next;
}

function ensureDaechiRootAllowedApps(rows: AppAllowanceCandidate[]): AppAllowanceCandidate[] {
  const normalized = normalizeAppAllowanceCandidates(rows);
  const root = normalized.find(isDaechiRootApp) || { ...DAECHI_ROOT_APP };
  const others = normalized.filter(app => !isDaechiRootApp(app));
  return [root, ...others];
}

function ensureDaechiRootAllowedSlots(slots: Array<Omit<AppAllowanceSlot, "localId"> | AppAllowanceSlot>) {
  return (slots || []).map(slot => ({
    ...slot,
    allowedApps: ensureDaechiRootAllowedApps(
      Array.isArray(slot.allowedApps) ? slot.allowedApps : []
    )
  }));
}

function hydrateAppAllowancePlan(raw: {
  targetDate?: string;
  summary?: string;
  slots?: Array<Omit<AppAllowanceSlot, "localId">>;
  usedOpenAi?: boolean;
  model?: string | null;
  availableApps?: AppAllowanceCandidate[];
}): AppAllowancePlan {
  const availableApps = normalizeAppAllowanceCandidates(
    Array.isArray(raw.availableApps) ? raw.availableApps : []
  );
  const slots = sortAppAllowanceSlots(
    ensureDaechiRootAllowedSlots(Array.isArray(raw.slots) ? raw.slots : []).map(slot => ({
      localId: createAppAllowanceSlotId(),
      title: String(slot.title || "").trim() || "시간표",
      source:
        slot.source === "schedule"
          ? "schedule"
          : slot.source === "free"
            ? "free"
            : "plan",
      startTime: String(slot.startTime || "").trim(),
      endTime: String(slot.endTime || "").trim(),
      reason: String(slot.reason || "").trim(),
      allowedApps: ensureDaechiRootAllowedApps(
        Array.isArray(slot.allowedApps) ? slot.allowedApps : []
      )
    }))
  );
  return {
    targetDate: String(raw.targetDate || ""),
    summary: String(raw.summary || ""),
    slots,
    usedOpenAi: Boolean(raw.usedOpenAi),
    model:
      typeof raw.model === "string" || raw.model === null ? raw.model ?? null : null,
    availableApps
  };
}

function createDraftAppAllowanceSlot(existingSlots: AppAllowanceSlot[]): AppAllowanceSlot {
  const sorted = sortAppAllowanceSlots(existingSlots);
  const lastEnd = hhmmToMinutesAllow24(sorted[sorted.length - 1]?.endTime || "") ?? 18 * 60;
  let start = Math.min(lastEnd, 23 * 60);
  let end = Math.min(start + 60, 24 * 60);
  if (end <= start) {
    start = Math.max(0, Math.min(start - 60, 23 * 60));
    end = Math.min(start + 60, 24 * 60);
  }
  return {
    localId: createAppAllowanceSlotId(),
    title: "직접 조정 시간대",
    source: "free",
    startTime: minutesToHhmmAllow24(start),
    endTime: minutesToHhmmAllow24(end),
    reason: "학생이 직접 조정한 시간대입니다.",
    allowedApps: ensureDaechiRootAllowedApps([])
  };
}

/** scroll-snap + scrollIntoView 조합에서 월요일로 붙는 문제 방지 — 날짜 키로 카드 찾아 가로 중앙 정렬 */
function centerRecordsStripOnDateKey(
  scrollEl: HTMLDivElement | null,
  dateKey: string
) {
  if (!scrollEl) return;
  const card = scrollEl.querySelector<HTMLElement>(
    `[data-weekday-key="${dateKey}"]`
  );
  if (!card) return;

  const apply = () => {
    scrollEl.scrollLeft = 0;
    void scrollEl.offsetWidth;
    const sc = scrollEl.getBoundingClientRect();
    const cr = card.getBoundingClientRect();
    scrollEl.scrollLeft = Math.max(
      0,
      cr.left - sc.left - (sc.width - cr.width) / 2
    );
  };

  apply();
  requestAnimationFrame(apply);
}

const storeAppIcons: Record<string, string> = {
  "youtube-learning": "/icons/youtube-learning.svg",
  "khan-academy": "/icons/khan-academy.svg",
  quizlet: "/icons/quizlet.svg",
  notion: "/icons/notion.svg",
  "google-drive": "/icons/google-drive.svg"
};

export type StudentLinkRow = {
  id: number;
  parent_email: string;
  parent_user_id: number;
  created_at: string;
};

export function StudentLegacyView(props: {
  tab: TabKey;
  apiBase: string;
  authToken: string | null;
  meRole: string | null;
  blocks: StudyBlock[];
  toggleDone: (id: number) => void;
  studentLockStatus: StudentLockStatus | null;
  studentLockMessage: string;
  timelineSyncError: string;
  onDismissTimelineSyncError: () => void;
  planRequestNotice?: string;
  onDismissPlanRequestNotice?: () => void;
  progressWeekOffset: number;
  setProgressWeekOffset: React.Dispatch<React.SetStateAction<number>>;
  progressBooks: ProgressBook[];
  removeProgressBook: (bookId: number) => Promise<void>;
  tomorrowPlan: ProgressPlan;
  setTomorrowPlan: React.Dispatch<React.SetStateAction<ProgressPlan>>;
  saveTomorrowPlan: () => Promise<boolean>;
  todayStudyEvaluation: string;
  setTodayStudyEvaluation: React.Dispatch<React.SetStateAction<string>>;
  todayMetacognitionReflection: string;
  setTodayMetacognitionReflection: React.Dispatch<React.SetStateAction<string>>;
  setBooksModalOpen: (v: boolean) => void;
  onOpenAddPlan: () => void;
  setCheckSettingsOpen: (v: boolean) => void;
  storeApps: StudyStoreApp[];
  storeLoading: boolean;
  storeError: string;
  storeSavingId: string | null;
  setStoreSavingId: (v: string | null) => void;
  setStoreError: (v: string) => void;
  setStoreApps: React.Dispatch<React.SetStateAction<StudyStoreApp[]>>;
  resolvePreferredSerial: () => string;
  hapticSelection: () => void;
  hapticWarning: () => void;
  hapticImpactLight: () => void;
  hapticSuccess: () => void;
}) {
  const {
    tab,
    apiBase,
    authToken,
    meRole,
    blocks,
    toggleDone,
    studentLockStatus,
    studentLockMessage,
    timelineSyncError,
    onDismissTimelineSyncError,
    planRequestNotice = "",
    onDismissPlanRequestNotice,
    progressWeekOffset,
    setProgressWeekOffset,
    progressBooks,
    removeProgressBook,
    tomorrowPlan,
    setTomorrowPlan,
    saveTomorrowPlan,
    todayStudyEvaluation,
    setTodayStudyEvaluation,
    todayMetacognitionReflection,
    setTodayMetacognitionReflection,
    setBooksModalOpen,
    onOpenAddPlan,
    setCheckSettingsOpen: _setCheckSettingsOpen,
    storeApps,
    storeLoading,
    storeError,
    storeSavingId,
    setStoreSavingId,
    setStoreError,
    setStoreApps,
    resolvePreferredSerial,
    hapticSelection,
    hapticWarning,
    hapticImpactLight,
    hapticSuccess
  } = props;

  const [todaySleepHours, setTodaySleepHours] = useState("7");
  const [todayStress, setTodayStress] = useState("3");
  const [todayConcentration, setTodayConcentration] = useState("3");
  /** 오늘 학습 시간(내부는 분 정수, UI는 시간 슬라이더) — 기록 탭·코치 맥락 공유 */
  const [todayStudyMinutes, setTodayStudyMinutes] = useState(
    String(DEFAULT_STUDY_MINUTES)
  );
  const [todayMemo, setTodayMemo] = useState("");
  const [todayTomorrowPractice, setTodayTomorrowPractice] = useState("");
  /** 어제 기록의「내일 실천할 한 가지」→ 오늘 실천 약속 문구 */
  const [commitmentFromYesterday, setCommitmentFromYesterday] = useState("");
  /** 오늘 그 약속을 실천했는지(null: 아직 서버에 없음·미선택) */
  const [commitmentDoneToday, setCommitmentDoneToday] = useState<
    boolean | null
  >(null);
  const [commitmentDoneSaving, setCommitmentDoneSaving] = useState(false);
  const [todayLogSaving, setTodayLogSaving] = useState(false);
  const [todayLogMessage, setTodayLogMessage] = useState("");
  const [appAllowanceRequesting, setAppAllowanceRequesting] = useState(false);
  const coachLifeDayHydratedRef = useRef<string>("");
  /** coach/state 지연 응답이 토글 직후 상태를 덮어쓰지 않도록 중단 */
  const todayCoachFetchAbortRef = useRef<AbortController | null>(null);
  const commitmentDoneRef = useRef<boolean | null>(null);
  commitmentDoneRef.current = commitmentDoneToday;
  const commitmentToggleInFlightRef = useRef(false);
  const [todayDdayLabel, setTodayDdayLabel] = useState("디데이");
  const [ddayEditOpen, setDdayEditOpen] = useState(false);
  const [ddayEditTitle, setDdayEditTitle] = useState("");
  const [ddayEditDate, setDdayEditDate] = useState("");
  const weekDayScrollRef = useRef<HTMLDivElement | null>(null);
  const lifeRecordScrollRef = useRef<HTMLDivElement | null>(null);
  const [timePicker, setTimePicker] = useState<
    | {
        kind: "tomorrow-plan";
        bookId: number;
        field: "start" | "end";
      }
    | {
        kind: "app-allowance";
        slotId: string;
        field: "startTime" | "endTime";
      }
    | null
  >(null);
  const [storeDetailApp, setStoreDetailApp] = useState<StudyStoreApp | null>(
    null
  );
  const [appAllowancePlan, setAppAllowancePlan] = useState<AppAllowancePlan | null>(
    null
  );
  const [appAllowancePickerSlotId, setAppAllowancePickerSlotId] = useState<string | null>(
    null
  );
  const hasCommitmentFromYesterday = commitmentFromYesterday.trim().length > 0;

  const [coachPlanHintOpen, setCoachPlanHintOpen] = useState(false);
  const [coachPlanHintKind, setCoachPlanHintKind] = useState<"study" | "life">(
    "study"
  );

  const ddayModalReveal = useModalReveal(ddayEditOpen);
  const coachPlanHintReveal = useModalReveal(coachPlanHintOpen);
  const storeDetailReveal = useModalReveal(storeDetailApp != null);
  const appAllowanceReveal = useModalReveal(appAllowancePlan != null);

  const tryOpenCoachTomorrowPlan = useCallback(
    (kind: "study" | "life") => {
      hapticSelection();
      if (kind === "study") {
        if (
          !todayStudyEvaluation.trim() ||
          !todayMetacognitionReflection.trim()
        ) {
          hapticWarning();
          setCoachPlanHintKind("study");
          setCoachPlanHintOpen(true);
          return;
        }
      } else {
        if (!todayMemo.trim()) {
          hapticWarning();
          setCoachPlanHintKind("life");
          setCoachPlanHintOpen(true);
          return;
        }
      }
      try {
        sessionStorage.setItem(DAECHI_COACH_INITIAL_PANEL_KEY, "plan");
        sessionStorage.setItem(DAECHI_COACH_TOMORROW_STARTER_KEY, kind);
      } catch {
        // ignore
      }
      setAppPath("#/student/home?panel=plan");
    },
    [
      hapticSelection,
      hapticWarning,
      todayStudyEvaluation,
      todayMetacognitionReflection,
      todayMemo
    ]
  );

  useEffect(() => {
    if (tab !== "store") {
      setStoreDetailApp(null);
      setStoreCategoryFilter(null);
    }
  }, [tab]);

  useEffect(() => {
    if (!storeDetailApp && !appAllowancePlan) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [storeDetailApp, appAllowancePlan]);

  useEffect(() => {
    if (appAllowancePlan) return;
    setAppAllowancePickerSlotId(null);
  }, [appAllowancePlan]);

  const buildTomorrowPlanDraftPayload = useCallback(() => {
    return progressBooks
      .map(book => ({
        bookId: book.id,
        bookName: book.name,
        plannedRange: tomorrowPlan[book.id]?.text || "",
        startTime: tomorrowPlan[book.id]?.start || "",
        endTime: tomorrowPlan[book.id]?.end || ""
      }))
      .filter(
        item =>
          item.bookName.trim() ||
          item.plannedRange.trim() ||
          item.startTime.trim() ||
          item.endTime.trim()
      );
  }, [progressBooks, tomorrowPlan]);

  const requestAppAllowancePlan = useCallback(async () => {
    if (!authToken) return null;
    try {
      const res = await fetch(`${apiBase}/api/student/coach/app-timetable`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          planDraft: buildTomorrowPlanDraftPayload(),
          serial: resolvePreferredSerial() || undefined
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return null;
      return hydrateAppAllowancePlan({
        targetDate: String((data as { targetDate?: string }).targetDate || ""),
        summary: String((data as { summary?: string }).summary || ""),
        slots: Array.isArray(
          (data as { slots?: Array<Omit<AppAllowanceSlot, "localId">> }).slots
        )
          ? ((data as { slots?: Array<Omit<AppAllowanceSlot, "localId">> }).slots || [])
          : [],
        usedOpenAi: Boolean((data as { usedOpenAi?: boolean }).usedOpenAi),
        model:
          typeof (data as { model?: string | null }).model === "string" ||
          (data as { model?: string | null }).model === null
            ? ((data as { model?: string | null }).model ?? null)
            : null,
        availableApps: Array.isArray(
          (data as { availableApps?: AppAllowanceCandidate[] }).availableApps
        )
          ? ((data as { availableApps?: AppAllowanceCandidate[] }).availableApps || [])
          : []
      });
    } catch {
      return null;
    }
  }, [apiBase, authToken, buildTomorrowPlanDraftPayload]);

  const requestParentAppAllowanceReview = useCallback(async () => {
    if (!authToken || !appAllowancePlan || appAllowanceRequesting) return;
    setAppAllowanceRequesting(true);
    setTodayLogMessage("");
    try {
      const res = await fetch(`${apiBase}/api/student/coach/app-timetable-request`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          targetDate: appAllowancePlan.targetDate,
          summary: appAllowancePlan.summary,
          slots: appAllowancePlan.slots.map(slot => ({
            title: slot.title,
            startTime: slot.startTime,
            endTime: slot.endTime,
            source: slot.source,
            allowedAppNames: slot.allowedApps.map(app => app.name)
          }))
        })
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
      };
      if (!res.ok) {
        hapticWarning();
        setTodayLogMessage(
          String(data.error || "").trim() ||
            (data.code === "NO_LINKED_PARENT"
              ? "연결된 학부모 계정이 없어 요청을 보낼 수 없습니다."
              : "학부모에게 요청을 보내지 못했습니다.")
        );
        return;
      }
      hapticSuccess();
      setTodayLogMessage("학부모 페이지 알림으로 내일 앱 허용 시간표 요청을 보냈습니다.");
      appAllowanceReveal.beginClose(() => setAppAllowancePlan(null));
    } catch {
      hapticWarning();
      setTodayLogMessage("네트워크 오류로 요청을 보내지 못했습니다.");
    } finally {
      setAppAllowanceRequesting(false);
    }
  }, [
    apiBase,
    appAllowancePlan,
    appAllowanceRequesting,
    appAllowanceReveal,
    authToken,
    hapticSuccess,
    hapticWarning
  ]);

  const availableAppAllowanceApps = useMemo(() => {
    const planApps = appAllowancePlan?.availableApps || [];
    if (planApps.length > 0) return planApps;
    return normalizeAppAllowanceCandidates(
      storeApps
        .filter(app => app.installed)
        .map(app => ({
          id: app.id,
          name: app.name,
          category: app.category,
          description: app.description,
          bundleId: null
        }))
    );
  }, [appAllowancePlan, storeApps]);

  const updateAppAllowanceSlots = useCallback(
    (updater: (slots: AppAllowanceSlot[]) => AppAllowanceSlot[]) => {
      setAppAllowancePlan(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          slots: sortAppAllowanceSlots(updater(prev.slots))
        };
      });
    },
    []
  );

  const updateAppAllowanceTime = useCallback(
    (slotId: string, field: "startTime" | "endTime", value: string) => {
      const nextValue = sanitizeTimeInput(value);
      if (!nextValue) return;
      let invalidRange = false;
      updateAppAllowanceSlots(slots =>
        slots.map(slot => {
          if (slot.localId !== slotId) return slot;
          const candidate = { ...slot, [field]: nextValue };
          const startMin = hhmmToMinutesAllow24(candidate.startTime);
          const endMin = hhmmToMinutesAllow24(candidate.endTime);
          if (startMin == null || endMin == null || endMin <= startMin) {
            invalidRange = true;
            return slot;
          }
          return candidate;
        })
      );
      if (invalidRange) {
        hapticWarning();
        setTodayLogMessage("시간대 종료 시간은 시작 시간보다 늦어야 합니다.");
      }
    },
    [hapticWarning, updateAppAllowanceSlots]
  );

  const addAppAllowanceSlot = useCallback(() => {
    hapticSelection();
    setTodayLogMessage("");
    updateAppAllowanceSlots(slots => [...slots, createDraftAppAllowanceSlot(slots)]);
  }, [hapticSelection, updateAppAllowanceSlots]);

  const removeAppAllowanceSlot = useCallback(
    (slotId: string) => {
      hapticSelection();
      setAppAllowancePickerSlotId(current => (current === slotId ? null : current));
      updateAppAllowanceSlots(slots => slots.filter(slot => slot.localId !== slotId));
    },
    [hapticSelection, updateAppAllowanceSlots]
  );

  const toggleAppAllowanceAllowedApp = useCallback(
    (slotId: string, app: AppAllowanceCandidate) => {
      if (isDaechiRootApp(app)) {
        return;
      }
      hapticSelection();
      updateAppAllowanceSlots(slots =>
        slots.map(slot => {
          if (slot.localId !== slotId) return slot;
          const exists = slot.allowedApps.some(item => item.id === app.id);
          return {
            ...slot,
            allowedApps: ensureDaechiRootAllowedApps(
              exists
                ? slot.allowedApps.filter(item => item.id !== app.id)
                : [...slot.allowedApps, app]
            )
          };
        })
      );
    },
    [hapticSelection, updateAppAllowanceSlots]
  );

  const updateDdayLabelFromDate = (dateStr: string | null) => {
    if (!dateStr) {
      setTodayDdayLabel("디데이");
      return;
    }
    const target = new Date(`${dateStr}T12:00:00`);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    target.setHours(0, 0, 0, 0);
    const diffDays = Math.round(
      (target.getTime() - today.getTime()) / (24 * 60 * 60 * 1000)
    );
    if (diffDays > 0) {
      setTodayDdayLabel(`D-${diffDays}`);
    } else if (diffDays === 0) {
      setTodayDdayLabel("D-Day");
    } else {
      setTodayDdayLabel(`D+${Math.abs(diffDays)}`);
    }
  };

  const getTodayTitle = () => {
    const weekdayNames = ["일", "월", "화", "수", "목", "금", "토"];
    const d = new Date();
    return `${d.getMonth() + 1}월 ${d.getDate()}일 ${weekdayNames[d.getDay()]}요일`;
  };

  useEffect(() => {
    try {
      const rawDate = localStorage.getItem("daechi_student_dday_date");
      const rawTitle = localStorage.getItem("daechi_student_dday_title");
      if (rawDate) {
        setDdayEditDate(rawDate);
        updateDdayLabelFromDate(rawDate);
      }
      if (rawTitle) {
        setDdayEditTitle(rawTitle);
      }
    } catch {
      // ignore
    }
  }, []);

  useLayoutEffect(() => {
    if (tab !== "records") return;
    const days = getWeekDaysIncludingTomorrowSeoul(progressWeekOffset);
    const todayKey = getDateKeySeoul(0);
    const mondayKey = days[0]?.key ?? todayKey;

    /** 생활 기록: 이번 주만 오늘, 다른 주는 그 주 월요일 */
    const lifeDateKey =
      progressWeekOffset === 0 ? todayKey : mondayKey;
    /** 학습 기록: 이번 주만 오늘 카드 중심, 다른 주는 그 주 월요일 */
    const studyDateKey =
      progressWeekOffset === 0 ? todayKey : mondayKey;

    const run = () => {
      centerRecordsStripOnDateKey(lifeRecordScrollRef.current, lifeDateKey);
      centerRecordsStripOnDateKey(weekDayScrollRef.current, studyDateKey);
    };

    run();
    const t0 = window.setTimeout(run, 0);
    const t1 = window.setTimeout(run, 120);
    const t2 = window.setTimeout(run, RECORDS_TAB_ENTER_MS);
    const t3 = window.setTimeout(run, RECORDS_TAB_ENTER_MS + 120);
    let raf = 0;
    raf = requestAnimationFrame(run);
    return () => {
      window.clearTimeout(t0);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
      cancelAnimationFrame(raf);
    };
  }, [tab, progressWeekOffset]);

  useEffect(() => {
    if (!authToken) {
      coachLifeDayHydratedRef.current = "";
      return;
    }
    if (tab !== "records") return;
    const dayKey = getDateKeySeoul(0);
    const sessionKey = `${authToken}:${dayKey}`;
    if (coachLifeDayHydratedRef.current === sessionKey) return;
    let cancelled = false;
    (async () => {
      try {
        const mondayKey = getWeekDaysIncludingTomorrowSeoul(0)[0]?.key;
        if (!mondayKey) return;
        const res = await fetch(
          `${apiBase}/api/student/coach/state?weekStart=${encodeURIComponent(mondayKey)}`,
          {
            headers: { Authorization: `Bearer ${authToken}` },
            cache: "no-store"
          }
        );
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          logs?: Array<{
            date?: string;
            sleepHours?: number | null;
            stressScore?: number | null;
            concentrationScore?: number | null;
            studyMinutes?: number | null;
            memo?: string | null;
            tomorrowPractice?: string | null;
            tomorrowPracticeDone?: boolean | null;
            studyEvaluation?: string | null;
            metacognitionReflection?: string | null;
          }>;
        };
        const logs = data.logs || [];
        const row = logs.find(l => l.date === dayKey);
        if (!row || cancelled) return;
        const yesterdayKey = getDateKeySeoul(-1);
        const yRow = logs.find(l => l.date === yesterdayKey);
        setCommitmentFromYesterday(String(yRow?.tomorrowPractice ?? "").trim());
        const td = row.tomorrowPracticeDone;
        setCommitmentDoneToday(mergeCommitmentDoneFromServer(td, dayKey));
        if (row.sleepHours != null && Number.isFinite(Number(row.sleepHours))) {
          const sh = Math.max(
            0,
            Math.min(SLEEP_HOURS_MAX, Number(row.sleepHours))
          );
          setTodaySleepHours(String(sh));
        }
        const s = row.stressScore;
        if (s != null && s >= 1 && s <= 5) setTodayStress(String(s));
        const c = row.concentrationScore;
        if (c != null && c >= 1 && c <= 5) setTodayConcentration(String(c));
        setTodayMemo(row.memo ?? "");
        setTodayTomorrowPractice(row.tomorrowPractice ?? "");
        setTodayStudyEvaluation(String(row.studyEvaluation ?? ""));
        setTodayMetacognitionReflection(String(row.metacognitionReflection ?? ""));
        const sm = row.studyMinutes;
        if (sm != null && Number.isFinite(Number(sm))) {
          const raw = Math.round(Number(sm));
          const clamped = Math.max(
            0,
            Math.min(STUDY_MINUTES_MAX, raw)
          );
          const snapped =
            Math.round(clamped / STUDY_MINUTES_STEP) * STUDY_MINUTES_STEP;
          setTodayStudyMinutes(String(snapped));
        } else {
          setTodayStudyMinutes(String(DEFAULT_STUDY_MINUTES));
        }
        coachLifeDayHydratedRef.current = sessionKey;
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, authToken, apiBase]);

  useEffect(() => {
    if (!authToken || tab !== "today") {
      todayCoachFetchAbortRef.current = null;
      return;
    }
    todayCoachFetchAbortRef.current?.abort();
    const ac = new AbortController();
    todayCoachFetchAbortRef.current = ac;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${apiBase}/api/student/coach/state`, {
          headers: { Authorization: `Bearer ${authToken}` },
          cache: "no-store",
          signal: ac.signal
        });
        if (!res.ok || cancelled || ac.signal.aborted) return;
        const data = (await res.json()) as {
          logs?: Array<{
            date?: string;
            tomorrowPractice?: string | null;
            tomorrowPracticeDone?: boolean | null;
          }>;
        };
        if (cancelled || ac.signal.aborted) return;
        const logs = data.logs || [];
        const todayKey = getDateKeySeoul(0);
        const yesterdayKey = getDateKeySeoul(-1);
        const yRow = logs.find(l => l.date === yesterdayKey);
        const tRow = logs.find(l => l.date === todayKey);
        setCommitmentFromYesterday(String(yRow?.tomorrowPractice ?? "").trim());
        const td = tRow?.tomorrowPracticeDone;
        setCommitmentDoneToday(mergeCommitmentDoneFromServer(td, todayKey));
      } catch (e) {
        if (ac.signal.aborted || (e as { name?: string }).name === "AbortError") {
          return;
        }
      }
    })();
    return () => {
      cancelled = true;
      ac.abort();
      if (todayCoachFetchAbortRef.current === ac) {
        todayCoachFetchAbortRef.current = null;
      }
    };
  }, [tab, authToken, apiBase]);

  const toggleCommitmentDone = useCallback(async () => {
    if (!authToken) {
      hapticWarning();
      return;
    }
    if (commitmentToggleInFlightRef.current) return;
    todayCoachFetchAbortRef.current?.abort();
    commitmentToggleInFlightRef.current = true;
    const prev = commitmentDoneRef.current;
    const next = !(prev === true);
    const dayKey = getDateKeySeoul(0);
    setCommitmentDoneToday(next);
    writeStoredCommitmentDone(dayKey, next);
    setCommitmentDoneSaving(true);
    hapticSelection();
    try {
      const res = await fetch(
        `${apiBase}/api/student/coach/log/tomorrow-practice-done`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken}`
          },
          body: JSON.stringify({ done: next })
        }
      );
      if (res.ok) {
        hapticSuccess();
      }
      // 실패해도 화면·로컬 값은 유지 (DB 컬럼 없음 등)
    } catch {
      // 네트워크 오류도 동일
    } finally {
      commitmentToggleInFlightRef.current = false;
      setCommitmentDoneSaving(false);
    }
  }, [apiBase, authToken, hapticSelection, hapticSuccess]);

  const todayTotalCount = blocks.length;
  const todayDoneCount = blocks.filter(b => b.done).length;
  const todayProgress =
    todayTotalCount === 0 ? 0 : Math.round((todayDoneCount / todayTotalCount) * 100);

  /** 종류 버튼 순서(서버 목록 순서대로 첫 등장 기준) */
  const storeCategoryList = useMemo(() => {
    const order: string[] = [];
    const seen = new Set<string>();
    for (const app of storeApps) {
      const cat = String(app.category || "").trim() || "기타";
      if (!seen.has(cat)) {
        seen.add(cat);
        order.push(cat);
      }
    }
    return order;
  }, [storeApps]);

  const [storeCategoryFilter, setStoreCategoryFilter] = useState<string | null>(
    null
  );

  const displayedStoreApps = useMemo(() => {
    if (storeCategoryFilter == null) return storeApps;
    return storeApps.filter(
      a =>
        (String(a.category || "").trim() || "기타") === storeCategoryFilter
    );
  }, [storeApps, storeCategoryFilter]);

  const handleSaveTodayLog = async () => {
    if (!authToken) return;
    const sleepRaw = todaySleepHours.trim();
    if (!sleepRaw) {
      hapticWarning();
      setTodayLogMessage("수면시간을 입력해 주세요.");
      return;
    }
    const sleepHours = Number(sleepRaw);
    if (
      !Number.isFinite(sleepHours) ||
      sleepHours < 0 ||
      sleepHours > SLEEP_HOURS_MAX
    ) {
      hapticWarning();
      setTodayLogMessage(
        `수면시간은 0~${SLEEP_HOURS_MAX}시간 범위로 입력해 주세요.`
      );
      return;
    }
    setTodayLogSaving(true);
    setTodayLogMessage("");
    try {
      let planSaved = true;
      if (progressBooks.length > 0) {
        planSaved = await saveTomorrowPlan();
      }
      const studyMinRaw = todayStudyMinutes.trim();
      let studyMinutesPayload: number | null = null;
      if (studyMinRaw) {
        const n = Number(studyMinRaw);
        if (
          !Number.isFinite(n) ||
          n < 0 ||
          n > STUDY_MINUTES_MAX ||
          !Number.isInteger(n) ||
          n % STUDY_MINUTES_STEP !== 0
        ) {
          hapticWarning();
          setTodayLogMessage(
            `학습 시간은 0~${STUDY_HOURS_MAX}시간 사이, ${STUDY_HOURS_STEP}시간(${STUDY_MINUTES_STEP}분) 단위로 입력해 주세요.`
          );
          return;
        }
        studyMinutesPayload = n;
      }
      const logPayload: Record<string, unknown> = {
        sleepHours,
        stressScore: Number(todayStress),
        concentrationScore: Number(todayConcentration),
        memo: todayMemo.trim() || null,
        tomorrowPractice: todayTomorrowPractice.trim() || null,
        studyEvaluation: todayStudyEvaluation.trim() || null,
        metacognitionReflection: todayMetacognitionReflection.trim() || null,
        studyMinutes: studyMinutesPayload
      };
      if (typeof commitmentDoneToday === "boolean") {
        logPayload.tomorrowPracticeDone = commitmentDoneToday;
      }
      const res = await fetch(`${apiBase}/api/student/coach/log`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify(logPayload)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        hapticWarning();
        setTodayLogMessage(
          (data as { error?: string }).error || "오늘 기록 저장에 실패했습니다."
        );
        return;
      }
      hapticSuccess();
      const savedKey = seoulDateKeyFromApiValue(
        (data as { log?: { log_date?: unknown } }).log?.log_date
      );
      const planNote =
        progressBooks.length > 0 && !planSaved
          ? "내일 계획은 저장되지 않았어요. "
          : "";
      setTodayLogMessage(
        planNote +
          (savedKey ? `오늘 기록이 저장되었습니다. ${savedKey}` : "오늘 기록이 저장되었습니다.")
      );
      try {
        window.dispatchEvent(new CustomEvent(DAECHI_COACH_LOG_SAVED_EVENT));
        localStorage.setItem(DAECHI_COACH_LOG_SAVED_STORAGE_KEY, String(Date.now()));
      } catch {
        // ignore
      }
      setAppAllowancePlan(
        hydrateAppAllowancePlan({
        targetDate: getDateKeySeoul(1),
        summary: "학생 일정과 내일 계획을 바탕으로 앱 허용 시간표를 생성 중이에요.",
        slots: [],
        usedOpenAi: false,
        model: null,
        availableApps: []
      })
      );
      const generatedPlan = await requestAppAllowancePlan();
      if (generatedPlan) {
        setAppAllowancePlan(generatedPlan);
      } else {
        setAppAllowancePlan(
          hydrateAppAllowancePlan({
          targetDate: getDateKeySeoul(1),
          summary:
            "시간표를 자동 생성하지 못했어요. 그래도 내일 허용 앱 팝업은 열어 두었어요.",
          slots: [],
          usedOpenAi: false,
          model: null,
          availableApps: []
        })
        );
      }
    } catch {
      hapticWarning();
      setTodayLogMessage("서버와 통신 중 오류가 발생했습니다.");
    } finally {
      setTodayLogSaving(false);
    }
  };

  return (
    <>
      <TabTransitionPanel tabKey={tab} className="student-tab-transition">
      {tab === "today" && (
        <>
          <div className="today-study-layout">
            <section className="section today-cards-outer">
              <div className="today-cards-scroll">
                <div className="today-cards-container">
                  <div className="timeline-page">
                    {timelineSyncError ? (
                      <div className="timeline-sync-banner" role="alert">
                        <p className="timeline-sync-banner__text">
                          {timelineSyncError}
                        </p>
                        <button
                          type="button"
                          className="timeline-sync-banner__dismiss"
                          onClick={() => onDismissTimelineSyncError()}
                        >
                          닫기
                        </button>
                      </div>
                    ) : null}
                    {planRequestNotice.trim() ? (
                      <div
                        className="timeline-sync-banner timeline-sync-banner--success"
                        role="status"
                      >
                        <p className="timeline-sync-banner__text timeline-sync-banner__text--success">
                          {planRequestNotice}
                        </p>
                        <button
                          type="button"
                          className="timeline-sync-banner__dismiss"
                          onClick={() => onDismissPlanRequestNotice?.()}
                        >
                          닫기
                        </button>
                      </div>
                    ) : null}
                    <div className="progress-card today-summary-card">
                      <div className="today-summary-row">
                        <button
                          type="button"
                          className="today-dday-label"
                          onClick={() => {
                            setDdayEditDate(d => d || getDateKeySeoul(0));
                            setDdayEditOpen(true);
                          }}
                        >
                          {todayDdayLabel}
                        </button>
                        <span className="today-date-label">{getTodayTitle()}</span>
                      </div>
                      <div className="today-progress-bar-row">
                        <div
                          className="record-slider-pill"
                          role="progressbar"
                          aria-valuenow={todayProgress}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-label="오늘 학습 진행률"
                        >
                          <div
                            className="record-slider-pill__fill"
                            style={{
                              width: `${Math.max(
                                0,
                                Math.min(100, todayProgress)
                              )}%`
                            }}
                            aria-hidden="true"
                          />
                        </div>
                        <span className="record-slider-value today-progress-pct">
                          {todayProgress}%
                        </span>
                      </div>
                    </div>

                    <div className="progress-card timeline-card-with-action timeline-card-with-action--today">
                      <div className="timeline-list">
                        {hasCommitmentFromYesterday ? (
                          <button
                            type="button"
                            className={
                              "timeline-item timeline-item--commitment" +
                              (commitmentDoneToday === true ? " timeline-item-done" : "")
                            }
                            disabled={commitmentDoneSaving}
                            onClick={() => void toggleCommitmentDone()}
                            aria-pressed={commitmentDoneToday === true}
                            aria-label={
                              commitmentDoneToday === true
                                ? "오늘의 핵심 실천 완료로 표시됨. 눌러 미실천으로 바꿉니다."
                                : "오늘의 핵심 미실천. 눌러 실천 완료로 표시합니다."
                            }
                          >
                            <div className="time-col">
                              <span className="time-main">오늘의 핵심</span>
                              <span className="timeline-book-name">
                                {commitmentFromYesterday.trim()}
                              </span>
                              <span className="timeline-plan-range">
                                {commitmentDoneToday === true ? "실천했어요" : "미실천"}
                              </span>
                            </div>
                            <div className="check-col" aria-hidden="true">
                              <span className="check-circle">
                                {commitmentDoneToday === true ? (
                                  <span className="check-dot" />
                                ) : null}
                              </span>
                            </div>
                          </button>
                        ) : null}
                        {blocks.map(block => (
                          <button
                            key={block.id}
                            className={
                              "timeline-item" + (block.done ? " timeline-item-done" : "")
                            }
                            onClick={() => toggleDone(block.id)}
                          >
                            <div className="time-col">
                              <span className="time-main">
                                {block.start} - {block.end}
                              </span>
                              <span className="timeline-book-name">{block.subject}</span>
                              {block.plannedRange ? (
                                <span className="timeline-plan-range">
                                  {block.plannedRange}
                                </span>
                              ) : null}
                            </div>
                            <div className="check-col" aria-hidden="true">
                              <span className="check-circle">
                                {block.done && <span className="check-dot" />}
                              </span>
                            </div>
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        className="timeline-add-button timeline-add-button--plan-edit"
                        onClick={() => {
                          hapticSelection();
                          onOpenAddPlan();
                        }}
                        aria-label="오늘 계획 수정 요청"
                      >
                        <span
                          className="timeline-add-button__icon timeline-add-button__icon--lucide"
                          aria-hidden
                        >
                          <Pencil size={20} strokeWidth={2} />
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </div>

          {ddayEditOpen
            ? createPortal(
                <div
                  className={
                    "dday-modal" +
                    (ddayModalReveal.revealed ? " dday-modal--open" : "")
                  }
                  onClick={() =>
                    ddayModalReveal.beginClose(() => setDdayEditOpen(false))
                  }
                >
                  <div className="dday-modal-inner" onClick={e => e.stopPropagation()}>
                    <div className="dday-modal-header">
                      <span className="dday-modal-title">디데이 설정</span>
                    </div>
                    <div className="dday-modal-body">
                      <div className="field">
                        <label className="field-label">제목</label>
                        <input
                          className="field-input"
                          value={ddayEditTitle}
                          onChange={e => setDdayEditTitle(e.target.value)}
                        />
                      </div>
                      <div className="field" style={{ marginTop: 10 }}>
                        <label className="field-label">날짜</label>
                        <DatePickerScroll
                          value={ddayEditDate || getDateKeySeoul(0)}
                          onChange={setDdayEditDate}
                          hapticSelection={hapticSelection}
                        />
                      </div>
                    </div>
                    <div className="dday-modal-footer">
                      <button
                        type="button"
                        className="modal-secondary"
                        onClick={() =>
                          ddayModalReveal.beginClose(() => setDdayEditOpen(false))
                        }
                      >
                        취소
                      </button>
                      <button
                        type="button"
                        className="modal-primary"
                        onClick={() => {
                          try {
                            localStorage.setItem("daechi_student_dday_date", ddayEditDate);
                            localStorage.setItem("daechi_student_dday_title", ddayEditTitle);
                          } catch {
                            // ignore
                          }
                          updateDdayLabelFromDate(ddayEditDate || null);
                          ddayModalReveal.beginClose(() => setDdayEditOpen(false));
                        }}
                        disabled={!ddayEditDate}
                      >
                        저장
                      </button>
                    </div>
                  </div>
                </div>,
                document.body
              )
            : null}
        </>
      )}

      {tab === "records" && (
        <>
          <section className="section week-days-section">
            <div className="progress-card week-switch-card">
              <div className="week-switch">
                <button
                  type="button"
                  className="week-switch-btn week-switch-prev"
                  onClick={() => setProgressWeekOffset(prev => prev + 1)}
                  aria-label="이전 주"
                >
                  <ChevronLeft size={20} strokeWidth={2.2} />
                </button>
                <div className="week-switch-center">
                  <span className="week-switch-label">
                    {getWeekTitleSeoul(progressWeekOffset)}
                  </span>
                </div>
                <button
                  type="button"
                  className="week-switch-btn week-switch-next"
                  onClick={() => setProgressWeekOffset(prev => prev - 1)}
                  aria-label="다음 주"
                >
                  <ChevronRight size={20} strokeWidth={2.2} />
                </button>
              </div>
            </div>
          </section>

          <section className="section records-study-section">
            <div className="section-header records-section-header">
              <h2 className="section-title">학습 기록</h2>
            </div>
            <div className="week-frame">
              <div className="progress-cards-scroll" ref={weekDayScrollRef}>
                <div className="progress-cards-container">
                  {getWeekDaysIncludingTomorrowSeoul(progressWeekOffset).map(day => {
                    const todayKey = getDateKeySeoul(0);
                    const tomorrowKey = getDateKeySeoul(1);
                    const isTodayCard = day.key === todayKey;
                    const isTomorrowCard = day.key === tomorrowKey;
                    const showStudyPlanEditor =
                      progressWeekOffset === 0 && isTodayCard;
                    const showTomorrowPlanReadonly =
                      progressWeekOffset === 0 && isTomorrowCard;
                    return (
                      <div
                        key={`study-${day.key}`}
                        data-weekday-card
                        data-weekday-key={day.key}
                        className={
                          "progress-day-card" +
                          (isTodayCard ? " progress-day-card--today" : "")
                        }
                      >
                        <div className="progress-day-card-header">{day.label}</div>
                        <div className="progress-day-card-body">
                          {showStudyPlanEditor ? (
                            <>
                              <div className="record-life-group">
                                <h3 className="record-life-group-title">오늘 기록</h3>
                                <div className="record-study-reflection-card">
                                  <div className="field record-day-field">
                                    <label className="field-label">오늘 학습 시간</label>
                                    <div className="record-slider-row">
                                      <div className="record-slider-pill">
                                        <div
                                          className="record-slider-pill__fill"
                                          style={{
                                            width: recordStudyHoursSliderFillPctFromMinutes(
                                              todayStudyMinutes
                                            )
                                          }}
                                        />
                                        <input
                                          type="range"
                                          className="record-slider-pill__input"
                                          min={0}
                                          max={STUDY_HOURS_MAX}
                                          step={STUDY_HOURS_STEP}
                                          value={studyMinutesToHoursSlider(
                                            todayStudyMinutes
                                          )}
                                          onChange={e => {
                                            const hrs = Number(e.target.value);
                                            if (!Number.isFinite(hrs)) return;
                                            setTodayStudyMinutes(
                                              String(Math.round(hrs * 60))
                                            );
                                          }}
                                          aria-valuetext={
                                            todayStudyMinutes.trim() === ""
                                              ? "미입력"
                                              : formatStudyHoursLabel(
                                                  todayStudyMinutes
                                                )
                                          }
                                        />
                                      </div>
                                      <span className="record-slider-value record-slider-value--study-min">
                                        {formatStudyHoursLabel(
                                          todayStudyMinutes
                                        )}
                                      </span>
                                    </div>
                                  </div>
                                  <div className="field record-day-field record-day-memo">
                                    <label className="field-label">
                                      오늘 공부 좋았던 점과 나빴던 점
                                    </label>
                                    <textarea
                                      className="field-input record-day-input"
                                      value={todayStudyEvaluation}
                                      onChange={e =>
                                        setTodayStudyEvaluation(e.target.value)
                                      }
                                      rows={3}
                                    />
                                  </div>
                                  <div className="field record-day-field record-day-memo">
                                    <label className="field-label">오늘 공부한 내용을 설명해보세요</label>
                                    <textarea
                                      className="field-input record-day-input"
                                      value={todayMetacognitionReflection}
                                      onChange={e =>
                                        setTodayMetacognitionReflection(e.target.value)
                                      }
                                      rows={4}
                                    />
                                  </div>
                                </div>
                              </div>
                              <div className="record-life-group">
                                <div className="record-life-group-head-row">
                                  <h3 className="record-life-group-title">내일 계획</h3>
                                  <button
                                    type="button"
                                    className="records-tomorrow-coach-btn"
                                    onClick={() => tryOpenCoachTomorrowPlan("study")}
                                  >
                                    AI 코치와 함께 계획 짜기
                                  </button>
                                </div>
                                {progressBooks.length > 0 ? (
                                  <>
                                    {progressBooks.map(book => (
                                      <div
                                        key={book.id}
                                        className="progress-day-book progress-day-book--editable"
                                      >
                                        <div className="progress-day-book-name">
                                          {book.name}
                                        </div>
                                        <div className="books-plan-inputs">
                                          <input
                                            className="field-input books-plan-range"
                                            value={tomorrowPlan[book.id]?.text || ""}
                                            onChange={e =>
                                              setTomorrowPlan(prev => ({
                                                ...prev,
                                                [book.id]: {
                                                  ...prev[book.id],
                                                  text: e.target.value
                                                }
                                              }))
                                            }
                                          />
                                          <div className="books-plan-times">
                                            <button
                                              type="button"
                                              className={
                                                "books-plan-time-btn" +
                                                (!tomorrowPlan[book.id]?.start
                                                  ? " books-plan-time-btn--placeholder"
                                                  : "")
                                              }
                                              onClick={() => {
                                                hapticSelection();
                                                setTimePicker({
                                                  kind: "tomorrow-plan",
                                                  bookId: book.id,
                                                  field: "start"
                                                });
                                              }}
                                            >
                                              {tomorrowPlan[book.id]?.start || "시작"}
                                            </button>
                                            <span className="time-divider">―</span>
                                            <button
                                              type="button"
                                              className={
                                                "books-plan-time-btn" +
                                                (!tomorrowPlan[book.id]?.end
                                                  ? " books-plan-time-btn--placeholder"
                                                  : "")
                                              }
                                              onClick={() => {
                                                hapticSelection();
                                                setTimePicker({
                                                  kind: "tomorrow-plan",
                                                  bookId: book.id,
                                                  field: "end"
                                                });
                                              }}
                                            >
                                              {tomorrowPlan[book.id]?.end || "종료"}
                                            </button>
                                          </div>
                                        </div>
                                      </div>
                                    ))}
                                  </>
                                ) : null}
                              </div>
                              <div className="record-primary-save-wrap">
                                <button
                                  type="button"
                                  className="timeline-save-button"
                                  disabled={todayLogSaving}
                                  onClick={handleSaveTodayLog}
                                >
                                  {todayLogSaving ? "저장 중..." : "기록 저장"}
                                </button>
                                {todayLogMessage ? (
                                  <p className="settings-hint record-save-feedback">
                                    {todayLogMessage}
                                  </p>
                                ) : null}
                              </div>
                            </>
                          ) : showTomorrowPlanReadonly ? (
                            <div className="record-life-group">
                              <h3 className="record-life-group-title">내일 계획</h3>
                              {progressBooks.length > 0 ? (
                                progressBooks.map(book => {
                                  const p = tomorrowPlan[book.id];
                                  const range = (p?.text || "").trim();
                                  const start = p?.start || "";
                                  const end = p?.end || "";
                                  const timePart =
                                    start || end
                                      ? `${start || "—"} ~ ${end || "—"}`
                                      : "";
                                  return (
                                    <div key={book.id} className="progress-day-book">
                                      <div className="progress-day-book-name">
                                        {book.name}
                                      </div>
                                      <div className="progress-day-book-plan">
                                        내일 계획: {range || "미설정"}
                                        {timePart ? ` · ${timePart}` : ""}
                                      </div>
                                    </div>
                                  );
                                })
                              ) : null}
                            </div>
                          ) : (
                            progressBooks.map(book => (
                              <div key={book.id} className="progress-day-book">
                                <div className="progress-day-book-name">{book.name}</div>
                                <div className="progress-day-book-plan">
                                  {isTodayCard ? "오늘 계획: " : "계획: "}
                                  {isTodayCard
                                    ? (() => {
                                        const ranges = blocks
                                          .filter(b => b.subject === book.name)
                                          .map(b => `${b.start}~${b.end}`);
                                        return ranges.length > 0
                                          ? ranges.join(", ")
                                          : "미설정";
                                      })()
                                    : "미설정"}
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>

          <section className="section week-books-section">
            <div className="progress-card timeline-card-with-action week-books-card">
              <div className="section-header">
                <h2 className="section-title">책 관리</h2>
              </div>
              <ul className="books-list">
                {progressBooks.map(book => (
                  <li key={book.id} className="books-item">
                    <span className="books-name">{book.name}</span>
                    <button
                      type="button"
                      className="books-delete"
                      onClick={() => {
                        void removeProgressBook(book.id);
                      }}
                    >
                      삭제
                    </button>
                  </li>
                ))}
                {progressBooks.length === 0 && (
                  <li className="books-empty">등록된 책이 없습니다.</li>
                )}
              </ul>
              <button
                type="button"
                className="timeline-add-button"
                onClick={() => setBooksModalOpen(true)}
                aria-label="책 추가"
              >
                <span className="timeline-add-button__icon">＋</span>
              </button>
            </div>
          </section>

          <section className="section records-life-section">
            <div className="section-header records-section-header">
              <h2 className="section-title">생활 기록</h2>
            </div>
            <div className="week-frame">
              <div className="progress-cards-scroll" ref={lifeRecordScrollRef}>
                <div className="progress-cards-container">
                  {getWeekDaysIncludingTomorrowSeoul(progressWeekOffset).map(day => {
                    const todayKey = getDateKeySeoul(0);
                    const isTodayCard = day.key === todayKey;
                    return (
                      <div
                        key={`life-${day.key}`}
                        data-weekday-card
                        data-weekday-key={day.key}
                        className={
                          "progress-day-card" +
                          (isTodayCard ? " progress-day-card--today" : "")
                        }
                      >
                        <div className="progress-day-card-header">{day.label}</div>
                        <div className="progress-day-card-body">
                          {isTodayCard ? (
                            <>
                              <div className="record-life-group">
                                <h3 className="record-life-group-title">오늘 기록</h3>
                                <div className="record-day-block">
                                  <div className="field record-day-field">
                                    <label className="field-label">수면시간</label>
                                    <div className="record-slider-row">
                                      <div className="record-slider-pill">
                                        <div
                                          className="record-slider-pill__fill"
                                          style={{
                                            width: recordSleepSliderFillPct(
                                              todaySleepHours
                                            )
                                          }}
                                        />
                                        <input
                                          type="range"
                                          className="record-slider-pill__input"
                                          min={0}
                                          max={SLEEP_HOURS_MAX}
                                          step={0.5}
                                          value={(() => {
                                            const n = Number(todaySleepHours);
                                            return Number.isFinite(n)
                                              ? Math.max(
                                                  0,
                                                  Math.min(SLEEP_HOURS_MAX, n)
                                                )
                                              : 0;
                                          })()}
                                          onChange={e =>
                                            setTodaySleepHours(e.target.value)
                                          }
                                          aria-valuetext={`${todaySleepHours}시간`}
                                        />
                                      </div>
                                      <span className="record-slider-value">
                                        {`${todaySleepHours}시간`}
                                      </span>
                                    </div>
                                  </div>
                                  <div className="field record-day-field">
                                    <label className="field-label">스트레스</label>
                                    <div className="record-slider-row">
                                      <div className="record-slider-pill">
                                        <div
                                          className="record-slider-pill__fill"
                                          style={{
                                            width: recordLifeSliderFillPct(
                                              todayStress
                                            )
                                          }}
                                        />
                                        <input
                                          type="range"
                                          className="record-slider-pill__input"
                                          min={1}
                                          max={5}
                                          step={1}
                                          value={todayStress}
                                          onChange={e =>
                                            setTodayStress(e.target.value)
                                          }
                                          aria-valuetext={`${todayStress}단계`}
                                        />
                                      </div>
                                      <span className="record-slider-value">
                                        {todayStress}
                                      </span>
                                    </div>
                                  </div>
                                  <div className="field record-day-field">
                                    <label className="field-label">집중도</label>
                                    <div className="record-slider-row">
                                      <div className="record-slider-pill">
                                        <div
                                          className="record-slider-pill__fill"
                                          style={{
                                            width: recordLifeSliderFillPct(
                                              todayConcentration
                                            )
                                          }}
                                        />
                                        <input
                                          type="range"
                                          className="record-slider-pill__input"
                                          min={1}
                                          max={5}
                                          step={1}
                                          value={todayConcentration}
                                          onChange={e =>
                                            setTodayConcentration(e.target.value)
                                          }
                                          aria-valuetext={`${todayConcentration}단계`}
                                        />
                                      </div>
                                      <span className="record-slider-value">
                                        {todayConcentration}
                                      </span>
                                    </div>
                                  </div>
                                  <div className="field record-day-field record-day-memo">
                                    <label className="field-label">
                                      오늘 생활 좋았던 점과 나빴던 점
                                    </label>
                                    <textarea
                                      className="field-input record-day-input"
                                      value={todayMemo}
                                      onChange={e => setTodayMemo(e.target.value)}
                                      rows={3}
                                    />
                                  </div>
                                </div>
                              </div>
                              <div className="record-life-group">
                                <div className="record-life-group-head-row">
                                  <h3 className="record-life-group-title">내일 계획</h3>
                                  <button
                                    type="button"
                                    className="records-tomorrow-coach-btn"
                                    onClick={() => tryOpenCoachTomorrowPlan("life")}
                                  >
                                    AI 코치와 함께 계획 짜기
                                  </button>
                                </div>
                                <div className="record-day-block">
                                  <div className="field record-day-field record-day-memo">
                                    <label className="field-label">
                                      내일 실천할 한 가지
                                    </label>
                                    <textarea
                                      className="field-input record-day-input"
                                      value={todayTomorrowPractice}
                                      onChange={e =>
                                        setTodayTomorrowPractice(e.target.value)
                                      }
                                      rows={2}
                                    />
                                  </div>
                                </div>
                              </div>
                              <div className="record-primary-save-wrap">
                                <button
                                  type="button"
                                  className="timeline-save-button"
                                  disabled={todayLogSaving}
                                  onClick={handleSaveTodayLog}
                                >
                                  {todayLogSaving ? "저장 중..." : "기록 저장"}
                                </button>
                                {todayLogMessage ? (
                                  <p className="settings-hint record-save-feedback">
                                    {todayLogMessage}
                                  </p>
                                ) : null}
                              </div>
                            </>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>
        </>
      )}

      {tab === "store" && (
        <section className="section store-section">
          {storeError && <p className="empty-state">{storeError}</p>}
          {storeApps.length > 0 && (
            <div
              className="store-filter-row"
              role="tablist"
              aria-label="앱 종류"
            >
              <button
                type="button"
                role="tab"
                aria-selected={storeCategoryFilter === null}
                className={
                  "store-filter-btn" +
                  (storeCategoryFilter === null
                    ? " store-filter-btn--active"
                    : "")
                }
                onClick={() => {
                  hapticSelection();
                  setStoreCategoryFilter(null);
                }}
              >
                전체
              </button>
              {storeCategoryList.map(cat => (
                <button
                  key={cat}
                  type="button"
                  role="tab"
                  aria-selected={storeCategoryFilter === cat}
                  className={
                    "store-filter-btn" +
                    (storeCategoryFilter === cat
                      ? " store-filter-btn--active"
                      : "")
                  }
                  onClick={() => {
                    hapticSelection();
                    setStoreCategoryFilter(cat);
                  }}
                >
                  {cat}
                </button>
              ))}
            </div>
          )}
          {storeApps.length > 0 && (
            <div className="store-grid">
              {displayedStoreApps.map(app => (
                <article key={app.id} className="store-card">
                  <div className="store-card-top">
                    <button
                      type="button"
                      className="store-card-summary"
                      onClick={() => {
                        hapticSelection();
                        setStoreDetailApp(app);
                      }}
                    >
                      <img
                        src={
                          storeAppIcons[app.id] || "/icons/google-drive.svg"
                        }
                        alt=""
                        className="store-icon"
                        aria-hidden
                      />
                      <div className="store-card-summary__text">
                        <h3 className="store-title">{app.name}</h3>
                        <span className="store-card-summary__hint">
                          설명 보기
                        </span>
                      </div>
                    </button>
                    <div className="store-actions">
                      <button
                        type="button"
                        className={
                          "store-install-btn" +
                          (app.installed
                            ? " store-install-btn-installed"
                            : "")
                        }
                        disabled={storeSavingId === app.id}
                        onClick={async () => {
                          if (!authToken) return;
                          setStoreSavingId(app.id);
                          setStoreError("");
                          try {
                            const res = await fetch(
                              `${apiBase}/api/student/store-apps/${app.id}`,
                              {
                                method: "PUT",
                                credentials: "include",
                                headers: {
                                  "Content-Type": "application/json",
                                  Authorization: `Bearer ${authToken}`
                                },
                                body: JSON.stringify({
                                  installed: !app.installed,
                                  serial:
                                    resolvePreferredSerial() || undefined
                                })
                              }
                            );
                            const data = await res.json().catch(() => ({}));
                            if (!res.ok) {
                              setStoreError(
                                (data as { error?: string }).error ||
                                  "앱 상태를 저장하지 못했습니다."
                              );
                              return;
                            }
                            const refreshRes = await fetch(
                              `${apiBase}/api/student/store-apps`,
                              {
                                headers: {
                                  Authorization: `Bearer ${authToken}`
                                }
                              }
                            );
                            const refreshData = await refreshRes
                              .json()
                              .catch(() => ({}));
                            if (
                              refreshRes.ok &&
                              Array.isArray(
                                (refreshData as { apps?: StudyStoreApp[] }).apps
                              )
                            ) {
                              setStoreApps(
                                (refreshData as { apps: StudyStoreApp[] }).apps
                              );
                            } else {
                              setStoreApps(prev =>
                                prev.map(item =>
                                  item.id === app.id
                                    ? (data as { app?: StudyStoreApp }).app ||
                                      item
                                    : item
                                )
                              );
                            }
                            if (!app.installed) {
                              hapticSuccess();
                            } else {
                              hapticSelection();
                            }
                          } catch {
                            setStoreError("앱 상태를 저장하지 못했습니다.");
                          } finally {
                            setStoreSavingId(null);
                          }
                        }}
                      >
                        {storeSavingId === app.id
                          ? "저장 중..."
                          : app.installed
                            ? "삭제하기"
                            : "설치하기"}
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
          {storeDetailApp
            ? createPortal(
                <div
                  className={
                    "store-detail-overlay" +
                    (storeDetailReveal.revealed
                      ? " store-detail-overlay--open"
                      : "")
                  }
                  role="presentation"
                  onClick={() =>
                    storeDetailReveal.beginClose(() => setStoreDetailApp(null))
                  }
                >
                  <div
                    className="store-detail-sheet"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="store-detail-title"
                    onClick={e => e.stopPropagation()}
                  >
                    <div className="dday-modal-header">
                      <span className="dday-modal-title" id="store-detail-title">
                        {storeDetailApp.name}
                      </span>
                    </div>
                    <div className="dday-modal-body">
                      {storeDetailApp.category ? (
                        <p className="store-detail-category store-detail-category--muted">
                          {storeDetailApp.category}
                        </p>
                      ) : null}
                      <p className="store-detail-description">
                        {String(storeDetailApp.description ?? "").trim()}
                      </p>
                    </div>
                    <div className="dday-modal-footer">
                      <button
                        type="button"
                        className="modal-primary"
                        onClick={() =>
                          storeDetailReveal.beginClose(() =>
                            setStoreDetailApp(null)
                          )
                        }
                      >
                        닫기
                      </button>
                    </div>
                  </div>
                </div>,
                document.body
              )
            : null}
        </section>
      )}

      </TabTransitionPanel>

      {appAllowancePlan
        ? createPortal(
            <div
              className={
                "dday-modal" +
                (appAllowanceReveal.revealed ? " dday-modal--open" : "")
              }
              role="presentation"
            >
              <div
                className="dday-modal-inner app-allow-plan-modal-inner"
                role="dialog"
                aria-modal="true"
                aria-labelledby="app-allow-plan-title"
                onClick={e => e.stopPropagation()}
              >
                <div className="dday-modal-header app-allow-plan-header">
                  <div>
                    <span className="dday-modal-title" id="app-allow-plan-title">
                      내일 앱 허용 시간표
                    </span>
                    {appAllowancePlan.targetDate ? (
                      <p className="app-allow-plan-date">{appAllowancePlan.targetDate}</p>
                    ) : null}
                  </div>
                  <span className="app-allow-plan-badge">
                    {appAllowancePlan.usedOpenAi ? "GPT 추천" : "기본 추천"}
                  </span>
                </div>
                <div className="dday-modal-body">
                  <p className="app-allow-plan-summary">
                    {appAllowancePlan.summary ||
                      "내일 일정과 계획을 기준으로 앱 허용 후보를 정리했어요."}
                  </p>
                  <AppAllowanceCoachCollab
                    apiBase={apiBase}
                    authToken={authToken}
                    plan={appAllowancePlan}
                    onReplacePlan={next => {
                      setAppAllowancePickerSlotId(null);
                      setAppAllowancePlan(prev =>
                        prev
                          ? hydrateAppAllowancePlan({
                              targetDate: prev.targetDate,
                              summary: next.summary,
                              slots: next.slots,
                              usedOpenAi: next.usedOpenAi,
                              model: next.model,
                              availableApps: next.availableApps
                            })
                          : prev
                      );
                    }}
                  />
                  <div className="app-allow-plan-toolbar">
                    <button
                      type="button"
                      className="modal-secondary app-allow-plan-toolbar__button"
                      onClick={addAppAllowanceSlot}
                    >
                      시간대 추가
                    </button>
                  </div>
                  {appAllowancePlan.slots.length > 0 ? (
                    <div className="app-allow-plan-slot-list">
                      {appAllowancePlan.slots.map(slot => (
                        <section
                          key={slot.localId}
                          className="app-allow-plan-slot"
                        >
                          <div className="app-allow-plan-slot__top">
                            <div>
                              <div className="app-allow-plan-slot__time">
                                {slot.startTime} - {slot.endTime}
                              </div>
                              <div className="app-allow-plan-slot__title">{slot.title}</div>
                            </div>
                            <span className="app-allow-plan-slot__source">
                              {slot.source === "schedule"
                                ? "일정"
                                : slot.source === "plan"
                                  ? "계획"
                                  : "빈 시간"}
                            </span>
                          </div>
                          <div className="app-allow-plan-slot__edit-row">
                            <label className="app-allow-plan-slot__time-field">
                              <span className="app-allow-plan-slot__time-label">시작</span>
                              <input
                                type="time"
                                step={60}
                                className="app-allow-plan-slot__time-input"
                                value={getEditableTimeValue(slot.startTime)}
                                onChange={e =>
                                  updateAppAllowanceTime(
                                    slot.localId,
                                    "startTime",
                                    e.target.value
                                  )
                                }
                              />
                            </label>
                            <label className="app-allow-plan-slot__time-field">
                              <span className="app-allow-plan-slot__time-label">종료</span>
                              <input
                                type="time"
                                step={60}
                                className="app-allow-plan-slot__time-input"
                                value={getEditableTimeValue(slot.endTime)}
                                onChange={e =>
                                  updateAppAllowanceTime(
                                    slot.localId,
                                    "endTime",
                                    e.target.value
                                  )
                                }
                              />
                            </label>
                            <button
                              type="button"
                              className="app-allow-plan-slot__delete"
                              onClick={() => removeAppAllowanceSlot(slot.localId)}
                            >
                              삭제
                            </button>
                          </div>
                          {slot.reason ? (
                            <p className="app-allow-plan-slot__reason">{slot.reason}</p>
                          ) : null}
                          <div className="app-allow-plan-slot__apps">
                            {slot.allowedApps.length > 0 ? (
                              slot.allowedApps.map(app => (
                                <button
                                  key={app.id}
                                  type="button"
                                  className={
                                    "app-allow-plan-chip app-allow-plan-chip--selected" +
                                    (isDaechiRootApp(app)
                                      ? " app-allow-plan-chip--locked"
                                      : "")
                                  }
                                  onClick={() =>
                                    toggleAppAllowanceAllowedApp(slot.localId, app)
                                  }
                                  disabled={isDaechiRootApp(app)}
                                >
                                  {app.name}
                                  <span className="app-allow-plan-chip__remove">
                                    {isDaechiRootApp(app) ? "고정" : "x"}
                                  </span>
                                </button>
                              ))
                            ) : (
                              <span className="app-allow-plan-chip app-allow-plan-chip--empty">
                                허용 앱 없음
                              </span>
                            )}
                          </div>
                          <div className="app-allow-plan-slot__actions">
                            <button
                              type="button"
                              className="modal-secondary app-allow-plan-slot__picker-toggle"
                              onClick={() =>
                                setAppAllowancePickerSlotId(current =>
                                  current === slot.localId ? null : slot.localId
                                )
                              }
                            >
                              {appAllowancePickerSlotId === slot.localId
                                ? "허용 앱 접기"
                                : "허용 앱 편집"}
                            </button>
                          </div>
                          {appAllowancePickerSlotId === slot.localId ? (
                            <div className="app-allow-plan-slot__picker">
                              {availableAppAllowanceApps.length > 0 ? (
                                availableAppAllowanceApps.map(app => {
                                  const selected = slot.allowedApps.some(
                                    item => item.id === app.id
                                  );
                                  return (
                                    <button
                                      key={`${slot.localId}-${app.id}`}
                                      type="button"
                                      className={
                                        "app-allow-plan-chip app-allow-plan-chip--picker" +
                                        (selected
                                          ? " app-allow-plan-chip--picker-selected"
                                          : "")
                                      }
                                      onClick={() =>
                                        toggleAppAllowanceAllowedApp(slot.localId, app)
                                      }
                                      disabled={isDaechiRootApp(app)}
                                    >
                                      {app.name}
                                    </button>
                                  );
                                })
                              ) : (
                                <p className="app-allow-plan-slot__picker-empty">
                                  불러온 설치 앱이 없어 허용 앱을 추가할 수 없습니다.
                                </p>
                              )}
                            </div>
                          ) : null}
                        </section>
                      ))}
                    </div>
                  ) : (
                    <p className="app-allow-plan-empty">
                      내일 일정이나 계획 시간이 더 정리되면 시간대별 허용 앱을 더 정확히 추천할 수 있어요.
                    </p>
                  )}
                  {appAllowancePlan.usedOpenAi && appAllowancePlan.model ? (
                    <p className="app-allow-plan-model">생성 모델: {appAllowancePlan.model}</p>
                  ) : null}
                </div>
                <div className="dday-modal-footer">
                  <button
                    type="button"
                    className="modal-secondary"
                    onClick={() => {
                      setAppAllowancePickerSlotId(null);
                      appAllowanceReveal.beginClose(() => setAppAllowancePlan(null));
                    }}
                  >
                    닫기
                  </button>
                  <button
                    type="button"
                    className="modal-primary"
                    onClick={() => void requestParentAppAllowanceReview()}
                    disabled={appAllowanceRequesting}
                  >
                    {appAllowanceRequesting ? "요청 중..." : "요청하기"}
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}

      {timePicker !== null && (
        <TimePickerSheet
          open
          title={
            timePicker.kind === "tomorrow-plan"
              ? timePicker.field === "start"
                ? "시작 시간"
                : "종료 시간"
              : timePicker.field === "startTime"
                ? "허용 시작 시간"
                : "허용 종료 시간"
          }
          value={
            timePicker.kind === "tomorrow-plan"
              ? tomorrowPlan[timePicker.bookId]?.[timePicker.field] || ""
              : getEditableTimeValue(
                  appAllowancePlan?.slots.find(slot => slot.localId === timePicker.slotId)?.[
                    timePicker.field
                  ] || ""
                )
          }
          onClose={() => setTimePicker(null)}
          onConfirm={hhmm => {
            if (timePicker.kind === "tomorrow-plan") {
              const { bookId, field } = timePicker;
              setTomorrowPlan(prev => {
                const cur = prev[bookId];
                return {
                  ...prev,
                  [bookId]: {
                    text: cur?.text ?? "",
                    start: cur?.start,
                    end: cur?.end,
                    [field]: hhmm
                  }
                };
              });
            } else {
              updateAppAllowanceTime(timePicker.slotId, timePicker.field, hhmm);
            }
            setTimePicker(null);
            hapticSuccess();
          }}
          hapticSelection={hapticSelection}
        />
      )}

      {coachPlanHintOpen
        ? createPortal(
            <div
              className={
                "dday-modal" +
                (coachPlanHintReveal.revealed ? " dday-modal--open" : "")
              }
              onClick={() =>
                coachPlanHintReveal.beginClose(() => setCoachPlanHintOpen(false))
              }
              role="presentation"
            >
              <div
                className="dday-modal-inner"
                onClick={e => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby="coach-plan-hint-title"
              >
                <div className="dday-modal-header">
                  <span className="dday-modal-title" id="coach-plan-hint-title">
                    오늘 기록을 먼저 작성해 주세요
                  </span>
                </div>
                <div className="dday-modal-body">
                  <p
                    className="settings-hint"
                    style={{
                      marginTop: 0,
                      lineHeight: 1.55,
                      fontSize: "var(--font-size-medium)"
                    }}
                  >
                    AI 코치와 내일 계획을 세울 때는, 기록 탭에 적어 둔 오늘 생활 좋았던 점과
                    나빴던 점, 그리고 오늘 탭에서 공부한 내용을 함께 참고하는 방식으로
                    이어갈 예정이에요. 먼저 아래 항목을 채운 뒤 다시 눌러 주세요.
                  </p>
                  {coachPlanHintKind === "study" ? (
                    <ul
                      className="settings-hint"
                      style={{
                        margin: "12px 0 0",
                        paddingLeft: 18,
                        lineHeight: 1.6,
                        fontSize: "var(--font-size-medium)"
                      }}
                    >
                      <li>오늘 학습 시간</li>
                      <li>오늘 공부 좋았던 점과 나빴던 점</li>
                      <li>오늘 공부한 내용을 설명해보세요</li>
                    </ul>
                  ) : (
                    <ul
                      className="settings-hint"
                      style={{
                        margin: "12px 0 0",
                        paddingLeft: 18,
                        lineHeight: 1.6,
                        fontSize: "var(--font-size-medium)"
                      }}
                    >
                      <li>오늘 생활 좋았던 점과 나빴던 점</li>
                    </ul>
                  )}
                </div>
                <div className="dday-modal-footer">
                  <button
                    type="button"
                    className="modal-primary"
                    onClick={() =>
                      coachPlanHintReveal.beginClose(() =>
                        setCoachPlanHintOpen(false)
                      )
                    }
                  >
                    확인
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
