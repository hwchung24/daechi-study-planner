import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { Capacitor } from "@capacitor/core";
import { AppConfig } from "@capacitor-community/mdm-appconfig";
import { LocalNotifications } from "@capacitor/local-notifications";
import { Bell, BellDot, ChevronLeft } from "lucide-react";
import SplashScreen from "./SplashScreen";
import { AuthScreen } from "./components/AuthScreen";
import { AppBottomNav } from "./components/AppBottomNav";
import { PageTransition } from "./components/PageTransition";
import type { ParentTabKey } from "./components/parent/ParentLegacyView";
import type { TabKey } from "./components/student/StudentLegacyView";
import type { ParentStudentRow } from "./types/parent";
import type { ParentNotificationAction } from "./components/student/NotificationsPage";
import { TimePickerInline } from "./components/TimePickerSheet";
import { NativeKeyboardInputManager } from "./components/NativeKeyboardInputManager";
import { useOnlineStatus } from "./hooks/useOnlineStatus";
import { canUseNativeAppShell, AppShell, type PendingNetworkBanner } from "./lib/nativeAppShell";
import { DAECHI_LINKS_UPDATED_EVENT } from "./lib/linkEvents";
import type { StudentTabKey as CoachStudentTabKey } from "./coach/student/StudentCoachApp";
import type { ParentTabKey as ParentCoachShellTab } from "./coach/parent/ParentCoachApp";
import {
  hapticImpactLight,
  hapticImpactMedium,
  hapticSelection,
  hapticSuccess,
  hapticWarning
} from "./lib/haptics";
import {
  getInitialRoute,
  injectSerialIntoLocation,
  readCoachPanelParamFromHash,
  parseCoachParentTabFromHash,
  parseCoachStudentTabFromHash,
  parseParentTabFromHash,
  parseRouteFromHash,
  parseStudentTabFromHash,
  persistSerial,
  resolvePreferredSerial,
  scrubSerialFromLocation
} from "./lib/hashRouteUtils";
import {
  getAppPath,
  replaceAppPath,
  setAppPath,
  subscribeAppPathChange
} from "./lib/appNavigation";
import {
  getDateKey,
  getDateKeySeoul,
  getWeekStartKey,
  getWeekStartKeySeoul,
  seoulDateKeyFromApiValue
} from "./lib/weekDates";
import { MODAL_TRANSITION_MS } from "./lib/uiTiming";
import { useModalReveal } from "./lib/useModalReveal";
import { API_BASE } from "./lib/apiBase";
import {
  buildStoreAppsCacheKey,
  buildStudentCoachStateCacheKey,
  normalizeLocalCacheScope,
  readLocalCache,
  readStoredUserCacheScope,
  writeLocalCache
} from "./lib/viewCache";
import {
  DAECHI_COACH_LOG_SAVED_EVENT,
  DAECHI_COACH_LOG_SAVED_STORAGE_KEY
} from "./lib/coachEvents";
import {
  buildStudentAlarmSettingsCacheKey,
  readStudentAlarmSettings,
  STUDENT_ALARM_SETTINGS_UPDATED_EVENT,
  writeStudentAlarmSettings,
  type StudentAlarmSettings
} from "./lib/studentAlarmSettings";
import {
  getNativeStudyRoomTrackingStatus,
  requestNativeStudyRoomTrackingPermissions,
  startNativeStudyRoomTracking,
  stopNativeStudyRoomTracking
} from "./lib/nativeStudyRoomTracking";
import {
  getNativePushStatus,
  registerNativePushNotifications,
  requestNativePushPermissions
} from "./lib/nativePushNotifications";
import { isDocumentVisible, trackAsync } from "./lib/perfMetrics";
import {
  scheduleBackgroundUiUpdate,
  stableStringify
} from "./lib/stableUiUpdate";
import { storeIconAssetList } from "./lib/storeIconAssets";
import { preloadImageAssets } from "./lib/preloadAssets";
import type { ParentLockStatus, StudentLockStatus } from "./types/lockStatus";
import type { ProgressBook, ProgressPlan, StudyBlock } from "./types/planner";

const ParentLegacyView = React.lazy(() =>
  import("./components/parent/ParentLegacyView").then(module => ({
    default: module.ParentLegacyView
  }))
);
const StudentLegacyView = React.lazy(() =>
  import("./components/student/StudentLegacyView").then(module => ({
    default: module.StudentLegacyView
  }))
);
const StudentProfilePage = React.lazy(() =>
  import("./components/student/StudentProfilePage").then(module => ({
    default: module.StudentProfilePage
  }))
);
const NotificationsPage = React.lazy(() =>
  import("./components/student/NotificationsPage").then(module => ({
    default: module.NotificationsPage
  }))
);
const StudentCoachApp = React.lazy(() =>
  import("./coach/student/StudentCoachApp").then(module => ({
    default: module.StudentCoachApp
  }))
);
const ParentCoachApp = React.lazy(() =>
  import("./coach/parent/ParentCoachApp").then(module => ({
    default: module.ParentCoachApp
  }))
);

/** lazy 라우트 청크 로딩 시 큰 텍스트 플래시 대신 얇은 스켈레톤만 표시 */
function AppRouteSuspenseFallback() {
  return (
    <div className="app-route-suspense-fallback" aria-hidden>
      <div className="app-route-suspense-fallback__pulse" />
    </div>
  );
}

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

type AppRoute = "student" | "parent" | "auth";

type KioskPopupKind = "planner-enter" | "planner-release" | null;

type ParentPlanAddRequestRow = {
  id: number;
  student_user_id: number;
  target_date: string;
  book_id: number;
  planned_range: string | null;
  start_time: string;
  end_time: string;
  subject_snapshot: string;
  created_at: string;
  student_email: string;
};

type ParentAppTimetableRequestDetail = {
  studentEmail: string;
  targetDate: string;
  summary: string;
  slotSummary: string;
  slots: Array<{
    dayKey?: "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
    title?: string;
    source?: "schedule" | "plan" | "free";
    startTime?: string;
    endTime?: string;
    reason?: string;
    allowedApps?: Array<{
      id?: string;
      name?: string;
      category?: string;
      description?: string | null;
      bundleId?: string | null;
    }>;
  }>;
};

type ActiveStudyReminder = {
  reminderKey: string;
  blockId: number;
  subject: string;
  start: string;
  end: string;
  plannedRange?: string;
};

const STUDENT_SETUP_PROMPT_PENDING_KEY_PREFIX =
  "daechi_student_setup_prompt_pending:";
const ME_CACHE_KEY = "daechi_me_cache";
const STUDY_REMINDER_NOTIFICATION_IDS_STORAGE_PREFIX =
  "daechi_study_reminder_notification_ids:";
const STUDY_REMINDER_SHOWN_STORAGE_PREFIX = "daechi_study_reminder_shown:";
const IOS_PUSH_BUNDLE_ID = "com.daechiroot.ios";
const STORE_APPS_CACHE_TTL_MS = 10 * 60 * 1000;

type CachedMeState = {
  role: string | null;
  email: string | null;
  initialProfileCompleted: boolean;
  grade: string;
  goal: string;
  goalUniversity: string;
  targetGrade: string;
  currentConcern: string;
  weakness: string;
};

function getStudentSetupPromptPendingKey(email: string) {
  return `${STUDENT_SETUP_PROMPT_PENDING_KEY_PREFIX}${String(email).trim().toLowerCase()}`;
}

function armStudentSetupPrompt(email: string) {
  try {
    const normalized = String(email).trim().toLowerCase();
    if (!normalized) return;
    localStorage.setItem(getStudentSetupPromptPendingKey(normalized), "1");
  } catch {
    // ignore
  }
}

function consumeStudentSetupPrompt(email: string) {
  try {
    const normalized = String(email).trim().toLowerCase();
    if (!normalized) return false;
    const key = getStudentSetupPromptPendingKey(normalized);
    const armed = localStorage.getItem(key) === "1";
    if (armed) {
      localStorage.removeItem(key);
    }
    return armed;
  } catch {
    return false;
  }
}

function readCachedMeState(): CachedMeState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(ME_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedMeState>;
    return {
      role:
        parsed.role != null && String(parsed.role).trim() !== ""
          ? String(parsed.role).trim().toLowerCase()
          : null,
      email:
        parsed.email != null && String(parsed.email).trim() !== ""
          ? String(parsed.email).trim().toLowerCase()
          : null,
      initialProfileCompleted: Boolean(parsed.initialProfileCompleted),
      grade: String(parsed.grade ?? "").trim(),
      goal: String(parsed.goal ?? "").trim(),
      goalUniversity: String(parsed.goalUniversity ?? "").trim(),
      targetGrade: String(parsed.targetGrade ?? "").trim(),
      currentConcern: String(parsed.currentConcern ?? "").trim(),
      weakness: String(parsed.weakness ?? "").trim()
    };
  } catch {
    return null;
  }
}

function writeCachedMeState(next: CachedMeState) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(ME_CACHE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

function clearCachedMeState() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(ME_CACHE_KEY);
  } catch {
    // ignore
  }
}

function normalizeDayKey(raw: string | undefined | null): string {
  return String(raw ?? "")
    .trim()
    .slice(0, 10);
}

/** DB/API 시간 문자열 → HH:MM 표시 */
function normalizeBlockTime(t: string | null | undefined): string {
  const s = String(t ?? "").trim();
  if (!s) return "";
  return s.length >= 5 ? s.slice(0, 5) : s;
}

/** "H:MM" / "HH:MM" 정렬용 */
function blockTimeSortKey(t: string): number {
  const m = String(t).trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

function sortStudyBlocksByStart(blocks: StudyBlock[]): StudyBlock[] {
  return [...blocks].sort(
    (a, b) => blockTimeSortKey(a.start) - blockTimeSortKey(b.start)
  );
}

type WeekApiPayload = {
  days?: Array<{ id: number | string; date: string }>;
  blocks?: Array<{
    id: number;
    study_day_id: number | string;
    subject: string;
    start_time: string;
    end_time: string;
    done: boolean | number;
    book_id?: number | string | null;
    planned_range?: string | null;
  }>;
};

/** /api/week 응답에서 서울 기준 오늘 칸 블록만 추출 */
function extractTodayBlocksFromWeekApi(
  dataScroll: WeekApiPayload,
  wantTodayKey: string
): StudyBlock[] {
  const todayDay =
    dataScroll.days?.find(
      d => seoulDateKeyFromApiValue(d.date) === wantTodayKey
    ) ?? null;
  const todayDayId = todayDay ? Number(todayDay.id) : NaN;
  if (!todayDay || !Number.isFinite(todayDayId)) return [];
  const rows =
    dataScroll.blocks?.filter(b => {
      const sid = b.study_day_id;
      return (
        Number(sid) === todayDayId ||
        String(sid) === String(todayDayId)
      );
    }) ?? [];
  const todayBlocks: StudyBlock[] = rows.map(b => {
    const bid = b.book_id;
    const bookIdNum =
      bid != null && bid !== "" ? Number(bid) : undefined;
    return {
      id: b.id,
      subject: b.subject,
      start: normalizeBlockTime(b.start_time),
      end: normalizeBlockTime(b.end_time),
      done: !!b.done,
      bookId:
        bookIdNum != null && Number.isFinite(bookIdNum) ? bookIdNum : undefined,
      plannedRange:
        b.planned_range != null && String(b.planned_range).trim() !== ""
          ? String(b.planned_range).trim()
          : undefined
    };
  });
  return sortStudyBlocksByStart(todayBlocks);
}

/**
 * 저장 직전 서버 최신 목록을 기준으로 하고, 클라이언트가 바꾼 done만 반영.
 * 학부모가 승인해 추가된 블록이 로컬 state에 없을 때 PUT으로 지워지지 않게 함.
 */
function mergeServerTodayWithLocalDone(
  serverToday: StudyBlock[],
  localNext: StudyBlock[]
): StudyBlock[] {
  const localById = new Map(localNext.map(b => [b.id, b]));
  return serverToday.map(sb => {
    const loc = localById.get(sb.id);
    return loc ? { ...sb, done: loc.done } : sb;
  });
}

function studyReminderScope(email: string | null) {
  const normalized = String(email || "").trim().toLowerCase();
  return normalized || "anonymous";
}

function buildStudyReminderNotificationStorageKey(scope: string) {
  return `${STUDY_REMINDER_NOTIFICATION_IDS_STORAGE_PREFIX}${scope}`;
}

function buildStudyReminderShownStorageKey(scope: string, dayKey: string) {
  return `${STUDY_REMINDER_SHOWN_STORAGE_PREFIX}${scope}:${dayKey}`;
}

function readStoredNumberList(key: string): number[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(value => Number(value))
      .filter(value => Number.isInteger(value) && value > 0);
  } catch {
    return [];
  }
}

function writeStoredNumberList(key: string, values: number[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(values));
  } catch {
    // ignore
  }
}

