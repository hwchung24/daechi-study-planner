import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Card, SectionHeader } from "../../coach/ui/components";
import { demoStudents } from "../../coach/demoData";
import { useCoachStore } from "../../coach/state/useCoachStore";
import { API_BASE } from "../../lib/apiBase";
import {
  getNativeStudyRoomTrackingStatus,
  requestNativeStudyRoomTrackingPermissions,
  startNativeStudyRoomTracking,
  type NativeTrackingStatus
} from "../../lib/nativeStudyRoomTracking";
import {
  STUDENT_PROFILE_SCHEDULES_UPDATED_EVENT,
  type StudentProfileSchedule
} from "../../lib/studentProfileSchedules";
import {
  WEEKLY_APP_ALLOWANCE_DAYS,
  createEmptyWeeklyAppAllowanceSchedule,
  createWeeklyAppAllowanceSlot,
  ensureDaechiRootWeeklyApps,
  hhmmToMinutesAllow24,
  minutesToHhmmAllow24,
  normalizeWeeklyAppAllowanceCandidates,
  normalizeWeeklyAppAllowanceSchedule,
  sanitizeWeeklyAppAllowanceTime,
  sortWeeklyAppAllowanceSlots,
  isDaechiRootWeeklyApp,
  type WeeklyAppAllowanceCandidate,
  type WeeklyAppAllowanceDayKey,
  type WeeklyAppAllowanceSchedule,
  type WeeklyAppAllowanceSlot
} from "../../lib/studentWeeklyAppAllowance";
import type {
  StudentStudyRoomSummary
} from "../../types/studyRoomTracking";
import { DatePickerScroll } from "../DatePickerScroll";
import { TimePickerInline, TimePickerSheet } from "../TimePickerSheet";
import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { getWeekStartKeySeoul } from "../../lib/weekDates";
import {
  buildStudentAlarmSettingsCacheKey,
  DEFAULT_STUDENT_ALARM_SETTINGS,
  readStudentAlarmSettings,
  STUDENT_ALARM_SETTINGS_UPDATED_EVENT,
  type StudentAlarmSettings,
  writeStudentAlarmSettings
} from "../../lib/studentAlarmSettings";
import { useEffectiveBearer } from "../../lib/useEffectiveBearer";
import { useModalReveal } from "../../lib/useModalReveal";
import { DAECHI_LINKS_UPDATED_EVENT } from "../../lib/linkEvents";
import { DAECHI_STUDENT_PROFILE_INITIAL_MODAL_KEY } from "../../lib/coachEvents";
import type { StudentLinkRow } from "./StudentLegacyView";

const STUDENT_PROFILE_NAME_LS_KEY = "daechi_student_profile_name";
const STUDENT_PROFILE_CACHE_PREFIX = "daechi_student_profile";
const STUDY_ROOM_TRACKING_REFRESH_INTERVAL_MS = 30000;

type RemoteCoachState = {
  snapshot?: {
    profile?: {
      name?: string;
      schoolLevel?: string | null;
      grade?: number | null;
      goal?: string;
      goalUniversity?: string;
      targetGrade?: string;
      currentConcern?: string;
      weakness?: string;
      targetSubjects?: string[];
    };
  };
};

type StudentLinkedParentRow = {
  id: number | string;
  email: string;
};

type StudentStoreApp = {
  id: string;
  name: string;
  category: string;
  description?: string | null;
  installed: boolean;
};

const EMPTY_TRACKING_SUMMARY: StudentStudyRoomSummary = {
  currentHeartbeatAt: null,
  currentAccuracyMeters: null,
  rooms: [],
  recentVisits: []
};

const EMPTY_NATIVE_TRACKING_STATUS: NativeTrackingStatus = {
  supported: false,
  platform: "web",
  authorizationStatus: "prompt",
  trackingEnabled: false,
  hasConfig: false,
  lastHeartbeatAt: null,
  lastError: null
};

