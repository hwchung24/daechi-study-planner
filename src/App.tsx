import React, { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { AppConfig } from "@capacitor-community/mdm-appconfig";
import SplashScreen from "./SplashScreen";
import { AuthScreen } from "./components/AuthScreen";
import { AppBottomNav } from "./components/AppBottomNav";
import { ParentLegacyView, type ParentTabKey } from "./components/parent/ParentLegacyView";
import { StudentLegacyView, type TabKey } from "./components/student/StudentLegacyView";
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
import {
  getInitialRoute,
  injectSerialIntoLocation,
  parseCoachParentTabFromHash,
  parseCoachStudentTabFromHash,
  parseParentTabFromHash,
  parseRouteFromHash,
  parseStudentTabFromHash,
  persistSerial,
  resolvePreferredSerial,
  scrubSerialFromLocation
} from "./lib/hashRouteUtils";
import { getDateKey, getWeekStartKey } from "./lib/weekDates";
import { API_BASE } from "./lib/apiBase";
import type { ParentLockStatus, StudentLockStatus } from "./types/lockStatus";
import type { ProgressBook, ProgressPlan, StudyBlock } from "./types/planner";

const presetSubjects = ["수학", "국어", "영어", "과탐", "사탐", "논술", "자습"];

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

type AppRoute = "student" | "parent" | "auth";

/** 개발 모드 Strict Mode 재마운트 시 스플래시가 두 번 뜨는 것 방지 */
let splashCompletedModule = false;

const App: React.FC = () => {
  const online = useOnlineStatus();

  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [authRole, setAuthRole] = useState<"student" | "parent">("student");
  const [authStudentName, setAuthStudentName] = useState("");
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
      setTab(parseStudentTabFromHash());
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

  const handleWithdrawAccount = async () => {
    if (!authToken) return;

    const ok = window.confirm(
      "정말로 회원 탈퇴를 하시겠습니까?\n이 작업은 되돌릴 수 없습니다."
    );
    if (!ok) return;

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

  const handleAuthSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
                e.preventDefault();
                const email = authEmail.trim().toLowerCase();
                const password = authPassword;
    const studentName = authStudentName.trim();
                if (!email) {
                  hapticWarning();
                  setAuthError("이메일을 입력해 주세요.");
                  return;
                }
    if (authMode === "signup" && authRole === "student" && !studentName) {
      hapticWarning();
      setAuthError("학생 이름을 입력해 주세요.");
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
        localStorage.setItem("daechi_planner_user_email", data.email);
                    localStorage.setItem("daechi_planner_token", token);
                    window.location.hash = "#/";
                    setMainEnter(true);
                  }, 420);
                } catch {
                  hapticWarning();
                  setAuthError("서버와 통신 중 오류가 발생했습니다.");
                }
  };

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
        <AuthScreen
          authLeaving={authLeaving}
          authMode={authMode}
          authRole={authRole}
          authStudentName={authStudentName}
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
          onEmailChange={setAuthEmail}
          onPasswordChange={setAuthPassword}
          onSubmit={handleAuthSubmit}
        />
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

          {/* 오늘 공부의 진행률은 StudentLegacyView에서 3섹션 레이아웃으로 렌더링합니다. */}
        </header>

        <main
          className={
            "app-main" +
            (showStudentShell && !coachStudentMode && tab === "today"
              ? " app-main--today-fixed"
              : "")
          }
        >
          {roleLoading && (
            <p className="empty-state">불러오는 중…</p>
          )}
          {!roleLoading && coachStudentMode && coachStudentTab && (
            <StudentCoachApp
              tab={coachStudentTab}
            />
          )}
          {!roleLoading && coachParentMode && coachParentTab && (
            <ParentCoachApp
              tab={coachParentTab}
            />
          )}
          {!roleLoading && parentView && !coachParentMode && (
            <ParentLegacyView
              apiBase={API_BASE}
              authToken={authToken}
              meRole={meRole}
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
              hapticSelection={hapticSelection}
              hapticWarning={hapticWarning}
              handleLogout={handleLogout}
              handleWithdrawAccount={handleWithdrawAccount}
            />
          )}


          {showStudentShell && !coachStudentMode && (
            <StudentLegacyView
              tab={tab}
              apiBase={API_BASE}
              authToken={authToken}
              userEmail={userEmail}
              meRole={meRole}
              blocks={blocks}
              toggleDone={toggleDone}
              studentLockStatus={studentLockStatus}
              studentLockMessage={studentLockMessage}
              progressWeekOffset={progressWeekOffset}
              setProgressWeekOffset={setProgressWeekOffset}
              progressBooks={progressBooks}
              tomorrowPlan={tomorrowPlan}
              setBooksModalOpen={setBooksModalOpen}
              setPlanTomorrowOpen={setPlanTomorrowOpen}
              setCheckSettingsOpen={setCheckSettingsOpen}
              storeApps={storeApps}
              storeLoading={storeLoading}
              storeError={storeError}
              storeSavingId={storeSavingId}
              setStoreSavingId={setStoreSavingId}
              setStoreError={setStoreError}
              setStoreApps={setStoreApps}
              resolvePreferredSerial={resolvePreferredSerial}
              studentParentEmail={studentParentEmail}
              setStudentParentEmail={setStudentParentEmail}
              studentWaitingOnParent={studentWaitingOnParent}
              studentWaitingOnMe={studentWaitingOnMe}
              setStudentWaitingOnParent={setStudentWaitingOnParent}
              setStudentWaitingOnMe={setStudentWaitingOnMe}
              editUnlocked={editUnlocked}
              setEditUnlocked={setEditUnlocked}
              setRequestSent={setRequestSent}
              requestSent={requestSent}
              setShowGuideModal={setShowGuideModal}
              hapticSelection={hapticSelection}
              hapticWarning={hapticWarning}
              hapticImpactLight={hapticImpactLight}
              hapticSuccess={hapticSuccess}
              handleLogout={handleLogout}
              handleWithdrawAccount={handleWithdrawAccount}
            />
          )}

        </main>

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
              hapticSelection();
            setCoachStudentTab(null);
            setTab(nextTab);
            window.location.hash =
              nextTab === "today"
                ? "#/today"
                : nextTab === "week"
                  ? "#/week"
                  : nextTab === "store"
                    ? "#/store"
                    : "#/settings";
          }}
          onCoachStudentNavClick={nextTab => {
              hapticSelection();
            setCoachStudentTab(nextTab);
            window.location.hash =
              nextTab === "coach" ? "#/student/coach" : "#/student/home";
          }}
          onParentNavClick={nextTab => {
              hapticSelection();
            setParentTab(nextTab);
            window.location.hash =
              nextTab === "report" ? "#/parent/report" : "#/parent";
          }}
          onCoachParentNavClick={nextTab => {
              hapticSelection();
            setCoachParentTab(nextTab);
            window.location.hash =
              nextTab === "home"
                ? "#/parent/home"
                : nextTab === "timeline"
                  ? "#/parent/timeline"
                  : nextTab === "guide"
                    ? "#/parent/guide"
                    : "#/parent/profile";
          }}
          onParentCoachExit={() => {
                hapticSelection();
            setCoachParentTab(null);
                window.location.hash = "#/parent";
              }}
        />

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