function readShownReminderKeys(scope: string, dayKey: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(buildStudyReminderShownStorageKey(scope, dayKey));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(value => String(value || "").trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function hasShownReminder(scope: string, dayKey: string, reminderKey: string) {
  return readShownReminderKeys(scope, dayKey).includes(reminderKey);
}

function markReminderShown(scope: string, dayKey: string, reminderKey: string) {
  if (typeof window === "undefined") return;
  const storageKey = buildStudyReminderShownStorageKey(scope, dayKey);
  const next = Array.from(
    new Set([...readShownReminderKeys(scope, dayKey), reminderKey])
  );
  try {
    localStorage.setItem(storageKey, JSON.stringify(next));
  } catch {
    // ignore
  }
}

function buildStudyReminderKey(dayKey: string, block: StudyBlock) {
  return [
    dayKey,
    normalizeBlockTime(block.start),
    normalizeBlockTime(block.end),
    String(block.subject || "").trim(),
    String(block.plannedRange || "").trim()
  ].join("|");
}

function buildStudyReminderNotificationId(reminderKey: string) {
  let hash = 0;
  for (let index = 0; index < reminderKey.length; index += 1) {
    hash = (hash * 31 + reminderKey.charCodeAt(index)) % 1000000000;
  }
  return 100000000 + hash;
}

function parseTimeParts(value: string) {
  const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function getSeoulCurrentHm() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(new Date());
  const hour = parts.find(part => part.type === "hour")?.value || "00";
  const minute = parts.find(part => part.type === "minute")?.value || "00";
  return `${hour}:${minute}`;
}

function buildTodayReminderDate(startTime: string) {
  const parsed = parseTimeParts(startTime);
  if (!parsed) return null;
  const at = new Date();
  at.setHours(parsed.hour, parsed.minute, 0, 0);
  return at;
}

function buildStudyReminderBody(block: StudyBlock) {
  const plan = String(block.plannedRange || "").trim();
  return plan
    ? `${block.start} ${block.subject} 공부를 시작할 시간입니다. ${plan}`
    : `${block.start} ${block.subject} 공부를 시작할 시간입니다.`;
}

function hasAuthorizedStudyRoomTrackingPermission(status: string | null | undefined) {
  const normalized = String(status || "").trim().toLowerCase();
  return (
    normalized === "authorized" ||
    normalized === "authorized_when_in_use" ||
    normalized === "authorized_always"
  );
}

/**
 * GET /api/student/plans-by-date 의 plans → ProgressPlan.
 * DB의 book_id와 현재 책 목록 id가 다를 수 있음(삭제 후 같은 이름으로 재추가 등)이라
 * book_name으로 현재 목록의 id에 먼저 맞춘 뒤, 없으면 book_id로 매칭합니다.
 */
function buildTomorrowPlanFromPlanRows(
  plans:
    | Array<{
        book_id: number | string;
        book_name?: string | null;
        planned_range: string | null;
        start_time: string | null;
        end_time: string | null;
      }>
    | undefined
    | null,
  books: ProgressBook[]
): ProgressPlan {
  const nextPlan: ProgressPlan = {};
  if (!plans?.length) return nextPlan;
  const byId = new Map(books.map(b => [b.id, b]));
  for (const p of plans) {
    const name = String(p.book_name ?? "").trim();
    let targetId: number | undefined;
    if (name) {
      const match = books.find(b => b.name.trim() === name);
      if (match) targetId = match.id;
    }
    if (targetId === undefined) {
      const bid = Number(p.book_id);
      if (Number.isFinite(bid) && byId.has(bid)) targetId = bid;
    }
    if (targetId === undefined) continue;
    nextPlan[targetId] = {
      text: String(p.planned_range ?? ""),
      start: p.start_time ? String(p.start_time).slice(0, 5) : "",
      end: p.end_time ? String(p.end_time).slice(0, 5) : ""
    };
  }
  return nextPlan;
}

/** 개발 모드 Strict Mode 재마운트 시 스플래시가 두 번 뜨는 것 방지 */
let splashCompletedModule = false;

function isLikelyKoreanMobileDigits(raw: string) {
  const d = String(raw || "").replace(/\D/g, "");
  return /^01[016789]\d{7,8}$/.test(d);
}

const App: React.FC = () => {
  const online = useOnlineStatus();
  const [networkBanner, setNetworkBanner] = useState<PendingNetworkBanner | null>(null);
  const onlineRef = useRef(online);

  const [userEmail, setUserEmail] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      return localStorage.getItem("daechi_planner_user_email");
    } catch {
      return null;
    }
  });
  const [authToken, setAuthToken] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      return localStorage.getItem("daechi_planner_token");
    } catch {
      return null;
    }
  });
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [authRole, setAuthRole] = useState<"student" | "parent">("student");
  const [authStudentName, setAuthStudentName] = useState("");
  const [authParentPhone, setAuthParentPhone] = useState("");
  const [authParentPhoneCode, setAuthParentPhoneCode] = useState("");
  const [authParentPhoneVerifyToken, setAuthParentPhoneVerifyToken] = useState<
    string | null
  >(null);
  const [authParentPhoneSending, setAuthParentPhoneSending] = useState(false);
  const [authParentPhoneVerifying, setAuthParentPhoneVerifying] = useState(false);
  const [authParentPhoneNotice, setAuthParentPhoneNotice] = useState("");
  const [authParentPhoneNoticeTone, setAuthParentPhoneNoticeTone] = useState<
    "neutral" | "success" | "error"
  >("neutral");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [blocks, setBlocks] = useState<StudyBlock[]>([]);
  /** 오늘 탭에서 공부 계획(블록) 주기적 재조회(학부모 승인 반영) */
  const [timelineRefreshNonce, setTimelineRefreshNonce] = useState(0);

  const [tab, setTab] = useState<TabKey>("today");
  const [route, setRoute] = useState<AppRoute>(getInitialRoute);
  const [splashDone, setSplashDone] = useState(
    () => splashCompletedModule
  );
  /** 로그인 직후 인증 화면 페이드아웃 → 메인 페이드인 */
  const [authLeaving, setAuthLeaving] = useState(false);
  const [mainEnter, setMainEnter] = useState(false);
  const [headerScrolled, setHeaderScrolled] = useState(false);
  const [meRole, setMeRole] = useState<string | null>(
    () => readCachedMeState()?.role ?? null
  );
  /** /api/me 1회 이상 끝났는지(실패 포함). false면 헤더에 무한 «불러오는 중» */
  const [meRoleResolved, setMeRoleResolved] = useState(true);
  const [profileLoadError, setProfileLoadError] = useState<string | null>(
    null
  );
  const [meFetchNonce, setMeFetchNonce] = useState(0);
  /** 기록 탭 저장 시 코치용 coach/state(메모·학습 시간 등) 재동기화 */
  const [coachLogSyncNonce, setCoachLogSyncNonce] = useState(0);
  /** 오늘 계획 수정 요청: study_books.id */
  const [addBlockBookId, setAddBlockBookId] = useState<number | null>(null);
  const [addBlockPlan, setAddBlockPlan] = useState("");
  const [startInput, setStartInput] = useState("18:00");
  const [endInput, setEndInput] = useState("19:00");
  const [showAddModal, setShowAddModal] = useState(false);
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [kioskPopupKind, setKioskPopupKind] = useState<KioskPopupKind>(null);
  const [authConfirmKind, setAuthConfirmKind] = useState<
    "logout" | "withdraw" | null
  >(null);
  const [studentSetupOpen, setStudentSetupOpen] = useState(false);
  const [studentSetupGrade, setStudentSetupGrade] = useState("");
  const [studentSetupGoalUniversity, setStudentSetupGoalUniversity] =
    useState("");
  const [studentSetupTargetGrade, setStudentSetupTargetGrade] = useState("");
  const [studentSetupCurrentConcern, setStudentSetupCurrentConcern] =
    useState("");
  const [studentSetupWeakness, setStudentSetupWeakness] = useState("");
  const [studentSetupSaving, setStudentSetupSaving] = useState(false);
  const [studentSetupError, setStudentSetupError] = useState("");
  const [studentInitialProfileCompleted, setStudentInitialProfileCompleted] =
    useState(() => readCachedMeState()?.initialProfileCompleted ?? true);
  const [studentSetupPromptArmed, setStudentSetupPromptArmed] =
    useState(false);
  const [requestReason, setRequestReason] = useState("");

  const [progressWeekOffset, setProgressWeekOffset] = useState(0);
  const [progressBooks, setProgressBooks] = useState<ProgressBook[]>([]);
  const progressBooksRef = useRef<ProgressBook[]>([]);
  useEffect(() => {
    progressBooksRef.current = progressBooks;
  }, [progressBooks]);
  const [checkSettingsOpen, setCheckSettingsOpen] = useState(false);
  const [planRequestNotice, setPlanRequestNotice] = useState("");
  const [showPlanAddNoParentModal, setShowPlanAddNoParentModal] =
    useState(false);
  const [parentPlanAddRequests, setParentPlanAddRequests] = useState<
    ParentPlanAddRequestRow[]
  >([]);
  const [parentPlanAddBusy, setParentPlanAddBusy] = useState(false);
  const [showNotificationsModal, setShowNotificationsModal] = useState(false);
  const [parentAppTimetableRequestDetail, setParentAppTimetableRequestDetail] =
    useState<ParentAppTimetableRequestDetail | null>(null);
  const [parentAppTimetableRequestBusy, setParentAppTimetableRequestBusy] =
    useState(false);
  const [parentAppTimetableRequestError, setParentAppTimetableRequestError] =
    useState("");
  const [parentStudentsLoaded, setParentStudentsLoaded] = useState(false);
  const [showParentStudentRequiredModal, setShowParentStudentRequiredModal] =
    useState(false);
  const [pendingLinkUnlinkAction, setPendingLinkUnlinkAction] = useState<Extract<
    ParentNotificationAction,
    { type: "link_unlink_request" }
  > | null>(null);
  const [pendingLinkUnlinkBusy, setPendingLinkUnlinkBusy] = useState(false);
  const [pendingLinkUnlinkError, setPendingLinkUnlinkError] = useState("");
  const studentAlarmSettingsKey = useMemo(
    () => buildStudentAlarmSettingsCacheKey(userEmail),
    [userEmail]
  );
  const [studentAlarmSettings, setStudentAlarmSettings] =
    useState<StudentAlarmSettings>(() =>
      readStudentAlarmSettings(buildStudentAlarmSettingsCacheKey(userEmail))
    );
  const [activeStudyReminder, setActiveStudyReminder] =
    useState<ActiveStudyReminder | null>(null);
  const studyReminderScheduleSignatureRef = useRef("");
  const lastStudyReminderScopeRef = useRef<string | null>(null);
  const autoLocationPermissionScopeRef = useRef<string | null>(null);
  const autoTrackingBootstrapScopeRef = useRef<string | null>(null);
  const autoPushRegistrationScopeRef = useRef<string | null>(null);
  const studentLockStatusFastSyncUntilRef = useRef(0);

  useEffect(() => {
    if (!networkBanner?.message) return;
    const timeout = window.setTimeout(() => {
      setNetworkBanner(null);
    }, 3200);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [networkBanner]);

  useEffect(() => {
    if (!canUseNativeAppShell()) return;
    let cancelled = false;
    const run = async () => {
      try {
        const pending = await AppShell.consumePendingNetworkBanner();
        if (cancelled) return;
        if (pending?.message) {
          setNetworkBanner(pending);
        }
      } catch {
        // ignore
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const prev = onlineRef.current;
    onlineRef.current = online;
    if (prev === online) return;

    if (!canUseNativeAppShell()) {
      setNetworkBanner({
        kind: online ? "online" : "offline",
        message: online
          ? "다시 연결되었습니다."
          : "오프라인입니다."
      });
      return;
    }

    if (!online) {
      setNetworkBanner({
        kind: "offline",
        message: "오프라인입니다."
      });
    }
  }, [online]);

  const addModalReveal = useModalReveal(showAddModal);
  const noParentPlanModalReveal = useModalReveal(showPlanAddNoParentModal);
  const parentPlanAddModalReveal = useModalReveal(
    parentPlanAddRequests.length > 0
  );
  const requestModalReveal = useModalReveal(showRequestModal);
  const authConfirmReveal = useModalReveal(authConfirmKind !== null);
  const studentSetupReveal = useModalReveal(studentSetupOpen);
  const checkSettingsModalReveal = useModalReveal(checkSettingsOpen);
  const notificationsModalReveal = useModalReveal(showNotificationsModal);
  const activeStudyReminderReveal = useModalReveal(activeStudyReminder !== null);
  const parentAppTimetableRequestReveal = useModalReveal(
    parentAppTimetableRequestDetail !== null
  );
  const parentStudentRequiredModalReveal = useModalReveal(
    showParentStudentRequiredModal
  );
  const kioskPopupReveal = useModalReveal(kioskPopupKind !== null);
  const kioskTransitionRef = useRef<{
    active: boolean;
    activationSource: "planner_time" | "admin_manual" | "manual" | null;
  } | null>(null);
  const plannerEnterPopupShownRef = useRef(false);
  const shouldShowKioskEnterPopup = useCallback(
    (source: "planner_time" | "admin_manual" | "manual" | null) =>
      source === "planner_time" || source === "admin_manual",
    []
  );

  const [newBookName, setNewBookName] = useState("");
  const [booksModalMounted, setBooksModalMounted] = useState(false);
  const [booksModalReveal, setBooksModalReveal] = useState(false);
  const setBooksModalOpen = useCallback((open: boolean) => {
    if (open) {
      setBooksModalMounted(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setBooksModalReveal(true));
      });
    } else {
      setBooksModalReveal(false);
      window.setTimeout(() => {
        setBooksModalMounted(false);
        setNewBookName("");
      }, MODAL_TRANSITION_MS);
    }
  }, []);
  const [midCheckTime, setMidCheckTime] = useState("14:00");
  const [finalCheckTime, setFinalCheckTime] = useState("22:00");
  const [tomorrowPlan, setTomorrowPlan] = useState<ProgressPlan>({});
  const [todayStudyEvaluation, setTodayStudyEvaluation] = useState("");
  const [todayMetacognitionReflection, setTodayMetacognitionReflection] =
    useState("");
  const [coachTodayMemo, setCoachTodayMemo] = useState("");
  const [coachDraftTomorrowPractice, setCoachDraftTomorrowPractice] =
    useState("");
  const [coachTodayStudyMinutes, setCoachTodayStudyMinutes] = useState<
    number | null
  >(null);

  const [parentStudents, setParentStudents] = useState<ParentStudentRow[]>([]);
  const [parentLinkEmail, setParentLinkEmail] = useState("");
  const [parentStudentId, setParentStudentId] = useState<number | null>(
    null
  );
  const [parentWeekOffset, setParentWeekOffset] = useState(0);
  /** 기록 탭·포그라운드 복귀 시 학부모 주간 데이터 재조회 */
  const [parentWeekRefreshNonce, setParentWeekRefreshNonce] = useState(0);
  const [parentReport, setParentReport] = useState<any>(null);
  const [parentError, setParentError] = useState<string | null>(null);
  const [parentAiDaily, setParentAiDaily] = useState<{
    summary_text: string;
    report_date: string;
    model: string;
    created_at: string;
  } | null>(null);
  const [parentPlannerEnabled, setParentPlannerEnabled] = useState(true);
  const [parentPlannerTime, setParentPlannerTime] = useState("21:00");
  const [parentPlannerSaving, setParentPlannerSaving] = useState(false);
  const [parentPlannerMessage, setParentPlannerMessage] = useState("");
  const [parentTab, setParentTab] = useState<ParentTabKey>(() =>
    parseParentTabFromHash()
  );

  const openParentAppTimetableRequestFromNotification = useCallback(
    (action: ParentNotificationAction) => {
      if (action.type !== "parent_app_timetable_request") return;
      const studentEmail = String(action.studentEmail || "").trim().toLowerCase();
      const targetDate = String(action.targetDate || "").trim();
      const summary = String(action.summary || "").trim();
      const slotSummary = String(action.slotSummary || "").trim();
      const slots = Array.isArray(action.slots) ? action.slots : [];

      if (studentEmail) {
        const matchedStudent = parentStudents.find(
          student => String(student.email || "").trim().toLowerCase() === studentEmail
        );
        if (matchedStudent) {
          setParentStudentId(matchedStudent.id);
        }
      }

        setCoachParentTab("analysis");
        setAppPath("#/parent/analysis");
      notificationsModalReveal.beginClose(() => {
        setShowNotificationsModal(false);
        setParentAppTimetableRequestError("");
        setParentAppTimetableRequestDetail({
          studentEmail,
          targetDate,
          summary,
          slotSummary,
          slots
        });
      });
    },
    [notificationsModalReveal, parentStudents]
  );
  const openLinkUnlinkRequestFromNotification = useCallback(
    (action: ParentNotificationAction) => {
      if (action.type !== "link_unlink_request") return;
      setPendingLinkUnlinkError("");
      notificationsModalReveal.beginClose(() => {
        setShowNotificationsModal(false);
        setPendingLinkUnlinkAction(action);
      });
    },
    [notificationsModalReveal]
  );
  const [coachStudentTab, setCoachStudentTab] = useState<CoachStudentTabKey | null>(
    () => parseCoachStudentTabFromHash()
  );
  const [coachStudentCoachLayout, setCoachStudentCoachLayout] = useState<
    "scroll" | "chat"
  >(() =>
    typeof window !== "undefined" &&
    parseCoachStudentTabFromHash() === "coach"
      ? "chat"
      : "scroll"
  );
  const [coachParentTab, setCoachParentTab] = useState<ParentCoachShellTab | null>(
    () => parseCoachParentTabFromHash()
  );

  type ParentLinkRow = {
    id: number;
    student_email: string;
    student_id: number;
    created_at: string;
  };
  type StudentLinkRow = {
    id: number;
    parent_email: string;
    parent_user_id: number;
    created_at: string;
  };

  const [parentWaitingOnStudent, setParentWaitingOnStudent] = useState<
    ParentLinkRow[]
  >([]);
  const [parentWaitingOnMe, setParentWaitingOnMe] = useState<ParentLinkRow[]>(
    []
  );
  const [studentWaitingOnParent, setStudentWaitingOnParent] = useState<
    StudentLinkRow[]
  >([]);
  const [studentWaitingOnMe, setStudentWaitingOnMe] = useState<
    StudentLinkRow[]
  >([]);
  const [studentParentEmail, setStudentParentEmail] = useState("");
  const [storeApps, setStoreApps] = useState<StudyStoreApp[]>(() =>
    readLocalCache<StudyStoreApp[]>(
      buildStoreAppsCacheKey(readStoredUserCacheScope()),
      STORE_APPS_CACHE_TTL_MS
    )?.value ?? []
  );
  const [storeLoading, setStoreLoading] = useState(false);
  const [storeSavingId, setStoreSavingId] = useState<string | null>(null);
  const [storeError, setStoreError] = useState("");
  const [studentLockStatus, setStudentLockStatus] =
    useState<StudentLockStatus | null>(null);
  const [studentLockMessage, setStudentLockMessage] = useState("");
  const [timelineSyncError, setTimelineSyncError] = useState("");
  const [studentNotificationUnreadCount, setStudentNotificationUnreadCount] =
    useState(0);
  const [parentNotificationUnreadCount, setParentNotificationUnreadCount] =
    useState(0);
  const [parentLockStatus, setParentLockStatus] =
    useState<ParentLockStatus | null>(null);
  const storeAppsCacheKey = useMemo(
    () => buildStoreAppsCacheKey(normalizeLocalCacheScope(userEmail || readStoredUserCacheScope())),
    [userEmail]
  );

  const studentLockStatusSigRef = useRef<string | null>(null);
  const applyStudentLockStatus = useCallback(
    (next: StudentLockStatus | null) => {
      const sig = stableStringify(next);
      if (studentLockStatusSigRef.current === sig) return;
      studentLockStatusSigRef.current = sig;
      scheduleBackgroundUiUpdate(() => setStudentLockStatus(next));
    },
    []
  );

  const timelineBlocksSigRef = useRef<string | null>(null);
  const parentPlanAddSigRef = useRef<string | null>(null);
  const parentStudentsSigRef = useRef<string | null>(null);
  const parentLinkWaitSigRef = useRef<string | null>(null);
  const studentLinkWaitSigRef = useRef<string | null>(null);
  const coachTodayRowSigRef = useRef<string | null>(null);
  const storeAppsSigRef = useRef<string | null>(null);
  const mdmAppliedRef = useRef(false);

  useEffect(() => {
    try {
      const savedEmail = localStorage.getItem("daechi_planner_user_email");
      const savedToken = localStorage.getItem("daechi_planner_token");
      const cachedMe = readCachedMeState();
      if (savedEmail && savedToken) {
        setUserEmail(savedEmail);
        setAuthToken(savedToken);
        if (cachedMe?.role) {
          setMeRole(cachedMe.role);
        }
        setStudentInitialProfileCompleted(
          cachedMe?.initialProfileCompleted ?? true
        );
        setStudentSetupGrade(cachedMe?.grade ?? "");
        setStudentSetupGoalUniversity(cachedMe?.goalUniversity ?? "");
        setStudentSetupTargetGrade(cachedMe?.targetGrade ?? "");
        setStudentSetupCurrentConcern(cachedMe?.currentConcern ?? "");
        setStudentSetupWeakness(cachedMe?.weakness ?? "");
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const run = async () => {
      try {
        const currentSerial = resolvePreferredSerial();
        let managedSerial = "";
        for (const key of ["serial_number", "serial"]) {
          const result = await AppConfig.getValue({ key });
          managedSerial = String(result?.value || "").trim();
          if (managedSerial) break;
        }
        if (!managedSerial) return;
        mdmAppliedRef.current = true;
        if (!currentSerial) {
          injectSerialIntoLocation(managedSerial);
          persistSerial(managedSerial);
        }
      } catch {
        // ignore: web or unmanaged install path
      }
    };
    run();
  }, []);

  useEffect(() => {
    const serial = resolvePreferredSerial();
    if (serial) persistSerial(serial);
  }, []);

  useEffect(() => {
    preloadImageAssets(["/coach-ai-avatar.png", ...storeIconAssetList]);
  }, []);

  useEffect(() => {
    const syncRouteFromHash = () => {
      const path = getAppPath();
      try {
        if (!localStorage.getItem("daechi_planner_token")) {
          setRoute("auth");
          return;
        }
      } catch {
        setRoute("auth");
        return;
      }
      if (path === "#/parent/report" || path === "#/parent/ai-report") {
        replaceAppPath("#/parent/analysis");
        return;
      }
      setRoute(parseRouteFromHash(path));
      if (path === "#/settings") {
        replaceAppPath("#/profile");
      }
      const studentTab = parseStudentTabFromHash(path);
      setTab(studentTab);
      setParentTab(parseParentTabFromHash(path));
      const coachFromHash = parseCoachStudentTabFromHash(path);
      if (coachFromHash === "coach" && readCoachPanelParamFromHash(path) === "analysis") {
        replaceAppPath("#/student/analysis");
        return;
      }
      setCoachStudentTab(coachFromHash);
      setCoachStudentCoachLayout(
        coachFromHash === "coach"
          ? "chat"
          : "scroll"
      );
      setCoachParentTab(parseCoachParentTabFromHash(path));
    };
    const onHash = () => syncRouteFromHash();
    const unsubscribe = subscribeAppPathChange(onHash);
    syncRouteFromHash();
    return unsubscribe;
  }, []);

  /** #/notifications 접근 시 알림 모달만 열고 해시는 오늘 탭으로 정리 */
  useEffect(() => {
    const openModalFromNotificationsHash = () => {
      if (getAppPath() !== "#/notifications") return;
      setShowNotificationsModal(true);
      replaceAppPath("#/today");
    };
    openModalFromNotificationsHash();
    return subscribeAppPathChange(openModalFromNotificationsHash);
  }, []);

  // 미로그인 시 로그인 페이지로 (첫 프레임에서 authToken이 아직 null일 수 있어 localStorage 기준)
  useEffect(() => {
    try {
      if (localStorage.getItem("daechi_planner_token")) return;
      if (getAppPath() !== "#/auth") {
        replaceAppPath("#/auth");
      }
    } catch {
      // ignore
    }
  }, [authToken]);

  // 로그인 상태에서 /#/auth 접근 시 앱으로
  useEffect(() => {
    try {
      if (!localStorage.getItem("daechi_planner_token")) return;
      if (getAppPath() === "#/auth") {
        replaceAppPath("#/");
      }
    } catch {
      // ignore
    }
  }, [authToken]);

  useEffect(() => {
    if (!authToken) {
      setMeRole(null);
      setMeRoleResolved(true);
      setProfileLoadError(null);
      setStudentInitialProfileCompleted(true);
      setStudentSetupPromptArmed(false);
      setStudentSetupOpen(false);
      setStudentSetupGrade("");
      setStudentSetupGoalUniversity("");
      setStudentSetupTargetGrade("");
      setStudentSetupCurrentConcern("");
      setStudentSetupWeakness("");
      setStudentSetupError("");
      clearCachedMeState();
      return;
    }

    let cancelled = false;
    const fallbackRole = meRole;
    setMeRoleResolved(!fallbackRole);
    setProfileLoadError(null);

    const done = () => {
      if (!cancelled) setMeRoleResolved(true);
    };

    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/me`, {
          headers: { Authorization: `Bearer ${authToken}` }
        });
        if (cancelled) return;

        if (res.status === 401) {
          try {
            localStorage.removeItem("daechi_planner_token");
            localStorage.removeItem("daechi_planner_user_email");
          } catch {
            // ignore
          }
          clearCachedMeState();
          setAuthToken(null);
          setUserEmail(null);
          setMeRole(null);
          setAppPath("#/auth");
          done();
          return;
        }

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          if (!fallbackRole) {
            setProfileLoadError(
              String((data as { error?: string }).error || "").trim() ||
                "계정을 불러오지 못했습니다."
            );
            setMeRole(null);
          }
          done();
          return;
        }

        const data = await res.json();
        const nextRole =
          data.role != null && data.role !== ""
            ? String(data.role).toLowerCase()
            : null;
        setMeRole(nextRole);
        if (data.email != null && String(data.email).trim() !== "") {
          const em = String(data.email).trim();
          setUserEmail(em);
          try {
            localStorage.setItem("daechi_planner_user_email", em);
          } catch {
            // ignore
          }
        }
        if (nextRole === "student") {
          const nextEmail =
            data.email != null && String(data.email).trim() !== ""
              ? String(data.email).trim()
              : userEmail;
          const nextAlarmSettings: StudentAlarmSettings = {
            scheduleReminders: Boolean(data.scheduleReminders),
            parentLinkAlerts: Boolean(data.parentLinkAlerts),
            studyRoomAlerts: Boolean(data.studyRoomAlerts),
            messageAlerts: Boolean(data.messageAlerts),
            homeworkAlerts: Boolean(data.homeworkAlerts),
            wakeAlarmEnabled: Boolean(data.wakeAlarmEnabled),
            wakeAlarmTime:
              /^\d{2}:\d{2}$/.test(String(data.wakeAlarmTime || ""))
                ? String(data.wakeAlarmTime)
                : "06:30"
          };
          writeStudentAlarmSettings(
            buildStudentAlarmSettingsCacheKey(nextEmail),
            nextAlarmSettings
          );
          setStudentAlarmSettings(nextAlarmSettings);
          const initialCompleted = Boolean(data.initial_profile_completed);
          setStudentInitialProfileCompleted(initialCompleted);
          setStudentSetupGrade(
            data.grade != null && String(data.grade).trim() !== ""
              ? String(data.grade).trim()
              : ""
          );
          setStudentSetupGoalUniversity(String(data.goal_university ?? "").trim());
          setStudentSetupTargetGrade(String(data.target_grade ?? "").trim());
          setStudentSetupCurrentConcern(String(data.current_concern ?? "").trim());
          setStudentSetupWeakness(String(data.weakness ?? "").trim());
        } else {
          setStudentInitialProfileCompleted(true);
          setStudentSetupOpen(false);
          setStudentSetupGrade("");
          setStudentSetupGoalUniversity("");
          setStudentSetupTargetGrade("");
          setStudentSetupCurrentConcern("");
          setStudentSetupWeakness("");
          setStudentSetupError("");
        }
        writeCachedMeState({
          role: nextRole,
          email:
            data.email != null && String(data.email).trim() !== ""
              ? String(data.email).trim().toLowerCase()
              : userEmail,
          initialProfileCompleted:
            nextRole === "student"
              ? Boolean(data.initial_profile_completed)
              : true,
          grade:
            nextRole === "student" &&
            data.grade != null &&
            String(data.grade).trim() !== ""
              ? String(data.grade).trim()
              : "",
          goal: nextRole === "student" ? String(data.goal ?? "").trim() : "",
          goalUniversity:
            nextRole === "student"
              ? String(data.goal_university ?? "").trim()
              : "",
          targetGrade:
            nextRole === "student"
              ? String(data.target_grade ?? "").trim()
              : "",
          currentConcern:
            nextRole === "student"
              ? String(data.current_concern ?? "").trim()
              : "",
          weakness:
            nextRole === "student"
              ? String(data.weakness ?? "").trim()
              : ""
        });
        setProfileLoadError(null);
      } catch {
        if (!cancelled) {
          if (!fallbackRole) {
            setProfileLoadError(
              `서버에 연결할 수 없어요. 같은 네트워크에서 서버가 켜져 있는지 확인하세요. (${API_BASE})`
            );
            setMeRole(null);
          }
        }
      } finally {
        done();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authToken, meFetchNonce, meRole, userEmail]);

  useEffect(() => {
    if (!authToken || !userEmail) {
      setStudentSetupPromptArmed(false);
      return;
    }
    setStudentSetupPromptArmed(consumeStudentSetupPrompt(userEmail));
  }, [authToken, userEmail]);

  /** 로그인 직후 lazy 라우트 청크를 미리 받아 탭·페이지 전환 시 Suspense 플래시를 줄임 */
  useEffect(() => {
    if (!authToken || !meRoleResolved || !meRole) return;
    const prefetch = () => {
      void import("./coach/parent/ParentCoachApp");
      void import("./coach/student/StudentCoachApp");
      void import("./components/parent/ParentLegacyView");
      void import("./components/student/StudentLegacyView");
      void import("./components/student/StudentProfilePage");
      void import("./components/student/NotificationsPage");
    };
    const ric = window.requestIdleCallback;
    if (typeof ric === "function") {
      const id = ric.call(window, prefetch, { timeout: 2000 });
      return () => {
        window.cancelIdleCallback?.(id);
      };
    }
    const t = window.setTimeout(prefetch, 200);
    return () => window.clearTimeout(t);
  }, [authToken, meRole, meRoleResolved]);

  /** 학부모 세션: 큰 화면(웹) 전제로 토큰·패딩 조밀 — 포털 모달까지 html에서 상속 */
  useEffect(() => {
    const active =
      splashDone && route !== "auth" && meRole === "parent";
    document.documentElement.classList.toggle("parent-session", active);
    return () => {
      document.documentElement.classList.remove("parent-session");
    };
  }, [splashDone, route, meRole]);

  useEffect(() => {
    if (
      !authToken ||
      route === "auth" ||
      !meRoleResolved ||
      profileLoadError ||
      meRole !== "student" ||
      studentInitialProfileCompleted ||
      !studentSetupPromptArmed
    ) {
      if (!authToken || route === "auth" || meRole !== "student") {
        setStudentSetupOpen(false);
      }
      return;
    }
    setStudentSetupError("");
    setStudentSetupOpen(true);
  }, [
    authToken,
    route,
    meRoleResolved,
    profileLoadError,
    meRole,
    studentInitialProfileCompleted,
    studentSetupPromptArmed
  ]);

  useEffect(() => {
    if (Capacitor.getPlatform() !== "ios") return;
    if (!authToken || route === "auth" || !meRoleResolved || !userEmail) {
      autoPushRegistrationScopeRef.current = null;
      return;
    }

    const scope = `${String(userEmail).trim().toLowerCase()}::${authToken}`;
    if (autoPushRegistrationScopeRef.current === scope) {
      return;
    }
    autoPushRegistrationScopeRef.current = scope;

    let cancelled = false;
    const ensurePushRegistrationReady = async () => {
      try {
        let status = await getNativePushStatus();
        if (cancelled) return;

        if (
          status.permissionStatus !== "authorized" &&
          status.permissionStatus !== "provisional" &&
          status.permissionStatus !== "ephemeral"
        ) {
          status = await requestNativePushPermissions();
          if (cancelled) return;
        }

        if (
          status.permissionStatus !== "authorized" &&
          status.permissionStatus !== "provisional" &&
          status.permissionStatus !== "ephemeral"
        ) {
          return;
        }

        status = await registerNativePushNotifications();
        if (cancelled || !status.deviceToken) return;

        await fetch(`${API_BASE}/api/push/register-token`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken}`
          },
          body: JSON.stringify({
            platform: "ios",
            deviceToken: status.deviceToken,
            bundleId: IOS_PUSH_BUNDLE_ID
          })
        }).catch(() => {
          // ignore token registration failures; retry on next auth scope
        });
      } catch {
        // ignore native push bootstrap failures
      }
    };

    void ensurePushRegistrationReady();

    return () => {
      cancelled = true;
    };
  }, [authToken, meRoleResolved, route, userEmail]);

  useEffect(() => {
    if (!authToken || route === "auth" || !meRoleResolved || meRole !== "student") {
      autoLocationPermissionScopeRef.current = null;
      autoTrackingBootstrapScopeRef.current = null;
      return;
    }

    const permissionScope = `${String(userEmail || "student").trim().toLowerCase()}::${authToken}`;
    if (
      autoLocationPermissionScopeRef.current === permissionScope &&
      autoTrackingBootstrapScopeRef.current === permissionScope
    ) {
      return;
    }

    autoLocationPermissionScopeRef.current = permissionScope;
    autoTrackingBootstrapScopeRef.current = permissionScope;

    let cancelled = false;
    const ensureLocationTrackingReady = async () => {
      try {
        let status = await getNativeStudyRoomTrackingStatus();
        if (cancelled) {
          return;
        }

        if (!hasAuthorizedStudyRoomTrackingPermission(status.authorizationStatus)) {
          await requestNativeStudyRoomTrackingPermissions();
          if (cancelled) {
            return;
          }
          status = await getNativeStudyRoomTrackingStatus();
          if (cancelled || !hasAuthorizedStudyRoomTrackingPermission(status.authorizationStatus)) {
            return;
          }
        }

        if (status.trackingEnabled) {
          return;
        }

        // 독서실이 없어도 heartbeat으로 최근 위치는 쌓이므로, 학생 로그인 시 기본으로 추적을 켭니다.
        await startNativeStudyRoomTracking({
          apiBase: API_BASE,
          authToken
        });
      } catch {
        // ignore automatic location bootstrap failures
      }
    };

    void ensureLocationTrackingReady();

    return () => {
      cancelled = true;
      // React 18 Strict Mode runs mount → cleanup → remount; refs were set
      // synchronously before the async work, so the second mount would skip
      // ensureLocationTrackingReady and never show the system prompt.
      if (autoLocationPermissionScopeRef.current === permissionScope) {
        autoLocationPermissionScopeRef.current = null;
      }
      if (autoTrackingBootstrapScopeRef.current === permissionScope) {
        autoTrackingBootstrapScopeRef.current = null;
      }
    };
  }, [authToken, meRole, meRoleResolved, route, userEmail]);

  useEffect(() => {
    if (!authToken || meRole !== "student") return;
    const run = async () => {
      try {
        await fetch(`${API_BASE}/api/student/mdm-status`, {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken}`
          },
          body: JSON.stringify({ mdmApplied: mdmAppliedRef.current })
        });
        const preferredSerial = resolvePreferredSerial();
        if (preferredSerial) {
          await fetch(`${API_BASE}/api/device/link-serial`, {
            method: "POST",
            credentials: "include",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${authToken}`
            },
            body: JSON.stringify({ serial: preferredSerial })
          });
          persistSerial(preferredSerial);
          scrubSerialFromLocation();
          return;
        }
        await fetch(`${API_BASE}/api/device/link-current`, {
          method: "POST",
          credentials: "include",
          headers: {
            Authorization: `Bearer ${authToken}`
          }
        });
      } catch {
        // ignore
      }
    };
    run();
  }, [authToken, meRole]);

  useEffect(() => {
    if (meRole !== "student") {
      kioskTransitionRef.current = null;
      plannerEnterPopupShownRef.current = false;
      setKioskPopupKind(null);
      return;
    }
    const kioskMode = studentLockStatus?.kioskMode;
    if (!kioskMode || typeof kioskMode.active !== "boolean") {
      return;
    }
    const current = {
      active: Boolean(kioskMode.active),
      activationSource: kioskMode.activationSource || null
    };
    const previous = kioskTransitionRef.current;
    if (!shouldShowKioskEnterPopup(current.activationSource)) {
      plannerEnterPopupShownRef.current = false;
    }
    if (previous) {
      if (
        !previous.active &&
        current.active &&
        shouldShowKioskEnterPopup(current.activationSource) &&
        !plannerEnterPopupShownRef.current
      ) {
        plannerEnterPopupShownRef.current = true;
        setKioskPopupKind("planner-enter");
      }
      if (
        previous.active &&
        previous.activationSource === "planner_time" &&
        !current.active &&
        Boolean(studentLockStatus?.dailyRecordCompletion?.completed)
      ) {
        setKioskPopupKind("planner-release");
        plannerEnterPopupShownRef.current = false;
      }
    } else if (
      current.active &&
      shouldShowKioskEnterPopup(current.activationSource) &&
      !plannerEnterPopupShownRef.current
    ) {
      plannerEnterPopupShownRef.current = true;
      setKioskPopupKind("planner-enter");
    }
    kioskTransitionRef.current = current;
  }, [meRole, shouldShowKioskEnterPopup, studentLockStatus]);

  useEffect(() => {
    if (meRole !== "student") return;
    if (!studentLockStatus?.forceRecordsPage) return;
    const forceToRecords = () => {
      if (getAppPath() !== "#/records") {
        replaceAppPath("#/records");
      }
    };
    forceToRecords();
    return subscribeAppPathChange(forceToRecords);
  }, [meRole, studentLockStatus?.forceRecordsPage]);

  useEffect(() => {
    if (!authToken || meRole !== "student") return;
    let cancelled = false;
    let inFlight = false;
    let pendingImmediateLockRefetch = false;
    let timerId: number | null = null;
    const lockStatusPollIntervalMs =
      tab === "today" || tab === "records" ? 20000 : 60000;
    const lockStatusFastPollIntervalMs = 2500;
    const lockStatusFastPollWindowMs = 120000;
    const run = async (fastSync = false) => {
      if (!isDocumentVisible()) return;
      if (inFlight) {
        if (fastSync) pendingImmediateLockRefetch = true;
        return;
      }
      if (fastSync) {
        studentLockStatusFastSyncUntilRef.current =
          Date.now() + lockStatusFastPollWindowMs;
      }
      inFlight = true;
      try {
        const res = await trackAsync("poll.studentLockStatus", () =>
          fetch(`${API_BASE}/api/student/lock-status`, {
            headers: { Authorization: `Bearer ${authToken}` },
            cache: "no-store"
          })
        );
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) {
          applyStudentLockStatus(data.lockStatus || null);
          if (data.lockStatus?.forceRecordsPage && getAppPath() !== "#/records") {
            setAppPath("#/records");
          }
          if (data.lockStatus?.kioskMode?.active || data.lockStatus?.forceRecordsPage) {
            studentLockStatusFastSyncUntilRef.current =
              Date.now() + lockStatusFastPollWindowMs;
          }
          if (!data.lockStatus?.locked) {
            setStudentLockMessage("");
          }
        }
      } catch {
        // ignore
      } finally {
        inFlight = false;
        if (cancelled) return;
        if (pendingImmediateLockRefetch) {
          pendingImmediateLockRefetch = false;
          void run(false);
          return;
        }
        const inFastSyncWindow =
          Date.now() < studentLockStatusFastSyncUntilRef.current;
        const nextDelay = inFastSyncWindow
          ? lockStatusFastPollIntervalMs
          : lockStatusPollIntervalMs;
        timerId = window.setTimeout(() => {
          void run();
        }, nextDelay);
      }
    };
    void run(true);
    const onLogSaved = () => {
      if (!cancelled) {
        void run(true);
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible" || cancelled) return;
      void run(true);
    };
    const onFocus = () => {
      if (cancelled) return;
      void run(true);
    };
    const onOnline = () => {
      if (cancelled) return;
      void run(true);
    };
    window.addEventListener(DAECHI_COACH_LOG_SAVED_EVENT, onLogSaved);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    return () => {
      cancelled = true;
      if (timerId !== null) {
        window.clearTimeout(timerId);
      }
      window.removeEventListener(DAECHI_COACH_LOG_SAVED_EVENT, onLogSaved);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
    };
  }, [authToken, meRole, tab, applyStudentLockStatus]);

  useEffect(() => {
    if (!authToken || meRole !== "student") {
      setStudentNotificationUnreadCount(0);
      return;
    }
    let cancelled = false;
    const studentNotificationPollIntervalMs =
      tab === "today" || tab === "records" || tab === "profile" ? 25000 : 70000;
    const run = async () => {
      if (!isDocumentVisible()) return;
      try {
        const res = await trackAsync("poll.studentNotificationSummary", () =>
          fetch(
            `${API_BASE}/api/student/notifications/summary`,
            {
              headers: { Authorization: `Bearer ${authToken}` },
              cache: "no-store"
            }
          )
        );
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { unreadCount?: unknown };
        const n = Number(data.unreadCount);
        if (!cancelled && Number.isFinite(n) && n >= 0) {
          setStudentNotificationUnreadCount(Math.floor(n));
        }
      } catch {
        if (!cancelled) setStudentNotificationUnreadCount(0);
      }
    };
    void run();
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible" || cancelled) return;
      void run();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    const timerId = window.setInterval(() => {
      void run();
    }, studentNotificationPollIntervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(timerId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [authToken, meRole, meFetchNonce, tab]);

  useEffect(() => {
    if (!authToken || meRole !== "parent") {
      setParentNotificationUnreadCount(0);
      return;
    }
    let cancelled = false;
    const parentNotificationPollIntervalMs = showNotificationsModal ? 20000 : 45000;
    const run = async () => {
      if (!isDocumentVisible()) return;
      try {
        const res = await trackAsync("poll.parentNotificationSummary", () =>
          fetch(`${API_BASE}/api/parent/notifications/summary`, {
            headers: { Authorization: `Bearer ${authToken}` },
            cache: "no-store"
          })
        );
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { unreadCount?: unknown };
        const n = Number(data.unreadCount);
        if (!cancelled && Number.isFinite(n) && n >= 0) {
          setParentNotificationUnreadCount(Math.floor(n));
        }
      } catch {
        if (!cancelled) setParentNotificationUnreadCount(0);
      }
    };
    void run();
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible" || cancelled) return;
      void run();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    const timerId = window.setInterval(() => {
      void run();
    }, parentNotificationPollIntervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(timerId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [authToken, meRole, meFetchNonce, showNotificationsModal]);

  // 학부모 계정이면 항상 학부모 페이지로 (학습 플래너 대신)
  useEffect(() => {
    if (meRole !== "parent") return;
    if (typeof window === "undefined") return;
    const h = getAppPath();
    if (
      h === "#/parent" ||
      h === "#/parent/home" ||
      h === "#/parent/manage" ||
      h === "#/parent/analysis" ||
      h === "#/parent/student-settings" ||
      h === "#/parent/records" ||
      h === "#/parent/report" ||
      h === "#/parent/profile"
    )
      return;
    setAppPath("#/parent/home");
  }, [meRole]);

  // 학생 계정은 학부모 URL에 있으면 학생 화면으로 복귀
  useEffect(() => {
    if (meRole !== "student") return;
    if (typeof window === "undefined") return;
    const h = getAppPath();
    if (
      h === "#/parent" ||
      h === "#/parent/home" ||
      h === "#/parent/manage" ||
      h === "#/parent/analysis" ||
      h === "#/parent/student-settings" ||
      h === "#/parent/records" ||
      h === "#/parent/report" ||
      h === "#/parent/profile"
    ) {
      setAppPath("#/");
    }
  }, [meRole]);

  // 오늘 공부 계획(블록)을 서버로 동기화 (study_blocks / study_days)
  const syncBlocksToServer = async (
    nextBlocks: StudyBlock[]
  ): Promise<boolean> => {
    if (!authToken) {
      setTimelineSyncError("로그인해 주세요.");
      return false;
    }
    let payloadBlocks = nextBlocks;
    try {
      const mondayStr = getWeekStartKeySeoul(0);
      const weekRes = await fetch(
        `${API_BASE}/api/week?start=${encodeURIComponent(mondayStr)}`,
        { headers: { Authorization: `Bearer ${authToken}` } }
      );
      if (weekRes.ok) {
        const dataScroll = (await weekRes.json()) as WeekApiPayload;
        const wantToday = normalizeDayKey(getDateKeySeoul(0));
        const serverToday = extractTodayBlocksFromWeekApi(dataScroll, wantToday);
        if (serverToday.length > 0) {
          payloadBlocks = mergeServerTodayWithLocalDone(serverToday, nextBlocks);
        }
      }
    } catch {
      /* 네트워크 실패 시 기존 nextBlocks로 저장 시도 */
    }
    try {
      const res = await fetch(`${API_BASE}/api/blocks`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          date: getDateKeySeoul(0),
          blocks: payloadBlocks.map(b => ({
            subject: b.subject,
            startTime: b.start,
            endTime: b.end,
            done: b.done,
            focusScore: null,
            bookId: b.bookId ?? null,
            plannedRange: b.plannedRange?.trim() || null
          }))
        })
      });
      if (res.status === 423) {
        const data = await res.json().catch(() => ({}));
        applyStudentLockStatus(data.lockStatus || null);
        setStudentLockMessage(
          data.error || "잠금 상태에서는 오늘 계획을 수정할 수 없습니다."
        );
        setTimelineSyncError("");
        return false;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setTimelineSyncError(
          String(data.error || "").trim() ||
            "오늘 계획을 저장하지 못했습니다. 잠시 후 다시 시도하세요."
        );
        hapticWarning();
        return false;
      }
      const data = await res.json().catch(() => ({}));
      if (data.lockStatus) {
        applyStudentLockStatus(data.lockStatus);
      }
      setStudentLockMessage("");
      setTimelineSyncError("");
      return true;
    } catch {
      setTimelineSyncError(
        "저장하지 못했습니다. 연결을 확인하세요."
      );
      hapticWarning();
      return false;
    }
  };

  // 학생: 책 목록 + 내일 계획 (주간 스크롤과 무관 — 실패 시 기존 state 유지)
  useEffect(() => {
    if (!authToken || meRole !== "student") return;
    const run = async () => {
      try {
        const tomorrowKey = getDateKey(1);
        const headers = { Authorization: `Bearer ${authToken}` };
        const [booksRes, plansRes] = await Promise.all([
          fetch(`${API_BASE}/api/student/books`, { headers }),
          fetch(
            `${API_BASE}/api/student/plans-by-date?date=${encodeURIComponent(tomorrowKey)}`,
            { headers }
          )
        ]);

        let booksForMerge: ProgressBook[] = progressBooksRef.current;

        if (booksRes.ok) {
          const bd = await booksRes.json().catch(() => ({}));
          const list = Array.isArray(bd.books) ? bd.books : [];
          booksForMerge = list.map((b: { id: number; name: string }) => ({
            id: Number(b.id),
            name: String(b.name)
          }));
          setProgressBooks(booksForMerge);
          progressBooksRef.current = booksForMerge;
        }

        if (plansRes.ok) {
          const pd = await plansRes.json().catch(() => ({}));
          setTomorrowPlan(
            buildTomorrowPlanFromPlanRows(
              Array.isArray(pd.plans) ? pd.plans : [],
              booksForMerge
            )
          );
        }
      } catch {
        // 네트워크 오류 시 내일 계획·책 목록은 이전 값 유지
      }
    };
    run();
  }, [authToken, meRole]);

  // 학생: 오늘 학습 기록(공부 좋았던/나빴던 점·메타인지) — 코치/기록/계획 협업에서 공유
  useEffect(() => {
    if (!authToken || meRole !== "student") {
      coachTodayRowSigRef.current = null;
      return;
    }
    const dayKey = getDateKey(0);
    const weekStart = getDateKeySeoul(-6);
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `${API_BASE}/api/student/coach/state?weekStart=${encodeURIComponent(weekStart)}`,
          {
            headers: { Authorization: `Bearer ${authToken}` },
            cache: "no-store"
          }
        );
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          logs?: Array<{
            date?: string;
            studyEvaluation?: string | null;
            metacognitionReflection?: string | null;
            memo?: string | null;
            tomorrowPractice?: string | null;
            studyMinutes?: number | null;
          }>;
        };
        writeLocalCache(
          buildStudentCoachStateCacheKey(
            normalizeLocalCacheScope(userEmail || readStoredUserCacheScope()),
            weekStart
          ),
          data
        );
        const row = (data.logs || []).find(
          l => seoulDateKeyFromApiValue(l.date) === dayKey
        );
        if (!row || cancelled) return;
        const sm = row.studyMinutes;
        const studyMinutesVal =
          sm != null && Number.isFinite(Number(sm)) ? Number(sm) : null;
        const rowSnapshot = {
          studyEvaluation: String(row.studyEvaluation ?? ""),
          metacognitionReflection: String(row.metacognitionReflection ?? ""),
          memo: String(row.memo ?? ""),
          tomorrowPractice: String(row.tomorrowPractice ?? ""),
          studyMinutes: studyMinutesVal
        };
        const sig = stableStringify(rowSnapshot);
        if (coachTodayRowSigRef.current === sig) return;
        coachTodayRowSigRef.current = sig;
        scheduleBackgroundUiUpdate(() => {
          setTodayStudyEvaluation(rowSnapshot.studyEvaluation);
          setTodayMetacognitionReflection(rowSnapshot.metacognitionReflection);
          setCoachTodayMemo(rowSnapshot.memo);
          setCoachDraftTomorrowPractice(rowSnapshot.tomorrowPractice);
          setCoachTodayStudyMinutes(rowSnapshot.studyMinutes);
        });
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authToken, meRole, coachLogSyncNonce]);

  useEffect(() => {
    if (!authToken || meRole !== "student") return;
    const bump = () => setCoachLogSyncNonce(n => n + 1);
    window.addEventListener(DAECHI_COACH_LOG_SAVED_EVENT, bump);
    return () => window.removeEventListener(DAECHI_COACH_LOG_SAVED_EVENT, bump);
  }, [authToken, meRole]);

  // 학생: 오늘 공부 계획(블록) — DB study_blocks (항상 오늘이 속한 주만 조회, 주간 탭 offset과 무관)
  useEffect(() => {
    if (!authToken || meRole !== "student") {
      timelineBlocksSigRef.current = null;
      return;
    }
    const applyBlocks = (next: StudyBlock[]) => {
      const sig = stableStringify(next);
      if (timelineBlocksSigRef.current === sig) return;
      timelineBlocksSigRef.current = sig;
      scheduleBackgroundUiUpdate(() => setBlocks(next));
    };
    const run = async () => {
      try {
        const mondayStr = getWeekStartKeySeoul(0);

        const headers = { Authorization: `Bearer ${authToken}` };
        const res = await fetch(
          `${API_BASE}/api/week?start=${encodeURIComponent(mondayStr)}`,
          { headers }
        );
        if (!res.ok) {
          applyBlocks([]);
          return;
        }
        const dataScroll = (await res.json()) as WeekApiPayload;

        const wantToday = normalizeDayKey(getDateKeySeoul(0));
        applyBlocks(extractTodayBlocksFromWeekApi(dataScroll, wantToday));
      } catch {
        applyBlocks([]);
      }
    };
    run();
  }, [authToken, meRole, timelineRefreshNonce]);

  useEffect(() => {
    if (!authToken || meRole !== "student" || tab !== "today") return;
    const id = window.setInterval(() => {
      if (!isDocumentVisible()) return;
      setTimelineRefreshNonce(n => n + 1);
    }, 22000);
    return () => window.clearInterval(id);
  }, [authToken, meRole, tab]);

  // 다른 기기(학부모 승인 등) 후 앱으로 돌아올 때 공부 계획(블록) 즉시 재조회
  useEffect(() => {
    if (!authToken || meRole !== "student") return;
    const onVis = () => {
      if (document.visibilityState === "visible") {
        setTimelineRefreshNonce(n => n + 1);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [authToken, meRole]);

  const refreshParentPlanAddRequests = useCallback(async () => {
    if (!authToken || meRole !== "parent") return;
    if (!isDocumentVisible()) return;
    try {
      const res = await trackAsync("poll.parentPlanAddRequests", () =>
        fetch(`${API_BASE}/api/parent/plan-add-requests?limit=100`, {
          headers: { Authorization: `Bearer ${authToken}` }
        })
      );
      if (!res.ok) return;
      const data = (await res.json().catch(() => ({}))) as {
        requests?: ParentPlanAddRequestRow[];
      };
      const next = Array.isArray(data.requests) ? data.requests : [];
      const sig = stableStringify(next);
      if (parentPlanAddSigRef.current === sig) return;
      parentPlanAddSigRef.current = sig;
      scheduleBackgroundUiUpdate(() => setParentPlanAddRequests(next));
    } catch {
      // ignore
    }
  }, [authToken, meRole]);

  useEffect(() => {
    if (!authToken || meRole !== "parent") {
      parentPlanAddSigRef.current = null;
      setParentPlanAddRequests([]);
      return;
    }
    void refreshParentPlanAddRequests();
    const t = window.setInterval(() => {
      void refreshParentPlanAddRequests();
    }, 25000);
    return () => window.clearInterval(t);
  }, [authToken, meRole, refreshParentPlanAddRequests]);

  const refreshParentStudents = useCallback(async () => {
    if (!authToken || meRole !== "parent") {
      parentStudentsSigRef.current = null;
      setParentStudentsLoaded(false);
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/parent/students`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      if (!res.ok) return;
      const data = await res.json();
      const nextStudents = data.students || [];
      const nextId =
        nextStudents.length > 0 ? nextStudents[0].id : null;
      const bundleSig = stableStringify({ list: nextStudents, selectedId: nextId });
      if (parentStudentsSigRef.current === bundleSig) {
        setParentStudentsLoaded(true);
        return;
      }
      parentStudentsSigRef.current = bundleSig;
      scheduleBackgroundUiUpdate(() => {
        setParentStudents(nextStudents);
        setParentStudentId(nextId);
        setParentStudentsLoaded(true);
      });
    } catch {
      // ignore
    }
  }, [authToken, meRole]);

  // 학부모 페이지: 연결된 학생 목록 로딩
  useEffect(() => {
    void refreshParentStudents();
  }, [refreshParentStudents]);

  // 학부모: 연결 요청 목록 (양쪽 확인)
  useEffect(() => {
    if (!authToken || meRole !== "parent") {
      parentLinkWaitSigRef.current = null;
      return;
    }
    const run = async () => {
      if (!authToken || meRole !== "parent") return;
      try {
        const res = await fetch(`${API_BASE}/api/parent/link-requests`, {
          headers: { Authorization: `Bearer ${authToken}` }
        });
        if (!res.ok) return;
        const data = await res.json();
        const nextA = data.waitingOnStudent || [];
        const nextB = data.waitingOnMe || [];
        const sig = stableStringify({ a: nextA, b: nextB });
        if (parentLinkWaitSigRef.current === sig) return;
        parentLinkWaitSigRef.current = sig;
        scheduleBackgroundUiUpdate(() => {
          setParentWaitingOnStudent(nextA);
          setParentWaitingOnMe(nextB);
        });
      } catch {
        // ignore
      }
    };
    run();
  }, [authToken, meRole]);

  // 학생: 연결 요청 목록
  useEffect(() => {
    const run = async () => {
      if (!authToken || meRole !== "student") return;
      if (tab !== "profile") return;
      if (!isDocumentVisible()) return;
      try {
        const res = await trackAsync("poll.studentLinkRequests", () =>
          fetch(`${API_BASE}/api/student/link-requests`, {
            headers: { Authorization: `Bearer ${authToken}` }
          })
        );
        if (!res.ok) return;
        const data = await res.json();
        const nextA = data.waitingOnParent || [];
        const nextB = data.waitingOnMe || [];
        const sig = stableStringify({ a: nextA, b: nextB });
        if (studentLinkWaitSigRef.current === sig) return;
        studentLinkWaitSigRef.current = sig;
        scheduleBackgroundUiUpdate(() => {
          setStudentWaitingOnParent(nextA);
          setStudentWaitingOnMe(nextB);
        });
      } catch {
        // ignore
      }
    };
    void run();
    if (!authToken || meRole !== "student") {
      studentLinkWaitSigRef.current = null;
      setStudentWaitingOnParent([]);
      setStudentWaitingOnMe([]);
      return;
    }
    if (tab !== "profile") {
      // 프로필 탭 진입 시 StudentProfilePage가 즉시 재조회하므로
      // 글로벌 폴링은 유휴 탭에서 중단해 배터리/네트워크를 아낀다.
      studentLinkWaitSigRef.current = null;
      setStudentWaitingOnParent([]);
      setStudentWaitingOnMe([]);
      return;
    }
    const timerId = window.setInterval(() => {
      void run();
    }, 45000);
    return () => {
      window.clearInterval(timerId);
    };
  }, [authToken, meRole, tab]);

  // 학생: 학습 앱스토어 목록 + 설치 상태
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!authToken || meRole !== "student") {
        storeAppsSigRef.current = null;
        setStoreLoading(false);
        setStoreError("");
        return;
      }
      const cached = readLocalCache<StudyStoreApp[]>(
        storeAppsCacheKey,
        STORE_APPS_CACHE_TTL_MS
      );
      const cachedApps = Array.isArray(cached?.value) ? cached.value : [];
      if (cachedApps.length > 0) {
        setStoreApps(cachedApps);
      }
      const shouldFetch = tab === "store" || !cached?.isFresh || cachedApps.length === 0;
      if (!shouldFetch) {
        setStoreLoading(false);
        setStoreError("");
        return;
      }
      const showLoading = tab === "store" && cachedApps.length === 0;
      if (showLoading) {
        setStoreLoading(true);
      }
      setStoreError("");
      try {
        const res = await fetch(`${API_BASE}/api/student/store-apps`, {
          headers: { Authorization: `Bearer ${authToken}` }
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          if (cachedApps.length === 0 || tab === "store") {
            setStoreError(data.error || "앱 목록을 불러오지 못했습니다.");
          }
          return;
        }
        const nextApps = Array.isArray(data.apps) ? data.apps : [];
        const sig = stableStringify(nextApps);
        if (storeAppsSigRef.current === sig) {
          return;
        }
        storeAppsSigRef.current = sig;
        scheduleBackgroundUiUpdate(() => {
          setStoreApps(nextApps);
          writeLocalCache(storeAppsCacheKey, nextApps);
        });
      } catch {
        if (!cancelled && (cachedApps.length === 0 || tab === "store")) {
          setStoreError("앱 목록을 불러오지 못했습니다.");
        }
      } finally {
        if (!cancelled) {
          setStoreLoading(false);
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [authToken, meRole, storeAppsCacheKey, tab]);

  // 학부모 페이지: 학생별 주간 리포트 로딩
  useEffect(() => {
    const run = async () => {
      if (!authToken || meRole !== "parent") return;
      if (!parentStudentId) return;
      try {
        const start = getWeekStartKeySeoul(parentWeekOffset);
        const res = await fetch(
          `${API_BASE}/api/parent/week?studentId=${parentStudentId}&start=${encodeURIComponent(start)}`,
          { headers: { Authorization: `Bearer ${authToken}` } }
        );
        if (!res.ok) return;
        const data = await res.json();
        setParentReport(data);
      } catch {
        // ignore
      }
    };
    run();
  }, [
    authToken,
    meRole,
    parentStudentId,
    parentWeekOffset,
    coachParentTab,
    parentWeekRefreshNonce
  ]);

  useEffect(() => {
    if (!authToken || meRole !== "parent") return;
    if (coachParentTab !== "records") return;
    const onVis = () => {
      if (document.visibilityState === "visible") {
        setParentWeekRefreshNonce(n => n + 1);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [authToken, meRole, coachParentTab]);

  // 학부모: AI 일일 리포트 (자정 배치 생성본)
  useEffect(() => {
    const run = async () => {
      if (!authToken || meRole !== "parent") {
        setParentAiDaily(null);
        return;
      }
      if (!parentStudentId) {
        setParentAiDaily(null);
        return;
      }
      try {
        const res = await fetch(
          `${API_BASE}/api/parent/ai-daily-report?studentId=${parentStudentId}`,
          { headers: { Authorization: `Bearer ${authToken}` } }
        );
        if (!res.ok) {
          // 기존 값 유지: 느린 재동기화 중 화면 깜빡임 방지
          return;
        }
        const data = await res.json();
        setParentAiDaily(data.report ?? null);
      } catch {
        // 네트워크 에러 시 이전 리포트를 유지해 화면 점멸을 줄인다.
      }
    };
    run();
  }, [authToken, meRole, parentStudentId]);

  // 학부모: 학생별 계획표 시간 설정 조회
  useEffect(() => {
    const run = async () => {
      if (!authToken || meRole !== "parent" || !parentStudentId) return;
      try {
        const res = await fetch(
          `${API_BASE}/api/parent/planner-rule?studentId=${parentStudentId}`,
          {
            headers: { Authorization: `Bearer ${authToken}` }
          }
        );
        if (!res.ok) return;
        const data = await res.json();
        const rule = data?.rule;
        if (!rule) return;
        setParentPlannerEnabled(Boolean(rule.enabled));
        setParentPlannerTime(String(rule.lockTime || "21:00").slice(0, 5));
        setParentLockStatus(data.lockStatus || null);
        setParentPlannerMessage("");
      } catch {
        // ignore
      }
    };
    run();
  }, [authToken, meRole, parentStudentId]);

  const toggleDone = (id: number) => {
    hapticImpactLight();
    setBlocks(prev => {
      const target = prev.find(block => block.id === id);
      if (!target) return prev;
      const next = prev.map(b =>
        b.id === id ? { ...b, done: !b.done } : b
      );
      const attemptedDone = !target.done;
      void (async () => {
        const ok = await syncBlocksToServer(next);
        if (ok) return;
        setBlocks(current =>
          current.map(block =>
            block.id === id && block.done === attemptedDone
              ? { ...block, done: target.done }
              : block
          )
        );
      })();
      return next;
    });
  };

  const removeProgressBook = useCallback(
    async (bookId: number) => {
      if (!authToken) {
        setAppPath("#/auth");
        return;
      }
      try {
        const res = await fetch(
          `${API_BASE}/api/student/books/${bookId}`,
          {
            method: "DELETE",
            headers: { Authorization: `Bearer ${authToken}` }
          }
        );
        if (res.ok) {
          setProgressBooks(prev => prev.filter(b => b.id !== bookId));
          setTomorrowPlan(prev => {
            const next = { ...prev };
            delete next[bookId];
            return next;
          });
          hapticSuccess();
        } else {
          hapticWarning();
        }
      } catch {
        hapticWarning();
      }
    },
    [authToken]
  );

  const saveTomorrowPlan = async (planOverride?: ProgressPlan): Promise<boolean> => {
    if (!authToken) {
      setAppPath("#/auth");
      return false;
    }
    const plan = planOverride ?? tomorrowPlan;
    try {
      const res = await fetch(`${API_BASE}/api/plan`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          date: getDateKey(1),
          plans: progressBooks.map(book => ({
            bookName: book.name,
            plannedRange: plan[book.id]?.text || "",
            startTime: plan[book.id]?.start || null,
            endTime: plan[book.id]?.end || null
          }))
        })
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 423) {
        applyStudentLockStatus(data.lockStatus || null);
        setStudentLockMessage(
          data.error ||
            "잠금 상태에서는 오늘 계획을 수정할 수 없습니다."
        );
        return false;
      }
      if (res.ok) {
        setStudentLockMessage("");
        if (data.lockStatus) {
          applyStudentLockStatus(data.lockStatus);
        }
        try {
          const tk = getDateKey(1);
          const wr = await fetch(
            `${API_BASE}/api/student/plans-by-date?date=${encodeURIComponent(tk)}`,
            { headers: { Authorization: `Bearer ${authToken}` } }
          );
          if (wr.ok) {
            const pd = await wr.json().catch(() => ({}));
            setTomorrowPlan(
              buildTomorrowPlanFromPlanRows(
                Array.isArray(pd.plans) ? pd.plans : [],
                progressBooks
              )
            );
          }
        } catch {
          // ignore
        }
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  const applyCoachTomorrowPlanAndGoRecords = async (
    next: ProgressPlan
  ): Promise<boolean> => {
    setTomorrowPlan(next);
    const ok = await saveTomorrowPlan(next);
    if (ok) {
      hapticSuccess();
      setAppPath("#/records");
    } else {
      hapticWarning();
    }
    return ok;
  };

  const applyCoachTomorrowPracticeAndGoRecords = async (
    text: string
  ): Promise<boolean> => {
    if (!authToken) {
      setAppPath("#/auth");
      return false;
    }
    const trimmed = text.trim();
    if (!trimmed) {
      hapticWarning();
      return false;
    }
    try {
      const res = await fetch(`${API_BASE}/api/student/coach/log/tomorrow-practice`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({ tomorrowPractice: trimmed })
      });
      if (!res.ok) {
        hapticWarning();
        return false;
      }
      setCoachDraftTomorrowPractice(trimmed);
      hapticSuccess();
      try {
        window.dispatchEvent(new CustomEvent(DAECHI_COACH_LOG_SAVED_EVENT));
        localStorage.setItem(
          DAECHI_COACH_LOG_SAVED_STORAGE_KEY,
          String(Date.now())
        );
      } catch {
        // ignore
      }
      setAppPath("#/records");
      return true;
    } catch {
      hapticWarning();
      return false;
    }
  };

  const handleLogout = () => {
    void stopNativeStudyRoomTracking({ clearConfig: true }).catch(() => {
      // ignore native tracking cleanup failures during logout
    });
    try {
      localStorage.removeItem("daechi_planner_token");
      localStorage.removeItem("daechi_planner_user_email");
    } catch {
      // ignore
    }
    clearCachedMeState();
    setAuthToken(null);
    setUserEmail(null);
    setMeRole(null);
    setStudentInitialProfileCompleted(true);
    setStudentSetupOpen(false);
    setStudentSetupGrade("");
    setStudentSetupGoalUniversity("");
    setStudentSetupTargetGrade("");
    setStudentSetupCurrentConcern("");
    setStudentSetupWeakness("");
    setStudentSetupError("");
    setRoute("auth");
    setAppPath("#/auth");
  };

  useEffect(() => {
    if (!meRoleResolved) return;
    if (authToken && meRole === "student") return;
    void stopNativeStudyRoomTracking({ clearConfig: true }).catch(() => {
      // ignore cleanup failures when leaving student mode
    });
  }, [authToken, meRole, meRoleResolved]);

  const saveInitialStudentProfile = async () => {
    if (!authToken) return;
    const trimmedGoalUniversity = studentSetupGoalUniversity.trim();
    const trimmedTargetGrade = studentSetupTargetGrade.trim();
    const trimmedCurrentConcern = studentSetupCurrentConcern.trim();
    const trimmedWeakness = studentSetupWeakness.trim();
    const parsedGrade = Number(studentSetupGrade);

    if (!Number.isInteger(parsedGrade) || parsedGrade < 1 || parsedGrade > 12) {
      setStudentSetupError("학년은 1–12 사이로 입력하세요.");
      hapticWarning();
      return;
    }
    if (!trimmedGoalUniversity) {
      setStudentSetupError("목표 대학을 입력하세요.");
      hapticWarning();
      return;
    }
    if (!trimmedTargetGrade) {
      setStudentSetupError("목표 성적을 입력하세요.");
      hapticWarning();
      return;
    }

    setStudentSetupSaving(true);
    setStudentSetupError("");
    try {
      const res = await fetch(`${API_BASE}/api/account`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          grade: parsedGrade,
          goalUniversity: trimmedGoalUniversity,
          targetGrade: trimmedTargetGrade,
          currentConcern: trimmedCurrentConcern,
          weakness: trimmedWeakness
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          String(data?.error || "초기 프로필을 저장하지 못했습니다.").trim()
        );
      }
      const savedUser =
        data && typeof data === "object" && data.user && typeof data.user === "object"
          ? data.user
          : null;
      const savedGrade =
        savedUser?.grade != null && String(savedUser.grade).trim() !== ""
          ? String(savedUser.grade).trim()
          : String(parsedGrade);
      setStudentSetupGrade(savedGrade);
      setStudentSetupGoalUniversity(
        savedUser?.goal_university != null
          ? String(savedUser.goal_university).trim()
          : trimmedGoalUniversity
      );
      setStudentSetupTargetGrade(
        savedUser?.target_grade != null
          ? String(savedUser.target_grade).trim()
          : trimmedTargetGrade
      );
      setStudentSetupCurrentConcern(
        savedUser?.current_concern != null
          ? String(savedUser.current_concern).trim()
          : trimmedCurrentConcern
      );
      setStudentSetupWeakness(
        savedUser?.weakness != null
          ? String(savedUser.weakness).trim()
          : trimmedWeakness
      );
      setStudentInitialProfileCompleted(true);
      setStudentSetupPromptArmed(false);
      setStudentSetupOpen(false);
      setStudentSetupError("");
      hapticSuccess();
    } catch (error) {
      setStudentSetupError(
        error instanceof Error && error.message
          ? error.message
          : "초기 프로필을 저장하지 못했습니다."
      );
      hapticWarning();
    } finally {
      setStudentSetupSaving(false);
    }
  };

  const performWithdrawAccount = async () => {
    if (!authToken) return;
    try {
      await fetch(`${API_BASE}/api/account/withdraw`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({})
      });
    } catch {
      // ignore (logout still proceeds)
    }
    handleLogout();
  };

  const confirmAuthAction = () => {
    if (authConfirmKind === "logout") {
      authConfirmReveal.beginClose(() => {
        setAuthConfirmKind(null);
        handleLogout();
      });
    } else if (authConfirmKind === "withdraw") {
      authConfirmReveal.beginClose(() => {
        setAuthConfirmKind(null);
        void performWithdrawAccount();
      });
    }
  };

  useEffect(() => {
    setStudentAlarmSettings(readStudentAlarmSettings(studentAlarmSettingsKey));
  }, [studentAlarmSettingsKey]);

  useEffect(() => {
    const syncFromStorage = () => {
      setStudentAlarmSettings(readStudentAlarmSettings(studentAlarmSettingsKey));
    };
    const handleAlarmSettingsUpdated = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          key?: string;
          settings?: StudentAlarmSettings;
        }>
      ).detail;
      if (detail?.key && detail.key !== studentAlarmSettingsKey) return;
      if (detail?.settings) {
        setStudentAlarmSettings(detail.settings);
        return;
      }
      syncFromStorage();
    };
    window.addEventListener(
      STUDENT_ALARM_SETTINGS_UPDATED_EVENT,
      handleAlarmSettingsUpdated as EventListener
    );
    window.addEventListener("storage", syncFromStorage);
    return () => {
      window.removeEventListener(
        STUDENT_ALARM_SETTINGS_UPDATED_EVENT,
        handleAlarmSettingsUpdated as EventListener
      );
      window.removeEventListener("storage", syncFromStorage);
    };
  }, [studentAlarmSettingsKey]);

  useEffect(() => {
    const scope = studyReminderScope(userEmail);
    const previousScope = lastStudyReminderScopeRef.current;
    lastStudyReminderScopeRef.current = scope;

    const cancelStoredNotifications = async (targetScope: string) => {
      if (!Capacitor.isNativePlatform()) return;
      const storageKey = buildStudyReminderNotificationStorageKey(targetScope);
      const ids = readStoredNumberList(storageKey);
      if (!ids.length) return;
      await LocalNotifications.cancel({
        notifications: ids.map(id => ({ id }))
      }).catch(() => {
        // ignore
      });
      writeStoredNumberList(storageKey, []);
    };

    if (previousScope && previousScope !== scope) {
      void cancelStoredNotifications(previousScope);
    }

    const dayKey = getDateKey(0);
    const pendingBlocks = sortStudyBlocksByStart(blocks).filter(block => {
      if (block.done) return false;
      const startMinutes = blockTimeSortKey(block.start);
      return startMinutes >= blockTimeSortKey(getSeoulCurrentHm());
    });
    const signature = [
      scope,
      meRole,
      studentAlarmSettings.scheduleReminders ? "on" : "off",
      pendingBlocks.map(block => buildStudyReminderKey(dayKey, block)).join("||")
    ].join("::");
    if (studyReminderScheduleSignatureRef.current === signature) return;
    studyReminderScheduleSignatureRef.current = signature;

    const syncStudyReminderNotifications = async () => {
      const storageKey = buildStudyReminderNotificationStorageKey(scope);
      const previousIds = readStoredNumberList(storageKey);

      if (
        !Capacitor.isNativePlatform() ||
        meRole !== "student" ||
        !authToken ||
        !studentAlarmSettings.scheduleReminders
      ) {
        if (previousIds.length) {
          await LocalNotifications.cancel({
            notifications: previousIds.map(id => ({ id }))
          }).catch(() => {
            // ignore
          });
          writeStoredNumberList(storageKey, []);
        }
        return;
      }

      const permission = await LocalNotifications.checkPermissions();
      if (permission.display !== "granted") {
        await LocalNotifications.requestPermissions().catch(() => {
          // ignore
        });
      }
      const latestPermission = await LocalNotifications.checkPermissions();
      if (latestPermission.display !== "granted") {
        if (previousIds.length) {
          await LocalNotifications.cancel({
            notifications: previousIds.map(id => ({ id }))
          }).catch(() => {
            // ignore
          });
          writeStoredNumberList(storageKey, []);
        }
        return;
      }

      if (previousIds.length) {
        await LocalNotifications.cancel({
          notifications: previousIds.map(id => ({ id }))
        }).catch(() => {
          // ignore
        });
      }

      const notifications = pendingBlocks
        .map(block => {
          const reminderKey = buildStudyReminderKey(dayKey, block);
          const at = buildTodayReminderDate(block.start);
          if (!at) return null;
          return {
            id: buildStudyReminderNotificationId(reminderKey),
            title: `${block.subject} 공부 시작 시간`,
            body: buildStudyReminderBody(block),
            schedule: { at },
            actionTypeId: "default",
            extra: {
              type: "study-reminder",
              reminderKey
            }
          };
        })
        .filter(
          (
            value
          ): value is {
            id: number;
            title: string;
            body: string;
            schedule: { at: Date };
            actionTypeId: string;
            extra: { type: string; reminderKey: string };
          } => value != null
        );

      if (!notifications.length) {
        writeStoredNumberList(storageKey, []);
        return;
      }

      await LocalNotifications.schedule({ notifications }).catch(() => {
        // ignore
      });
      writeStoredNumberList(
        storageKey,
        notifications.map(notification => notification.id)
      );
    };

    void syncStudyReminderNotifications();
  }, [
    authToken,
    blocks,
    meRole,
    studentAlarmSettings.scheduleReminders,
    userEmail
  ]);

  useEffect(() => {
    if (meRole !== "student" || !studentAlarmSettings.scheduleReminders) {
      if (activeStudyReminder) {
        activeStudyReminderReveal.beginClose(() => setActiveStudyReminder(null));
      }
      return;
    }
    if (activeStudyReminder) return;

    const scope = studyReminderScope(userEmail);
    const checkReminderPopup = () => {
      const dayKey = getDateKey(0);
      const currentHm = getSeoulCurrentHm();
      const dueBlock = sortStudyBlocksByStart(blocks).find(block => {
        if (block.done) return false;
        if (normalizeBlockTime(block.start) !== currentHm) return false;
        const reminderKey = buildStudyReminderKey(dayKey, block);
        return !hasShownReminder(scope, dayKey, reminderKey);
      });
      if (!dueBlock) return;

      const reminderKey = buildStudyReminderKey(dayKey, dueBlock);
      markReminderShown(scope, dayKey, reminderKey);
      setActiveStudyReminder({
        reminderKey,
        blockId: dueBlock.id,
        subject: dueBlock.subject,
        start: dueBlock.start,
        end: dueBlock.end,
        plannedRange: dueBlock.plannedRange
      });
      hapticImpactMedium();
    };

    checkReminderPopup();
    const timerId = window.setInterval(checkReminderPopup, 15000);
    return () => window.clearInterval(timerId);
  }, [
    activeStudyReminder,
    activeStudyReminderReveal,
    blocks,
    meRole,
    studentAlarmSettings.scheduleReminders,
    userEmail
  ]);

  const handleAdd = async () => {
    if (!authToken) {
      setTimelineSyncError("로그인해 주세요.");
      return;
    }
    const book =
      addBlockBookId != null
        ? progressBooks.find(b => b.id === addBlockBookId)
        : undefined;
    if (!book) return;
    const start = normalizeBlockTime(startInput);
    const end = normalizeBlockTime(endInput);
    if (!start || !end) return;
    const planTrim = addBlockPlan.trim();
    try {
      const res = await fetch(`${API_BASE}/api/student/plan-add-request`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          bookId: book.id,
          plannedRange: planTrim || null,
          startTime: start,
          endTime: end,
          date: getDateKeySeoul(0)
        })
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
      };
      if (res.status === 400 && data.code === "NO_LINKED_PARENT") {
        setShowPlanAddNoParentModal(true);
        return;
      }
      if (!res.ok) {
        setTimelineSyncError(
          String(data.error || "").trim() ||
            "보내지 못했습니다. 잠시 후 다시 시도하세요."
        );
        hapticWarning();
        return;
      }
      setAddBlockPlan("");
      addModalReveal.beginClose(() => setShowAddModal(false));
      setPlanRequestNotice(
        "요청을 보냈어요. 승인되면 오늘 계획에 반영돼요."
      );
      hapticSuccess();
    } catch {
      setTimelineSyncError(
        "요청을 보내지 못했습니다. 연결을 확인하세요."
      );
      hapticWarning();
    }
  };

  const openAddPlanModal = () => {
    setTimelineSyncError("");
    setPlanRequestNotice("");
    setAddBlockBookId(progressBooks[0]?.id ?? null);
    setAddBlockPlan("");
    setStartInput("18:00");
    setEndInput("19:00");
    setShowAddModal(true);
  };

  const roleLoading = Boolean(
    authToken && route !== "auth" && !meRoleResolved && !meRole
  );
  const profileLoadFailed = Boolean(
    authToken && route !== "auth" && meRoleResolved && profileLoadError
  );
  const parentView = meRole === "parent" || route === "parent";
  const showStudentShell =
    route !== "auth" &&
    !roleLoading &&
    !parentView &&
    !profileLoadFailed;
  const coachStudentMode = showStudentShell && coachStudentTab !== null;
  const isStudentAnalysisPage = coachStudentMode && coachStudentTab === "analysis";

  const coachParentMode =
    !roleLoading &&
    !profileLoadFailed &&
    parentView &&
    meRole === "parent" &&
    coachParentTab !== null;
  const isParentAnalysisPage = coachParentMode && coachParentTab === "analysis";
  const isStandaloneAnalysisPage = isStudentAnalysisPage || isParentAnalysisPage;

  const redirectParentToProfileForStudentLink = useCallback(() => {
    hapticWarning();
    setShowParentStudentRequiredModal(true);
    setCoachParentTab(null);
    setParentTab("profile");
    replaceAppPath("#/parent/profile");
  }, [hapticWarning]);

  useEffect(() => {
    if (meRole !== "parent" || !parentStudentsLoaded || parentStudents.length > 0) {
      return;
    }

    const path = getAppPath();
    const requiresLinkedStudent =
      path === "#/parent/manage" ||
      path === "#/parent/analysis" ||
      path === "#/parent/records" ||
      path === "#/parent/student-settings";

    if (!requiresLinkedStudent) return;

    redirectParentToProfileForStudentLink();
  }, [
    coachParentTab,
    meRole,
    parentStudents.length,
    parentStudentsLoaded,
    parentTab,
    redirectParentToProfileForStudentLink
  ]);

  const headerTitle = roleLoading
    ? route === "parent"
      ? "학부모"
      : tab === "profile"
        ? "내 정보"
        : ""
    : parentView
      ? meRole === "parent"
        ? coachParentMode
          ? coachParentTab === "home"
            ? "홈"
            : coachParentTab === "manage"
              ? "자녀"
              : coachParentTab === "records"
                  ? "기록"
                  : coachParentTab === "analysis"
                    ? "분석"
                  : "자녀 설정"
          : parentTab === "profile"
            ? "내 정보"
            : "학부모"
        : "학부모"
      : showStudentShell
        ? coachStudentMode
          ? isStudentAnalysisPage
            ? "분석"
            : coachStudentTab === "home"
              ? tab === "profile"
                ? "내 정보"
                : tab === "today"
                  ? "오늘"
                  : tab === "records"
                    ? "기록"
                    : tab === "store"
                      ? "앱"
                      : "오늘"
              : "코치"
          : tab === "profile"
            ? "내 정보"
            : tab === "today"
              ? "오늘"
              : tab === "records"
                ? "기록"
                : tab === "store"
                  ? "앱"
                  : "오늘"
        : "";

  const appMainPageKey = useMemo(() => {
    if (roleLoading) return "loading";
    if (profileLoadFailed) return "profile-error";
    /* 코치·학부모 탭 전환은 각 셸 안 TabTransitionPanel에서 처리 (이중 애니메이션 방지) */
    if (coachStudentMode && coachStudentTab && coachStudentTab !== "home")
      return "student-coach";
    if (coachParentMode && coachParentTab) return "parent-coach";
    if (parentView && !coachParentMode) return "parent-legacy";
    if (showStudentShell) return "student";
    return "idle";
  }, [
    roleLoading,
    profileLoadFailed,
    coachStudentMode,
    coachStudentTab,
    coachParentMode,
    coachParentTab,
    parentView,
    showStudentShell
  ]);

  useEffect(() => {
    setHeaderScrolled(false);
  }, [appMainPageKey]);

  const handleAppMainScroll = useCallback(
    (event: React.UIEvent<HTMLElement>) => {
      const nextScrolled = event.currentTarget.scrollTop > 8;
      setHeaderScrolled(prev => (prev === nextScrolled ? prev : nextScrolled));
    },
    []
  );

  const swipeNavRef = useRef({
    tab: "today" as TabKey,
    coachStudentTab: null as CoachStudentTabKey | null,
    coachStudentMode: false,
    parentView: false,
    meRole: null as string | null,
    parentTab: "report" as ParentTabKey,
    coachParentTab: null as ParentCoachShellTab | null,
    coachParentMode: false,
    studentLockStatus: null as { forceRecordsPage?: boolean } | null,
    parentStudentsLoaded: false,
    parentStudentsLength: 0,
    showStudentShell: false,
    isStandaloneAnalysisPage: false,
    roleLoading: true,
    profileLoadFailed: false
  });

  const handleMainTabSwipe = useCallback(
    (direction: "left" | "right") => {
      const s = swipeNavRef.current;
      if (
        s.isStandaloneAnalysisPage ||
        s.roleLoading ||
        s.profileLoadFailed
      ) {
        return;
      }
      const delta = direction === "left" ? 1 : -1;

      if (s.showStudentShell && !s.parentView) {
        if (!s.coachStudentMode && s.tab === "store") {
          return;
        }
        const lock =
          s.meRole === "student" && s.studentLockStatus?.forceRecordsPage;
        const idx = s.coachStudentMode
          ? 2
          : s.tab === "today"
            ? 0
            : s.tab === "records"
              ? 1
              : s.tab === "store"
                ? 3
                : 4;
        const nextIdx = idx + delta;
        if (nextIdx < 0 || nextIdx > 4 || nextIdx === idx) return;

        if (lock) {
          if (nextIdx !== 1) {
            hapticWarning();
            setCoachStudentTab(null);
            setCoachStudentCoachLayout("scroll");
            setTab("records");
            setAppPath("#/records");
            return;
          }
          if (idx === 1) return;
        }

        if (nextIdx === 0) {
          hapticSelection();
          setCoachStudentTab(null);
          setCoachStudentCoachLayout("scroll");
          setTab("today");
          setAppPath("#/today");
        } else if (nextIdx === 1) {
          hapticSelection();
          setCoachStudentTab(null);
          setCoachStudentCoachLayout("scroll");
          setTab("records");
          setAppPath("#/records");
        } else if (nextIdx === 2) {
          hapticSelection();
          setCoachStudentTab("coach");
          setCoachStudentCoachLayout("chat");
          setAppPath("#/student/coach");
        } else if (nextIdx === 3) {
          hapticSelection();
          setCoachStudentTab(null);
          setCoachStudentCoachLayout("scroll");
          setTab("store");
          setAppPath("#/store");
        } else {
          hapticSelection();
          setCoachStudentTab(null);
          setCoachStudentCoachLayout("scroll");
          setTab("profile");
          setAppPath("#/profile");
        }
        return;
      }

      if (s.parentView && s.meRole === "parent") {
        /* 학부모: 하단 탭만 사용 (가로 스와이프로 화면 전환하지 않음) */
        return;
      }
    },
    [
      hapticSelection,
      hapticWarning,
      redirectParentToProfileForStudentLink,
      setAppPath,
      setCoachParentTab,
      setCoachStudentCoachLayout,
      setCoachStudentTab,
      setParentTab,
      setTab
    ]
  );

  useEffect(() => {
    if (!mainEnter) return;
    const id = window.setTimeout(() => setMainEnter(false), 520);
    return () => clearTimeout(id);
  }, [mainEnter]);

  useEffect(() => {
    if (authMode === "signup" && authRole === "parent") return;
    setAuthParentPhone("");
    setAuthParentPhoneCode("");
    setAuthParentPhoneVerifyToken(null);
    setAuthParentPhoneNotice("");
    setAuthParentPhoneNoticeTone("neutral");
    setAuthParentPhoneSending(false);
    setAuthParentPhoneVerifying(false);
  }, [authMode, authRole]);

  const handleParentPhoneSendCode = useCallback(async () => {
    if (!isLikelyKoreanMobileDigits(authParentPhone)) {
      setAuthParentPhoneNotice("휴대폰 번호를 확인해 주세요.");
      setAuthParentPhoneNoticeTone("error");
      hapticWarning();
      return;
    }
    setAuthParentPhoneSending(true);
    setAuthParentPhoneNotice("");
    setAuthParentPhoneNoticeTone("neutral");
    try {
      const res = await fetch(`${API_BASE}/auth/parent/signup/send-phone-code`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: authParentPhone })
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setAuthParentPhoneNotice(
          String(data.error || "").trim() || "인증 문자를 보내지 못했습니다."
        );
        setAuthParentPhoneNoticeTone("error");
        hapticWarning();
        return;
      }
      setAuthParentPhoneNotice("인증번호를 문자로 보냈어요.");
      setAuthParentPhoneNoticeTone("success");
      hapticSuccess();
    } catch {
      setAuthParentPhoneNotice("연결을 확인해 주세요.");
      setAuthParentPhoneNoticeTone("error");
      hapticWarning();
    } finally {
      setAuthParentPhoneSending(false);
    }
  }, [authParentPhone, hapticSuccess, hapticWarning]);

  const handleParentPhoneVerifyCode = useCallback(async () => {
    if (authParentPhoneCode.length !== 6) return;
    setAuthParentPhoneVerifying(true);
    setAuthParentPhoneNotice("");
    setAuthParentPhoneNoticeTone("neutral");
    try {
      const res = await fetch(`${API_BASE}/auth/parent/signup/verify-phone-code`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: authParentPhone, code: authParentPhoneCode })
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        phoneVerifyToken?: string;
      };
      if (!res.ok || !data.phoneVerifyToken) {
        setAuthParentPhoneNotice(
          String(data.error || "").trim() || "인증에 실패했습니다."
        );
        setAuthParentPhoneNoticeTone("error");
        hapticWarning();
        return;
      }
      setAuthParentPhoneVerifyToken(data.phoneVerifyToken);
      setAuthParentPhoneNotice("");
      setAuthParentPhoneNoticeTone("neutral");
      hapticSuccess();
    } catch {
      setAuthParentPhoneNotice("연결을 확인해 주세요.");
      setAuthParentPhoneNoticeTone("error");
      hapticWarning();
    } finally {
      setAuthParentPhoneVerifying(false);
    }
  }, [authParentPhone, authParentPhoneCode, hapticSuccess, hapticWarning]);

  const handleAuthSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
                e.preventDefault();
                const email = authEmail.trim().toLowerCase();
                const password = authPassword;
    const studentName = authStudentName.trim();
                if (!email) {
                  setAuthError("이메일을 입력하세요.");
                  return;
                }
    if (authMode === "signup" && authRole === "student" && !studentName) {
      setAuthError("이름을 입력하세요.");
                  return;
                }
    if (authMode === "signup" && authRole === "parent") {
      if (!isLikelyKoreanMobileDigits(authParentPhone)) {
        setAuthError("휴대폰 번호를 확인해 주세요.");
        return;
      }
      if (!authParentPhoneVerifyToken) {
        setAuthError("휴대폰 인증을 완료해 주세요.");
        return;
      }
    }
                if (password.length < 4) {
                  setAuthError("비밀번호는 4자 이상이어야 합니다.");
                  return;
                }
                try {
                  setAuthError("");
                  const isStudentSignup =
                    authMode === "signup" && authRole === "student";
                  const isParentSignup = authMode === "signup" && authRole === "parent";
                  const res = await fetch(
        `${API_BASE}/auth/${authMode === "login" ? "login" : "register"}`,
                    {
                      method: "POST",
                      credentials: "include",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        email,
                        password,
                        role: authMode === "signup" ? authRole : undefined,
            name:
              authMode === "signup" && authRole === "student"
                ? studentName
                : undefined,
            phone: isParentSignup ? authParentPhone : undefined,
            phoneVerifyToken: isParentSignup
              ? authParentPhoneVerifyToken
              : undefined,
                        serial: resolvePreferredSerial() || undefined
                      })
                    }
                  );
                  const raw = await res.text();
                  let data: any = {};
                  try {
                    data = raw ? JSON.parse(raw) : {};
                  } catch {
                    data = { raw };
                  }
                  if (!res.ok) {
                    hapticWarning();
                    const serverMessage = String(data?.error || "").trim();
                    const fallbackMessage =
                      res.status >= 500
                        ? `문제가 발생했습니다. 잠시 후 다시 시도하세요. (${res.status})`
                        : `로그인에 실패했습니다. (${res.status})`;
                    setAuthError(serverMessage || fallbackMessage);
                    return;
                  }
                  const token = data.token as string;
                  const nextEmail = String(data.email || email).trim().toLowerCase();
                  const nextRole =
                    data.role != null && String(data.role).trim() !== ""
                      ? String(data.role).trim().toLowerCase()
                      : authMode === "signup"
                        ? authRole
                        : null;
                  hapticSuccess();
                  setAuthLeaving(true);
                  window.setTimeout(() => {
                    setUserEmail(nextEmail);
                    setAuthToken(token);
                    if (nextRole) {
                      setMeRole(nextRole);
                      writeCachedMeState({
                        role: nextRole,
                        email: nextEmail,
                        initialProfileCompleted:
                          nextRole === "student" ? false : true,
                        grade: "",
                        goal: "",
                        goalUniversity: "",
                        targetGrade: "",
                        currentConcern: "",
                        weakness: ""
                      });
                    }
                    if (isStudentSignup) {
                      armStudentSetupPrompt(nextEmail);
                    }
        localStorage.setItem("daechi_planner_user_email", nextEmail);
                    localStorage.setItem("daechi_planner_token", token);
                    setAppPath("#/");
                    setMainEnter(true);
                  }, 420);
                } catch (error) {
                  hapticWarning();
                  const detail =
                    error instanceof Error && error.message
                      ? ` ${error.message}`
                      : "";
                  setAuthError(
                    `서버에 연결할 수 없어요. Wi‑Fi·데이터와 서버 실행 여부를 확인하세요. (${API_BASE})${detail}`
                  );
                }
  };

  swipeNavRef.current = {
    tab,
    coachStudentTab,
    coachStudentMode,
    parentView,
    meRole,
    parentTab,
    coachParentTab,
    coachParentMode,
    studentLockStatus,
    parentStudentsLoaded,
    parentStudentsLength: parentStudents.length,
    showStudentShell,
    isStandaloneAnalysisPage,
    roleLoading,
    profileLoadFailed
  };

  return (
    <div className="app-root">
      {splashDone && networkBanner?.message && (
        <div
          className={`network-transition-banner network-transition-banner--${networkBanner.kind || "info"}`}
          role="status"
        >
          {networkBanner.message}
        </div>
      )}
      {splashDone && !online && (
        <div className="offline-banner" role="status">
          인터넷에 연결되어 있지 않아요. Wi‑Fi 또는 셀룰러에 연결한 뒤 다시 시도하세요. 로그인과 저장은
          온라인일 때만 할 수 있어요.
        </div>
      )}
      {!splashDone && (
        <>
          {/* fixed 스플래시는 flex 레이아웃 밖이라, 유동 높이 확보용 */}
          <div className="splash-spacer" aria-hidden />
          <SplashScreen
            onComplete={() => {
              splashCompletedModule = true;
              setSplashDone(true);
            }}
          />
        </>
      )}
      {splashDone && route === "auth" ? (
        <AuthScreen
          authLeaving={authLeaving}
          authMode={authMode}
          authRole={authRole}
          authStudentName={authStudentName}
          authParentPhone={authParentPhone}
          authParentPhoneCode={authParentPhoneCode}
          authParentPhoneVerified={Boolean(authParentPhoneVerifyToken)}
          authParentPhoneSending={authParentPhoneSending}
          authParentPhoneVerifying={authParentPhoneVerifying}
          authParentPhoneNotice={authParentPhoneNotice}
          authParentPhoneNoticeTone={authParentPhoneNoticeTone}
          authEmail={authEmail}
          authPassword={authPassword}
          authError={authError}
          onModeChange={mode => {
            hapticSelection();
            setAuthMode(mode);
            setAuthError("");
          }}
          onRoleChange={role => {
            hapticSelection();
            setAuthRole(role);
          }}
          onStudentNameChange={setAuthStudentName}
          onParentPhoneChange={value => {
            setAuthParentPhone(value);
            setAuthParentPhoneVerifyToken(null);
            setAuthParentPhoneCode("");
            setAuthParentPhoneNotice("");
            setAuthParentPhoneNoticeTone("neutral");
          }}
          onParentPhoneCodeChange={setAuthParentPhoneCode}
          onParentPhoneSendCode={() => void handleParentPhoneSendCode()}
          onParentPhoneVerifyCode={() => void handleParentPhoneVerifyCode()}
          onEmailChange={setAuthEmail}
          onPasswordChange={setAuthPassword}
          onSubmit={handleAuthSubmit}
        />
      ) : splashDone ? (
      <div
        className={
          "app-shell" +
          (mainEnter ? " app-shell--enter" : "") +
          (isStandaloneAnalysisPage ? " app-shell--analysis-focus" : "")
        }
      >
        <header className={`app-header${headerScrolled ? " app-header--scrolled" : ""}`}>
          <div className="header-top">
            {isStandaloneAnalysisPage ? (
              <button
                type="button"
                className="header-icon-btn header-icon-btn--back"
                aria-label="AI 코치로 돌아가기"
                onClick={() => {
                  hapticSelection();
                  if (isParentAnalysisPage) {
                    setCoachParentTab("records");
                    setAppPath("#/parent/records");
                    return;
                  }
                  setCoachStudentTab("coach");
                  setCoachStudentCoachLayout("chat");
                  setAppPath("#/student/coach");
                }}
              >
                <ChevronLeft size={20} strokeWidth={2.4} aria-hidden />
              </button>
            ) : null}
            <div className="header-title-group">
              <div className="header-title-row">
                <h1 className="header-title">{headerTitle}</h1>
              </div>
            </div>
            {((showStudentShell && !parentView) || (parentView && meRole === "parent")) &&
            !isStandaloneAnalysisPage ? (
              <div className="header-actions">
                <button
                  type="button"
                  className="header-icon-btn"
                  aria-label={
                    (parentView && meRole === "parent"
                      ? parentNotificationUnreadCount
                      : studentNotificationUnreadCount) > 0
                      ? "알림, 읽지 않은 알림 있음"
                      : "알림"
                  }
                  onClick={() => {
                    hapticSelection();
                    if (!parentView) {
                      setCoachStudentTab(null);
                      setCoachStudentCoachLayout("scroll");
                    }
                    setShowNotificationsModal(true);
                  }}
                >
                  {(parentView && meRole === "parent"
                    ? parentNotificationUnreadCount
                    : studentNotificationUnreadCount) > 0 ? (
                    <BellDot size={22} strokeWidth={2} aria-hidden />
                  ) : (
                    <Bell size={22} strokeWidth={2} aria-hidden />
                  )}
                </button>
              </div>
            ) : null}
          </div>

          {/* 오늘 공부의 진행률은 StudentLegacyView에서 3섹션 레이아웃으로 렌더링합니다. */}
        </header>

        <main
          className={
            "app-main" +
            (showStudentShell &&
            (!coachStudentMode || coachStudentTab === "home") &&
            tab === "today"
              ? " app-main--today-fixed"
              : "") +
            (showStudentShell &&
            !coachStudentMode &&
            tab === "store"
              ? " app-main--store-fixed"
              : "") +
            ((showStudentShell &&
            coachStudentMode &&
            coachStudentTab !== "home" &&
            coachStudentCoachLayout === "chat") ||
            (parentView && coachParentMode && coachParentTab === "manage")
              ? " app-main--coach-chat"
              : "")
          }
          onScroll={handleAppMainScroll}
        >
          <PageTransition
            pageKey={appMainPageKey}
            className="app-main__transition-root"
          >
            {profileLoadFailed && (
              <div className="section" style={{ padding: "16px 8px" }}>
                <p className="empty-state" style={{ marginBottom: 14 }}>
                  {profileLoadError}
                </p>
                <button
                  type="button"
                  className="modal-primary"
                  onClick={() => setMeFetchNonce(n => n + 1)}
                >
                  다시 시도
                </button>
              </div>
            )}
            {!roleLoading &&
              coachStudentMode &&
              coachStudentTab &&
              coachStudentTab !== "home" && (
              <React.Suspense fallback={<AppRouteSuspenseFallback />}>
                <StudentCoachApp
                  tab={coachStudentTab}
                  authToken={authToken}
                  onLayoutModeChange={setCoachStudentCoachLayout}
                  blocks={blocks}
                  progressBooks={progressBooks}
                  tomorrowPlan={tomorrowPlan}
                  todayStudyEvaluation={todayStudyEvaluation}
                  todayMetacognitionReflection={todayMetacognitionReflection}
                  todayMemo={coachTodayMemo}
                  draftTomorrowPractice={coachDraftTomorrowPractice}
                  todayStudyMinutes={coachTodayStudyMinutes}
                  onApplyTomorrowPlanAndGoRecords={applyCoachTomorrowPlanAndGoRecords}
                  onApplyTomorrowPracticeAndGoRecords={
                    applyCoachTomorrowPracticeAndGoRecords
                  }
                />
              </React.Suspense>
            )}
            {!roleLoading && coachParentMode && coachParentTab && (
              <React.Suspense fallback={<AppRouteSuspenseFallback />}>
                <ParentCoachApp
                  tab={coachParentTab}
                  apiBase={API_BASE}
                  authToken={authToken}
                  userEmail={userEmail}
                  parentNotificationUnreadCount={parentNotificationUnreadCount}
                  hapticSelection={hapticSelection}
                  parentStudents={parentStudents}
                  setParentStudents={setParentStudents}
                  parentStudentId={parentStudentId}
                  setParentStudentId={setParentStudentId}
                  parentReport={parentReport}
                  parentAiDaily={parentAiDaily}
                  parentPlannerEnabled={parentPlannerEnabled}
                  setParentPlannerEnabled={setParentPlannerEnabled}
                  parentPlannerTime={parentPlannerTime}
                  setParentPlannerTime={setParentPlannerTime}
                  parentPlannerSaving={parentPlannerSaving}
                  setParentPlannerSaving={setParentPlannerSaving}
                  parentPlannerMessage={parentPlannerMessage}
                  setParentPlannerMessage={setParentPlannerMessage}
                  parentLockStatus={parentLockStatus}
                  setParentLockStatus={setParentLockStatus}
                  hapticWarning={hapticWarning}
                  hapticSuccess={hapticSuccess}
                />
              </React.Suspense>
            )}
            {!roleLoading && parentView && !coachParentMode && (
              <React.Suspense fallback={<AppRouteSuspenseFallback />}>
                <ParentLegacyView
                  apiBase={API_BASE}
                  authToken={authToken}
                  meRole={meRole}
                  userEmail={userEmail}
                  parentTab={parentTab}
                  parentLinkEmail={parentLinkEmail}
                  setParentLinkEmail={setParentLinkEmail}
                  parentWaitingOnStudent={parentWaitingOnStudent}
                  parentWaitingOnMe={parentWaitingOnMe}
                  parentStudents={parentStudents}
                  parentStudentId={parentStudentId}
                  setParentStudentId={setParentStudentId}
                  parentWeekOffset={parentWeekOffset}
                  setParentWeekOffset={setParentWeekOffset}
                  parentReport={parentReport}
                  parentAiDaily={parentAiDaily}
                  parentPlannerEnabled={parentPlannerEnabled}
                  setParentPlannerEnabled={setParentPlannerEnabled}
                  parentPlannerTime={parentPlannerTime}
                  setParentPlannerTime={setParentPlannerTime}
                  parentPlannerSaving={parentPlannerSaving}
                  setParentPlannerSaving={setParentPlannerSaving}
                  parentPlannerMessage={parentPlannerMessage}
                  setParentPlannerMessage={setParentPlannerMessage}
                  parentLockStatus={parentLockStatus}
                  setParentLockStatus={setParentLockStatus}
                  setParentTab={setParentTab}
                  setParentWaitingOnStudent={setParentWaitingOnStudent}
                  setParentWaitingOnMe={setParentWaitingOnMe}
                  setParentStudents={setParentStudents}
                  setParentAiDaily={setParentAiDaily}
                  onSelectManagedStudent={studentId => {
                    setParentStudentId(studentId);
                    setCoachParentTab("manage");
                    setAppPath("#/parent/manage");
                  }}
                  hapticSelection={hapticSelection}
                  hapticWarning={hapticWarning}
                  hapticSuccess={hapticSuccess}
                  onUserEmailUpdated={(email: string) => {
                    setUserEmail(email);
                    try {
                      localStorage.setItem("daechi_planner_user_email", email);
                    } catch {
                      // ignore
                    }
                  }}
                  onLogoutPress={() => setAuthConfirmKind("logout")}
                  onWithdrawPress={() => setAuthConfirmKind("withdraw")}
                />
              </React.Suspense>
            )}

            {showStudentShell && !coachStudentMode && tab === "profile" && (
              <React.Suspense fallback={<AppRouteSuspenseFallback />}>
                <StudentProfilePage
                  authToken={authToken}
                  apiBase={API_BASE}
                  userEmail={userEmail}
                  meRole={meRole}
                  storeApps={storeApps}
                  studentParentEmail={studentParentEmail}
                  setStudentParentEmail={setStudentParentEmail}
                  studentWaitingOnParent={studentWaitingOnParent}
                  studentWaitingOnMe={studentWaitingOnMe}
                  setStudentWaitingOnParent={setStudentWaitingOnParent}
                  setStudentWaitingOnMe={setStudentWaitingOnMe}
                  hapticSelection={hapticSelection}
                  hapticWarning={hapticWarning}
                  hapticSuccess={hapticSuccess}
                  onUserEmailUpdated={(email: string) => {
                    setUserEmail(email);
                    try {
                      localStorage.setItem("daechi_planner_user_email", email);
                    } catch {
                      // ignore
                    }
                  }}
                  onLogoutPress={() => setAuthConfirmKind("logout")}
                  onWithdrawPress={() => setAuthConfirmKind("withdraw")}
                />
              </React.Suspense>
            )}
            {showStudentShell &&
              (!coachStudentMode || coachStudentTab === "home") &&
              tab !== "profile" && (
              <React.Suspense fallback={<AppRouteSuspenseFallback />}>
                <StudentLegacyView
                  tab={tab}
                  apiBase={API_BASE}
                  authToken={authToken}
                  meRole={meRole}
                  blocks={blocks}
                  toggleDone={toggleDone}
                  studentLockStatus={studentLockStatus}
                  studentLockMessage={studentLockMessage}
                  timelineSyncError={timelineSyncError}
                  onDismissTimelineSyncError={() => setTimelineSyncError("")}
                  planRequestNotice={planRequestNotice}
                  onDismissPlanRequestNotice={() => setPlanRequestNotice("")}
                  progressWeekOffset={progressWeekOffset}
                  setProgressWeekOffset={setProgressWeekOffset}
                  progressBooks={progressBooks}
                  removeProgressBook={removeProgressBook}
                  tomorrowPlan={tomorrowPlan}
                  setTomorrowPlan={setTomorrowPlan}
                  saveTomorrowPlan={saveTomorrowPlan}
                  todayStudyEvaluation={todayStudyEvaluation}
                  setTodayStudyEvaluation={setTodayStudyEvaluation}
                  todayMetacognitionReflection={todayMetacognitionReflection}
                  setTodayMetacognitionReflection={setTodayMetacognitionReflection}
                  setBooksModalOpen={setBooksModalOpen}
                  onOpenAddPlan={openAddPlanModal}
                  setCheckSettingsOpen={setCheckSettingsOpen}
                  storeApps={storeApps}
                  storeLoading={storeLoading}
                  storeError={storeError}
                  storeSavingId={storeSavingId}
                  setStoreSavingId={setStoreSavingId}
                  setStoreError={setStoreError}
                  setStoreApps={setStoreApps}
                  resolvePreferredSerial={resolvePreferredSerial}
                  hapticSelection={hapticSelection}
                  hapticWarning={hapticWarning}
                  hapticImpactLight={hapticImpactLight}
                  hapticSuccess={hapticSuccess}
                />
              </React.Suspense>
            )}
          </PageTransition>
        </main>

        {!isStandaloneAnalysisPage && (
          <AppBottomNav
            showStudentShell={showStudentShell}
            roleLoading={roleLoading}
            parentView={parentView}
            meRole={meRole}
            tab={tab}
            parentTab={parentTab}
            coachStudentTab={coachStudentTab}
            coachParentTab={coachParentTab}
            onStudentNavClick={nextTab => {
              if (
                meRole === "student" &&
                studentLockStatus?.forceRecordsPage &&
                nextTab !== "records"
              ) {
                hapticWarning();
                setAppPath("#/records");
                return;
              }
                hapticSelection();
              setCoachStudentTab(null);
              setCoachStudentCoachLayout("scroll");
              setTab(nextTab);
              setAppPath(
                nextTab === "today"
                  ? "#/today"
                  : nextTab === "records"
                    ? "#/records"
                    : nextTab === "store"
                      ? "#/store"
                      : "#/profile"
              );
            }}
            onCoachStudentNavClick={nextTab => {
              if (meRole === "student" && studentLockStatus?.forceRecordsPage) {
                hapticWarning();
                setCoachStudentTab(null);
                setCoachStudentCoachLayout("scroll");
                setTab("records");
                setAppPath("#/records");
                return;
              }
                hapticSelection();
              setCoachStudentTab(nextTab);
              setCoachStudentCoachLayout(nextTab === "coach" ? "chat" : "scroll");
              setAppPath(
                nextTab === "coach"
                  ? "#/student/coach"
                  : nextTab === "analysis"
                    ? "#/student/analysis"
                    : "#/student/home"
              );
            }}
            onParentNavClick={nextTab => {
              hapticSelection();
              setParentTab(nextTab);
              setAppPath(
                nextTab === "profile"
                    ? "#/parent/profile"
                    : "#/parent/home"
              );
            }}
            onCoachParentNavClick={nextTab => {
              if (
                nextTab !== "home" &&
                parentStudentsLoaded &&
                parentStudents.length === 0
              ) {
                redirectParentToProfileForStudentLink();
                return;
              }
              hapticSelection();
              setCoachParentTab(nextTab);
              setAppPath(
                nextTab === "home"
                  ? "#/parent/home"
                  : nextTab === "manage"
                    ? "#/parent/manage"
                    : nextTab === "analysis"
                      ? "#/parent/analysis"
                      : nextTab === "records"
                        ? "#/parent/records"
                        : "#/parent/student-settings"
              );
            }}
          />
        )}

        {showAddModal && (
          <div
            className={
              "dday-modal" +
              (addModalReveal.revealed ? " dday-modal--open" : "")
            }
            onClick={() =>
              addModalReveal.beginClose(() => setShowAddModal(false))
            }
          >
            <div
              className="dday-modal-inner dday-modal-inner--add-task"
              onClick={e => {
                e.stopPropagation();
              }}
            >
              <div className="dday-modal-header">
                <span className="dday-modal-title">계획 수정 요청</span>
              </div>
              <div className="dday-modal-body">
                <div className="field">
                  <label className="field-label" id="add-plan-book-label">
                    교재
                  </label>
                  {progressBooks.length > 0 ? (
                    <div
                      className="store-filter-row add-plan-book-picker"
                      role="listbox"
                      aria-labelledby="add-plan-book-label"
                    >
                      {progressBooks.map(b => (
                        <button
                          key={b.id}
                          type="button"
                          role="option"
                          aria-selected={addBlockBookId === b.id}
                          className={
                            "store-filter-btn" +
                            (addBlockBookId === b.id
                              ? " store-filter-btn--active"
                              : "")
                          }
                          onClick={() => {
                            hapticSelection();
                            setAddBlockBookId(b.id);
                          }}
                        >
                          {b.name}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="settings-hint" style={{ marginTop: 6 }}>
                      교재가 없어요. 기록에서 추가하세요.
                    </p>
                  )}
                </div>
                <div className="field">
                  <label className="field-label">범위</label>
                  <input
                    className="field-input"
                    value={addBlockPlan}
                    onChange={e => setAddBlockPlan(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label className="field-label">시간</label>
                  <div className="add-plan-time-inline-stack">
                    <div className="add-plan-time-inline-row">
                      <span className="add-plan-time-inline-label">시작</span>
                      <TimePickerInline
                        value={startInput}
                        onChange={setStartInput}
                        hapticSelection={hapticSelection}
                      />
                    </div>
                    <div className="add-plan-time-inline-row">
                      <span className="add-plan-time-inline-label">종료</span>
                      <TimePickerInline
                        value={endInput}
                        onChange={setEndInput}
                        hapticSelection={hapticSelection}
                      />
                    </div>
                  </div>
                </div>
              </div>
              <div className="dday-modal-footer">
                <button
                  type="button"
                  className="modal-secondary"
                  onClick={() =>
                    addModalReveal.beginClose(() => setShowAddModal(false))
                  }
                >
                  취소
                </button>
                <button
                  type="button"
                  className="modal-primary"
                  onClick={handleAdd}
                  disabled={
                    addBlockBookId == null ||
                    progressBooks.length === 0 ||
                    !normalizeBlockTime(startInput) ||
                    !normalizeBlockTime(endInput)
                  }
                >
                  보내기
                </button>
              </div>
            </div>
          </div>
        )}

        {kioskPopupKind && (
          <div
            className={
              "dday-modal" +
              (kioskPopupReveal.revealed ? " dday-modal--open" : "")
            }
            onClick={() =>
              kioskPopupReveal.beginClose(() => setKioskPopupKind(null))
            }
          >
            <div
              className="dday-modal-inner"
              onClick={e => {
                e.stopPropagation();
              }}
            >
              <div className="dday-modal-header">
                <span className="dday-modal-title">안내</span>
              </div>
              <div className="dday-modal-body">
                <p className="settings-hint" style={{ margin: 0, lineHeight: 1.5 }}>
                  {kioskPopupKind === "planner-enter"
                    ? "계획표 작성 시간이에요. 작성을 마치면 잠금이 풀려요."
                    : "작성이 끝났어요. 곧 잠금이 풀려요."}
                </p>
              </div>
              <div className="dday-modal-footer">
                <button
                  type="button"
                  className="modal-primary"
                  onClick={() =>
                    kioskPopupReveal.beginClose(() => setKioskPopupKind(null))
                  }
                >
                  확인
                </button>
              </div>
            </div>
          </div>
        )}

        {showPlanAddNoParentModal && (
          <div
            className={
              "dday-modal" +
              (noParentPlanModalReveal.revealed ? " dday-modal--open" : "")
            }
            onClick={() =>
              noParentPlanModalReveal.beginClose(() =>
                setShowPlanAddNoParentModal(false)
              )
            }
          >
            <div
              className="dday-modal-inner"
              onClick={e => {
                e.stopPropagation();
              }}
            >
              <div className="dday-modal-header">
                <span className="dday-modal-title">학부모 연결 필요</span>
              </div>
              <div className="dday-modal-body">
                <p
                  className="settings-hint"
                  style={{ margin: 0, lineHeight: 1.5 }}
                >
                  계획 수정 요청은 연결된 학부모가 있을 때 보낼 수 있어요. 내 정보에서 학부모와
                  먼저 연결하세요.
                </p>
              </div>
              <div className="dday-modal-footer">
                <button
                  type="button"
                  className="modal-primary"
                  onClick={() =>
                    noParentPlanModalReveal.beginClose(() =>
                      setShowPlanAddNoParentModal(false)
                    )
                  }
                >
                  확인
                </button>
              </div>
            </div>
          </div>
        )}

        {parentPlanAddRequests.length > 0 && parentPlanAddRequests[0] ? (
          <div
            className={
              "dday-modal" +
              (parentPlanAddModalReveal.revealed ? " dday-modal--open" : "")
            }
            role="dialog"
            aria-modal="true"
            aria-labelledby="parent-plan-add-title"
          >
            <div
              className="dday-modal-inner dday-modal-inner--fixed-72"
              onClick={e => {
                e.stopPropagation();
              }}
            >
              <div className="dday-modal-header">
                <span
                  className="dday-modal-title"
                  id="parent-plan-add-title"
                >
                  오늘 계획 수정을 허용하시겠습니까?
                </span>
              </div>
              <div className="dday-modal-body dday-modal-body--scroll-fill">
                <p
                  className="settings-hint"
                  style={{ margin: "0 0 10px", lineHeight: 1.5 }}
                >
                  학생이 오늘 공부 계획 수정을 요청했습니다.
                </p>
                <div className="parent-plan-add-request-detail">
                  <p className="parent-plan-add-request-line">
                    <span className="parent-plan-add-request-k">학생</span>{" "}
                    {parentPlanAddRequests[0].student_email}
                  </p>
                  <p className="parent-plan-add-request-line">
                    <span className="parent-plan-add-request-k">책</span>{" "}
                    {parentPlanAddRequests[0].subject_snapshot}
                  </p>
                  {parentPlanAddRequests[0].planned_range ? (
                    <p className="parent-plan-add-request-line">
                      <span className="parent-plan-add-request-k">범위</span>{" "}
                      {parentPlanAddRequests[0].planned_range}
                    </p>
                  ) : null}
                  <p className="parent-plan-add-request-line">
                    <span className="parent-plan-add-request-k">시간</span>{" "}
                    {normalizeBlockTime(parentPlanAddRequests[0].start_time)} –{" "}
                    {normalizeBlockTime(parentPlanAddRequests[0].end_time)}
                  </p>
                </div>
              </div>
              <div className="dday-modal-footer">
                <button
                  type="button"
                  className="modal-secondary"
                  disabled={parentPlanAddBusy}
                  onClick={async () => {
                    const head = parentPlanAddRequests[0];
                    if (!authToken || !head) return;
                    setParentPlanAddBusy(true);
                    hapticSelection();
                    try {
                      const res = await fetch(
                        `${API_BASE}/api/parent/plan-add-requests/${head.id}/reject`,
                        {
                          method: "POST",
                          headers: { Authorization: `Bearer ${authToken}` }
                        }
                      );
                      if (!res.ok) hapticWarning();
                      else hapticSuccess();
                      await refreshParentPlanAddRequests();
                    } finally {
                      setParentPlanAddBusy(false);
                    }
                  }}
                >
                  거절
                </button>
                <button
                  type="button"
                  className="modal-primary"
                  disabled={parentPlanAddBusy}
                  onClick={async () => {
                    const head = parentPlanAddRequests[0];
                    if (!authToken || !head) return;
                    setParentPlanAddBusy(true);
                    hapticImpactLight();
                    try {
                      const res = await fetch(
                        `${API_BASE}/api/parent/plan-add-requests/${head.id}/approve`,
                        {
                          method: "POST",
                          headers: { Authorization: `Bearer ${authToken}` }
                        }
                      );
                      if (!res.ok) {
                        hapticWarning();
                      } else {
                        hapticSuccess();
                      }
                      await refreshParentPlanAddRequests();
                    } finally {
                      setParentPlanAddBusy(false);
                    }
                  }}
                >
                  허용
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {showNotificationsModal && (
          <div
            className={
              "dday-modal" +
              (notificationsModalReveal.revealed ? " dday-modal--open" : "")
            }
            onClick={() =>
              notificationsModalReveal.beginClose(() =>
                setShowNotificationsModal(false)
              )
            }
          >
            <div
              className="dday-modal-inner dday-modal-inner--fixed-72"
              onClick={e => {
                e.stopPropagation();
              }}
              role="dialog"
              aria-modal="true"
              aria-labelledby="notifications-modal-title"
            >
              <div className="dday-modal-header">
                <span
                  className="dday-modal-title"
                  id="notifications-modal-title"
                >
                  알림
                </span>
              </div>
              <div className="dday-modal-body notifications-modal-body">
                <React.Suspense fallback={<AppRouteSuspenseFallback />}>
                  <NotificationsPage
                    apiBase={API_BASE}
                    authToken={authToken}
                    meRole={meRole}
                    onNotificationAction={action => {
                      if (action.type === "link_unlink_request") {
                        openLinkUnlinkRequestFromNotification(action);
                        return;
                      }
                      if (meRole === "parent") {
                        openParentAppTimetableRequestFromNotification(action);
                      }
                    }}
                    onReadAll={() => {
                      if (meRole === "parent") {
                        setParentNotificationUnreadCount(0);
                      }
                      if (meRole === "student") {
                        setStudentNotificationUnreadCount(0);
                      }
                    }}
                  />
                </React.Suspense>
              </div>
              <div className="dday-modal-footer">
                <button
                  type="button"
                  className="modal-primary"
                  onClick={() =>
                    notificationsModalReveal.beginClose(() =>
                      setShowNotificationsModal(false)
                    )
                  }
                >
                  닫기
                </button>
              </div>
            </div>
          </div>
        )}

        {pendingLinkUnlinkAction ? (
          <div
            className="dday-modal dday-modal--open"
            onClick={() => {
              if (pendingLinkUnlinkBusy) return;
              setPendingLinkUnlinkAction(null);
              setPendingLinkUnlinkError("");
            }}
          >
            <div
              className="dday-modal-inner"
              onClick={event => {
                event.stopPropagation();
              }}
              role="dialog"
              aria-modal="true"
              aria-labelledby="link-unlink-request-modal-title"
            >
              <div className="dday-modal-header">
                <span className="dday-modal-title" id="link-unlink-request-modal-title">
                  연결 끊기 요청
                </span>
              </div>
              <div className="dday-modal-body">
                <p className="settings-hint" style={{ marginTop: 0 }}>
                  {pendingLinkUnlinkAction.counterpartEmail
                    ? `${pendingLinkUnlinkAction.counterpartEmail} 계정이 연결 끊기를 요청했습니다. 확인하면 연결이 해제됩니다.`
                    : "상대 계정이 연결 끊기를 요청했습니다. 확인하면 연결이 해제됩니다."}
                </p>
                {pendingLinkUnlinkError ? (
                  <p className="settings-hint" style={{ color: "#b91c1c", marginTop: 10 }}>
                    {pendingLinkUnlinkError}
                  </p>
                ) : null}
              </div>
              <div className="dday-modal-footer">
                <button
                  type="button"
                  className="modal-secondary"
                  disabled={pendingLinkUnlinkBusy}
                  onClick={async () => {
                    if (!authToken) return;
                    setPendingLinkUnlinkBusy(true);
                    setPendingLinkUnlinkError("");
                    try {
                      const res = await fetch(`${API_BASE}/api/link/unlink-reject`, {
                        method: "POST",
                        headers: {
                          "Content-Type": "application/json",
                          Authorization: `Bearer ${authToken}`
                        },
                        body: JSON.stringify({ requestId: pendingLinkUnlinkAction.requestId })
                      });
                      const data = await res.json().catch(() => ({}));
                      if (!res.ok) {
                        setPendingLinkUnlinkError(
                          String(data?.error || "요청 거절에 실패했습니다.")
                        );
                        hapticWarning();
                        return;
                      }
                      window.dispatchEvent(new Event(DAECHI_LINKS_UPDATED_EVENT));
                      setPendingLinkUnlinkAction(null);
                      hapticSelection();
                    } catch {
                      setPendingLinkUnlinkError("네트워크 오류로 요청을 거절하지 못했습니다.");
                      hapticWarning();
                    } finally {
                      setPendingLinkUnlinkBusy(false);
                    }
                  }}
                >
                  {pendingLinkUnlinkBusy ? "처리 중…" : "거절"}
                </button>
                <button
                  type="button"
                  className="modal-primary"
                  disabled={pendingLinkUnlinkBusy}
                  onClick={async () => {
                    if (!authToken) return;
                    setPendingLinkUnlinkBusy(true);
                    setPendingLinkUnlinkError("");
                    try {
                      const res = await fetch(`${API_BASE}/api/link/unlink-confirm`, {
                        method: "POST",
                        headers: {
                          "Content-Type": "application/json",
                          Authorization: `Bearer ${authToken}`
                        },
                        body: JSON.stringify({ requestId: pendingLinkUnlinkAction.requestId })
                      });
                      const data = await res.json().catch(() => ({}));
                      if (!res.ok) {
                        setPendingLinkUnlinkError(
                          String(data?.error || "연결 해제에 실패했습니다.")
                        );
                        hapticWarning();
                        return;
                      }
                      if (meRole === "parent") {
                        await refreshParentStudents();
                      }
                      window.dispatchEvent(new Event(DAECHI_LINKS_UPDATED_EVENT));
                      setPendingLinkUnlinkAction(null);
                      hapticSuccess();
                    } catch {
                      setPendingLinkUnlinkError("네트워크 오류로 연결을 해제하지 못했습니다.");
                      hapticWarning();
                    } finally {
                      setPendingLinkUnlinkBusy(false);
                    }
                  }}
                >
                  {pendingLinkUnlinkBusy ? "처리 중…" : "확인 후 연결 끊기"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {activeStudyReminder && (
          <div
            className={
              "dday-modal" +
              (activeStudyReminderReveal.revealed ? " dday-modal--open" : "")
            }
            onClick={() =>
              activeStudyReminderReveal.beginClose(() =>
                setActiveStudyReminder(null)
              )
            }
          >
            <div
              className="dday-modal-inner"
              onClick={event => {
                event.stopPropagation();
              }}
              role="dialog"
              aria-modal="true"
              aria-labelledby="study-reminder-title"
            >
              <div className="dday-modal-header">
                <span className="dday-modal-title" id="study-reminder-title">
                  공부 시작 알림
                </span>
              </div>
              <div className="dday-modal-body">
                <p className="settings-hint" style={{ margin: 0, lineHeight: 1.5 }}>
                  {activeStudyReminder.start}부터 {activeStudyReminder.subject} 공부를 시작할
                  시간입니다.
                </p>
                {activeStudyReminder.plannedRange ? (
                  <p
                    className="settings-hint"
                    style={{ margin: 0, color: "var(--neutral)", lineHeight: 1.5 }}
                  >
                    오늘 범위: {activeStudyReminder.plannedRange}
                  </p>
                ) : null}
              </div>
              <div className="dday-modal-footer">
                <button
                  type="button"
                  className="modal-secondary"
                  onClick={() =>
                    activeStudyReminderReveal.beginClose(() =>
                      setActiveStudyReminder(null)
                    )
                  }
                >
                  닫기
                </button>
                <button
                  type="button"
                  className="modal-primary"
                  onClick={() => {
                    const block = blocks.find(
                      item => item.id === activeStudyReminder.blockId
                    );
                    activeStudyReminderReveal.beginClose(() =>
                      setActiveStudyReminder(null)
                    );
                    if (block && !block.done) {
                      toggleDone(activeStudyReminder.blockId);
                    }
                  }}
                >
                  완료로 체크
                </button>
              </div>
            </div>
          </div>
        )}

        {parentAppTimetableRequestDetail && (
          <div
            className={
              "dday-modal" +
              (parentAppTimetableRequestReveal.revealed ? " dday-modal--open" : "")
            }
            onClick={() =>
              parentAppTimetableRequestReveal.beginClose(() =>
                setParentAppTimetableRequestDetail(null)
              )
            }
          >
            <div
              className="dday-modal-inner dday-modal-inner--fixed-72 parent-app-request-modal"
              onClick={e => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-labelledby="parent-app-request-title"
            >
              <div className="dday-modal-header">
                <span className="dday-modal-title" id="parent-app-request-title">
                  허용 앱 요청
                </span>
              </div>
              <div className="dday-modal-body parent-app-request-modal__body dday-modal-body--scroll-fill">
                <div className="parent-app-request-modal__meta">
                  <div className="parent-app-request-modal__meta-row">
                    <span className="parent-app-request-modal__label">학생</span>
                    <span className="parent-app-request-modal__value">
                      {parentAppTimetableRequestDetail.studentEmail || "연결 학생"}
                    </span>
                  </div>
                  <div className="parent-app-request-modal__meta-row">
                    <span className="parent-app-request-modal__label">요청 범위</span>
                    <span className="parent-app-request-modal__value">
                      {parentAppTimetableRequestDetail.targetDate || "요일별 요청"}
                    </span>
                  </div>
                </div>
                {parentAppTimetableRequestDetail.summary ? (
                  <div className="parent-app-request-modal__card">
                    <div className="parent-app-request-modal__card-title">요청 요약</div>
                    <p className="parent-app-request-modal__card-copy">
                      {parentAppTimetableRequestDetail.summary}
                    </p>
                  </div>
                ) : null}
                {parentAppTimetableRequestDetail.slotSummary ? (
                  <div className="parent-app-request-modal__card">
                    <div className="parent-app-request-modal__card-title">요청 시간대</div>
                    <p className="parent-app-request-modal__card-copy">
                      {parentAppTimetableRequestDetail.slotSummary}
                    </p>
                  </div>
                ) : null}
                <p className="parent-app-request-modal__hint">
                  승인하면 요청된 요일의 학생 허용 앱 시간표에 바로 반영됩니다.
                </p>
                {parentAppTimetableRequestError ? (
                  <p className="settings-hint" style={{ margin: 0, color: "#8d2c22" }}>
                    {parentAppTimetableRequestError}
                  </p>
                ) : null}
              </div>
              <div className="dday-modal-footer">
                <button
                  type="button"
                  className="modal-secondary"
                  onClick={() =>
                    parentAppTimetableRequestReveal.beginClose(() =>
                      setParentAppTimetableRequestDetail(null)
                    )
                  }
                >
                  닫기
                </button>
                <button
                  type="button"
                  className="modal-primary"
                  disabled={parentAppTimetableRequestBusy}
                  onClick={async () => {
                    if (!parentAppTimetableRequestDetail || !authToken) return;
                    setParentAppTimetableRequestError("");
                    setParentAppTimetableRequestBusy(true);
                    try {
                      const res = await fetch(
                        `${API_BASE}/api/parent/app-timetable-request/approve`,
                        {
                          method: "POST",
                          headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${authToken}`
                          },
                          body: JSON.stringify({
                            studentEmail: parentAppTimetableRequestDetail.studentEmail,
                            targetDate: parentAppTimetableRequestDetail.targetDate,
                            slots: parentAppTimetableRequestDetail.slots
                          })
                        }
                      );
                      const data = await res.json().catch(() => ({}));
                      if (!res.ok) {
                        throw new Error(
                          String(data?.error || "허용 앱 시간표 승인에 실패했습니다.")
                        );
                      }
                      parentAppTimetableRequestReveal.beginClose(() =>
                        setParentAppTimetableRequestDetail(null)
                      );
                    } catch (error) {
                      setParentAppTimetableRequestError(
                        error instanceof Error && error.message
                          ? error.message
                          : "허용 앱 시간표 승인에 실패했습니다."
                      );
                    } finally {
                      setParentAppTimetableRequestBusy(false);
                    }
                  }}
                >
                  {parentAppTimetableRequestBusy ? "반영 중…" : "승인하고 반영"}
                </button>
              </div>
            </div>
          </div>
        )}

        {studentSetupOpen && (
          <div
            className={
              "dday-modal" +
              (studentSetupReveal.revealed ? " dday-modal--open" : "")
            }
          >
            <div
              className="dday-modal-inner"
              onClick={e => {
                e.stopPropagation();
              }}
            >
              <div className="dday-modal-header">
                <span className="dday-modal-title">프로필</span>
              </div>
              <div className="dday-modal-body">
                <p className="settings-hint" style={{ margin: 0, lineHeight: 1.5 }}>
                  학년·목표 대학·목표 성적은 필수예요. 고민과 취약점은 나중에도 바꿀 수 있어요.
                </p>
                <div className="field">
                  <label className="field-label" htmlFor="student-setup-grade">
                    학년
                  </label>
                  <input
                    id="student-setup-grade"
                    className="field-input"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={12}
                    value={studentSetupGrade}
                    onChange={e => setStudentSetupGrade(e.target.value)}
                    placeholder="예: 3"
                  />
                </div>
                <div className="field">
                  <label className="field-label" htmlFor="student-setup-goal-university">
                    목표 대학
                  </label>
                  <input
                    id="student-setup-goal-university"
                    className="field-input"
                    type="text"
                    value={studentSetupGoalUniversity}
                    onChange={e => setStudentSetupGoalUniversity(e.target.value)}
                    placeholder="예: 연세대학교"
                  />
                </div>
                <div className="field">
                  <label className="field-label" htmlFor="student-setup-target-grade">
                    목표 성적
                  </label>
                  <input
                    id="student-setup-target-grade"
                    className="field-input"
                    type="text"
                    value={studentSetupTargetGrade}
                    onChange={e => setStudentSetupTargetGrade(e.target.value)}
                    placeholder="예: 수학 1등급, 평균 92점"
                  />
                </div>
                <div className="field">
                  <label className="field-label" htmlFor="student-setup-current-concern">
                    현재 고민
                  </label>
                  <textarea
                    id="student-setup-current-concern"
                    className="field-input"
                    rows={3}
                    value={studentSetupCurrentConcern}
                    onChange={e => setStudentSetupCurrentConcern(e.target.value)}
                    placeholder="예: 계획은 세우는데 실천이 자주 밀려요"
                  />
                </div>
                <div className="field">
                  <label className="field-label" htmlFor="student-setup-weakness">
                    취약점
                  </label>
                  <textarea
                    id="student-setup-weakness"
                    className="field-input"
                    rows={3}
                    value={studentSetupWeakness}
                    onChange={e => setStudentSetupWeakness(e.target.value)}
                    placeholder="예: 수학 킬러 문항, 영어 빈칸 추론"
                  />
                </div>
                {studentSetupError ? (
                  <p className="settings-hint" style={{ margin: 0, color: "#000000" }}>
                    {studentSetupError}
                  </p>
                ) : null}
              </div>
              <div className="dday-modal-footer">
                <button
                  type="button"
                  className="modal-primary"
                  onClick={() => void saveInitialStudentProfile()}
                  disabled={studentSetupSaving}
                >
                  {studentSetupSaving ? "저장 중…" : "완료"}
                </button>
              </div>
            </div>
          </div>
        )}

        {showParentStudentRequiredModal && (
          <div
            className={
              "dday-modal" +
              (parentStudentRequiredModalReveal.revealed ? " dday-modal--open" : "")
            }
            onClick={() =>
              parentStudentRequiredModalReveal.beginClose(() =>
                setShowParentStudentRequiredModal(false)
              )
            }
          >
            <div
              className="dday-modal-inner"
              role="dialog"
              aria-modal="true"
              aria-labelledby="parent-student-required-title"
              onClick={e => {
                e.stopPropagation();
              }}
            >
              <div className="dday-modal-header">
                <span id="parent-student-required-title" className="dday-modal-title">
                  학생 연결이 먼저 필요해요
                </span>
              </div>
              <div className="dday-modal-body">
                <p className="settings-hint" style={{ margin: 0, lineHeight: 1.5 }}>
                  연결된 학생이 없어서 이 페이지는 아직 볼 수 없어요. 학부모 프로필에서 학생을 연결한 뒤 다시 들어오세요.
                </p>
              </div>
              <div className="dday-modal-footer">
                <button
                  type="button"
                  className="modal-secondary"
                  onClick={() =>
                    parentStudentRequiredModalReveal.beginClose(() =>
                      setShowParentStudentRequiredModal(false)
                    )
                  }
                >
                  확인
                </button>
                <button
                  type="button"
                  className="modal-primary"
                  onClick={() => {
                    setCoachParentTab(null);
                    setParentTab("profile");
                    replaceAppPath("#/parent/profile");
                    parentStudentRequiredModalReveal.beginClose(() =>
                      setShowParentStudentRequiredModal(false)
                    );
                  }}
                >
                  학생 연결하러 가기
                </button>
              </div>
            </div>
          </div>
        )}

        {authConfirmKind && (
          <div
            className={
              "dday-modal" +
              (authConfirmReveal.revealed ? " dday-modal--open" : "")
            }
            onClick={() =>
              authConfirmReveal.beginClose(() => setAuthConfirmKind(null))
            }
          >
            <div
              className="dday-modal-inner"
              onClick={e => {
                e.stopPropagation();
              }}
            >
              <div className="dday-modal-header">
                <span className="dday-modal-title">
                  {authConfirmKind === "logout" ? "로그아웃" : "회원 탈퇴"}
                </span>
              </div>
              <div className="dday-modal-body">
                <p className="settings-hint" style={{ margin: 0, lineHeight: 1.5 }}>
                  {authConfirmKind === "logout"
                    ? "정말 로그아웃할까요?"
                    : "정말 회원 탈퇴할까요? 이 작업은 되돌릴 수 없습니다."}
                </p>
              </div>
              <div className="dday-modal-footer">
                <button
                  type="button"
                  className="modal-secondary auth-confirm-btn-secondary"
                  onClick={() =>
                    authConfirmReveal.beginClose(() => setAuthConfirmKind(null))
                  }
                >
                  취소
                </button>
                <button
                  type="button"
                  className="modal-primary auth-confirm-btn-primary"
                  onClick={confirmAuthAction}
                >
                  {authConfirmKind === "logout" ? "로그아웃" : "탈퇴하기"}
                </button>
              </div>
            </div>
          </div>
        )}

        {showRequestModal && (
          <div
            className={
              "modal-backdrop" +
              (requestModalReveal.revealed ? " modal-backdrop--open" : "")
            }
            onClick={() =>
              requestModalReveal.beginClose(() => {
                setShowRequestModal(false);
                setRequestReason("");
              })
            }
          >
            <div
              className="modal-sheet"
              onClick={e => {
                e.stopPropagation();
              }}
            >
              <div className="modal-header">
                <span className="modal-title">플랜 수정 요청</span>
              </div>
              <div className="modal-body">
                <div className="field">
                  <label className="field-label">사유</label>
                  <input
                    className="field-input"
                    value={requestReason}
                    onChange={e => setRequestReason(e.target.value)}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="modal-secondary"
                  onClick={() =>
                    requestModalReveal.beginClose(() => {
                      setShowRequestModal(false);
                      setRequestReason("");
                    })
                  }
                >
                  취소
                </button>
                <button
                  type="button"
                  className="modal-primary"
                  onClick={() => {
                    if (!requestReason.trim()) return;
                    requestModalReveal.beginClose(() =>
                      setShowRequestModal(false)
                    );
                  }}
                  disabled={!requestReason.trim()}
                >
                  요청 보내기
                </button>
              </div>
            </div>
          </div>
        )}

        {booksModalMounted && (
          <div
            className={
              "dday-modal" + (booksModalReveal ? " dday-modal--open" : "")
            }
            onClick={() => setBooksModalOpen(false)}
          >
            <div
              className="dday-modal-inner"
              onClick={e => e.stopPropagation()}
            >
              <div className="dday-modal-header">
                <span className="dday-modal-title">책 추가</span>
              </div>
              <div className="dday-modal-body">
                <div className="books-add-row">
                  <input
                    className="field-input"
                    value={newBookName}
                    onChange={e => setNewBookName(e.target.value)}
                  />
                  <button
                    type="button"
                    className="modal-primary"
                    onClick={async () => {
                      const name = newBookName.trim();
                      if (!name) return;
                      if (!authToken) {
                        setAppPath("#/auth");
                        return;
                      }
                      try {
                        const res = await fetch(
                          `${API_BASE}/api/student/books`,
                          {
                            method: "POST",
                            headers: {
                              "Content-Type": "application/json",
                              Authorization: `Bearer ${authToken}`
                            },
                            body: JSON.stringify({ name })
                          }
                        );
                        const data = await res.json().catch(() => ({}));
                        if (res.ok && data.id != null) {
                          setProgressBooks(prev => {
                            if (prev.some(b => b.id === Number(data.id))) {
                              return prev.map(b =>
                                b.id === Number(data.id)
                                  ? {
                                      ...b,
                                      name: String(data.name)
                                    }
                                  : b
                              );
                            }
                            return [
                              ...prev,
                              {
                                id: Number(data.id),
                                name: String(data.name)
                              }
                            ];
                          });
                          setNewBookName("");
                          hapticSuccess();
                          setBooksModalOpen(false);
                        } else {
                          hapticWarning();
                        }
                      } catch {
                        hapticWarning();
                      }
                    }}
                  >
                    추가
                  </button>
                </div>
              </div>
              <div className="dday-modal-footer">
                <button
                  type="button"
                  className="modal-secondary"
                  onClick={() => setBooksModalOpen(false)}
                >
                  닫기
                </button>
              </div>
            </div>
          </div>
        )}

        {checkSettingsOpen && (
          <div
            className={
              "modal-backdrop" +
              (checkSettingsModalReveal.revealed
                ? " modal-backdrop--open"
                : "")
            }
            onClick={() =>
              checkSettingsModalReveal.beginClose(() =>
                setCheckSettingsOpen(false)
              )
            }
          >
            <div
              className="modal-sheet"
              onClick={e => e.stopPropagation()}
            >
              <div className="modal-header">
                <span className="modal-title">점검 시간 설정</span>
              </div>
              <div className="modal-body">
                <div className="field">
                  <label className="field-label">중간 점검 시간</label>
                  <input
                    type="time"
                    className="field-input"
                    value={midCheckTime}
                    onChange={e => setMidCheckTime(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label className="field-label">최종 점검 시간</label>
                  <input
                    type="time"
                    className="field-input"
                    value={finalCheckTime}
                    onChange={e => setFinalCheckTime(e.target.value)}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="modal-secondary"
                  onClick={() =>
                    checkSettingsModalReveal.beginClose(() =>
                      setCheckSettingsOpen(false)
                    )
                  }
                >
                  닫기
                </button>
                <button
                  type="button"
                  className="modal-primary"
                  onClick={() =>
                    checkSettingsModalReveal.beginClose(() =>
                      setCheckSettingsOpen(false)
                    )
                  }
                >
                  저장
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    ) : null}
      <NativeKeyboardInputManager />
    </div>
  );
};

export default App;

