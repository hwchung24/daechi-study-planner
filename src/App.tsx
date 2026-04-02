import React, { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { AppConfig } from "@capacitor-community/mdm-appconfig";
import SplashScreen from "./SplashScreen";
import { useOnlineStatus } from "./hooks/useOnlineStatus";
import { StudentCoachApp, type StudentTabKey as CoachStudentTabKey } from "./coach/student/StudentCoachApp";
import { ParentCoachApp, type ParentTabKey as CoachParentTabKey } from "./coach/parent/ParentCoachApp";
import {
  hapticImpactLight,
  hapticImpactMedium,
  hapticSelection,
  hapticSuccess,
  hapticWarning
} from "./lib/haptics";

type StudyBlock = {
  id: number;
  subject: string;
  start: string;
  end: string;
  done: boolean;
};

const presetSubjects = ["수학", "국어", "영어", "과탐", "사탐", "논술", "자습"];

type TabKey = "today" | "week" | "store" | "settings";

type StudyStoreApp = {
  id: string;
  name: string;
  category: string;
  description: string;
  url: string;
  installed: boolean;
  installedAt?: string | null;
  removedAt?: string | null;
};

type ProgressBook = {
  id: number;
  name: string;
};

type ProgressPlanValue = {
  text: string;
  start?: string;
  end?: string;
};

type ProgressPlan = {
  [bookId: number]: ProgressPlanValue;
};

type StudentLockRule = {
  parentUserId: number;
  enabled: boolean;
  lockTime: string;
  desiredLocked: boolean;
  reason: string;
  tomorrowSubmitted: boolean;
  scheduledFor: string;
};

type StudentLockStatus = {
  locked: boolean;
  reason: string;
  timezone: string;
  todayKey: string;
  tomorrowKey: string;
  rules: StudentLockRule[];
  sessions: Array<{
    id: number;
    status: string;
    reason?: string | null;
    locked_at?: string | null;
    unlocked_at?: string | null;
  }>;
};

type ParentLockStatus = {
  locked: boolean;
  timezone: string;
  rule?: StudentLockRule | null;
  session?: {
    id: number;
    status: string;
    reason?: string | null;
    locked_at?: string | null;
    unlocked_at?: string | null;
  } | null;
};

const API_BASE = String(
  (import.meta as any).env?.VITE_API_BASE || "http://localhost:3000"
).replace(/\/+$/, "");
const DEVICE_SERIAL_STORAGE_KEY = "daechi_device_serial";

type AppRoute = "student" | "parent" | "auth";

type ParentTabKey = "link" | "report";

function parseCoachStudentTabFromHash(): CoachStudentTabKey | null {
  if (typeof window === "undefined") return null;
  const h = window.location.hash;
  if (!h.startsWith("#/student/")) return null;
  const path = h.slice("#/student/".length).split("?")[0];
  const seg = (path || "home").replace(/^\/+/, "");
  if (seg === "home") return "home";
  // 통합: 예전 URL은 홈으로 매핑
  if (seg === "insights") return "home";
  if (seg === "actions") return "home";
  if (seg === "coach" || seg === "chat") return "coach";
  if (seg === "profile") return "profile";
  if (seg === "log") return "log";
  return "home";
}

function parseCoachParentTabFromHash(): CoachParentTabKey | null {
  if (typeof window === "undefined") return null;
  const h = window.location.hash;
  // 기존 학부모 화면(#/parent, #/parent/report)은 유지
  if (h === "#/parent" || h === "#/parent/report") return null;
  if (!h.startsWith("#/parent/")) return null;
  const path = h.slice("#/parent/".length).split("?")[0];
  const seg = (path || "home").replace(/^\/+/, "");
  if (seg === "home") return "home";
  if (seg === "timeline") return "timeline";
  if (seg === "guide") return "guide";
  if (seg === "profile") return "profile";
  return "home";
}

function parseRouteFromHash(): AppRoute {
  if (typeof window === "undefined") return "student";
  const h = window.location.hash;
  if (h.startsWith("#/parent")) return "parent";
  if (h === "#/auth") return "auth";
  return "student";
}

function parseParentTabFromHash(): ParentTabKey {
  if (typeof window === "undefined") return "link";
  return window.location.hash === "#/parent/report" ? "report" : "link";
}

function getInitialRoute(): AppRoute {
  if (typeof window === "undefined") return "auth";
  let token: string | null = null;
  try {
    token = localStorage.getItem("daechi_planner_token");
  } catch {
    return "auth";
  }
  if (!token) return "auth";
  const h = window.location.hash;
  if (h.startsWith("#/parent")) return "parent";
  if (h === "#/auth") return "student";
  return parseRouteFromHash();
}

function getSerialFromLocation(): string {
  if (typeof window === "undefined") return "";
  try {
    const url = new URL(window.location.href);
    const searchSerial = String(url.searchParams.get("serial") || "").trim();
    if (searchSerial) return searchSerial;
    const hash = String(url.hash || "");
    const qIdx = hash.indexOf("?");
    if (qIdx >= 0) {
      const hashParams = new URLSearchParams(hash.slice(qIdx + 1));
      return String(hashParams.get("serial") || "").trim();
    }
    return "";
  } catch {
    return "";
  }
}

function injectSerialIntoLocation(serial: string) {
  if (typeof window === "undefined") return;
  const safe = String(serial || "").trim();
  if (!safe) return;
  try {
    const url = new URL(window.location.href);
    if (String(url.searchParams.get("serial") || "").trim()) return;
    const hash = String(url.hash || "");
    const qIdx = hash.indexOf("?");
    if (qIdx >= 0) {
      const hashPath = hash.slice(0, qIdx);
      const hashParams = new URLSearchParams(hash.slice(qIdx + 1));
      if (String(hashParams.get("serial") || "").trim()) return;
      hashParams.set("serial", safe);
      url.hash = `${hashPath}?${hashParams.toString()}`;
    } else if (hash) {
      url.hash = `${hash}?serial=${encodeURIComponent(safe)}`;
    } else {
      url.hash = `#/?serial=${encodeURIComponent(safe)}`;
    }
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // ignore
  }
}

function scrubSerialFromLocation() {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    let changed = false;
    if (url.searchParams.has("serial")) {
      url.searchParams.delete("serial");
      changed = true;
    }
    const hash = String(url.hash || "");
    const qIdx = hash.indexOf("?");
    if (qIdx >= 0) {
      const hashPath = hash.slice(0, qIdx);
      const hashParams = new URLSearchParams(hash.slice(qIdx + 1));
      if (hashParams.has("serial")) {
        hashParams.delete("serial");
        url.hash = hashParams.toString()
          ? `${hashPath}?${hashParams.toString()}`
          : hashPath;
        changed = true;
      }
    }
    if (!changed) return;
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // ignore
  }
}

function getStoredSerial(): string {
  if (typeof window === "undefined") return "";
  try {
    return String(localStorage.getItem(DEVICE_SERIAL_STORAGE_KEY) || "").trim();
  } catch {
    return "";
  }
}

function resolvePreferredSerial(): string {
  return getSerialFromLocation() || getStoredSerial();
}

function persistSerial(serial: string) {
  if (typeof window === "undefined") return;
  const safe = String(serial || "").trim();
  if (!safe) return;
  try {
    localStorage.setItem(DEVICE_SERIAL_STORAGE_KEY, safe);
  } catch {
    // ignore
  }
}

/** 개발 모드 Strict Mode 재마운트 시 스플래시가 두 번 뜨는 것 방지 */
let splashCompletedModule = false;