function formatTrackingDateTime(value: string | null) {
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

function profileCacheScope(email: string | null) {
  const normalized = String(email || "").trim().toLowerCase();
  return normalized || "anonymous";
}

function buildProfileCacheKey(scope: string, suffix: string) {
  return `${STUDENT_PROFILE_CACHE_PREFIX}:${scope}:${suffix}`;
}

function readProfileCache<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeProfileCache(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

export function StudentProfilePage(props: {
  authToken: string | null;
  apiBase: string;
  userEmail: string | null;
  meRole: string | null;
  storeApps: StudentStoreApp[];
  studentParentEmail: string;
  setStudentParentEmail: (v: string) => void;
  studentWaitingOnParent: StudentLinkRow[];
  studentWaitingOnMe: StudentLinkRow[];
  setStudentWaitingOnParent: (rows: StudentLinkRow[]) => void;
  setStudentWaitingOnMe: (rows: StudentLinkRow[]) => void;
  hapticSelection: () => void;
  hapticWarning: () => void;
  onLogoutPress: () => void;
  onWithdrawPress: () => void;
  hapticSuccess: () => void;
  onUserEmailUpdated: (email: string) => void;
}) {
  const {
    apiBase,
    userEmail,
    meRole,
    storeApps,
    studentParentEmail,
    setStudentParentEmail,
    studentWaitingOnParent,
    studentWaitingOnMe,
    setStudentWaitingOnParent,
    setStudentWaitingOnMe,
    hapticSelection,
    hapticWarning,
    onLogoutPress,
    onWithdrawPress,
    hapticSuccess,
    onUserEmailUpdated
  } = props;
  const token = useEffectiveBearer(props.authToken);
  const cacheScope = useMemo(() => profileCacheScope(userEmail), [userEmail]);
  const remoteCacheKey = useMemo(
    () => buildProfileCacheKey(cacheScope, "remote"),
    [cacheScope]
  );
  const schedulesCacheKey = useMemo(
    () => buildProfileCacheKey(cacheScope, "schedules"),
    [cacheScope]
  );
  const weeklyAppAllowanceCacheKey = useMemo(
    () => buildProfileCacheKey(cacheScope, "weekly-app-allowance"),
    [cacheScope]
  );
  const linkedParentsCacheKey = useMemo(
    () => buildProfileCacheKey(cacheScope, "linked-parents"),
    [cacheScope]
  );
  const alarmSettingsCacheKey = useMemo(
    () => buildStudentAlarmSettingsCacheKey(userEmail),
    [userEmail]
  );
  const activeStudentId = useCoachStore(s => s.activeStudentId);
  const student = useMemo(
    () => demoStudents.find(s => s.id === activeStudentId) || demoStudents[0],
    [activeStudentId]
  );
  const [remote, setRemote] = useState<RemoteCoachState | null>(() =>
    readProfileCache<RemoteCoachState | null>(remoteCacheKey, null)
  );
  const [editOpen, setEditOpen] = useState(false);
  const [scheduleManagementModalOpen, setScheduleManagementModalOpen] = useState(false);
  const [scheduleEditOpen, setScheduleEditOpen] = useState(false);
  const [accountEditOpen, setAccountEditOpen] = useState(false);
  const [alarmSettingsModalOpen, setAlarmSettingsModalOpen] = useState(false);
  const [studyRoomTrackingModalOpen, setStudyRoomTrackingModalOpen] = useState(false);
  const [parentManagementModalOpen, setParentManagementModalOpen] = useState(false);
  const [linkedParentExistsModalOpen, setLinkedParentExistsModalOpen] = useState(false);
  const [accountName, setAccountName] = useState("");
  const [accountEmail, setAccountEmail] = useState("");
  const [accountNewPw, setAccountNewPw] = useState("");
  const [accountNewPw2, setAccountNewPw2] = useState("");
  const [accountCurrentPw, setAccountCurrentPw] = useState("");
  const [accountSaving, setAccountSaving] = useState(false);
  const [accountError, setAccountError] = useState("");
  const [goalUniversityInput, setGoalUniversityInput] = useState("");
  const [targetGradeInput, setTargetGradeInput] = useState("");
  const [currentConcernInput, setCurrentConcernInput] = useState("");
  const [weaknessInput, setWeaknessInput] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [scheduleItems, setScheduleItems] = useState<StudentProfileSchedule[]>(() =>
    readProfileCache<StudentProfileSchedule[]>(schedulesCacheKey, [])
  );
  const [scheduleTitle, setScheduleTitle] = useState("");
  const [scheduleDate, setScheduleDate] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [scheduleTime, setScheduleTime] = useState("18:00");
  const [scheduleEndTime, setScheduleEndTime] = useState("19:00");
  const [scheduleError, setScheduleError] = useState("");
  const [weeklyAppManagementModalOpen, setWeeklyAppManagementModalOpen] = useState(false);
  const [weeklyAppEditorOpen, setWeeklyAppEditorOpen] = useState(false);
  const [selectedWeeklyAppDay, setSelectedWeeklyAppDay] =
    useState<WeeklyAppAllowanceDayKey>("mon");
  const [weeklyAppAllowanceSchedule, setWeeklyAppAllowanceSchedule] =
    useState<WeeklyAppAllowanceSchedule>(() =>
      normalizeWeeklyAppAllowanceSchedule(
        readProfileCache<WeeklyAppAllowanceSchedule | null>(
          weeklyAppAllowanceCacheKey,
          null
        )
      )
    );
  const [weeklyAppEditorSlotId, setWeeklyAppEditorSlotId] = useState<string | null>(null);
  const [weeklyAppEditorOriginalDay, setWeeklyAppEditorOriginalDay] =
    useState<WeeklyAppAllowanceDayKey>("mon");
  const [weeklyAppEditorDay, setWeeklyAppEditorDay] =
    useState<WeeklyAppAllowanceDayKey>("mon");
  const [weeklyAppEditorStartTime, setWeeklyAppEditorStartTime] = useState("18:00");
  const [weeklyAppEditorEndTime, setWeeklyAppEditorEndTime] = useState("19:00");
  const [weeklyAppEditorAllowedApps, setWeeklyAppEditorAllowedApps] = useState<
    WeeklyAppAllowanceCandidate[]
  >(() => ensureDaechiRootWeeklyApps([]));
  const [weeklyAppEditorError, setWeeklyAppEditorError] = useState("");
  const [weeklyAppLoading, setWeeklyAppLoading] = useState(false);
  const [weeklyAppSaving, setWeeklyAppSaving] = useState(false);
  const [weeklyAppError, setWeeklyAppError] = useState("");
  const [parentLinkFeedback, setParentLinkFeedback] = useState("");
  const [linkedParents, setLinkedParents] = useState<StudentLinkedParentRow[]>(() =>
    readProfileCache<StudentLinkedParentRow[]>(linkedParentsCacheKey, [])
  );
  const [unlinkingParentId, setUnlinkingParentId] = useState<number | string | null>(null);
  const [alarmSettings, setAlarmSettings] = useState<StudentAlarmSettings>(() =>
    readStudentAlarmSettings(alarmSettingsCacheKey)
  );
  const [wakeAlarmSheetOpen, setWakeAlarmSheetOpen] = useState(false);
  const [studyRoomTrackingSummary, setStudyRoomTrackingSummary] =
    useState<StudentStudyRoomSummary>(EMPTY_TRACKING_SUMMARY);
  const [studyRoomTrackingStatus, setStudyRoomTrackingStatus] =
    useState<NativeTrackingStatus>(EMPTY_NATIVE_TRACKING_STATUS);
  const [studyRoomTrackingLoading, setStudyRoomTrackingLoading] =
    useState(false);
  const [studyRoomTrackingBusy, setStudyRoomTrackingBusy] = useState(false);
  const [studyRoomTrackingMessage, setStudyRoomTrackingMessage] = useState("");
  const [cachedProfileName, setCachedProfileName] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    try {
      return String(localStorage.getItem(STUDENT_PROFILE_NAME_LS_KEY) || "").trim();
    } catch {
      return "";
    }
  });
  const fetchRef = useRef<AbortController | null>(null);

  const enabledAlarmCount = useMemo(() => {
    let count = 0;
    if (alarmSettings.scheduleReminders) count += 1;
    if (alarmSettings.parentLinkAlerts) count += 1;
    if (alarmSettings.studyRoomAlerts) count += 1;
    if (alarmSettings.messageAlerts) count += 1;
    if (alarmSettings.homeworkAlerts) count += 1;
    if (alarmSettings.wakeAlarmEnabled) count += 1;
    return count;
  }, [alarmSettings]);

  const alarmSettingsSummary = enabledAlarmCount
    ? `${enabledAlarmCount}개 켜짐`
    : "모두 꺼짐";

  const scheduleSummary = scheduleItems.length
    ? `${scheduleItems.length}개 등록`
    : "일정 없음";
  const weeklyAppSlotCount = useMemo(
    () =>
      WEEKLY_APP_ALLOWANCE_DAYS.reduce(
        (count, day) => count + (weeklyAppAllowanceSchedule[day.key]?.length || 0),
        0
      ),
    [weeklyAppAllowanceSchedule]
  );
  const weeklyAppActiveDayCount = useMemo(
    () =>
      WEEKLY_APP_ALLOWANCE_DAYS.reduce(
        (count, day) => count + ((weeklyAppAllowanceSchedule[day.key]?.length || 0) > 0 ? 1 : 0),
        0
      ),
    [weeklyAppAllowanceSchedule]
  );
  const weeklyAppSummary = weeklyAppSlotCount
    ? `${weeklyAppActiveDayCount}일 · ${weeklyAppSlotCount}구간`
    : "미설정";

  const parentManagementSummary = linkedParents.length > 0
    ? "연결됨"
    : studentWaitingOnParent.length > 0 || studentWaitingOnMe.length > 0
      ? "요청 진행 중"
      : "미연결";

  const accountModalReveal = useModalReveal(accountEditOpen);
  const alarmSettingsModalReveal = useModalReveal(alarmSettingsModalOpen);
  const profileEditModalReveal = useModalReveal(editOpen);
  const scheduleManagementModalReveal = useModalReveal(scheduleManagementModalOpen);
  const weeklyAppManagementModalReveal = useModalReveal(weeklyAppManagementModalOpen);
  const studyRoomTrackingModalReveal = useModalReveal(studyRoomTrackingModalOpen);
  const trackingBootstrapStartedRef = useRef(false);
  const parentManagementModalReveal = useModalReveal(parentManagementModalOpen);
  const scheduleModalReveal = useModalReveal(scheduleEditOpen);
  const weeklyAppEditorModalReveal = useModalReveal(weeklyAppEditorOpen);
  const linkedParentExistsModalReveal = useModalReveal(linkedParentExistsModalOpen);

  const installedWeeklyAppCandidates = useMemo(
    () =>
      normalizeWeeklyAppAllowanceCandidates(
        storeApps
          .filter(app => app.installed)
          .map(app => ({
            id: app.id,
            name: app.name,
            category: app.category,
            description: app.description,
            bundleId: null
          }))
      ),
    [storeApps]
  );
  const weeklyAppAvailableApps = useMemo(() => {
    const scheduledApps = WEEKLY_APP_ALLOWANCE_DAYS.flatMap(day =>
      (weeklyAppAllowanceSchedule[day.key] || []).flatMap(slot => slot.allowedApps)
    );
    return normalizeWeeklyAppAllowanceCandidates([
      ...installedWeeklyAppCandidates,
      ...scheduledApps
    ]);
  }, [installedWeeklyAppCandidates, weeklyAppAllowanceSchedule]);
  const selectedWeeklyAppDaySlots = weeklyAppAllowanceSchedule[selectedWeeklyAppDay] || [];

  useEffect(() => {
    setRemote(readProfileCache<RemoteCoachState | null>(remoteCacheKey, null));
    setScheduleItems(
      readProfileCache<StudentProfileSchedule[]>(schedulesCacheKey, [])
    );
    setWeeklyAppAllowanceSchedule(
      normalizeWeeklyAppAllowanceSchedule(
        readProfileCache<WeeklyAppAllowanceSchedule | null>(weeklyAppAllowanceCacheKey, null)
      )
    );
    setLinkedParents(
      readProfileCache<StudentLinkedParentRow[]>(linkedParentsCacheKey, [])
    );
    setAlarmSettings(
      readStudentAlarmSettings(alarmSettingsCacheKey)
    );
    setWeeklyAppError("");
  }, [
    alarmSettingsCacheKey,
    linkedParentsCacheKey,
    remoteCacheKey,
    schedulesCacheKey,
    weeklyAppAllowanceCacheKey
  ]);

  useEffect(() => {
    writeProfileCache(weeklyAppAllowanceCacheKey, weeklyAppAllowanceSchedule);
  }, [weeklyAppAllowanceCacheKey, weeklyAppAllowanceSchedule]);

  useEffect(() => {
    const syncFromStorage = () => {
      setAlarmSettings(readStudentAlarmSettings(alarmSettingsCacheKey));
    };
    const handleAlarmSettingsUpdated = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          key?: string;
          settings?: StudentAlarmSettings;
        }>
      ).detail;
      if (detail?.key && detail.key !== alarmSettingsCacheKey) return;
      if (detail?.settings) {
        setAlarmSettings(detail.settings);
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
  }, [alarmSettingsCacheKey]);

  const persistAlarmSettings = useCallback(
    async (next: StudentAlarmSettings) => {
      if (!token || meRole !== "student") return;
      try {
        const res = await fetch(`${apiBase}/api/student/alarm-settings`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify(next)
        });
        if (!res.ok) {
          throw new Error("student alarm settings save failed");
        }
      } catch {
        // keep local settings even if remote sync fails
      }
    },
    [apiBase, meRole, token]
  );

  type StudentAlarmToggleKey =
    | "scheduleReminders"
    | "parentLinkAlerts"
    | "studyRoomAlerts"
    | "messageAlerts"
    | "homeworkAlerts"
    | "wakeAlarmEnabled";

  const toggleAlarmSetting = useCallback(
    (key: StudentAlarmToggleKey) => {
      setAlarmSettings(prev => {
        const next = {
          ...prev,
          [key]: !prev[key]
        };
        writeStudentAlarmSettings(alarmSettingsCacheKey, next);
        void persistAlarmSettings(next);
        return next;
      });
      hapticSelection();
    },
    [alarmSettingsCacheKey, hapticSelection, persistAlarmSettings]
  );

  // 네이티브 알람 예약/취소
  const scheduleWakeAlarm = useCallback(
    async (enabled: boolean, time: string) => {
      if (!Capacitor.isNativePlatform()) return;
      const id = 10001; // 고정 ID, 계정별로 다르게 하려면 키 추가
      if (enabled) {
        // 시간 파싱 ("HH:mm")
        const [h, m] = time.split(":").map(Number);
        const now = new Date();
        const alarm = new Date();
        alarm.setHours(h, m, 0, 0);
        if (alarm.getTime() <= now.getTime()) {
          alarm.setDate(alarm.getDate() + 1); // 이미 지난 시간이면 내일로
        }
        // 권한 요청
        const perm = await LocalNotifications.checkPermissions();
        if (perm.display !== "granted") {
          await LocalNotifications.requestPermissions();
        }
        // 예약
        await LocalNotifications.schedule({
          notifications: [
            {
              id,
              title: "기상 알람",
              body: "설정한 기상 시간입니다! 일어나세요!",
              schedule: { at: alarm },
              sound: "beep.caf", // iOS/Android 기본음, 필요시 커스텀
              smallIcon: "ic_stat_icon_config_sample",
              actionTypeId: "default",
              extra: { type: "wake-alarm" }
            }
          ]
        });
      } else {
        // 취소
        await LocalNotifications.cancel({ notifications: [{ id }] });
      }
    },
    []
  );

  // 알람 설정 변경 시 네이티브 예약 동기화
  useEffect(() => {
    scheduleWakeAlarm(alarmSettings.wakeAlarmEnabled, alarmSettings.wakeAlarmTime);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alarmSettings.wakeAlarmEnabled, alarmSettings.wakeAlarmTime]);

  const updateWakeAlarmTime = useCallback(
    (time: string) => {
      setAlarmSettings(prev => {
        const next = {
          ...prev,
          wakeAlarmTime: time
        };
        writeStudentAlarmSettings(alarmSettingsCacheKey, next);
        void persistAlarmSettings(next);
        return next;
      });
    },
    [alarmSettingsCacheKey, persistAlarmSettings]
  );

  const refreshSchedules = useCallback(() => {
    if (!token) {
      setScheduleItems([]);
      return;
    }
    fetch(`${apiBase}/api/student/profile-schedules`, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error("schedule fetch failed"))))
      .then(data => {
        const nextSchedules = Array.isArray(data?.schedules) ? data.schedules : [];
        setScheduleItems(nextSchedules);
        writeProfileCache(schedulesCacheKey, nextSchedules);
      })
      .catch(() => {
        // keep stale schedules visible
      });
  }, [apiBase, schedulesCacheKey, token]);

  const refreshWeeklyAppAllowance = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!token) {
        setWeeklyAppAllowanceSchedule(createEmptyWeeklyAppAllowanceSchedule());
        return;
      }
      if (!options?.silent) {
        setWeeklyAppLoading(true);
      }
      try {
        const res = await fetch(`${apiBase}/api/student/weekly-app-allowance`, {
          cache: "no-store",
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            String(data?.error || "주간 허용 앱 시간표를 불러오지 못했습니다.")
          );
        }
        const nextSchedule = normalizeWeeklyAppAllowanceSchedule(data?.schedule);
        setWeeklyAppAllowanceSchedule(nextSchedule);
        writeProfileCache(weeklyAppAllowanceCacheKey, nextSchedule);
        setWeeklyAppError("");
      } catch (error) {
        setWeeklyAppError(
          error instanceof Error && error.message
            ? error.message
            : "주간 허용 앱 시간표를 불러오지 못했습니다."
        );
      } finally {
        if (!options?.silent) {
          setWeeklyAppLoading(false);
        }
      }
    },
    [apiBase, token, weeklyAppAllowanceCacheKey]
  );

  const persistWeeklyAppAllowance = useCallback(
    async (nextSchedule: WeeklyAppAllowanceSchedule) => {
      if (!token) {
        throw new Error("로그인 정보가 없어 저장할 수 없습니다.");
      }
      setWeeklyAppSaving(true);
      try {
        const res = await fetch(`${apiBase}/api/student/weekly-app-allowance`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ schedule: nextSchedule })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            String(data?.error || "주간 허용 앱 시간표를 저장하지 못했습니다.")
          );
        }
        const savedSchedule = normalizeWeeklyAppAllowanceSchedule(data?.schedule);
        setWeeklyAppAllowanceSchedule(savedSchedule);
        writeProfileCache(weeklyAppAllowanceCacheKey, savedSchedule);
        setWeeklyAppError("");
        return savedSchedule;
      } finally {
        setWeeklyAppSaving(false);
      }
    },
    [apiBase, token, weeklyAppAllowanceCacheKey]
  );

  const refreshStudentLinkRequests = useCallback(async () => {
    if (!token) {
      setStudentWaitingOnParent([]);
      setStudentWaitingOnMe([]);
      return;
    }
    const res = await fetch(`${apiBase}/api/student/link-requests`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      throw new Error("연결 요청 목록을 불러오지 못했습니다.");
    }
    const data = await res.json();
    setStudentWaitingOnParent(data.waitingOnParent || []);
    setStudentWaitingOnMe(data.waitingOnMe || []);
  }, [apiBase, token, setStudentWaitingOnMe, setStudentWaitingOnParent]);

  const refreshLinkedParents = useCallback(async () => {
    if (!token) {
      setLinkedParents([]);
      return;
    }
    const res = await fetch(`${apiBase}/api/student/parents`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      throw new Error("연결된 관리자 목록을 불러오지 못했습니다.");
    }
    const data = await res.json();
    const nextParents = Array.isArray(data?.parents) ? data.parents : [];
    setLinkedParents(nextParents);
    writeProfileCache(linkedParentsCacheKey, nextParents);
  }, [apiBase, linkedParentsCacheKey, token]);

  useEffect(() => {
    const onLinksUpdated = () => {
      void refreshStudentLinkRequests().catch(() => {
        // ignore
      });
      void refreshLinkedParents().catch(() => {
        // ignore
      });
    };
    window.addEventListener(DAECHI_LINKS_UPDATED_EVENT, onLinksUpdated);
    return () => {
      window.removeEventListener(DAECHI_LINKS_UPDATED_EVENT, onLinksUpdated);
    };
  }, [refreshLinkedParents, refreshStudentLinkRequests]);

  const refreshStudyRoomTracking = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!token || meRole !== "student") {
        setStudyRoomTrackingSummary(EMPTY_TRACKING_SUMMARY);
        setStudyRoomTrackingStatus(EMPTY_NATIVE_TRACKING_STATUS);
        return;
      }

      if (!options?.silent) {
        setStudyRoomTrackingLoading(true);
      }

      try {
        const [res, nativeStatus] = await Promise.all([
          fetch(`${apiBase}/api/student/study-room-tracking`, {
            cache: "no-store",
            headers: { Authorization: `Bearer ${token}` }
          }),
          getNativeStudyRoomTrackingStatus().catch(() => EMPTY_NATIVE_TRACKING_STATUS)
        ]);
        const data = (await res.json().catch(() => ({}))) as Partial<StudentStudyRoomSummary> & {
          error?: string;
        };
        if (!res.ok) {
          throw new Error(
            String(data.error || "독서실 추적 정보를 불러오지 못했습니다.")
          );
        }
        setStudyRoomTrackingSummary({
          currentHeartbeatAt:
            data.currentHeartbeatAt != null ? String(data.currentHeartbeatAt) : null,
          currentAccuracyMeters:
            data.currentAccuracyMeters != null && Number.isFinite(Number(data.currentAccuracyMeters))
              ? Number(data.currentAccuracyMeters)
              : null,
          rooms: Array.isArray(data.rooms) ? data.rooms : [],
          recentVisits: Array.isArray(data.recentVisits) ? data.recentVisits : []
        });
        setStudyRoomTrackingStatus(nativeStatus);
      } catch (error) {
        setStudyRoomTrackingMessage(
          error instanceof Error && error.message
            ? error.message
            : "독서실 추적 정보를 불러오지 못했습니다."
        );
      } finally {
        if (!options?.silent) {
          setStudyRoomTrackingLoading(false);
        }
      }
    },
    [apiBase, meRole, token]
  );

  const addScheduleItem = async () => {
    const title = scheduleTitle.trim();
    setScheduleError("");
    if (!title || !token) return false;
    try {
      const res = await fetch(`${apiBase}/api/student/profile-schedules`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          title,
          date: scheduleDate,
          startTime: scheduleTime,
          endTime: scheduleEndTime,
          source: "manual"
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(data?.error || "일정을 저장하지 못했습니다."));
      refreshSchedules();
      window.dispatchEvent(new Event(STUDENT_PROFILE_SCHEDULES_UPDATED_EVENT));
    } catch (e) {
      setScheduleError(
        e instanceof Error && e.message
          ? e.message
          : "일정을 저장하지 못했습니다. 시간이 겹치지 않는지 확인해 주세요."
      );
      return false;
    }
    setScheduleTitle("");
    return true;
  };

  const removeScheduleItem = async (id: string) => {
    if (!token) return;
    try {
      const res = await fetch(`${apiBase}/api/student/profile-schedules/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) return;
      refreshSchedules();
      window.dispatchEvent(new Event(STUDENT_PROFILE_SCHEDULES_UPDATED_EVENT));
    } catch {
      // ignore
    }
  };

  const openScheduleEditor = () => {
    setScheduleError("");
    setScheduleEditOpen(true);
  };

  const openScheduleManagementModal = () => {
    hapticSelection();
    setScheduleManagementModalOpen(true);
  };

  const openScheduleEditorFromManagement = () => {
    scheduleManagementModalReveal.beginClose(() => {
      setScheduleManagementModalOpen(false);
      openScheduleEditor();
    });
  };

  const closeScheduleManagementModal = () => {
    scheduleManagementModalReveal.beginClose(() => setScheduleManagementModalOpen(false));
  };

  const openWeeklyAppManagementModal = () => {
    hapticSelection();
    setWeeklyAppError("");
    setWeeklyAppManagementModalOpen(true);
  };

  const closeWeeklyAppManagementModal = () => {
    weeklyAppManagementModalReveal.beginClose(() => setWeeklyAppManagementModalOpen(false));
  };

  const openWeeklyAppEditor = useCallback(
    (dayKey: WeeklyAppAllowanceDayKey, slot?: WeeklyAppAllowanceSlot) => {
      setWeeklyAppEditorError("");
      setSelectedWeeklyAppDay(dayKey);
      setWeeklyAppEditorSlotId(slot?.id ?? null);
      setWeeklyAppEditorOriginalDay(slot?.dayKey ?? dayKey);
      setWeeklyAppEditorDay(slot?.dayKey ?? dayKey);
      if (slot) {
        setWeeklyAppEditorStartTime(slot.startTime);
        setWeeklyAppEditorEndTime(slot.endTime);
        setWeeklyAppEditorAllowedApps(ensureDaechiRootWeeklyApps(slot.allowedApps));
      } else {
        const daySlots = weeklyAppAllowanceSchedule[dayKey] || [];
        const lastEndMinutes =
          hhmmToMinutesAllow24(daySlots[daySlots.length - 1]?.endTime || "") ?? 18 * 60;
        let start = Math.min(lastEndMinutes, 23 * 60);
        let end = Math.min(start + 60, 24 * 60);
        if (end <= start) {
          start = Math.max(0, Math.min(start - 60, 23 * 60));
          end = Math.min(start + 60, 24 * 60);
        }
        setWeeklyAppEditorStartTime(minutesToHhmmAllow24(start));
        setWeeklyAppEditorEndTime(minutesToHhmmAllow24(end));
        setWeeklyAppEditorAllowedApps(ensureDaechiRootWeeklyApps([]));
      }
      setWeeklyAppEditorOpen(true);
    },
    [weeklyAppAllowanceSchedule]
  );

  const openWeeklyAppEditorFromManagement = () => {
    openWeeklyAppEditor(selectedWeeklyAppDay);
  };

  const closeWeeklyAppEditor = () => {
    weeklyAppEditorModalReveal.beginClose(() => setWeeklyAppEditorOpen(false));
  };

  const toggleWeeklyAppEditorAllowedApp = (app: WeeklyAppAllowanceCandidate) => {
    if (isDaechiRootWeeklyApp(app)) return;
    hapticSelection();
    setWeeklyAppEditorAllowedApps(prev => {
      const exists = prev.some(item => item.id === app.id);
      return ensureDaechiRootWeeklyApps(
        exists ? prev.filter(item => item.id !== app.id) : [...prev, app]
      );
    });
  };

  const saveWeeklyAppSlot = async () => {
    const startTime = sanitizeWeeklyAppAllowanceTime(weeklyAppEditorStartTime);
    const endTime = sanitizeWeeklyAppAllowanceTime(weeklyAppEditorEndTime);
    if (!startTime || !endTime) {
      setWeeklyAppEditorError("시간을 다시 확인해 주세요.");
      hapticWarning();
      return;
    }
    const startMinutes = hhmmToMinutesAllow24(startTime);
    const endMinutes = hhmmToMinutesAllow24(endTime);
    if (startMinutes == null || endMinutes == null || endMinutes <= startMinutes) {
      setWeeklyAppEditorError("종료 시간은 시작 시간보다 늦어야 합니다.");
      hapticWarning();
      return;
    }

    const candidate = createWeeklyAppAllowanceSlot({
      id: weeklyAppEditorSlotId || undefined,
      dayKey: weeklyAppEditorDay,
      startTime,
      endTime,
      allowedApps: weeklyAppEditorAllowedApps
    });

    const targetSlots = sortWeeklyAppAllowanceSlots(
      [
        ...(weeklyAppAllowanceSchedule[weeklyAppEditorDay] || []).filter(
          slot => slot.id !== weeklyAppEditorSlotId
        ),
        candidate
      ]
    );
    const hasOverlap = targetSlots.some((slot, index) => {
      if (index === 0) return false;
      const previous = targetSlots[index - 1];
      const previousEnd = hhmmToMinutesAllow24(previous.endTime);
      const currentStart = hhmmToMinutesAllow24(slot.startTime);
      return previousEnd != null && currentStart != null && currentStart < previousEnd;
    });
    if (hasOverlap) {
      setWeeklyAppEditorError("같은 요일 안에서 시간이 겹치지 않게 설정해 주세요.");
      hapticWarning();
      return;
    }

    const nextSchedule = {
      ...weeklyAppAllowanceSchedule,
      [weeklyAppEditorOriginalDay]: (weeklyAppAllowanceSchedule[weeklyAppEditorOriginalDay] || []).filter(
        slot => slot.id !== weeklyAppEditorSlotId
      ),
      [weeklyAppEditorDay]: targetSlots
    };
    try {
      await persistWeeklyAppAllowance(nextSchedule);
      setSelectedWeeklyAppDay(weeklyAppEditorDay);
      hapticSuccess();
      weeklyAppEditorModalReveal.beginClose(() => setWeeklyAppEditorOpen(false));
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "주간 허용 앱 시간표를 저장하지 못했습니다.";
      setWeeklyAppEditorError(message);
      setWeeklyAppError(message);
      hapticWarning();
    }
  };

  const removeWeeklyAppSlot = async (dayKey: WeeklyAppAllowanceDayKey, slotId: string) => {
    hapticSelection();
    const nextSchedule = {
      ...weeklyAppAllowanceSchedule,
      [dayKey]: (weeklyAppAllowanceSchedule[dayKey] || []).filter(slot => slot.id !== slotId)
    };
    try {
      await persistWeeklyAppAllowance(nextSchedule);
      setWeeklyAppError("");
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "주간 허용 앱 시간표를 저장하지 못했습니다.";
      setWeeklyAppError(message);
      hapticWarning();
    }
  };

  const openStudyRoomTrackingModal = () => {
    hapticSelection();
    setStudyRoomTrackingModalOpen(true);
  };

  const closeStudyRoomTrackingModal = () => {
    studyRoomTrackingModalReveal.beginClose(() => setStudyRoomTrackingModalOpen(false));
  };

  const openParentManagementModal = () => {
    hapticSelection();
    setParentManagementModalOpen(true);
  };

  const closeParentManagementModal = () => {
    parentManagementModalReveal.beginClose(() => setParentManagementModalOpen(false));
  };

  const closeScheduleEditor = () => {
    scheduleModalReveal.beginClose(() => setScheduleEditOpen(false));
  };

  const refreshProfile = useCallback(() => {
    if (!token) {
      setRemote(null);
      return;
    }
    fetchRef.current?.abort();
    const ac = new AbortController();
    fetchRef.current = ac;
    const weekStart = encodeURIComponent(getWeekStartKeySeoul(0));
    fetch(`${API_BASE}/api/student/coach/state?weekStart=${weekStart}`, {
      signal: ac.signal,
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(r => {
        if (ac.signal.aborted) return Promise.reject(new DOMException("aborted", "AbortError"));
        return r.ok ? r.json() : Promise.reject(new Error("coach state fetch failed"));
      })
      .then((data: RemoteCoachState) => {
        if (ac.signal.aborted) return;
        setRemote(data);
        writeProfileCache(remoteCacheKey, data);
        const nextName = String(data?.snapshot?.profile?.name ?? "").trim();
        if (nextName) {
          setCachedProfileName(nextName);
          try {
            localStorage.setItem(STUDENT_PROFILE_NAME_LS_KEY, nextName);
          } catch {
            // ignore
          }
        }
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        if (ac.signal.aborted) return;
        // keep stale profile visible
      });
  }, [remoteCacheKey, token]);

  useEffect(() => {
    refreshProfile();
    return () => fetchRef.current?.abort();
  }, [refreshProfile]);

  useEffect(() => {
    refreshSchedules();
  }, [refreshSchedules]);

  useEffect(() => {
    void refreshWeeklyAppAllowance().catch(() => {
      // keep cached weekly app allowance visible
    });
  }, [refreshWeeklyAppAllowance]);

  useEffect(() => {
    refreshLinkedParents().catch(() => {
      // keep stale linked parents visible
    });
  }, [refreshLinkedParents]);

  useEffect(() => {
    refreshStudyRoomTracking().catch(() => {
      // keep current tracking state visible
    });
  }, [refreshStudyRoomTracking]);

  useEffect(() => {
    if (!token || meRole !== "student" || !Capacitor.isNativePlatform()) {
      return;
    }
    if (trackingBootstrapStartedRef.current) {
      return;
    }
    trackingBootstrapStartedRef.current = true;

    void (async () => {
      try {
        let status = await getNativeStudyRoomTrackingStatus().catch(
          () => EMPTY_NATIVE_TRACKING_STATUS
        );
        if (!status.supported) return;

        if (
          status.authorizationStatus === "not_determined" ||
          status.authorizationStatus === "prompt"
        ) {
          status = await requestNativeStudyRoomTrackingPermissions().catch(
            () => EMPTY_NATIVE_TRACKING_STATUS
          );
        }

        if (
          status.authorizationStatus === "denied" ||
          status.authorizationStatus === "restricted"
        ) {
          setStudyRoomTrackingMessage("위치 권한을 허용해야 독서실 거리 추적이 동작합니다.");
          return;
        }

        if (!status.trackingEnabled || !status.hasConfig) {
          await startNativeStudyRoomTracking({
            apiBase,
            authToken: token
          });
          await refreshStudyRoomTracking({ silent: true });
        }
      } catch (error) {
        setStudyRoomTrackingMessage(
          error instanceof Error && error.message
            ? `독서실 추적 시작에 실패했습니다. (${error.message})`
            : "독서실 추적 시작에 실패했습니다."
        );
      }
    })();
  }, [apiBase, meRole, refreshStudyRoomTracking, token]);

  useEffect(() => {
    if (!token || meRole !== "student") {
      return;
    }

    const run = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      void refreshStudyRoomTracking({ silent: true }).catch(() => {
        // keep current tracking state visible
      });
    };

    const timerId = window.setInterval(run, STUDY_ROOM_TRACKING_REFRESH_INTERVAL_MS);
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      run();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.clearInterval(timerId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [meRole, refreshStudyRoomTracking, token]);

  useEffect(() => {
    const onUpdated = () => refreshSchedules();
    window.addEventListener(STUDENT_PROFILE_SCHEDULES_UPDATED_EVENT, onUpdated);
    return () => {
      window.removeEventListener(STUDENT_PROFILE_SCHEDULES_UPDATED_EVENT, onUpdated);
    };
  }, [refreshSchedules]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let initialModal = "";
    try {
      initialModal = String(
        sessionStorage.getItem(DAECHI_STUDENT_PROFILE_INITIAL_MODAL_KEY) || ""
      ).trim();
      if (initialModal) {
        sessionStorage.removeItem(DAECHI_STUDENT_PROFILE_INITIAL_MODAL_KEY);
      }
    } catch {
      initialModal = "";
    }
    if (initialModal === "weekly-app") {
      setWeeklyAppError("");
      setWeeklyAppManagementModalOpen(true);
    }
  }, []);

  const openAccountEdit = () => {
    setAccountEmail((userEmail || "").trim());
    setAccountName(
      String(remote?.snapshot?.profile?.name ?? student.name ?? "").trim()
    );
    setAccountNewPw("");
    setAccountNewPw2("");
    setAccountCurrentPw("");
    setAccountError("");
    setAccountEditOpen(true);
  };

  const openAlarmSettingsModal = () => {
    hapticSelection();
    setAlarmSettingsModalOpen(true);
  };

  const closeAlarmSettingsModal = () => {
    setWakeAlarmSheetOpen(false);
    alarmSettingsModalReveal.beginClose(() => setAlarmSettingsModalOpen(false));
  };

  const saveAccount = async () => {
    setAccountError("");
    const em = accountEmail.trim().toLowerCase();
    if (!em) {
      setAccountError("이메일을 입력해 주세요.");
      return;
    }
    if (accountNewPw !== accountNewPw2) {
      setAccountError("새 비밀번호가 일치하지 않습니다.");
      return;
    }
    const emailChanged =
      em !== (userEmail || "").trim().toLowerCase();
    const pwChange = accountNewPw.length > 0;
    if ((emailChanged || pwChange) && !accountCurrentPw) {
      setAccountError(
        "이메일 또는 비밀번호를 바꿀 때는 현재 비밀번호를 입력해 주세요."
      );
      return;
    }
    if (pwChange && accountNewPw.length < 4) {
      setAccountError("새 비밀번호는 4자 이상이어야 합니다.");
      return;
    }
    if (!token) return;
    setAccountSaving(true);
    try {
      const body: Record<string, string> = {
        email: em,
        currentPassword: accountCurrentPw
      };
      if (pwChange) body.newPassword = accountNewPw;
      if (meRole === "student") body.name = accountName.trim();
      const res = await fetch(`${apiBase}/api/account`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(body)
      });
      const raw = await res.text();
      let data: { error?: string; user?: { email?: string } } = {};
      try {
        if (raw) data = JSON.parse(raw) as typeof data;
      } catch {
        // HTML 오류 페이지 등
      }
      if (!res.ok) {
        const msg =
          String(data.error || "").trim() ||
          (raw && raw.length < 400
            ? `서버 응답 ${res.status}: ${raw.replace(/<[^>]+>/g, " ").slice(0, 200)}`
            : `저장에 실패했습니다. (${res.status})`);
        setAccountError(msg);
        hapticWarning();
        return;
      }
      if (data.user?.email) {
        onUserEmailUpdated(String(data.user.email));
      }
      if (meRole === "student") {
        const nextName = accountName.trim();
        if (nextName) {
          setCachedProfileName(nextName);
          try {
            localStorage.setItem(STUDENT_PROFILE_NAME_LS_KEY, nextName);
          } catch {
            // ignore
          }
        }
      }
      hapticSuccess();
      accountModalReveal.beginClose(() => {
        setAccountEditOpen(false);
        setAccountNewPw("");
        setAccountNewPw2("");
        setAccountCurrentPw("");
      });
      refreshProfile();
    } catch (e: unknown) {
      const msg =
        e instanceof Error && e.message
          ? e.message
          : "네트워크 오류입니다. 연결과 API 주소를 확인해 주세요.";
      setAccountError(msg);
      hapticWarning();
    } finally {
      setAccountSaving(false);
    }
  };

  const saveProfile = async () => {
    if (!token) return;
    const trimmedGoalUniversity = goalUniversityInput.trim();
    const trimmedTargetGrade = targetGradeInput.trim();
    if (!trimmedGoalUniversity) {
      setProfileError("목표 대학을 입력해 주세요.");
      hapticWarning();
      return;
    }
    if (!trimmedTargetGrade) {
      setProfileError("목표 성적을 입력해 주세요.");
      hapticWarning();
      return;
    }

    setProfileSaving(true);
    setProfileError("");
    try {
      const res = await fetch(`${apiBase}/api/account`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          goalUniversity: trimmedGoalUniversity,
          targetGrade: trimmedTargetGrade,
          currentConcern: currentConcernInput.trim(),
          weakness: weaknessInput.trim()
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          String(data?.error || "프로필을 저장하지 못했습니다.").trim()
        );
      }
      hapticSuccess();
      profileEditModalReveal.beginClose(() => setEditOpen(false));
      refreshProfile();
    } catch (e: unknown) {
      const msg =
        e instanceof Error && e.message
          ? e.message
          : "프로필을 저장하지 못했습니다.";
      setProfileError(msg);
      hapticWarning();
    } finally {
      setProfileSaving(false);
    }
  };

  const profile = remote?.snapshot?.profile;
  const resolvedProfileName = String(profile?.name ?? "").trim() || cachedProfileName;
  const displayName = token
    ? remote
      ? resolvedProfileName || "학생"
      : resolvedProfileName
    : resolvedProfileName || student.name;
  const rawSchoolLevel = token ? profile?.schoolLevel || null : student.schoolLevel;
  const displaySchoolLevel =
    rawSchoolLevel === "고" ? "고등학교" : rawSchoolLevel === "중" ? "중학교" : rawSchoolLevel;
  const displayGrade = token ? profile?.grade ?? null : student.grade;
  const displayGoal = token ? String(profile?.goal ?? "").trim() : student.goal;
  const displayGoalUniversity = token
    ? String(profile?.goalUniversity ?? "").trim()
    : "";
  const displayTargetGrade = token
    ? String(profile?.targetGrade ?? "").trim()
    : "";
  const displayCurrentConcern = token
    ? String(profile?.currentConcern ?? "").trim()
    : "";
  const displayWeakness = token ? String(profile?.weakness ?? "").trim() : "";
  const preferredStudyRoom = useMemo(() => {
    const rooms = [...studyRoomTrackingSummary.rooms];
    rooms.sort((left, right) => {
      if (left.currentDistanceMeters == null && right.currentDistanceMeters == null) return 0;
      if (left.currentDistanceMeters == null) return 1;
      if (right.currentDistanceMeters == null) return -1;
      return left.currentDistanceMeters - right.currentDistanceMeters;
    });
    return rooms[0] || null;
  }, [studyRoomTrackingSummary.rooms]);
  const studyRoomTrackingSummaryText = useMemo(() => {
    if (studyRoomTrackingLoading) return "확인 중";
    if (!preferredStudyRoom) return "미설정";
    return preferredStudyRoom.isWithinRadius ? "체크인됨" : "체크아웃됨";
  }, [preferredStudyRoom, studyRoomTrackingLoading]);
  const modalRoot = typeof document === "undefined" ? null : document.body;
  const linkedParent = linkedParents[0] || null;
  const hasLinkedParent = linkedParents.length > 0;
  const hasPendingParentLink =
    studentWaitingOnParent.length > 0 || studentWaitingOnMe.length > 0;
  const parentLinkInputDisabled = hasPendingParentLink;
  const closeLinkedParentExistsModal = useCallback(() => {
    linkedParentExistsModalReveal.beginClose(() => setLinkedParentExistsModalOpen(false));
  }, [linkedParentExistsModalReveal]);

  return (
    <>
      <div className="student-profile-page section">
          <Card className="coach-card coach-card--padded coach-profile-card">
          <div className="coach-profile-card__main">
            <div className="coach-profile-card__info">
              <div className="coach-profile-card__content">
                <div className="coach-profile-card__name-row">
                  <span className="coach-profile-card__name">{displayName}</span>
                  {displayGrade != null && (
                    <span className="coach-profile-card__grade-pill">
                      {displaySchoolLevel ? `${displaySchoolLevel} ` : ""}
                      {displayGrade}학년
                    </span>
                  )}
                </div>
                {displayGoalUniversity ? (
                  <div className="coach-profile-card__goal">
                    {`목표 대학 · ${displayGoalUniversity}`}
                  </div>
                ) : null}
                {displayTargetGrade ? (
                  <div className="coach-profile-card__goal">
                    {`목표 성적 · ${displayTargetGrade}`}
                  </div>
                ) : null}
                {displayCurrentConcern ? (
                  <div className="coach-profile-card__goal">
                    {`현재 고민 · ${displayCurrentConcern}`}
                  </div>
                ) : null}
                {displayWeakness ? (
                  <div className="coach-profile-card__goal">
                    {`취약점 · ${displayWeakness}`}
                  </div>
                ) : null}
                {!displayGoalUniversity && !displayTargetGrade ? (
                  <div className="coach-profile-card__goal">
                    {displayGoal ? `목표 · ${displayGoal}` : "아직 목표를 설정하지 않았어요."}
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                className="coach-primary-btn coach-profile-card__action"
                onClick={() => {
                  setProfileError("");
                  setGoalUniversityInput(displayGoalUniversity || "");
                  setTargetGradeInput(displayTargetGrade || "");
                  setCurrentConcernInput(displayCurrentConcern || "");
                  setWeaknessInput(displayWeakness || "");
                  setEditOpen(true);
                }}
              >
                프로필 편집
              </button>
            </div>
          </div>
        </Card>

        {/* 관리카드 */}
        <Card className="coach-card coach-card--padded student-profile-manage-card">
          <SectionHeader title="관리" />
          <div className="student-profile-settings-list">
            <button
              type="button"
              className="settings-item"
              onClick={openScheduleManagementModal}
            >
              <span className="settings-label">일정 관리</span>
              <span className="settings-value">{scheduleSummary}</span>
            </button>
            <button
              type="button"
              className="settings-item"
              onClick={openWeeklyAppManagementModal}
            >
              <span className="settings-label">일주일 허용 앱 관리</span>
              <span className="settings-value">{weeklyAppSummary}</span>
            </button>
            {meRole === "student" ? (
              <button
                type="button"
                className="settings-item"
                onClick={openStudyRoomTrackingModal}
              >
                <span className="settings-label">독서실 체크인</span>
                <span className="settings-value">{studyRoomTrackingSummaryText}</span>
              </button>
            ) : null}
          </div>
        </Card>

        {/* 설정카드 */}
        <Card className="coach-card coach-card--padded student-profile-settings-card">
          <SectionHeader title="설정" />
          <div className="student-profile-settings-list">
            <button type="button" className="settings-item" onClick={openAccountEdit}>
              <span className="settings-label">이메일 · 이름 · 비밀번호</span>
              <span className="settings-value">수정</span>
            </button>
            <button
              type="button"
              className="settings-item"
              onClick={openAlarmSettingsModal}
            >
              <span className="settings-label">알람 설정</span>
              <span className="settings-value">{alarmSettingsSummary}</span>
            </button>
            {meRole === "student" ? (
              <button
                type="button"
                className="settings-item"
                onClick={openParentManagementModal}
              >
                <span className="settings-label">관리자 설정</span>
                <span className="settings-value">{parentManagementSummary}</span>
              </button>
            ) : null}
            <button
              type="button"
              className="settings-item"
              onClick={() => {
                hapticWarning();
                onLogoutPress();
              }}
            >
              <span className="settings-label">로그아웃</span>
              <span className="settings-value">계정 전환</span>
            </button>
            <button
              type="button"
              className="settings-item"
              onClick={() => {
                hapticWarning();
                onWithdrawPress();
              }}
            >
              <span className="settings-label">회원 탈퇴</span>
              <span className="settings-value">계정 삭제</span>
            </button>
          </div>
        </Card>
      </div>

      {scheduleEditOpen && modalRoot
        ? createPortal(
            <div
              className={
                "dday-modal student-profile-schedule-modal" +
                (scheduleModalReveal.revealed ? " dday-modal--open" : "")
              }
              onClick={closeScheduleEditor}
            >
              <div
                className="dday-modal-inner student-profile-schedule-modal-inner"
                onClick={e => e.stopPropagation()}
              >
                <div className="dday-modal-header">
                  <span className="dday-modal-title">일정 추가</span>
                </div>
                <div className="dday-modal-body student-profile-schedule-modal-body">
                  <div className="field">
                    <label className="field-label">일정 제목</label>
                    <input
                      className="field-input"
                      placeholder="예: 영어 학원"
                      value={scheduleTitle}
                      onChange={e => setScheduleTitle(e.target.value)}
                    />
                  </div>
                  <div className="field" style={{ marginTop: 10 }}>
                    <label className="field-label">날짜</label>
                    <DatePickerScroll
                      value={scheduleDate}
                      onChange={setScheduleDate}
                      hapticSelection={hapticSelection}
                    />
                  </div>
                  <div className="field" style={{ marginTop: 10 }}>
                    <label className="field-label">시간</label>
                    <div className="student-profile-schedule-time-grid">
                      <div className="student-profile-schedule-time-cell">
                        <span className="add-plan-time-inline-label">시작</span>
                        <TimePickerInline
                          value={scheduleTime}
                          onChange={setScheduleTime}
                          hapticSelection={hapticSelection}
                        />
                      </div>
                      <div className="student-profile-schedule-time-cell">
                        <span className="add-plan-time-inline-label">종료</span>
                        <TimePickerInline
                          value={scheduleEndTime}
                          onChange={setScheduleEndTime}
                          hapticSelection={hapticSelection}
                        />
                      </div>
                    </div>
                  </div>
                  {scheduleError ? (
                    <p className="settings-hint student-profile-schedule-error">{scheduleError}</p>
                  ) : null}
                </div>
                <div className="dday-modal-footer">
                  <button type="button" className="modal-secondary" onClick={closeScheduleEditor}>
                    취소
                  </button>
                  <button
                    type="button"
                    className="modal-primary"
                    onClick={async () => {
                      const saved = await addScheduleItem();
                      if (saved) {
                        scheduleModalReveal.beginClose(() => setScheduleEditOpen(false));
                      }
                    }}
                    disabled={!scheduleTitle.trim() || !scheduleTime || !scheduleEndTime}
                  >
                    저장
                  </button>
                </div>
              </div>
            </div>,
            modalRoot
          )
        : null}

      {scheduleManagementModalOpen && modalRoot
        ? createPortal(
            <div
              className={
                "dday-modal student-profile-schedule-modal" +
                (scheduleManagementModalReveal.revealed ? " dday-modal--open" : "")
              }
              onClick={closeScheduleManagementModal}
            >
              <div
                className="dday-modal-inner student-profile-schedule-modal-inner"
                onClick={e => e.stopPropagation()}
              >
                <div className="dday-modal-header">
                  <span className="dday-modal-title">일정 관리</span>
                </div>
                <div className="dday-modal-body student-profile-schedule-modal-body">
                  <div className="student-profile-schedule-stack">
                    <div className="student-profile-schedule-panel">
                      {scheduleItems.length === 0 ? (
                        <div className="student-profile-schedule-empty">
                          아직 등록된 일정이 없어요.
                        </div>
                      ) : (
                        scheduleItems.map(item => (
                          <div key={item.id} className="student-profile-schedule-item">
                            <div className="student-profile-schedule-item__body">
                              <div className="student-profile-schedule-item__title">
                                {item.title}
                              </div>
                              <div className="student-profile-schedule-item__meta">
                                {item.date} · {item.startTime}
                                {item.endTime ? `-${item.endTime}` : ""}
                                {item.isRecurring && item.recurrenceRule
                                  ? ` · ${item.recurrenceRule}`
                                  : ""}
                              </div>
                            </div>
                            <button
                              type="button"
                              className="student-profile-schedule-remove"
                              onClick={() => removeScheduleItem(item.id)}
                            >
                              삭제
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
                <div className="dday-modal-footer">
                  <button
                    type="button"
                    className="modal-secondary"
                    onClick={closeScheduleManagementModal}
                  >
                    닫기
                  </button>
                  <button
                    type="button"
                    className="modal-primary"
                    onClick={openScheduleEditorFromManagement}
                  >
                    일정 추가
                  </button>
                </div>
              </div>
            </div>,
            modalRoot
          )
        : null}

      {weeklyAppManagementModalOpen && modalRoot
        ? createPortal(
            <div
              className={
                "dday-modal student-profile-schedule-modal" +
                (weeklyAppManagementModalReveal.revealed ? " dday-modal--open" : "")
              }
              onClick={closeWeeklyAppManagementModal}
            >
              <div
                className="dday-modal-inner student-profile-schedule-modal-inner app-allow-plan-modal-inner"
                onClick={e => e.stopPropagation()}
              >
                <div className="dday-modal-header">
                  <span className="dday-modal-title">일주일 허용 앱 관리</span>
                </div>
                <div className="dday-modal-body student-profile-schedule-modal-body">
                  {weeklyAppError ? (
                    <p className="settings-hint student-profile-schedule-error">
                      {weeklyAppError}
                    </p>
                  ) : null}
                  <div className="student-weekly-app-day-strip" role="tablist" aria-label="요일 선택">
                    {WEEKLY_APP_ALLOWANCE_DAYS.map(day => {
                      const selected = day.key === selectedWeeklyAppDay;
                      return (
                        <button
                          key={day.key}
                          type="button"
                          className={
                            "student-weekly-app-day-chip" +
                            (selected ? " student-weekly-app-day-chip--selected" : "")
                          }
                          onClick={() => setSelectedWeeklyAppDay(day.key)}
                          role="tab"
                          aria-selected={selected}
                        >
                          <span>{day.shortLabel}</span>
                        </button>
                      );
                    })}
                  </div>
                  {weeklyAppLoading ? (
                    <p className="app-allow-plan-empty">주간 허용 앱 시간표를 불러오는 중이에요.</p>
                  ) : selectedWeeklyAppDaySlots.length > 0 ? (
                    <div className="app-allow-plan-slot-list student-weekly-app-slot-list">
                      {selectedWeeklyAppDaySlots.map(slot => (
                        <div key={slot.id} className="app-allow-plan-slot">
                          <div className="app-allow-plan-slot__top">
                            <div>
                              <div className="app-allow-plan-slot__time">
                                {slot.startTime} - {slot.endTime}
                              </div>
                              <div className="app-allow-plan-slot__title">
                                {slot.allowedApps.length > 1
                                  ? `허용 앱 ${slot.allowedApps.length}개`
                                  : "대치루트만 허용"}
                              </div>
                            </div>
                            <span className="app-allow-plan-slot__source">
                              {slot.allowedApps.length}개 앱
                            </span>
                          </div>
                          <div className="app-allow-plan-slot__apps">
                            {slot.allowedApps.map(app => (
                              <span
                                key={`${slot.id}-${app.id}`}
                                className={
                                  "app-allow-plan-chip" +
                                  (isDaechiRootWeeklyApp(app)
                                    ? " app-allow-plan-chip--locked"
                                    : "")
                                }
                              >
                                {app.name}
                              </span>
                            ))}
                          </div>
                          <div className="student-weekly-app-slot-actions">
                            <button
                              type="button"
                              className="modal-secondary app-allow-plan-slot__picker-toggle"
                              onClick={() => openWeeklyAppEditor(selectedWeeklyAppDay, slot)}
                              disabled={weeklyAppSaving}
                            >
                              수정
                            </button>
                            <button
                              type="button"
                              className="app-allow-plan-slot__delete"
                              onClick={() => removeWeeklyAppSlot(selectedWeeklyAppDay, slot.id)}
                              disabled={weeklyAppSaving}
                            >
                              삭제
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="app-allow-plan-empty">
                      {WEEKLY_APP_ALLOWANCE_DAYS.find(day => day.key === selectedWeeklyAppDay)?.label}에
                      등록된 허용 앱 시간대가 아직 없어요.
                    </p>
                  )}
                </div>
                <div className="dday-modal-footer">
                  <button
                    type="button"
                    className="modal-secondary"
                    onClick={closeWeeklyAppManagementModal}
                  >
                    닫기
                  </button>
                  <button
                    type="button"
                    className="modal-primary"
                    onClick={openWeeklyAppEditorFromManagement}
                    disabled={weeklyAppLoading || weeklyAppSaving}
                  >
                    시간대 추가
                  </button>
                </div>
              </div>
            </div>,
            modalRoot
          )
        : null}

      {weeklyAppEditorOpen && modalRoot
        ? createPortal(
            <div
              className={
                "dday-modal student-profile-schedule-modal" +
                (weeklyAppEditorModalReveal.revealed ? " dday-modal--open" : "")
              }
              onClick={closeWeeklyAppEditor}
            >
              <div
                className="dday-modal-inner student-profile-schedule-modal-inner app-allow-plan-modal-inner"
                onClick={e => e.stopPropagation()}
              >
                <div className="dday-modal-header">
                  <span className="dday-modal-title">
                    {weeklyAppEditorSlotId ? "허용 앱 시간대 수정" : "허용 앱 시간대 추가"}
                  </span>
                </div>
                <div className="dday-modal-body student-profile-schedule-modal-body">
                  <div className="field">
                    <label className="field-label">요일</label>
                    <div className="student-weekly-app-day-strip student-weekly-app-day-strip--editor">
                      {WEEKLY_APP_ALLOWANCE_DAYS.map(day => {
                        const selected = day.key === weeklyAppEditorDay;
                        return (
                          <button
                            key={day.key}
                            type="button"
                            className={
                              "student-weekly-app-day-chip" +
                              (selected ? " student-weekly-app-day-chip--selected" : "")
                            }
                            onClick={() => setWeeklyAppEditorDay(day.key)}
                          >
                            <span>{day.shortLabel}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="field" style={{ marginTop: 10 }}>
                    <label className="field-label">시간</label>
                    <div className="student-profile-schedule-time-grid">
                      <div className="student-profile-schedule-time-cell">
                        <span className="add-plan-time-inline-label">시작</span>
                        <TimePickerInline
                          value={weeklyAppEditorStartTime}
                          onChange={setWeeklyAppEditorStartTime}
                          hapticSelection={hapticSelection}
                        />
                      </div>
                      <div className="student-profile-schedule-time-cell">
                        <span className="add-plan-time-inline-label">종료</span>
                        <TimePickerInline
                          value={weeklyAppEditorEndTime}
                          onChange={setWeeklyAppEditorEndTime}
                          hapticSelection={hapticSelection}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="field student-weekly-app-picker-field" style={{ marginTop: 10 }}>
                    <label className="field-label">허용 앱</label>
                    <div className="app-allow-plan-slot__picker student-weekly-app-picker">
                      {weeklyAppAvailableApps.map(app => {
                        const selected = weeklyAppEditorAllowedApps.some(
                          item => item.id === app.id
                        );
                        const locked = isDaechiRootWeeklyApp(app);
                        return (
                          <button
                            key={app.id}
                            type="button"
                            className={
                              "app-allow-plan-chip app-allow-plan-chip--picker" +
                              (selected ? " app-allow-plan-chip--picker-selected" : "") +
                              (locked ? " app-allow-plan-chip--locked" : "")
                            }
                            onClick={() => toggleWeeklyAppEditorAllowedApp(app)}
                            disabled={locked}
                          >
                            {app.name}
                          </button>
                        );
                      })}
                    </div>
                    {weeklyAppAvailableApps.length <= 1 ? (
                      <p className="settings-hint student-weekly-app-picker-hint">
                        설치된 앱 목록을 아직 불러오지 못해 현재는 대치루트만 선택할 수 있어요.
                      </p>
                    ) : null}
                  </div>
                  {weeklyAppEditorError ? (
                    <p className="settings-hint student-profile-schedule-error">
                      {weeklyAppEditorError}
                    </p>
                  ) : null}
                </div>
                <div className="dday-modal-footer">
                  <button
                    type="button"
                    className="modal-secondary"
                    onClick={closeWeeklyAppEditor}
                    disabled={weeklyAppSaving}
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    className="modal-primary"
                    onClick={() => void saveWeeklyAppSlot()}
                    disabled={weeklyAppSaving}
                  >
                    {weeklyAppSaving ? "저장 중..." : "저장"}
                  </button>
                </div>
              </div>
            </div>,
            modalRoot
          )
        : null}

      {studyRoomTrackingModalOpen && modalRoot
        ? createPortal(
            <div
              className={
                "dday-modal" +
                (studyRoomTrackingModalReveal.revealed ? " dday-modal--open" : "")
              }
              onClick={closeStudyRoomTrackingModal}
            >
              <div className="dday-modal-inner" onClick={e => e.stopPropagation()}>
                <div className="dday-modal-header">
                  <span className="dday-modal-title">독서실 체크인</span>
                </div>
                <div className="dday-modal-body">
                  <div className="student-study-room-tracking-card__stack">
                    <div className="student-study-room-tracking-card__summary student-profile-link-status student-profile-link-status--first">
                      <div className="student-study-room-tracking-card__status-row">
                        <span className="student-profile-link-status__title">
                          {preferredStudyRoom?.name || "등록된 독서실 없음"}
                        </span>
                        <span className="student-study-room-tracking-card__status-value">
                          {studyRoomTrackingStatus.trackingEnabled ? "추적 중" : "대기"}
                        </span>
                      </div>
                      {preferredStudyRoom ? (
                        <span className="student-profile-link-status__hint">
                          {preferredStudyRoom.currentDistanceMeters != null
                            ? `현재 거리 ${Math.round(preferredStudyRoom.currentDistanceMeters)}m · ${preferredStudyRoom.isWithinRadius ? "체크인됨" : "체크아웃됨"}`
                            : "아직 거리 확인 전입니다."}
                        </span>
                      ) : (
                        <span className="student-profile-link-status__hint">
                          연결된 관리자가 독서실 위치를 먼저 설정해야 합니다.
                        </span>
                      )}
                      {preferredStudyRoom ? (
                        <span className="student-profile-link-status__hint">
                          기준 반경 {preferredStudyRoom.radiusMeters}m
                          {studyRoomTrackingSummary.rooms.length > 1
                            ? ` · 외 ${studyRoomTrackingSummary.rooms.length - 1}곳`
                            : ""}
                          {studyRoomTrackingSummary.currentHeartbeatAt
                            ? ` · ${formatTrackingDateTime(studyRoomTrackingSummary.currentHeartbeatAt)} 기준`
                            : ""}
                        </span>
                      ) : null}
                    </div>

                    {studyRoomTrackingMessage ? (
                      <p className="settings-hint student-study-room-tracking-card__message">
                        {studyRoomTrackingMessage}
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="dday-modal-footer">
                  <button
                    type="button"
                    className="modal-primary"
                    onClick={closeStudyRoomTrackingModal}
                  >
                    닫기
                  </button>
                </div>
              </div>
            </div>,
            modalRoot
          )
        : null}

      {parentManagementModalOpen && modalRoot
        ? createPortal(
            <div
              className={
                "dday-modal" +
                (parentManagementModalReveal.revealed ? " dday-modal--open" : "")
              }
              onClick={closeParentManagementModal}
            >
              <div className="dday-modal-inner" onClick={e => e.stopPropagation()}>
                <div className="dday-modal-header">
                  <span className="dday-modal-title">관리자 설정</span>
                </div>
                <div className="dday-modal-body">
                  {linkedParent && (
                    <div className="student-profile-link-status student-profile-link-status--first">
                      <div className="student-profile-schedule-stack">
                        <div className="student-profile-schedule-panel">
                          <div className="student-profile-schedule-item">
                            <div className="student-profile-schedule-item__body">
                              <div className="student-profile-schedule-item__title">{linkedParent.email}</div>
                            </div>
                            <button
                              type="button"
                              className="student-profile-schedule-remove"
                              disabled={unlinkingParentId === linkedParent.id}
                              onClick={async () => {
                                if (!token) return;
                                setUnlinkingParentId(linkedParent.id);
                                try {
                                  const res = await fetch(`${apiBase}/api/link/unlink`, {
                                    method: "POST",
                                    headers: {
                                      "Content-Type": "application/json",
                                      Authorization: `Bearer ${token}`
                                    },
                                    body: JSON.stringify({ parentUserId: linkedParent.id })
                                  });
                                  const data = await res.json().catch(() => ({}));
                                  if (!res.ok) {
                                    setParentLinkFeedback(
                                      String(data?.error || "연결 끊기 요청에 실패했습니다.")
                                    );
                                    hapticWarning();
                                    return;
                                  }
                                  setParentLinkFeedback("관리자에게 연결 끊기 요청을 보냈습니다.");
                                  hapticSuccess();
                                } catch {
                                  setParentLinkFeedback("네트워크 오류로 요청을 보내지 못했습니다.");
                                  hapticWarning();
                                } finally {
                                  setUnlinkingParentId(null);
                                }
                              }}
                            >
                              {unlinkingParentId === linkedParent.id ? "요청 중…" : "연결 끊기 요청"}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                  <div className="field" style={{ marginTop: 12 }}>
                    <label className="field-label" htmlFor="student-parent-email">
                      관리자 이메일
                    </label>
                    <input
                      id="student-parent-email"
                      className="field-input"
                      value={studentParentEmail}
                      onChange={e => setStudentParentEmail(e.target.value)}
                      disabled={parentLinkInputDisabled}
                    />
                  </div>
                  <button
                    type="button"
                    className="coach-primary-btn"
                    style={{ marginTop: 10 }}
                    disabled={parentLinkInputDisabled}
                    onClick={async () => {
                      if (!token) return;
                      if (hasLinkedParent) {
                        setLinkedParentExistsModalOpen(true);
                        hapticWarning();
                        return;
                      }
                      const parentEmail = studentParentEmail.trim();
                      if (!parentEmail) {
                        setParentLinkFeedback("관리자 이메일을 입력해 주세요.");
                        hapticWarning();
                        return;
                      }
                      try {
                        const res = await fetch(`${apiBase}/api/student/request-parent`, {
                          method: "POST",
                          headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${token}`
                          },
                          body: JSON.stringify({ parentEmail })
                        });
                        const data = await res.json().catch(() => ({}));
                        if (!res.ok) {
                          const msg = String(data?.error || "연결 요청에 실패했습니다.").trim();
                          setParentLinkFeedback(msg);
                          if (msg.includes("이미 진행 중") || msg.includes("이미 연결")) {
                            await refreshStudentLinkRequests();
                          }
                          hapticWarning();
                          return;
                        }
                        setStudentParentEmail("");
                        await refreshStudentLinkRequests();
                        await refreshLinkedParents();
                        setParentLinkFeedback("관리자에게 연결 요청을 보냈어요.");
                        hapticSuccess();
                      } catch {
                        setParentLinkFeedback("네트워크 오류로 연결 요청을 보내지 못했습니다.");
                        hapticWarning();
                      }
                    }}
                  >
                    연결 요청 보내기
                  </button>
                  {hasPendingParentLink ? (
                    <p className="settings-hint" style={{ marginTop: 10 }}>
                      진행 중인 관리자 연결 요청이 있어서 새 요청은 잠시 막아 두었습니다.
                    </p>
                  ) : null}
                  {parentLinkFeedback ? (
                    <p className="settings-hint" style={{ marginTop: 10 }}>
                      {parentLinkFeedback}
                    </p>
                  ) : null}
                  {studentWaitingOnParent.length > 0 && (
                    <div className="student-profile-link-status">
                      <span className="student-profile-link-status__title">관리자 승인 대기</span>
                      {studentWaitingOnParent.map(row => (
                        <span key={row.id} className="student-profile-link-status__hint">
                          {row.parent_email}
                        </span>
                      ))}
                    </div>
                  )}
                  {studentWaitingOnMe.length > 0 && (
                    <div className="student-profile-link-status student-profile-link-status--requests">
                      <span className="student-profile-link-status__title">관리자 연결 요청</span>
                      {studentWaitingOnMe.map(row => (
                        <div key={row.id} className="student-profile-link-request-row">
                          <span className="student-profile-link-status__hint">{row.parent_email}</span>
                          <div className="student-profile-link-request-row__actions">
                            <button
                              type="button"
                              className="progress-footer-btn"
                              disabled={hasLinkedParent}
                              onClick={async () => {
                                if (!token) return;
                                const res = await fetch(`${apiBase}/api/student/link-confirm`, {
                                  method: "POST",
                                  headers: {
                                    "Content-Type": "application/json",
                                    Authorization: `Bearer ${token}`
                                  },
                                  body: JSON.stringify({ requestId: row.id })
                                });
                                if (!res.ok) {
                                  const data = await res.json().catch(() => ({}));
                                  setParentLinkFeedback(
                                    String(data?.error || "연결 승인에 실패했습니다.")
                                  );
                                  hapticWarning();
                                  return;
                                }
                                await refreshStudentLinkRequests();
                                await refreshLinkedParents();
                                setParentLinkFeedback("관리자 계정과 연결했어요.");
                                hapticSuccess();
                              }}
                            >
                              {hasLinkedParent ? "이미 관리자 연결됨" : "승인 — 이 관리자와 연결"}
                            </button>
                            <button
                              type="button"
                              className="progress-footer-btn"
                              onClick={async () => {
                                if (!token) return;
                                await fetch(`${apiBase}/api/link/reject`, {
                                  method: "POST",
                                  headers: {
                                    "Content-Type": "application/json",
                                    Authorization: `Bearer ${token}`
                                  },
                                  body: JSON.stringify({ requestId: row.id })
                                });
                                await refreshStudentLinkRequests();
                                await refreshLinkedParents();
                                setParentLinkFeedback("연결 요청을 거절했어요.");
                              }}
                            >
                              거절
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="dday-modal-footer">
                  <button
                    type="button"
                    className="modal-primary"
                    onClick={closeParentManagementModal}
                  >
                    닫기
                  </button>
                </div>
              </div>
            </div>,
            modalRoot
          )
        : null}

      {alarmSettings.wakeAlarmEnabled ? (
        <TimePickerSheet
          open={wakeAlarmSheetOpen}
          title="기상 시간 설정"
          value={alarmSettings.wakeAlarmTime}
          onClose={() => setWakeAlarmSheetOpen(false)}
          onConfirm={time => {
            updateWakeAlarmTime(time);
            setWakeAlarmSheetOpen(false);
          }}
          hapticSelection={hapticSelection}
        />
      ) : null}

      {alarmSettingsModalOpen && modalRoot
        ? createPortal(
            <div
              className={
                "dday-modal" +
                (alarmSettingsModalReveal.revealed ? " dday-modal--open" : "")
              }
              onClick={closeAlarmSettingsModal}
            >
              <div className="dday-modal-inner" onClick={e => e.stopPropagation()}>
                <div className="dday-modal-header">
                  <span className="dday-modal-title">알림 및 알람</span>
                </div>
                <div className="dday-modal-body">
                  <div className="student-profile-settings-list student-profile-alarm-list">
                    <div className="settings-item settings-item--stack student-profile-alarm-item">
                      <span className="student-profile-alarm-item__body">
                        <span className="student-profile-alarm-item__label">학습 일정 알림</span>
                        <span className="student-profile-alarm-item__copy">
                          오늘 공부 시작 시간에 팝업과 기기 알림이 와요.
                        </span>
                      </span>
                      <button
                        type="button"
                        className={
                          "student-profile-alarm-item__toggle student-profile-alarm-item__toggle-button" +
                          (alarmSettings.scheduleReminders
                            ? " student-profile-alarm-item__toggle--on"
                            : " student-profile-alarm-item__toggle--off")
                        }
                        onClick={() => toggleAlarmSetting("scheduleReminders")}
                        aria-pressed={alarmSettings.scheduleReminders}
                      >
                        {alarmSettings.scheduleReminders ? "켜짐" : "꺼짐"}
                      </button>
                    </div>
                    <div className="settings-item settings-item--stack student-profile-alarm-item">
                      <span className="student-profile-alarm-item__body">
                        <span className="student-profile-alarm-item__label">관리자 연결 알림</span>
                        <span className="student-profile-alarm-item__copy">
                          연결 요청, 승인, 거절, 해제 알림이 와요.
                        </span>
                      </span>
                      <button
                        type="button"
                        className={
                          "student-profile-alarm-item__toggle student-profile-alarm-item__toggle-button" +
                          (alarmSettings.parentLinkAlerts
                            ? " student-profile-alarm-item__toggle--on"
                            : " student-profile-alarm-item__toggle--off")
                        }
                        onClick={() => toggleAlarmSetting("parentLinkAlerts")}
                        aria-pressed={alarmSettings.parentLinkAlerts}
                      >
                        {alarmSettings.parentLinkAlerts ? "켜짐" : "꺼짐"}
                      </button>
                    </div>
                    <div className="settings-item settings-item--stack student-profile-alarm-item">
                      <span className="student-profile-alarm-item__body">
                        <span className="student-profile-alarm-item__label">독서실 출입 알림</span>
                        <span className="student-profile-alarm-item__copy">
                          체크인과 체크아웃 때 알려줘요.
                        </span>
                      </span>
                      <button
                        type="button"
                        className={
                          "student-profile-alarm-item__toggle student-profile-alarm-item__toggle-button" +
                          (alarmSettings.studyRoomAlerts
                            ? " student-profile-alarm-item__toggle--on"
                            : " student-profile-alarm-item__toggle--off")
                        }
                        onClick={() => toggleAlarmSetting("studyRoomAlerts")}
                        aria-pressed={alarmSettings.studyRoomAlerts}
                      >
                        {alarmSettings.studyRoomAlerts ? "켜짐" : "꺼짐"}
                      </button>
                    </div>
                    <div className="settings-item settings-item--stack student-profile-alarm-item">
                      <span className="student-profile-alarm-item__body">
                        <span className="student-profile-alarm-item__label">관리자 메시지 알림</span>
                        <span className="student-profile-alarm-item__copy">
                          관리자 채팅 새 메시지가 오면 알려줘요.
                        </span>
                      </span>
                      <button
                        type="button"
                        className={
                          "student-profile-alarm-item__toggle student-profile-alarm-item__toggle-button" +
                          (alarmSettings.messageAlerts
                            ? " student-profile-alarm-item__toggle--on"
                            : " student-profile-alarm-item__toggle--off")
                        }
                        onClick={() => toggleAlarmSetting("messageAlerts")}
                        aria-pressed={alarmSettings.messageAlerts}
                      >
                        {alarmSettings.messageAlerts ? "켜짐" : "꺼짐"}
                      </button>
                    </div>
                    <div className="settings-item settings-item--stack student-profile-alarm-item">
                      <span className="student-profile-alarm-item__body">
                        <span className="student-profile-alarm-item__label">숙제 결과 알림</span>
                        <span className="student-profile-alarm-item__copy">
                          숙제 승인이나 수정 요청이 오면 알려줘요.
                        </span>
                      </span>
                      <button
                        type="button"
                        className={
                          "student-profile-alarm-item__toggle student-profile-alarm-item__toggle-button" +
                          (alarmSettings.homeworkAlerts
                            ? " student-profile-alarm-item__toggle--on"
                            : " student-profile-alarm-item__toggle--off")
                        }
                        onClick={() => toggleAlarmSetting("homeworkAlerts")}
                        aria-pressed={alarmSettings.homeworkAlerts}
                      >
                        {alarmSettings.homeworkAlerts ? "켜짐" : "꺼짐"}
                      </button>
                    </div>
                    <div className="settings-item settings-item--stack student-profile-alarm-item student-profile-alarm-item--detail">
                      <div className="student-profile-alarm-item__row">
                        <span className="student-profile-alarm-item__body">
                          <span className="student-profile-alarm-item__label">기상 알람</span>
                          <span className="student-profile-alarm-item__copy">
                            설정한 시간에 기기 알람이 울려요.
                          </span>
                        </span>
                        <button
                          type="button"
                          className={
                            "student-profile-alarm-item__toggle student-profile-alarm-item__toggle-button" +
                            (alarmSettings.wakeAlarmEnabled
                              ? " student-profile-alarm-item__toggle--on"
                              : " student-profile-alarm-item__toggle--off")
                          }
                          onClick={() => {
                            if (alarmSettings.wakeAlarmEnabled && wakeAlarmSheetOpen) {
                              setWakeAlarmSheetOpen(false);
                            }
                            toggleAlarmSetting("wakeAlarmEnabled");
                          }}
                          aria-pressed={alarmSettings.wakeAlarmEnabled}
                        >
                          {alarmSettings.wakeAlarmEnabled ? "켜짐" : "꺼짐"}
                        </button>
                      </div>
                      <button
                        type="button"
                        className="student-profile-alarm-item__time-trigger"
                        onClick={() => {
                          setWakeAlarmSheetOpen(true);
                          hapticSelection();
                        }}
                        disabled={!alarmSettings.wakeAlarmEnabled}
                      >
                        <span className="student-profile-alarm-item__time-label">기상 시간</span>
                        <span className="student-profile-alarm-item__time-value">
                          {alarmSettings.wakeAlarmTime}
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
                <div className="dday-modal-footer">
                  <button
                    type="button"
                    className="modal-primary"
                    onClick={closeAlarmSettingsModal}
                  >
                    닫기
                  </button>
                </div>
              </div>
            </div>,
            modalRoot
          )
        : null}

      {linkedParentExistsModalOpen && modalRoot
        ? createPortal(
            <div
              className={
                "dday-modal" +
                (linkedParentExistsModalReveal.revealed ? " dday-modal--open" : "")
              }
              onClick={closeLinkedParentExistsModal}
            >
              <div className="dday-modal-inner" onClick={e => e.stopPropagation()}>
                <div className="dday-modal-header">
                  <span className="dday-modal-title">연결 요청 불가</span>
                </div>
                <div className="dday-modal-body">
                </div>
                <div className="dday-modal-footer">
                  <button
                    type="button"
                    className="modal-primary"
                    onClick={closeLinkedParentExistsModal}
                  >
                    확인
                  </button>
                </div>
              </div>
            </div>,
            modalRoot
          )
        : null}

      {accountEditOpen && modalRoot
        ? createPortal(
            <div
              className={
                "dday-modal" +
                (accountModalReveal.revealed ? " dday-modal--open" : "")
              }
              onClick={() =>
                accountModalReveal.beginClose(() => setAccountEditOpen(false))
              }
            >
              <div className="dday-modal-inner" onClick={e => e.stopPropagation()}>
                <div className="dday-modal-header">
                  <span className="dday-modal-title">계정 정보</span>
                </div>
                <div className="dday-modal-body">
                  {meRole === "student" && (
                    <div className="field">
                      <label className="field-label" htmlFor="account-name">
                        이름
                      </label>
                      <input
                        id="account-name"
                        className="field-input"
                        value={accountName}
                        onChange={e => setAccountName(e.target.value)}
                        autoComplete="name"
                      />
                    </div>
                  )}
                  <div className="field" style={{ marginTop: meRole === "student" ? 10 : 0 }}>
                    <label className="field-label" htmlFor="account-email">
                      이메일
                    </label>
                    <input
                      id="account-email"
                      className="field-input"
                      type="email"
                      inputMode="email"
                      autoCapitalize="none"
                      value={accountEmail}
                      onChange={e => setAccountEmail(e.target.value)}
                      autoComplete="email"
                    />
                  </div>
                  <div className="field" style={{ marginTop: 10 }}>
                    <label className="field-label" htmlFor="account-new-pw">
                      새 비밀번호
                    </label>
                    <input
                      id="account-new-pw"
                      className="field-input"
                      type="password"
                      value={accountNewPw}
                      onChange={e => setAccountNewPw(e.target.value)}
                      autoComplete="new-password"
                      placeholder="변경하지 않으면 비워 두세요"
                    />
                  </div>
                  <div className="field" style={{ marginTop: 10 }}>
                    <label className="field-label" htmlFor="account-new-pw2">
                      새 비밀번호 확인
                    </label>
                    <input
                      id="account-new-pw2"
                      className="field-input"
                      type="password"
                      value={accountNewPw2}
                      onChange={e => setAccountNewPw2(e.target.value)}
                      autoComplete="new-password"
                    />
                  </div>
                  <div className="field" style={{ marginTop: 10 }}>
                    <label className="field-label" htmlFor="account-current-pw">
                      현재 비밀번호
                    </label>
                    <input
                      id="account-current-pw"
                      className="field-input"
                      type="password"
                      value={accountCurrentPw}
                      onChange={e => setAccountCurrentPw(e.target.value)}
                      autoComplete="current-password"
                      placeholder="이메일/비밀번호 변경 시 필요"
                    />
                  </div>
                  {accountError ? (
                    <p className="settings-hint" style={{ marginTop: 10, color: "#000000" }}>
                      {accountError}
                    </p>
                  ) : null}
                </div>
                <div className="dday-modal-footer">
                  <button
                    type="button"
                    className="modal-secondary"
                    onClick={() =>
                      accountModalReveal.beginClose(() => setAccountEditOpen(false))
                    }
                    disabled={accountSaving}
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    className="modal-primary"
                    onClick={() => void saveAccount()}
                    disabled={accountSaving}
                  >
                    {accountSaving ? "저장 중…" : "저장"}
                  </button>
                </div>
              </div>
            </div>,
            modalRoot
          )
        : null}

      {editOpen && modalRoot
        ? createPortal(
            <div
              className={
                "dday-modal" +
                (profileEditModalReveal.revealed ? " dday-modal--open" : "")
              }
              onClick={() =>
                profileEditModalReveal.beginClose(() => setEditOpen(false))
              }
            >
              <div className="dday-modal-inner" onClick={e => e.stopPropagation()}>
                <div className="dday-modal-header">
                  <span className="dday-modal-title">프로필 편집</span>
                </div>
                <div className="dday-modal-body">
                  <div className="field">
                    <label className="field-label">목표 대학</label>
                    <input
                      className="field-input"
                      type="text"
                      value={goalUniversityInput}
                      onChange={e => setGoalUniversityInput(e.target.value)}
                      placeholder="예: 연세대학교"
                    />
                  </div>
                  <div className="field">
                    <label className="field-label">목표 성적</label>
                    <input
                      className="field-input"
                      type="text"
                      value={targetGradeInput}
                      onChange={e => setTargetGradeInput(e.target.value)}
                      placeholder="예: 수학 1등급, 평균 92점"
                    />
                  </div>
                  <div className="field">
                    <label className="field-label">현재 고민</label>
                    <textarea
                      className="field-input"
                      rows={3}
                      value={currentConcernInput}
                      onChange={e => setCurrentConcernInput(e.target.value)}
                      placeholder="예: 계획은 세우는데 실천이 자주 밀려요"
                    />
                  </div>
                  <div className="field">
                    <label className="field-label">취약점</label>
                    <textarea
                      className="field-input"
                      rows={3}
                      value={weaknessInput}
                      onChange={e => setWeaknessInput(e.target.value)}
                      placeholder="예: 수학 킬러 문항, 영어 빈칸 추론"
                    />
                  </div>
                  {profileError ? (
                    <p className="settings-hint" style={{ margin: 0, color: "#000000" }}>
                      {profileError}
                    </p>
                  ) : null}
                </div>
                <div className="dday-modal-footer">
                  <button
                    type="button"
                    className="modal-secondary"
                    onClick={() =>
                      profileEditModalReveal.beginClose(() => setEditOpen(false))
                    }
                    disabled={profileSaving}
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    className="modal-primary"
                    onClick={() => void saveProfile()}
                    disabled={profileSaving}
                  >
                    {profileSaving ? "저장 중…" : "저장"}
                  </button>
                </div>
              </div>
            </div>,
            modalRoot
          )
        : null}
    </>
  );
}