const App: React.FC = () => {
  const online = useOnlineStatus();

  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [authRole, setAuthRole] = useState<"student" | "parent">("student");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [blocks, setBlocks] = useState<StudyBlock[]>([]);

  const [tab, setTab] = useState<TabKey>("today");
  const [route, setRoute] = useState<AppRoute>(getInitialRoute);
  const [splashDone, setSplashDone] = useState(
    () => splashCompletedModule
  );
  /** 로그인 직후 인증 화면 페이드아웃 → 메인 페이드인 */
  const [authLeaving, setAuthLeaving] = useState(false);
  const [mainEnter, setMainEnter] = useState(false);
  const [meRole, setMeRole] = useState<string | null>(null);
  const [subjectInput, setSubjectInput] = useState("");
  const [startInput, setStartInput] = useState("18:00");
  const [endInput, setEndInput] = useState("19:00");
  const [showAddModal, setShowAddModal] = useState(false);
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [showGuideModal, setShowGuideModal] = useState(false);
  const [requestReason, setRequestReason] = useState("");
  const [editUnlocked, setEditUnlocked] = useState(false);
  const [requestSent, setRequestSent] = useState(false);

  const [progressWeekOffset, setProgressWeekOffset] = useState(0);
  const [progressBooks, setProgressBooks] = useState<ProgressBook[]>([
    { id: 1, name: "워드마스터" },
    { id: 2, name: "센" }
  ]);
  const [planTomorrowOpen, setPlanTomorrowOpen] = useState(false);
  const [checkSettingsOpen, setCheckSettingsOpen] = useState(false);
  const [booksModalOpen, setBooksModalOpen] = useState(false);
  const [midCheckTime, setMidCheckTime] = useState("14:00");
  const [finalCheckTime, setFinalCheckTime] = useState("22:00");
  const [tomorrowPlan, setTomorrowPlan] = useState<ProgressPlan>({});
  const [newBookName, setNewBookName] = useState("");

  const [parentStudents, setParentStudents] = useState<
    Array<{ id: number; email: string }>
  >([]);
  const [parentLinkEmail, setParentLinkEmail] = useState("");
  const [parentStudentId, setParentStudentId] = useState<number | null>(
    null
  );
  const [parentWeekOffset, setParentWeekOffset] = useState(0);
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
  const [coachStudentTab, setCoachStudentTab] = useState<CoachStudentTabKey | null>(
    () => parseCoachStudentTabFromHash()
  );
  const [coachParentTab, setCoachParentTab] = useState<CoachParentTabKey | null>(
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
  const [storeApps, setStoreApps] = useState<StudyStoreApp[]>([]);
  const [storeLoading, setStoreLoading] = useState(false);
  const [storeSavingId, setStoreSavingId] = useState<string | null>(null);
  const [storeError, setStoreError] = useState("");
  const [studentLockStatus, setStudentLockStatus] =
    useState<StudentLockStatus | null>(null);
  const [studentLockMessage, setStudentLockMessage] = useState("");
  const [parentLockStatus, setParentLockStatus] =
    useState<ParentLockStatus | null>(null);

  const isLocked = Boolean(studentLockStatus?.locked);

  useEffect(() => {
    try {
      const savedEmail = localStorage.getItem("daechi_planner_user_email");
      const savedToken = localStorage.getItem("daechi_planner_token");
      if (savedEmail && savedToken) {
        setUserEmail(savedEmail);
        setAuthToken(savedToken);
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
        if (currentSerial) return;
        const result = await AppConfig.getValue({ key: "serial" });
        const managedSerial = String(result?.value || "").trim();
        if (!managedSerial) return;
        injectSerialIntoLocation(managedSerial);
        persistSerial(managedSerial);
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
    const syncRouteFromHash = () => {
      try {
        if (!localStorage.getItem("daechi_planner_token")) {
          setRoute("auth");
          return;
        }
      } catch {
        setRoute("auth");
        return;
      }
      setRoute(parseRouteFromHash());
      setParentTab(parseParentTabFromHash());
      setCoachStudentTab(parseCoachStudentTabFromHash());
      setCoachParentTab(parseCoachParentTabFromHash());
    };
    const onHash = () => syncRouteFromHash();
    window.addEventListener("hashchange", onHash);
    syncRouteFromHash();
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // 미로그인 시 로그인 페이지로 (첫 프레임에서 authToken이 아직 null일 수 있어 localStorage 기준)
  useEffect(() => {
    try {
      if (localStorage.getItem("daechi_planner_token")) return;
      if (window.location.hash !== "#/auth") {
        window.location.replace("#/auth");
      }
    } catch {
      // ignore
    }
  }, [authToken]);

  // 로그인 상태에서 /#/auth 접근 시 앱으로
  useEffect(() => {
    try {
      if (!localStorage.getItem("daechi_planner_token")) return;
      if (window.location.hash === "#/auth") {
        window.location.replace("#/");
      }
    } catch {
      // ignore
    }
  }, [authToken]);

  useEffect(() => {
    if (!authToken) return;
    const run = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/me`, {
          headers: { Authorization: `Bearer ${authToken}` }
        });
        if (!res.ok) return;
        const data = await res.json();
        setMeRole(data.role || null);
      } catch {
        // ignore
      }
    };
    run();
  }, [authToken]);

  useEffect(() => {
    if (!authToken || meRole !== "student") return;
    const run = async () => {
      try {
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
    if (!authToken || meRole !== "student") return;
    let cancelled = false;
    const run = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/student/lock-status`, {
          headers: { Authorization: `Bearer ${authToken}` }
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) {
          setStudentLockStatus(data.lockStatus || null);
          if (!data.lockStatus?.locked) {
            setStudentLockMessage("");
          }
        }
      } catch {
        // ignore
      }
    };
    run();
    const timerId = window.setInterval(run, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(timerId);
    };
  }, [authToken, meRole]);

  // 학부모 계정이면 항상 학부모 페이지로 (학습 플래너 대신)
  useEffect(() => {
    if (meRole !== "parent") return;
    if (typeof window === "undefined") return;
    const h = window.location.hash;
    if (h === "#/parent" || h === "#/parent/report") return;
    window.location.hash = "#/parent";
  }, [meRole]);

  // 학생 계정은 학부모 URL에 있으면 학생 화면으로 복귀
  useEffect(() => {
    if (meRole !== "student") return;
    if (typeof window === "undefined") return;
    const h = window.location.hash;
    if (h === "#/parent" || h === "#/parent/report") {
      window.location.hash = "";
    }
  }, [meRole]);

  const getDateKey = (offsetDays = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };

  const getWeekRangeLabel = (offset: number) => {
    const base = new Date();
    const day = base.getDay();
    const diffToMonday = ((day + 6) % 7) - offset * 7;
    const monday = new Date(
      base.getFullYear(),
      base.getMonth(),
      base.getDate() - diffToMonday
    );
    const sunday = new Date(
      monday.getFullYear(),
      monday.getMonth(),
      monday.getDate() + 6
    );

    const format = (d: Date) =>
      `${d.getMonth() + 1}/${d.getDate()}`;

    return `${format(monday)} ~ ${format(sunday)}`;
  };

  const getWeekStartKey = (offsetWeeks: number) => {
    const base = new Date();
    const day = base.getDay();
    // Monday-based week start
    const diffToMonday = ((day + 6) % 7) - offsetWeeks * 7;
    const monday = new Date(
      base.getFullYear(),
      base.getMonth(),
      base.getDate() - diffToMonday
    );
    return `${monday.getFullYear()}-${String(
      monday.getMonth() + 1
    ).padStart(2, "0")}-${String(monday.getDate()).padStart(2, "0")}`;
  };

  const getWeekDays = (offset: number) => {
    const base = new Date();
    const day = base.getDay();
    const diffToMonday = ((day + 6) % 7) - offset * 7;
    const monday = new Date(
      base.getFullYear(),
      base.getMonth(),
      base.getDate() - diffToMonday
    );
    const labels = ["월", "화", "수", "목", "금", "토", "일"];
    return Array.from({ length: 7 }).map((_, idx) => {
      const d = new Date(
        monday.getFullYear(),
        monday.getMonth(),
        monday.getDate() + idx
      );
      const key = `${d.getFullYear()}-${String(
        d.getMonth() + 1
      ).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      return {
        key,
        label: `${d.getMonth() + 1}/${d.getDate()} (${labels[idx]})`
      };
    });
  };

  const rebuildBlocksFromPlan = (plan: ProgressPlan) => {
    const plans = progressBooks.filter(book => {
      const value = plan[book.id];
      return value && value.text.trim().length > 0;
    });
    if (plans.length === 0) return;

    const baseMinutes = 7 * 60;
    const slotMinutes = 90;
    const formatTime = (minutes: number) => {
      const h = Math.floor(minutes / 60);
      const m = minutes % 60;
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    };

    const nextBlocks: StudyBlock[] = plans.map((book, index) => {
      const value = plan[book.id];
      const hasTime = value?.start && value?.end;

      const startMinutes = hasTime
        ? (() => {
            const [h, m] = (value.start as string).split(":").map(Number);
            return h * 60 + m;
          })()
        : baseMinutes + slotMinutes * index;

      const endMinutes = hasTime
        ? (() => {
            const [h, m] = (value.end as string).split(":").map(Number);
            return h * 60 + m;
          })()
        : startMinutes + slotMinutes;
      return {
        id: Date.now() + index,
        subject: book.name,
        start: formatTime(startMinutes),
        end: formatTime(endMinutes),
        done: false
      };
    });

    setBlocks(nextBlocks);
  };

  // 오늘 타임라인을 서버로 동기화
  const syncBlocksToServer = async (nextBlocks: StudyBlock[]) => {
    if (!authToken) return;
    try {
      const res = await fetch(`${API_BASE}/api/blocks`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          date: getDateKey(0),
          blocks: nextBlocks.map(b => ({
            subject: b.subject,
            startTime: b.start,
            endTime: b.end,
            done: b.done,
            focusScore: null
          }))
        })
      });
      if (res.status === 423) {
        const data = await res.json().catch(() => ({}));
        setStudentLockStatus(data.lockStatus || null);
        setStudentLockMessage(
          data.error || "잠금 상태에서는 오늘 계획을 수정할 수 없습니다."
        );
      } else if (res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.lockStatus) {
          setStudentLockStatus(data.lockStatus);
        }
        setStudentLockMessage("");
      }
    } catch {
      // 네트워크 오류는 일단 무시하고 로컬 상태만 유지
    }
  };

  // 현재 주간 데이터를 서버에서 불러와 오늘 타임라인을 세팅
  useEffect(() => {
    if (!authToken) return;
    const loadWeek = async () => {
      try {
        const base = new Date();
        const day = base.getDay();
        const diffToMonday = (day + 6) % 7 - progressWeekOffset * 7;
        const monday = new Date(
          base.getFullYear(),
          base.getMonth(),
          base.getDate() - diffToMonday
        );
        const mondayStr = `${monday.getFullYear()}-${String(
          monday.getMonth() + 1
        ).padStart(2, "0")}-${String(monday.getDate()).padStart(2, "0")}`;

        const res = await fetch(
          `${API_BASE}/api/week?start=${mondayStr}`,
          {
            headers: {
              Authorization: `Bearer ${authToken}`
            }
          }
        );
        if (!res.ok) return;
        const data = await res.json();
        const todayKey = getDateKey(0);
        const todayDay =
          data.days?.find((d: { date: string }) => d.date === todayKey) ??
          null;
        if (!todayDay) {
          setBlocks([]);
          return;
        }
        const todayBlocks =
          data.blocks
            ?.filter(
              (b: { study_day_id: number }) =>
                b.study_day_id === todayDay.id
            )
            .map(
              (b: {
                id: number;
                subject: string;
                start_time: string;
                end_time: string;
                done: boolean | number;
              }) => ({
                id: b.id,
                subject: b.subject,
                start: b.start_time,
                end: b.end_time,
                done: !!b.done
              })
            ) ?? [];
        setBlocks(todayBlocks);
      } catch {
        // 실패해도 앱은 계속 동작
      }
    };
    loadWeek();
  }, [authToken, progressWeekOffset]);

  // 학부모 페이지: 연결된 학생 목록 로딩
  useEffect(() => {
    const run = async () => {
      if (!authToken || meRole !== "parent") return;
      try {
        const res = await fetch(`${API_BASE}/api/parent/students`, {
          headers: { Authorization: `Bearer ${authToken}` }
        });
        if (!res.ok) return;
        const data = await res.json();
        setParentStudents(data.students || []);
        if (data.students && data.students.length > 0) {
          setParentStudentId(data.students[0].id);
        }
      } catch {
        // ignore
      }
    };
    run();
  }, [authToken, meRole]);

  // 학부모: 연결 요청 목록 (양쪽 확인)
  useEffect(() => {
    const run = async () => {
      if (!authToken || meRole !== "parent") return;
      try {
        const res = await fetch(`${API_BASE}/api/parent/link-requests`, {
          headers: { Authorization: `Bearer ${authToken}` }
        });
        if (!res.ok) return;
        const data = await res.json();
        setParentWaitingOnStudent(data.waitingOnStudent || []);
        setParentWaitingOnMe(data.waitingOnMe || []);
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
      try {
        const res = await fetch(`${API_BASE}/api/student/link-requests`, {
          headers: { Authorization: `Bearer ${authToken}` }
        });
        if (!res.ok) return;
        const data = await res.json();
        setStudentWaitingOnParent(data.waitingOnParent || []);
        setStudentWaitingOnMe(data.waitingOnMe || []);
      } catch {
        // ignore
      }
    };
    run();
  }, [authToken, meRole, tab]);

  // 학생: 학습 앱스토어 목록 + 설치 상태
  useEffect(() => {
    const run = async () => {
      if (!authToken || meRole !== "student" || tab !== "store") return;
      setStoreLoading(true);
      setStoreError("");
      try {
        const res = await fetch(`${API_BASE}/api/student/store-apps`, {
          headers: { Authorization: `Bearer ${authToken}` }
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setStoreError(data.error || "앱 목록을 불러오지 못했습니다.");
          return;
        }
        setStoreApps(Array.isArray(data.apps) ? data.apps : []);
      } catch {
        setStoreError("앱 목록을 불러오지 못했습니다.");
      } finally {
        setStoreLoading(false);
      }
    };
    run();
  }, [authToken, meRole, tab]);

  // 학부모 페이지: 학생별 주간 리포트 로딩
  useEffect(() => {
    const run = async () => {
      if (!authToken || meRole !== "parent") return;
      if (!parentStudentId) return;
      try {
        const start = getWeekStartKey(parentWeekOffset);
        const res = await fetch(
          `${API_BASE}/api/parent/week?studentId=${parentStudentId}&start=${start}`,
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
  }, [authToken, meRole, parentStudentId, parentWeekOffset]);

  // 학부모: AI 일일 리포트 (자정 배치 생성본)
  useEffect(() => {
    const run = async () => {
      if (!authToken || meRole !== "parent") return;
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
          setParentAiDaily(null);
          return;
        }
        const data = await res.json();
        setParentAiDaily(data.report ?? null);
      } catch {
        setParentAiDaily(null);
      }
    };
    run();
  }, [authToken, meRole, parentStudentId]);

  // 학부모: 자녀별 계획표 시간 설정 조회
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
    hapticImpactMedium();
    setBlocks(prev => {
      const next = prev.map(b =>
        b.id === id ? { ...b, done: !b.done } : b
      );
      syncBlocksToServer(next);
      return next;
    });
  };

  const handleLogout = () => {
    try {
      localStorage.removeItem("daechi_planner_token");
      localStorage.removeItem("daechi_planner_user_email");
    } catch {
      // ignore
    }
    setAuthToken(null);
    setUserEmail(null);
    setMeRole(null);
    setRoute("auth");
    window.location.hash = "#/auth";
  };

  const handleAdd = () => {
    if (isLocked) {
      setShowRequestModal(true);
      return;
    }
    if (!subjectInput.trim()) return;
    hapticImpactLight();
    setBlocks(prev => {
      const next: StudyBlock[] = [
        ...prev,
        {
          id: Date.now(),
          subject: subjectInput.trim(),
          start: startInput,
          end: endInput,
          done: false
        }
      ];
      syncBlocksToServer(next);
      return next;
    });
    setSubjectInput("");
    setShowAddModal(false);
  };

  const todayProgress =
    blocks.length === 0
      ? 0
      : Math.round(
          (blocks.filter(b => b.done).length / blocks.length) * 100
        );

  const roleLoading = Boolean(
    authToken && route !== "auth" && meRole === null
  );
  const parentView = meRole === "parent" || route === "parent";
  const showStudentShell =
    route !== "auth" && !roleLoading && !parentView;
  const coachStudentMode = showStudentShell && coachStudentTab !== null;
  const coachParentMode =
    !roleLoading && parentView && meRole === "parent" && coachParentTab !== null;

  useEffect(() => {
    if (!mainEnter) return;
    const id = window.setTimeout(() => setMainEnter(false), 520);
    return () => clearTimeout(id);
  }, [mainEnter]);

  return (
    <div className="app-root">
      {splashDone && !online && (
        <div className="offline-banner" role="status">
          인터넷에 연결되어 있지 않습니다. 로그인·서버 동기화는 Wi‑Fi 또는 데이터 연결 후
          가능합니다.
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
        <div
          className={
            "auth-page" + (authLeaving ? " auth-page--leaving" : "")
          }
        >
          <div className="status-bar-safe" />
          <div className="auth-page-inner">
            <h2 key={authMode} className="auth-title auth-title--enter">
              {authMode === "login" ? "로그인" : "회원가입"}
            </h2>
            <p className="auth-desc">
              계정으로 로그인하면 학습 플랜이 계정별로 안전하게 저장됩니다.
            </p>
            <div
              className={
                "auth-tabs auth-tabs--segmented" +
                (authMode === "login"
                  ? " auth-tabs--active-0"
                  : " auth-tabs--active-1")
              }
              role="tablist"
            >
              <span className="auth-tabs__indicator" aria-hidden />
              <button
                type="button"
                role="tab"
                aria-selected={authMode === "login"}
                className={
                  "auth-tab" + (authMode === "login" ? " active" : "")
                }
                onClick={() => {
                  hapticSelection();
                  setAuthMode("login");
                  setAuthError("");
                }}
              >
                로그인
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={authMode === "signup"}
                className={
                  "auth-tab" + (authMode === "signup" ? " active" : "")
                }
                onClick={() => {
                  hapticSelection();
                  setAuthMode("signup");
                  setAuthError("");
                }}
              >
                회원가입
              </button>
            </div>
            <div
              className={
                "auth-role-wrap" +
                (authMode === "signup" ? " auth-role-wrap--open" : "")
              }
            >
              <div className="auth-role-inner">
                <div
                  className={
                    "auth-tabs auth-tabs--segmented auth-tabs--role" +
                    (authRole === "student"
                      ? " auth-tabs--active-0"
                      : " auth-tabs--active-1")
                  }
                  role="tablist"
                >
                  <span className="auth-tabs__indicator" aria-hidden />
                  <button
                    type="button"
                    role="tab"
                    aria-selected={authRole === "student"}
                    className={
                      "auth-tab" +
                      (authRole === "student" ? " active" : "")
                    }
                    onClick={() => {
                      hapticSelection();
                      setAuthRole("student");
                    }}
                  >
                    학생
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={authRole === "parent"}
                    className={
                      "auth-tab" +
                      (authRole === "parent" ? " active" : "")
                    }
                    onClick={() => {
                      hapticSelection();
                      setAuthRole("parent");
                    }}
                  >
                    학부모
                  </button>
                </div>
              </div>
            </div>
            <form
              className="auth-form"
              onSubmit={async e => {
                e.preventDefault();
                const email = authEmail.trim().toLowerCase();
                const password = authPassword;
                if (!email) {
                  hapticWarning();
                  setAuthError("이메일을 입력해 주세요.");
                  return;
                }
                if (password.length < 4) {
                  hapticWarning();
                  setAuthError("비밀번호는 4자 이상이어야 합니다.");
                  return;
                }
                try {
                  setAuthError("");
                  const res = await fetch(
                    `${API_BASE}/auth/${
                      authMode === "login" ? "login" : "register"
                    }`,
                    {
                      method: "POST",
                      credentials: "include",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        email,
                        password,
                        role: authMode === "signup" ? authRole : undefined,
                        serial: resolvePreferredSerial() || undefined
                      })
                    }
                  );
                  const data = await res.json();
                  if (!res.ok) {
                    hapticWarning();
                    setAuthError(data.error || "로그인에 실패했습니다.");
                    return;
                  }
                  const token = data.token as string;
                  hapticSuccess();
                  setAuthLeaving(true);
                  window.setTimeout(() => {
                    setUserEmail(data.email);
                    setAuthToken(token);
                    localStorage.setItem(
                      "daechi_planner_user_email",
                      data.email
                    );
                    localStorage.setItem("daechi_planner_token", token);
                    window.location.hash = "#/";
                    setMainEnter(true);
                  }, 420);
                } catch {
                  hapticWarning();
                  setAuthError("서버와 통신 중 오류가 발생했습니다.");
                }
              }}
            >
              <div className="auth-field">
                <label htmlFor="auth-email">이메일</label>
                <input
                  id="auth-email"
                  type="email"
                  className="auth-input"
                  autoComplete="username"
                  value={authEmail}
                  onChange={e => setAuthEmail(e.target.value)}
                  placeholder="student@example.com"
                />
              </div>
              <div className="auth-field">
                <label htmlFor="auth-password">비밀번호</label>
                <input
                  id="auth-password"
                  type="password"
                  className="auth-input"
                  autoComplete="current-password"
                  value={authPassword}
                  onChange={e => setAuthPassword(e.target.value)}
                  placeholder="4자 이상"
                />
              </div>
              {authError && (
                <div className="auth-error">{authError}</div>
              )}
              <button
                type="submit"
                className="auth-submit"
                disabled={authLeaving}
              >
                {authLeaving
                  ? "이동 중…"
                  : authMode === "login"
                    ? "로그인"
                    : "회원가입 후 로그인"}
              </button>
            </form>
          </div>
        </div>
      ) : splashDone ? (
      <div
        className={
          "app-shell" + (mainEnter ? " app-shell--enter" : "")
        }
      >
        <header className="app-header">
          <div className="status-bar-safe" />
          <div className="header-top">
            <div className="header-title-group">
              <div className="header-title-row">
                {coachStudentMode && (
                  <button
                    type="button"
                    className="header-back-btn"
                    aria-label="뒤로가기"
                    onClick={() => {
                      hapticSelection();
                      try {
                        if (window.history.length > 1) {
                          window.history.back();
                        } else {
                          window.location.hash = "#/";
                        }
                      } catch {
                        window.location.hash = "#/";
                      }
                    }}
                  >
                    ←
                  </button>
                )}
                <h1 className="header-title">
                {roleLoading && "불러오는 중…"}
                {!roleLoading &&
                  parentView &&
                  (meRole === "parent"
                    ? coachParentMode
                      ? coachParentTab === "timeline"
                        ? "학습 타임라인"
                        : coachParentTab === "guide"
                          ? "대화 가이드"
                          : coachParentTab === "profile"
                            ? "학부모 프로필"
                            : "학부모 홈"
                      : parentTab === "link"
                        ? "자녀 연결"
                        : "AI 리포트"
                    : "학부모")}
                {showStudentShell &&
                  (coachStudentMode
                    ? coachStudentTab === "coach"
                          ? "AI 코치"
                          : coachStudentTab === "profile"
                            ? "프로필"
                            : coachStudentTab === "log"
                              ? "일일 기록"
                              : "학생 홈"
                    : tab === "today"
                      ? "오늘 공부"
                      : tab === "week"
                        ? "이번 주"
                        : tab === "store"
                          ? "학습 앱스토어"
                          : "설정")}
                </h1>
              </div>
            </div>
            <div className="profile-chip">
              <span className="profile-avatar">
                {(userEmail || "D").charAt(0).toUpperCase()}
              </span>
              {userEmail && (
                <span className="profile-label">{userEmail}</span>
              )}
            </div>
          </div>

          {showStudentShell && !coachStudentMode && tab === "today" && (
            <div className="progress-card">
              <div className="progress-row">
                <span className="progress-label">진행률</span>
                <span className="progress-value">{todayProgress}%</span>
              </div>
              <div className="progress-bar-track">
                <div
                  className="progress-bar-fill"
                  style={{ width: `${todayProgress}%` }}
                />
              </div>
              <div className="progress-meta-row">
                <span className="progress-meta">
                  {blocks.filter(b => b.done).length}/{blocks.length} 완료
                </span>
              </div>
            </div>
          )}
        </header>

        <main className="app-main">
          {roleLoading && (
            <p className="empty-state">불러오는 중…</p>
          )}
          {!roleLoading && coachStudentMode && coachStudentTab && (
            <StudentCoachApp
              tab={coachStudentTab}
              onTabChange={t => {
                hapticSelection();
                setCoachStudentTab(t);
                const path =
                  t === "home"
                    ? "home"
                    : t === "coach"
                      ? "coach"
                      : t === "profile"
                        ? "profile"
                        : "log";
                window.location.hash = `#/student/${path}`;
              }}
            />
          )}
          {!roleLoading && coachParentMode && coachParentTab && (
            <ParentCoachApp
              tab={coachParentTab}
              onTabChange={t => {
                hapticSelection();
                setCoachParentTab(t);
                const path =
                  t === "home"
                    ? "home"
                    : t === "timeline"
                      ? "timeline"
                      : t === "guide"
                        ? "guide"
                        : "profile";
                window.location.hash = `#/parent/${path}`;
              }}
            />
          )}
          {!roleLoading && parentView && !coachParentMode && (
            <>
              {meRole !== "parent" ? (
                <section className="section">
                  <div className="section-header">
                    <h2 className="section-title">학부모</h2>
                  </div>
                  <p className="empty-state">
                    학부모 계정으로 로그인해야 이 화면을 볼 수 있어요.
                  </p>
                </section>
              ) : (
                <>
                  {parentTab === "link" && (
                    <section className="section">
                      <div className="section-header">
                        <h2 className="section-title">자녀와 계정 연결</h2>
                      </div>

                      <div className="settings-list" style={{ marginTop: 14 }}>
                        <div className="field" style={{ marginTop: 6 }}>
                          <label className="field-label">자녀 학생 이메일</label>
                          <input
                            className="field-input"
                            placeholder="student@example.com"
                            value={parentLinkEmail}
                            onChange={e => setParentLinkEmail(e.target.value)}
                          />
                        </div>
                        <button
                          type="button"
                          className="modal-primary"
                          onClick={async () => {
                            if (!authToken) return;
                            const studentEmail = parentLinkEmail.trim();
                            if (!studentEmail) return;
                            try {
                              const res = await fetch(
                                `${API_BASE}/api/parent/link-request`,
                                {
                                  method: "POST",
                                  headers: {
                                    "Content-Type": "application/json",
                                    Authorization: `Bearer ${authToken}`
                                  },
                                  body: JSON.stringify({ studentEmail })
                                }
                              );
                              if (!res.ok) return;
                              setParentLinkEmail("");
                              const lr = await fetch(
                                `${API_BASE}/api/parent/link-requests`,
                                {
                                  headers: {
                                    Authorization: `Bearer ${authToken}`
                                  }
                                }
                              );
                              if (lr.ok) {
                                const d = await lr.json();
                                setParentWaitingOnStudent(d.waitingOnStudent || []);
                                setParentWaitingOnMe(d.waitingOnMe || []);
                              }
                            } catch {
                              // ignore
                            }
                          }}
                        >
                          연결 요청 보내기
                        </button>
                      </div>

                      {parentWaitingOnStudent.length > 0 && (
                        <div className="settings-list" style={{ marginTop: 14 }}>
                          <div className="section-header">
                            <h3 className="section-title" style={{ fontSize: 16 }}>
                              자녀 승인 대기
                            </h3>
                          </div>
                          {parentWaitingOnStudent.map(row => (
                            <div
                              key={row.id}
                              className="settings-item"
                              style={{
                                cursor: "default",
                                flexDirection: "column",
                                alignItems: "stretch"
                              }}
                            >
                              <span className="settings-label">{row.student_email}</span>
                              <span className="settings-hint">
                                학생이 앱에서 승인하면 연결됩니다.
                              </span>
                            </div>
                          ))}
                        </div>
                      )}

                      {parentWaitingOnMe.length > 0 && (
                        <div className="settings-list" style={{ marginTop: 14 }}>
                          <div className="section-header">
                            <h3 className="section-title" style={{ fontSize: 16 }}>
                              자녀가 보낸 연결 요청
                            </h3>
                          </div>
                          {parentWaitingOnMe.map(row => (
                            <div
                              key={row.id}
                              className="settings-item"
                              style={{ cursor: "default", flexDirection: "column", gap: 8 }}
                            >
                              <span className="settings-label">{row.student_email}</span>
                              <div style={{ display: "flex", gap: 8 }}>
                                <button
                                  type="button"
                                  className="progress-footer-btn"
                                  onClick={async () => {
                                    if (!authToken) return;
                                    const res = await fetch(
                                      `${API_BASE}/api/parent/link-confirm`,
                                      {
                                        method: "POST",
                                        headers: {
                                          "Content-Type": "application/json",
                                          Authorization: `Bearer ${authToken}`
                                        },
                                        body: JSON.stringify({ requestId: row.id })
                                      }
                                    );
                                    if (!res.ok) return;
                                    const lr = await fetch(
                                      `${API_BASE}/api/parent/link-requests`,
                                      {
                                        headers: {
                                          Authorization: `Bearer ${authToken}`
                                        }
                                      }
                                    );
                                    if (lr.ok) {
                                      const d = await lr.json();
                                      setParentWaitingOnStudent(
                                        d.waitingOnStudent || []
                                      );
                                      setParentWaitingOnMe(d.waitingOnMe || []);
                                    }
                                    const st = await fetch(
                                      `${API_BASE}/api/parent/students`,
                                      {
                                        headers: {
                                          Authorization: `Bearer ${authToken}`
                                        }
                                      }
                                    );
                                    if (st.ok) {
                                      const sd = await st.json();
                                      const next = sd.students || [];
                                      setParentStudents(next);
                                      if (next.length > 0)
                                        setParentStudentId(next[0].id);
                                    }
                                  }}
                                >
                                  승인 — 이 자녀와 연결
                                </button>
                                <button
                                  type="button"
                                  className="progress-footer-btn"
                                  onClick={async () => {
                                    if (!authToken) return;
                                    await fetch(`${API_BASE}/api/link/reject`, {
                                      method: "POST",
                                      headers: {
                                        "Content-Type": "application/json",
                                        Authorization: `Bearer ${authToken}`
                                      },
                                      body: JSON.stringify({ requestId: row.id })
                                    });
                                    const lr = await fetch(
                                      `${API_BASE}/api/parent/link-requests`,
                                      {
                                        headers: {
                                          Authorization: `Bearer ${authToken}`
                                        }
                                      }
                                    );
                                    if (lr.ok) {
                                      const d = await lr.json();
                                      setParentWaitingOnStudent(
                                        d.waitingOnStudent || []
                                      );
                                      setParentWaitingOnMe(d.waitingOnMe || []);
                                    }
                                  }}
                                >
                                  거절
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </section>
                  )}

                  {parentTab === "report" && (
                    <section className="section">
                      <div className="section-header">
                        <h2 className="section-title">주간 · AI 리포트</h2>
                      </div>

                      <div className="week-switch">
                        <button
                          className="week-switch-btn week-switch-prev"
                          onClick={() => setParentWeekOffset(v => v + 1)}
                        >
                          이전주
                        </button>
                        <div className="week-switch-center">
                          <span className="week-switch-label">
                            {getWeekRangeLabel(parentWeekOffset)}
                          </span>
                          <span className="week-switch-underline" />
                        </div>
                        <button
                          className="week-switch-btn week-switch-next"
                          onClick={() => setParentWeekOffset(v => v - 1)}
                        >
                          다음주
                        </button>
                      </div>

                      {parentStudents.length === 0 && (
                        <p className="empty-state" style={{ marginTop: 14 }}>
                          연결된 자녀가 없어요.{" "}
                          <button
                            type="button"
                            className="progress-footer-btn"
                            style={{ display: "inline", padding: "2px 8px", marginLeft: 4 }}
                            onClick={() => {
                              hapticSelection();
                              setParentTab("link");
                              window.location.hash = "#/parent";
                            }}
                          >
                            자녀 연결
                          </button>
                          탭에서 요청을 보내 주세요.
                        </p>
                      )}

                      {parentStudents.length > 0 && (
                        <div className="settings-list" style={{ marginTop: 14 }}>
                          <div className="settings-item" style={{ cursor: "default" }}>
                            <span className="settings-label">연결된 자녀</span>
                            <span className="settings-value">
                              <select
                                value={parentStudentId ?? ""}
                                onChange={e =>
                                  setParentStudentId(Number(e.target.value))
                                }
                                style={{
                                  fontSize: 14,
                                  padding: "6px 8px",
                                  borderRadius: 10,
                                  border: "1px solid var(--stroke)",
                                  background: "transparent"
                                }}
                              >
                                {parentStudents.map(s => (
                                  <option key={s.id} value={s.id}>
                                    {s.email}
                                  </option>
                                ))}
                              </select>
                            </span>
                          </div>
                        </div>
                      )}

                      {parentStudents.length > 0 && parentStudentId && (
                        <div style={{ marginTop: 14 }}>
                          <div className="section-header">
                            <h3 className="section-title" style={{ fontSize: 16 }}>
                              계획표 작성 시간 설정
                            </h3>
                          </div>
                          <div className="progress-card" style={{ marginBottom: 12 }}>
                            <div
                              className="settings-item"
                              style={{ cursor: "default", padding: 0, borderBottom: "none" }}
                            >
                              <span className="settings-label">강제 작성 활성화</span>
                              <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                                <input
                                  type="checkbox"
                                  checked={parentPlannerEnabled}
                                  onChange={e =>
                                    setParentPlannerEnabled(e.target.checked)
                                  }
                                />
                                <span className="settings-value">
                                  {parentPlannerEnabled ? "켜짐" : "꺼짐"}
                                </span>
                              </label>
                            </div>
                            <div
                              className="settings-item"
                              style={{ cursor: "default", padding: "10px 0 0", borderBottom: "none" }}
                            >
                              <span className="settings-label">자녀가 계획표를 쓰는 시각</span>
                              <input
                                type="time"
                                className="field-input"
                                value={parentPlannerTime}
                                onChange={e =>
                                  setParentPlannerTime(e.target.value || "21:00")
                                }
                                style={{ maxWidth: 150, padding: "7px 10px" }}
                              />
                            </div>
                            <button
                              type="button"
                              className="progress-footer-btn"
                              style={{ marginTop: 10 }}
                              disabled={parentPlannerSaving}
                              onClick={async () => {
                                if (!authToken || !parentStudentId) return;
                                setParentPlannerSaving(true);
                                setParentPlannerMessage("");
                                try {
                                  const res = await fetch(
                                    `${API_BASE}/api/parent/planner-rule`,
                                    {
                                      method: "PUT",
                                      headers: {
                                        "Content-Type": "application/json",
                                        Authorization: `Bearer ${authToken}`
                                      },
                                      body: JSON.stringify({
                                        studentId: parentStudentId,
                                        enabled: parentPlannerEnabled,
                                        lockTime: parentPlannerTime
                                      })
                                    }
                                  );
                                  const data = await res.json().catch(() => ({}));
                                  if (!res.ok) {
                                    setParentPlannerMessage(
                                      data.error || "시간 설정 저장에 실패했습니다."
                                    );
                                    return;
                                  }
                                  setParentLockStatus(data.lockStatus || null);
                                  setParentPlannerMessage("설정이 저장되었습니다.");
                                } catch {
                                  setParentPlannerMessage(
                                    "서버와 통신 중 오류가 발생했습니다."
                                  );
                                } finally {
                                  setParentPlannerSaving(false);
                                }
                              }}
                            >
                              {parentPlannerSaving ? "저장 중..." : "시간 설정 저장"}
                            </button>
                            {parentPlannerMessage && (
                              <p className="settings-hint" style={{ marginTop: 8 }}>
                                {parentPlannerMessage}
                              </p>
                            )}
                            {parentLockStatus && (
                              <div style={{ marginTop: 10 }}>
                                <p className="settings-hint">
                                  현재 상태: {parentLockStatus.locked ? "잠김" : "열림"}
                                </p>
                                <p className="settings-hint">
                                  마지막 변경:{" "}
                                  {parentLockStatus.session?.unlocked_at ||
                                    parentLockStatus.session?.locked_at ||
                                    "아직 없음"}
                                </p>
                                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                                  <button
                                    type="button"
                                    className="progress-footer-btn"
                                    onClick={async () => {
                                      if (!authToken || !parentStudentId) return;
                                      const res = await fetch(
                                        `${API_BASE}/api/parent/lock-now`,
                                        {
                                          method: "POST",
                                          headers: {
                                            "Content-Type": "application/json",
                                            Authorization: `Bearer ${authToken}`
                                          },
                                          body: JSON.stringify({ studentId: parentStudentId })
                                        }
                                      );
                                      const data = await res.json().catch(() => ({}));
                                      if (!res.ok) {
                                        setParentPlannerMessage(
                                          data.error || "수동 잠금에 실패했습니다."
                                        );
                                        return;
                                      }
                                      setParentLockStatus(data.lockStatus || null);
                                      setParentPlannerMessage("학생 기기를 잠금 상태로 전환했습니다.");
                                    }}
                                  >
                                    지금 잠그기
                                  </button>
                                  <button
                                    type="button"
                                    className="progress-footer-btn"
                                    onClick={async () => {
                                      if (!authToken || !parentStudentId) return;
                                      const res = await fetch(
                                        `${API_BASE}/api/parent/unlock-now`,
                                        {
                                          method: "POST",
                                          headers: {
                                            "Content-Type": "application/json",
                                            Authorization: `Bearer ${authToken}`
                                          },
                                          body: JSON.stringify({ studentId: parentStudentId })
                                        }
                                      );
                                      const data = await res.json().catch(() => ({}));
                                      if (!res.ok) {
                                        setParentPlannerMessage(
                                          data.error || "수동 해제에 실패했습니다."
                                        );
                                        return;
                                      }
                                      setParentLockStatus(data.lockStatus || null);
                                      setParentPlannerMessage("학생 기기 잠금을 해제했습니다.");
                                    }}
                                  >
                                    지금 해제
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>

                          <div className="section-header">
                            <h3 className="section-title" style={{ fontSize: 16 }}>
                              AI 일일 리포트
                            </h3>
                          </div>
                          {parentAiDaily ? (
                            <div className="progress-card">
                              <div className="progress-meta-row">
                                <span
                                  className="progress-meta"
                                  style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}
                                >
                                  {parentAiDaily.summary_text}
                                </span>
                              </div>
                              <p className="settings-hint" style={{ marginTop: 10 }}>
                                기준일{" "}
                                {String(parentAiDaily.report_date).slice(0, 10)} ·
                                한국시간 매일 자정 자동 생성
                              </p>
                            </div>
                          ) : (
                            <p className="settings-hint">
                              한국시간 매일 자정 자동 생성됩니다. 서버에 OPENAI_API_KEY가
                              있어야 하며, 자녀 계정에 학습 기록이 있으면 더 풍부해집니다.
                            </p>
                          )}
                          <button
                            type="button"
                            className="progress-footer-btn"
                            style={{ marginTop: 10 }}
                            onClick={async () => {
                              if (!authToken || !parentStudentId) return;
                              try {
                                const res = await fetch(
                                  `${API_BASE}/api/parent/ai-daily-report/refresh`,
                                  {
                                    method: "POST",
                                    headers: {
                                      "Content-Type": "application/json",
                                      Authorization: `Bearer ${authToken}`
                                    },
                                    body: JSON.stringify({
                                      studentId: parentStudentId
                                    })
                                  }
                                );
                                if (!res.ok) return;
                                const data = await res.json();
                                if (data.report) {
                                  setParentAiDaily({
                                    summary_text: data.report.summary_text,
                                    report_date: String(data.report.report_date),
                                    model: data.report.model,
                                    created_at: String(data.report.created_at)
                                  });
                                }
                              } catch {
                                // ignore
                              }
                            }}
                          >
                            지금 리포트 생성하기
                          </button>
                        </div>
                      )}

                      <div style={{ marginTop: 14 }}>
                        {!parentReport ? (
                          <p className="empty-state">리포트를 불러오는 중이에요.</p>
                        ) : (
                          <div className="progress-card">
                            <div className="progress-row">
                              <span className="progress-label">총 학습 시간</span>
                              <span className="progress-value">
                                {Math.floor((parentReport.stats?.totalStudyMinutes || 0) / 60)}
                                {"시간 "}
                                {(parentReport.stats?.totalStudyMinutes || 0) % 60}
                                {"분"}
                              </span>
                            </div>
                            <div className="progress-meta-row" style={{ marginTop: 10 }}>
                              <span className="progress-meta">
                                {parentReport.summaryLines?.length
                                  ? parentReport.summaryLines.join(" ")
                                  : "이번 주 요약이 아직 없어요."}
                              </span>
                            </div>
                            {parentReport.stats?.focusDistribution && (
                              <div className="progress-meta-row" style={{ marginTop: 10 }}>
                                <span className="progress-meta">
                                  집중도 분포 ◎/○/△/✕:{" "}
                                  {parentReport.stats.focusDistribution.best}/
                                  {parentReport.stats.focusDistribution.good}/
                                  {parentReport.stats.focusDistribution.ok}/
                                  {parentReport.stats.focusDistribution.bad}
                                </span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </section>
                  )}

                  <section className="section">
                    <div className="settings-list">
                      <button
                        type="button"
                        className="settings-item"
                        onClick={() => {
                          hapticWarning();
                          handleLogout();
                        }}
                      >
                        <span className="settings-label">로그아웃</span>
                        <span className="settings-value">계정 전환</span>
                      </button>
                    </div>
                  </section>
                </>
              )}
            </>
          )}

          {showStudentShell && !coachStudentMode && studentLockStatus?.locked && (
            <section className="section">
              <div className="progress-card">
                <div className="section-header">
                  <h2 className="section-title">잠금 상태</h2>
                </div>
                <p className="settings-hint" style={{ marginTop: 6 }}>
                  학부모가 정한 시각 이후라 오늘 계획 수정이 잠겨 있어요. 내일 계획을 저장하면
                  잠금이 해제됩니다.
                </p>
                <p className="settings-hint" style={{ marginTop: 6 }}>
                  예정 시각: {studentLockStatus.rules?.[0]?.lockTime || "21:00"} · 상태:
                  잠김
                </p>
                {studentLockMessage && (
                  <p className="settings-hint" style={{ marginTop: 6 }}>
                    {studentLockMessage}
                  </p>
                )}
              </div>
            </section>
          )}

          {showStudentShell && !coachStudentMode && tab === "today" && (
            <>
              <section className="section">
                <div className="section-header">
                  <h2 className="section-title">타임라인</h2>
                </div>

                <div className="timeline-list">
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
                        <span className="time-sub">{block.subject}</span>
                      </div>
                      <div className="subject-col">
                        <span className="subject-pill">{block.subject}</span>
                        <span className="subject-tag">
                          {block.done ? "완료" : ""}
                        </span>
                      </div>
                      <div className="check-col" aria-hidden="true">
                        <span className="check-circle">
                          {block.done && <span className="check-dot" />}
                        </span>
                      </div>
                    </button>
                  ))}
                  {blocks.length === 0 && (
                    <p className="empty-state">아직 일정이 없어요.</p>
                  )}
                </div>
              </section>

            </>
          )}

          {showStudentShell && !coachStudentMode && tab === "week" && (
            <section className="section">
              <div className="week-switch">
                <button
                  className="week-switch-btn week-switch-prev"
                  onClick={() =>
                    setProgressWeekOffset(prev => prev + 1)
                  }
                >
                  이전주
                </button>
                <div className="week-switch-center">
                  <span className="week-switch-label">
                    {getWeekRangeLabel(progressWeekOffset)}
                  </span>
                  <span className="week-switch-underline" />
                </div>
                <button
                  className="week-switch-btn week-switch-next"
                  onClick={() =>
                    setProgressWeekOffset(prev => prev - 1)
                  }
                >
                  다음주
                </button>
              </div>
              <div className="week-frame">
                <div className="progress-cards-scroll">
                  <div className="progress-cards-container">
                    {getWeekDays(progressWeekOffset).map(day => {
                      const todayKey = getDateKey(0);
                      const tomorrowKey = getDateKey(1);
                      const isTodayCard = day.key === todayKey;
                      const isTomorrowCard = day.key === tomorrowKey;
                      return (
                        <div key={day.key} className="progress-day-card">
                          <div className="progress-day-card-header">
                            {day.label}
                          </div>
                          <div className="progress-day-card-body">
                            {progressBooks.map(book => (
                              <div
                                key={book.id}
                                className="progress-day-book"
                              >
                                <div className="progress-day-book-name">
                                  {book.name}
                                </div>
                                <div className="progress-day-book-plan">
                                  {isTodayCard && "오늘 계획: "}
                                  {isTomorrowCard && "내일 계획: "}
                                  {!isTodayCard && !isTomorrowCard && "계획: "}
                                  {isTodayCard
                                    ? (() => {
                                        const ranges = blocks
                                          .filter(
                                            b => b.subject === book.name
                                          )
                                          .map(
                                            b => `${b.start}~${b.end}`
                                          );
                                        return ranges.length > 0
                                          ? ranges.join(", ")
                                          : "미설정";
                                      })()
                                    : isTomorrowCard
                                    ? (() => {
                                        const value = tomorrowPlan[book.id];
                                        if (!value || !value.text?.trim()) {
                                          return "미설정";
                                        }
                                        const hasTime =
                                          value.start && value.end;
                                        if (hasTime) {
                                          return `${value.start}~${value.end} · ${value.text}`;
                                        }
                                        return value.text;
                                      })()
                                    : "미설정"}
                                </div>
                                <div className="progress-day-book-pct-row">
                                  <div className="progress-day-book-pct-wrap">
                                    <span className="progress-day-book-pct-label">
                                      중간
                                    </span>
                                    <div className="progress-pct-input">
                                      -
                                    </div>
                                  </div>
                                  <div className="progress-day-book-pct-wrap">
                                    <span className="progress-day-book-pct-label">
                                      최종
                                    </span>
                                    <div className="progress-pct-input">
                                      -
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
              <div className="progress-footer-actions">
                <button
                  type="button"
                  className="progress-footer-btn"
                  onClick={() => setBooksModalOpen(true)}
                >
                  책 관리
                </button>
                <button
                  type="button"
                  className="progress-footer-btn"
                  onClick={() => setPlanTomorrowOpen(true)}
                >
                  내일 계획 짜기
                </button>
                <button
                  type="button"
                  className="progress-footer-btn"
                  onClick={() => setCheckSettingsOpen(true)}
                >
                  점검 설정
                </button>
              </div>
            </section>
          )}

          {showStudentShell && !coachStudentMode && tab === "store" && (
            <section className="section">
              <div className="section-header">
                <h2 className="section-title">추천 학습 앱</h2>
                <span className="section-caption">학습 전용으로 선별된 앱 목록</span>
              </div>
              <p className="store-notice">
                원격 설치나 삭제는 MDM 처리 때문에 바로 반영되지 않을 수 있어요. 보통 몇 분
                뒤에 기기에 반영됩니다.
              </p>
              {storeError && <p className="empty-state">{storeError}</p>}
              {storeLoading && <p className="empty-state">앱 목록을 불러오는 중…</p>}
              <div className="store-grid">
                {storeApps.map(app => (
                  <article key={app.id} className="store-card">
                    <div className="store-card-top">
                      <span className="store-chip">{app.category}</span>
                      <h3 className="store-title">{app.name}</h3>
                    </div>
                    <p className="store-desc">{app.description}</p>
                    {app.installed && (
                      <p className="store-meta">
                        설치된 앱은 여기서 삭제할 수 있어요. 설치나 삭제는 몇 분 뒤 기기에
                        반영될 수 있어요.
                      </p>
                    )}
                    <div className="store-actions">
                      <button
                        type="button"
                        className={
                          "store-install-btn" +
                          (app.installed ? " store-install-btn-installed" : "")
                        }
                        disabled={storeSavingId === app.id}
                        onClick={async () => {
                          if (!authToken) return;
                          setStoreSavingId(app.id);
                          setStoreError("");
                          try {
                            const res = await fetch(
                              `${API_BASE}/api/student/store-apps/${app.id}`,
                              {
                                method: "PUT",
                                credentials: "include",
                                headers: {
                                  "Content-Type": "application/json",
                                  Authorization: `Bearer ${authToken}`
                                },
                                body: JSON.stringify({
                                  installed: !app.installed,
                                  serial: resolvePreferredSerial() || undefined
                                })
                              }
                            );
                            const data = await res.json().catch(() => ({}));
                            if (!res.ok) {
                              setStoreError(
                                data.error || "앱 상태를 저장하지 못했습니다."
                              );
                              return;
                            }
                            setStoreApps(prev =>
                              prev.map(item =>
                                item.id === app.id ? data.app || item : item
                              )
                            );
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
                            : "다운받기"}
                      </button>
                      <button
                        type="button"
                        className="store-open-btn"
                        onClick={() => {
                          hapticImpactLight();
                          window.open(app.url, "_blank", "noopener,noreferrer");
                        }}
                      >
                        앱 열기
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              {!storeLoading && storeApps.length === 0 && !storeError && (
                <p className="empty-state">아직 등록된 앱이 없어요.</p>
              )}
            </section>
          )}

          {showStudentShell && !coachStudentMode && tab === "settings" && (
            <section className="section">
              <div className="settings-list">
                <button className="settings-item">
                  <span className="settings-label">이메일</span>
                  <span className="settings-value">
                    {userEmail || "로그인 필요"}
                  </span>
                </button>
                <button
                  className="settings-item"
                  onClick={() => {
                    setEditUnlocked(true);
                    setRequestSent(false);
                  }}
                >
                  <span className="settings-label">오늘 플랜 수정 승인</span>
                  <span className="settings-value">
                    {editUnlocked ? "승인됨" : "대기"}
                  </span>
                </button>
                <button
                  className="settings-item"
                  onClick={() => {
                    window.location.hash = "#/parent/report";
                  }}
                >
                  <span className="settings-label">학부모 리포트 보기</span>
                  <span className="settings-value">열기</span>
                </button>
                <button
                  className="settings-item"
                  onClick={() => {
                    hapticSelection();
                    window.location.hash = "#/student/home";
                  }}
                >
                  <span className="settings-label">AI 학습 코치 (신규)</span>
                  <span className="settings-value">열기</span>
                </button>
                <button
                  type="button"
                  className="settings-item"
                  onClick={() => setShowGuideModal(true)}
                >
                  <span className="settings-label">앱 사용 설명서</span>
                  <span className="settings-value">보기</span>
                </button>
                {meRole === "student" && (
                  <>
                    <div
                      className="settings-item"
                      style={{
                        cursor: "default",
                        flexDirection: "column",
                        alignItems: "stretch",
                        gap: 10
                      }}
                    >
                      <span className="settings-label">학부모와 계정 연결</span>
                      <div className="field" style={{ width: "100%" }}>
                        <label className="field-label">학부모 이메일</label>
                        <input
                          className="field-input"
                          placeholder="parent@example.com"
                          value={studentParentEmail}
                          onChange={e => setStudentParentEmail(e.target.value)}
                        />
                      </div>
                      <button
                        type="button"
                        className="progress-footer-btn"
                        onClick={async () => {
                          if (!authToken) return;
                          const parentEmail = studentParentEmail.trim();
                          if (!parentEmail) return;
                          try {
                            const res = await fetch(
                              `${API_BASE}/api/student/request-parent`,
                              {
                                method: "POST",
                                headers: {
                                  "Content-Type": "application/json",
                                  Authorization: `Bearer ${authToken}`
                                },
                                body: JSON.stringify({ parentEmail })
                              }
                            );
                            if (!res.ok) return;
                            setStudentParentEmail("");
                            const lr = await fetch(
                              `${API_BASE}/api/student/link-requests`,
                              {
                                headers: {
                                  Authorization: `Bearer ${authToken}`
                                }
                              }
                            );
                            if (lr.ok) {
                              const d = await lr.json();
                              setStudentWaitingOnParent(d.waitingOnParent || []);
                              setStudentWaitingOnMe(d.waitingOnMe || []);
                            }
                          } catch {
                            // ignore
                          }
                        }}
                      >
                        연결 요청 보내기
                      </button>
                    </div>
                    {studentWaitingOnParent.length > 0 && (
                      <div className="settings-item" style={{ cursor: "default", flexDirection: "column", alignItems: "stretch" }}>
                        <span className="settings-label">학부모 승인 대기</span>
                        {studentWaitingOnParent.map(row => (
                          <span key={row.id} className="settings-hint">
                            {row.parent_email}
                          </span>
                        ))}
                      </div>
                    )}
                    {studentWaitingOnMe.length > 0 && (
                      <div
                        className="settings-item"
                        style={{
                          cursor: "default",
                          flexDirection: "column",
                          alignItems: "stretch",
                          gap: 8
                        }}
                      >
                        <span className="settings-label">
                          학부모 연결 요청
                        </span>
                        {studentWaitingOnMe.map(row => (
                          <div
                            key={row.id}
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: 8
                            }}
                          >
                            <span className="settings-hint">{row.parent_email}</span>
                            <div style={{ display: "flex", gap: 8 }}>
                              <button
                                type="button"
                                className="progress-footer-btn"
                                onClick={async () => {
                                  if (!authToken) return;
                                  const res = await fetch(
                                    `${API_BASE}/api/student/link-confirm`,
                                    {
                                      method: "POST",
                                      headers: {
                                        "Content-Type": "application/json",
                                        Authorization: `Bearer ${authToken}`
                                      },
                                      body: JSON.stringify({ requestId: row.id })
                                    }
                                  );
                                  if (!res.ok) return;
                                  const lr = await fetch(
                                    `${API_BASE}/api/student/link-requests`,
                                    {
                                      headers: {
                                        Authorization: `Bearer ${authToken}`
                                      }
                                    }
                                  );
                                  if (lr.ok) {
                                    const d = await lr.json();
                                    setStudentWaitingOnParent(
                                      d.waitingOnParent || []
                                    );
                                    setStudentWaitingOnMe(d.waitingOnMe || []);
                                  }
                                }}
                              >
                                승인 — 이 학부모와 연결
                              </button>
                              <button
                                type="button"
                                className="progress-footer-btn"
                                onClick={async () => {
                                  if (!authToken) return;
                                  await fetch(`${API_BASE}/api/link/reject`, {
                                    method: "POST",
                                    headers: {
                                      "Content-Type": "application/json",
                                      Authorization: `Bearer ${authToken}`
                                    },
                                    body: JSON.stringify({ requestId: row.id })
                                  });
                                  const lr = await fetch(
                                    `${API_BASE}/api/student/link-requests`,
                                    {
                                      headers: {
                                        Authorization: `Bearer ${authToken}`
                                      }
                                    }
                                  );
                                  if (lr.ok) {
                                    const d = await lr.json();
                                    setStudentWaitingOnParent(
                                      d.waitingOnParent || []
                                    );
                                    setStudentWaitingOnMe(d.waitingOnMe || []);
                                  }
                                }}
                              >
                                거절
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
                <button
                  type="button"
                  className="settings-item"
                  onClick={() => {
                    hapticWarning();
                    handleLogout();
                  }}
                >
                  <span className="settings-label">로그아웃</span>
                  <span className="settings-value">계정 전환</span>
                </button>
              </div>
              {requestSent && (
                <p className="settings-hint">
                  학생이 수정 요청을 보냈습니다. 위 버튼으로 승인할 수 있습니다.
                </p>
              )}
            </section>
          )}
        </main>

        {showStudentShell && (
          <nav className="bottom-nav" aria-label="하단 내비게이션">
            {coachStudentMode ? (
              <>
                <button
                  type="button"
                  className={
                    "nav-item" +
                    (coachStudentTab === "home" ? " nav-item-active" : "")
                  }
                  onClick={() => {
                    hapticSelection();
                    setCoachStudentTab("home");
                    window.location.hash = "#/student/home";
                  }}
                >
                  <span className="nav-label">홈</span>
                </button>
                <button
                  type="button"
                  className={
                    "nav-item" +
                    (coachStudentTab === "coach" ? " nav-item-active" : "")
                  }
                  onClick={() => {
                    hapticSelection();
                    setCoachStudentTab("coach");
                    window.location.hash = "#/student/coach";
                  }}
                >
                  <span className="nav-label">코치</span>
                </button>
                <button
                  type="button"
                  className={
                    "nav-item" +
                    (coachStudentTab === "log" ? " nav-item-active" : "")
                  }
                  onClick={() => {
                    hapticSelection();
                    setCoachStudentTab("log");
                    window.location.hash = "#/student/log";
                  }}
                >
                  <span className="nav-label">기록</span>
                </button>
                <button
                  type="button"
                  className={
                    "nav-item" +
                    (coachStudentTab === "profile" ? " nav-item-active" : "")
                  }
                  onClick={() => {
                    hapticSelection();
                    setCoachStudentTab("profile");
                    window.location.hash = "#/student/profile";
                  }}
                >
                  <span className="nav-label">프로필</span>
                </button>
                <button
                  type="button"
                  className="nav-item"
                  onClick={() => {
                    hapticSelection();
                    setCoachStudentTab(null);
                    window.location.hash = "#/";
                  }}
                >
                  <span className="nav-label">기본</span>
                </button>
              </>
            ) : (
              <>
                <button
                  className={
                    "nav-item" + (tab === "today" ? " nav-item-active" : "")
                  }
                  onClick={() => {
                    hapticSelection();
                    setTab("today");
                  }}
                >
                  <span className="nav-icon">●</span>
                  <span className="nav-label">오늘</span>
                </button>
                <button
                  className={
                    "nav-item" + (tab === "week" ? " nav-item-active" : "")
                  }
                  onClick={() => {
                    hapticSelection();
                    setTab("week");
                  }}
                >
                  <span className="nav-label">주간</span>
                </button>
                <button
                  className={
                    "nav-item" + (tab === "store" ? " nav-item-active" : "")
                  }
                  onClick={() => {
                    hapticSelection();
                    setTab("store");
                  }}
                >
                  <span className="nav-label">앱스토어</span>
                </button>
                <button
                  type="button"
                  className="nav-item"
                  onClick={() => {
                    hapticSelection();
                    setCoachStudentTab("home");
                    window.location.hash = "#/student/home";
                  }}
                >
                  <span className="nav-label">AI 코치</span>
                </button>
                <button
                  className={
                    "nav-item" +
                    (tab === "settings" ? " nav-item-active" : "")
                  }
                  onClick={() => {
                    hapticSelection();
                    setTab("settings");
                  }}
                >
                  <span className="nav-label">설정</span>
                </button>
              </>
            )}
          </nav>
        )}

        {!roleLoading && parentView && meRole === "parent" && (
          <nav className="bottom-nav" aria-label="하단 내비게이션">
            {coachParentMode ? (
              <>
                <button
                  type="button"
                  className={
                    "nav-item" +
                    (coachParentTab === "home" ? " nav-item-active" : "")
                  }
                  onClick={() => {
                    hapticSelection();
                    setCoachParentTab("home");
                    window.location.hash = "#/parent/home";
                  }}
                >
                  <span className="nav-label">홈</span>
                </button>
                <button
                  type="button"
                  className={
                    "nav-item" +
                    (coachParentTab === "timeline"
                      ? " nav-item-active"
                      : "")
                  }
                  onClick={() => {
                    hapticSelection();
                    setCoachParentTab("timeline");
                    window.location.hash = "#/parent/timeline";
                  }}
                >
                  <span className="nav-label">타임라인</span>
                </button>
                <button
                  type="button"
                  className={
                    "nav-item" +
                    (coachParentTab === "guide" ? " nav-item-active" : "")
                  }
                  onClick={() => {
                    hapticSelection();
                    setCoachParentTab("guide");
                    window.location.hash = "#/parent/guide";
                  }}
                >
                  <span className="nav-label">가이드</span>
                </button>
                <button
                  type="button"
                  className={
                    "nav-item" +
                    (coachParentTab === "profile" ? " nav-item-active" : "")
                  }
                  onClick={() => {
                    hapticSelection();
                    setCoachParentTab("profile");
                    window.location.hash = "#/parent/profile";
                  }}
                >
                  <span className="nav-label">프로필</span>
                </button>
                <button
                  type="button"
                  className="nav-item"
                  onClick={() => {
                    hapticSelection();
                    setCoachParentTab(null);
                    window.location.hash = "#/parent";
                  }}
                >
                  <span className="nav-label">기본</span>
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className={
                    "nav-item" +
                    (parentTab === "link" ? " nav-item-active" : "")
                  }
                  onClick={() => {
                    hapticSelection();
                    setParentTab("link");
                    window.location.hash = "#/parent";
                  }}
                >
                  <span className="nav-icon">●</span>
                  <span className="nav-label">연결</span>
                </button>
                <button
                  type="button"
                  className="nav-item"
                  onClick={() => {
                    hapticSelection();
                    setCoachParentTab("home");
                    window.location.hash = "#/parent/home";
                  }}
                >
                  <span className="nav-label">코치</span>
                </button>
                <button
                  type="button"
                  className={
                    "nav-item" +
                    (parentTab === "report" ? " nav-item-active" : "")
                  }
                  onClick={() => {
                    hapticSelection();
                    setParentTab("report");
                    window.location.hash = "#/parent/report";
                  }}
                >
                  <span className="nav-label">리포트</span>
                </button>
              </>
            )}
          </nav>
        )}

        {showStudentShell && !coachStudentMode && tab === "today" && (
          <button
            type="button"
            className="floating-add-button"
            onClick={() => {
              hapticImpactLight();
              if (isLocked) {
                setShowRequestModal(true);
              } else {
                setShowAddModal(true);
              }
            }}
          >
            ＋
          </button>
        )}

        {showAddModal && (
          <div className="modal-backdrop" onClick={() => setShowAddModal(false)}>
            <div
              className="modal-sheet"
              onClick={e => {
                e.stopPropagation();
              }}
            >
              <div className="modal-header">
                <span className="modal-title">할 일 추가</span>
              </div>
              <div className="modal-body">
                <div className="field">
                  <label className="field-label">과목</label>
                  <input
                    className="field-input"
                    placeholder="과목 또는 계획"
                    value={subjectInput}
                    onChange={e => setSubjectInput(e.target.value)}
                  />
                </div>
                <div className="quick-chips">
                  {presetSubjects.map(s => (
                    <button
                      key={s}
                      type="button"
                      className={
                        "chip" + (subjectInput === s ? " chip-active" : "")
                      }
                      onClick={() => setSubjectInput(s)}
                    >
                      {s}
                    </button>
                  ))}
                </div>
                <div className="add-row time-row">
                  <div className="field time-field">
                    <label className="field-label">시작</label>
                    <input
                      type="time"
                      className="field-input"
                      value={startInput}
                      onChange={e => setStartInput(e.target.value)}
                    />
                  </div>
                  <div className="time-divider">―</div>
                  <div className="field time-field">
                    <label className="field-label">종료</label>
                    <input
                      type="time"
                      className="field-input"
                      value={endInput}
                      onChange={e => setEndInput(e.target.value)}
                    />
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="modal-secondary"
                  onClick={() => setShowAddModal(false)}
                >
                  취소
                </button>
                <button
                  type="button"
                  className="modal-primary"
                  onClick={handleAdd}
                  disabled={!subjectInput.trim()}
                >
                  추가
                </button>
              </div>
            </div>
          </div>
        )}

        {showRequestModal && (
          <div
            className="modal-backdrop"
            onClick={() => {
              setShowRequestModal(false);
              setRequestReason("");
            }}
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
                    placeholder="예: 수행평가, 병원 일정"
                    value={requestReason}
                    onChange={e => setRequestReason(e.target.value)}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="modal-secondary"
                  onClick={() => {
                    setShowRequestModal(false);
                    setRequestReason("");
                  }}
                >
                  취소
                </button>
                <button
                  type="button"
                  className="modal-primary"
                  onClick={() => {
                    if (!requestReason.trim()) return;
                    setRequestSent(true);
                    setShowRequestModal(false);
                  }}
                  disabled={!requestReason.trim()}
                >
                  요청 보내기
                </button>
              </div>
            </div>
          </div>
        )}

        {showGuideModal && (
          <div
            className="modal-backdrop"
            onClick={() => setShowGuideModal(false)}
          >
            <div className="modal-sheet" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <span className="modal-title">앱 사용 설명서</span>
              </div>
              <div className="modal-body">
                <div className="field">
                  <label className="field-label">핵심 안내</label>
                  <div className="settings-hint" style={{ marginTop: 0, lineHeight: 1.6 }}>
                    매일 정해진 시간 이후에는 오늘 계획 수정이 제한됩니다. 수정이 필요하면
                    요청을 보내고 승인 후에 편집할 수 있습니다.
                  </div>
                </div>
                <div className="field">
                  <label className="field-label">오늘 공부</label>
                  <div className="settings-hint" style={{ marginTop: 0, lineHeight: 1.6 }}>
                    타임라인을 등록하고 완료 체크를 하며 진행률을 확인합니다.
                  </div>
                </div>
                <div className="field">
                  <label className="field-label">이번 주</label>
                  <div className="settings-hint" style={{ marginTop: 0, lineHeight: 1.6 }}>
                    주간 카드에서 계획과 진도를 확인하고 필요한 입력을 저장합니다.
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="modal-secondary"
                  onClick={() => setShowGuideModal(false)}
                >
                  닫기
                </button>
              </div>
            </div>
          </div>
        )}

        {booksModalOpen && (
          <div
            className="modal-backdrop"
            onClick={() => {
              setBooksModalOpen(false);
              setNewBookName("");
            }}
          >
            <div
              className="modal-sheet"
              onClick={e => e.stopPropagation()}
            >
              <div className="modal-header">
                <span className="modal-title">책 관리</span>
              </div>
              <div className="modal-body">
                <ul className="books-list">
                  {progressBooks.map(book => (
                    <li key={book.id} className="books-item">
                      <span className="books-name">{book.name}</span>
                      <button
                        type="button"
                        className="books-delete"
                        onClick={() =>
                          setProgressBooks(prev =>
                            prev.filter(b => b.id !== book.id)
                          )
                        }
                      >
                        삭제
                      </button>
                    </li>
                  ))}
                  {progressBooks.length === 0 && (
                    <li className="books-empty">등록된 책이 없습니다.</li>
                  )}
                </ul>
                <div className="books-add-row">
                  <input
                    className="field-input"
                    placeholder="책 이름 입력"
                    value={newBookName}
                    onChange={e => setNewBookName(e.target.value)}
                  />
                  <button
                    type="button"
                    className="modal-primary"
                    onClick={() => {
                      if (!newBookName.trim()) return;
                      setProgressBooks(prev => [
                        ...prev,
                        {
                          id: Date.now(),
                          name: newBookName.trim()
                        }
                      ]);
                      setNewBookName("");
                    }}
                  >
                    추가
                  </button>
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="modal-secondary"
                  onClick={() => {
                    setBooksModalOpen(false);
                    setNewBookName("");
                  }}
                >
                  닫기
                </button>
              </div>
            </div>
          </div>
        )}

        {planTomorrowOpen && (
          <div
            className="modal-backdrop"
            onClick={() => setPlanTomorrowOpen(false)}
          >
            <div
              className="modal-sheet"
              onClick={e => e.stopPropagation()}
            >
              <div className="modal-header">
                <span className="modal-title">내일 계획 짜기</span>
              </div>
              <div className="modal-body">
                {progressBooks.map(book => (
                  <div
                    key={book.id}
                    className="books-plan-row"
                  >
                    <span className="books-name">{book.name}</span>
                    <div className="books-plan-inputs">
                      <input
                        className="field-input books-plan-range"
                        placeholder="예: 10-20쪽"
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
                        <input
                          type="time"
                          className="field-input books-plan-time"
                          value={tomorrowPlan[book.id]?.start || ""}
                          onChange={e =>
                            setTomorrowPlan(prev => ({
                              ...prev,
                              [book.id]: {
                                ...prev[book.id],
                                start: e.target.value
                              }
                            }))
                          }
                        />
                        <span className="time-divider">―</span>
                        <input
                          type="time"
                          className="field-input books-plan-time"
                          value={tomorrowPlan[book.id]?.end || ""}
                          onChange={e =>
                            setTomorrowPlan(prev => ({
                              ...prev,
                              [book.id]: {
                                ...prev[book.id],
                                end: e.target.value
                              }
                            }))
                          }
                        />
                      </div>
                    </div>
                  </div>
                ))}
                {progressBooks.length === 0 && (
                  <p className="week-hint">
                    먼저 책을 추가해 주세요.
                  </p>
                )}
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="modal-secondary"
                  onClick={() => setPlanTomorrowOpen(false)}
                >
                  닫기
                </button>
                <button
                  type="button"
                  className="modal-primary"
                  onClick={async () => {
                    if (!authToken) {
                      window.location.hash = "#/auth";
                      return;
                    }
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
                            plannedRange:
                              tomorrowPlan[book.id]?.text || "",
                            startTime:
                              tomorrowPlan[book.id]?.start || null,
                            endTime:
                              tomorrowPlan[book.id]?.end || null
                          }))
                        })
                      });
                      const data = await res.json().catch(() => ({}));
                      if (res.status === 423) {
                        setStudentLockStatus(data.lockStatus || null);
                        setStudentLockMessage(
                          data.error ||
                            "잠금 상태에서는 오늘 계획을 수정할 수 없습니다."
                        );
                        return;
                      }
                      if (res.ok) {
                        setStudentLockMessage("");
                        if (data.lockStatus) {
                          setStudentLockStatus(data.lockStatus);
                        }
                      }
                    } catch {
                      // ignore for now
                    }
                    setPlanTomorrowOpen(false);
                  }}
                  disabled={progressBooks.length === 0}
                >
                  저장
                </button>
              </div>
            </div>
          </div>
        )}

        {checkSettingsOpen && (
          <div
            className="modal-backdrop"
            onClick={() => setCheckSettingsOpen(false)}
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
                  onClick={() => setCheckSettingsOpen(false)}
                >
                  닫기
                </button>
                <button
                  type="button"
                  className="modal-primary"
                  onClick={() => setCheckSettingsOpen(false)}
                >
                  저장
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    ) : null}
    </div>
  );
};

export default App;

