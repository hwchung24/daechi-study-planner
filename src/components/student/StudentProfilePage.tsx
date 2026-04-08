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
  stopNativeStudyRoomTracking,
  type NativeTrackingStatus
} from "../../lib/nativeStudyRoomTracking";
import {
  STUDENT_PROFILE_SCHEDULES_UPDATED_EVENT,
  type StudentProfileSchedule
} from "../../lib/studentProfileSchedules";
import type {
  StudentStudyRoomSummary,
  StudyRoomVisitSession
} from "../../types/studyRoomTracking";
import { DatePickerScroll } from "../DatePickerScroll";
import { TimePickerInline } from "../TimePickerSheet";
import { getWeekStartKeySeoul } from "../../lib/weekDates";
import { useEffectiveBearer } from "../../lib/useEffectiveBearer";
import { useModalReveal } from "../../lib/useModalReveal";
import type { StudentLinkRow } from "./StudentLegacyView";

const STUDENT_PROFILE_NAME_LS_KEY = "daechi_student_profile_name";
const STUDENT_PROFILE_CACHE_PREFIX = "daechi_student_profile";

type RemoteCoachState = {
  snapshot?: {
    profile?: {
      name?: string;
      schoolLevel?: string | null;
      grade?: number | null;
      goal?: string;
      targetSubjects?: string[];
    };
  };
};

type StudentLinkedParentRow = {
  id: number | string;
  email: string;
};

const EMPTY_TRACKING_SUMMARY: StudentStudyRoomSummary = {
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

function formatTrackingAuthorizationStatus(status: string) {
  switch (status) {
    case "authorized_always":
      return "항상 허용";
    case "authorized_when_in_use":
    case "authorized":
      return "앱 사용 중 허용";
    case "denied":
      return "거부됨";
    case "restricted":
      return "제한됨";
    case "not_determined":
    case "prompt":
      return "아직 묻지 않음";
    case "unsupported":
      return "지원되지 않음";
    default:
      return "확인 필요";
  }
}

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

function formatStudyRoomVisitPeriod(visit: StudyRoomVisitSession) {
  const enteredAt = formatTrackingDateTime(visit.enteredAt);
  const endedAt = visit.exitedAt
    ? formatTrackingDateTime(visit.exitedAt)
    : "현재 근방 체류 중";
  return `${enteredAt} - ${endedAt}`;
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
  const linkedParentsCacheKey = useMemo(
    () => buildProfileCacheKey(cacheScope, "linked-parents"),
    [cacheScope]
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
  const [scheduleEditOpen, setScheduleEditOpen] = useState(false);
  const [accountEditOpen, setAccountEditOpen] = useState(false);
  const [accountName, setAccountName] = useState("");
  const [accountEmail, setAccountEmail] = useState("");
  const [accountNewPw, setAccountNewPw] = useState("");
  const [accountNewPw2, setAccountNewPw2] = useState("");
  const [accountCurrentPw, setAccountCurrentPw] = useState("");
  const [accountSaving, setAccountSaving] = useState(false);
  const [accountError, setAccountError] = useState("");
  const [goalInput, setGoalInput] = useState("");
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
  const [parentLinkFeedback, setParentLinkFeedback] = useState("");
  const [linkedParents, setLinkedParents] = useState<StudentLinkedParentRow[]>(() =>
    readProfileCache<StudentLinkedParentRow[]>(linkedParentsCacheKey, [])
  );
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

  const accountModalReveal = useModalReveal(accountEditOpen);
  const profileEditModalReveal = useModalReveal(editOpen);
  const scheduleModalReveal = useModalReveal(scheduleEditOpen);

  useEffect(() => {
    setRemote(readProfileCache<RemoteCoachState | null>(remoteCacheKey, null));
    setScheduleItems(
      readProfileCache<StudentProfileSchedule[]>(schedulesCacheKey, [])
    );
    setLinkedParents(
      readProfileCache<StudentLinkedParentRow[]>(linkedParentsCacheKey, [])
    );
  }, [linkedParentsCacheKey, remoteCacheKey, schedulesCacheKey]);

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
      throw new Error("연결된 학부모 목록을 불러오지 못했습니다.");
    }
    const data = await res.json();
    const nextParents = Array.isArray(data?.parents) ? data.parents : [];
    setLinkedParents(nextParents);
    writeProfileCache(linkedParentsCacheKey, nextParents);
  }, [apiBase, linkedParentsCacheKey, token]);

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
    const onUpdated = () => refreshSchedules();
    window.addEventListener(STUDENT_PROFILE_SCHEDULES_UPDATED_EVENT, onUpdated);
    return () => {
      window.removeEventListener(STUDENT_PROFILE_SCHEDULES_UPDATED_EVENT, onUpdated);
    };
  }, [refreshSchedules]);

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
    const trimmedGoal = goalInput.trim();
    if (!trimmedGoal) {
      setProfileError("목표를 입력해 주세요.");
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
          goal: trimmedGoal
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
  const trackingPermissionLabel = formatTrackingAuthorizationStatus(
    studyRoomTrackingStatus.authorizationStatus
  );
  const modalRoot = typeof document === "undefined" ? null : document.body;

  const requestTrackingPermission = async () => {
    setStudyRoomTrackingBusy(true);
    setStudyRoomTrackingMessage("");
    try {
      const status = await requestNativeStudyRoomTrackingPermissions();
      setStudyRoomTrackingStatus(status);
      setStudyRoomTrackingMessage("위치 권한 상태를 확인했습니다.");
      if (
        status.authorizationStatus === "authorized_always" ||
        status.authorizationStatus === "authorized_when_in_use" ||
        status.authorizationStatus === "authorized"
      ) {
        hapticSuccess();
      }
    } catch (error) {
      setStudyRoomTrackingMessage(
        error instanceof Error && error.message
          ? error.message
          : "위치 권한 요청에 실패했습니다."
      );
      hapticWarning();
    } finally {
      setStudyRoomTrackingBusy(false);
    }
  };

  const startTracking = async () => {
    if (!token) return;
    if (studyRoomTrackingSummary.rooms.length === 0) {
      setStudyRoomTrackingMessage(
        "연결된 학부모가 독서실 위치를 먼저 설정해야 추적을 시작할 수 있습니다."
      );
      hapticWarning();
      return;
    }
    setStudyRoomTrackingBusy(true);
    setStudyRoomTrackingMessage("");
    try {
      const status = await startNativeStudyRoomTracking({
        apiBase,
        authToken: token
      });
      setStudyRoomTrackingStatus(status);
      setStudyRoomTrackingMessage(
        "실제 휴대폰 위치 권한으로 독서실 근방 체류 시간을 기록하기 시작했습니다."
      );
      await refreshStudyRoomTracking({ silent: true });
      hapticSuccess();
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "위치 추적을 시작하지 못했습니다.";
      setStudyRoomTrackingMessage(
        message === "location_permission_required"
          ? "먼저 위치 권한을 허용해 주세요."
          : message
      );
      hapticWarning();
    } finally {
      setStudyRoomTrackingBusy(false);
    }
  };

  const stopTracking = async () => {
    setStudyRoomTrackingBusy(true);
    setStudyRoomTrackingMessage("");
    try {
      const status = await stopNativeStudyRoomTracking({ clearConfig: true });
      setStudyRoomTrackingStatus(status);
      setStudyRoomTrackingMessage("독서실 근방 위치 추적을 중지했습니다.");
      await refreshStudyRoomTracking({ silent: true });
      hapticSuccess();
    } catch (error) {
      setStudyRoomTrackingMessage(
        error instanceof Error && error.message
          ? error.message
          : "위치 추적을 중지하지 못했습니다."
      );
      hapticWarning();
    } finally {
      setStudyRoomTrackingBusy(false);
    }
  };

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
                <div className="coach-profile-card__goal">
                  {displayGoal ? `목표 · ${displayGoal}` : "아직 목표를 설정하지 않았어요."}
                </div>
              </div>
              <button
                type="button"
                className="coach-primary-btn coach-profile-card__action"
                onClick={() => {
                  setProfileError("");
                  setGoalInput(displayGoal || "");
                  setEditOpen(true);
                }}
              >
                프로필 편집
              </button>
            </div>
          </div>
        </Card>

        <Card className="coach-card coach-card--padded student-profile-schedule-card">
          <SectionHeader
            title="일정 관리"
            right={
              <button
                type="button"
                className="student-profile-schedule-add-trigger"
                onClick={openScheduleEditor}
              >
                일정 추가
              </button>
            }
          />
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
                        {item.isRecurring && item.recurrenceRule ? ` · ${item.recurrenceRule}` : ""}
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
        </Card>

        {meRole === "student" && (
          <Card className="coach-card coach-card--padded student-study-room-tracking-card">
            <SectionHeader
              title="독서실 근방 확인"
              right={
                <button
                  type="button"
                  className="student-profile-schedule-add-trigger"
                  onClick={() => {
                    setStudyRoomTrackingMessage("");
                    void refreshStudyRoomTracking();
                  }}
                  disabled={studyRoomTrackingLoading || studyRoomTrackingBusy}
                >
                  새로고침
                </button>
              }
            />
            <div className="student-study-room-tracking-card__summary">
              <div className="student-study-room-tracking-card__status-row">
                <span className="student-study-room-tracking-card__badge">
                  {studyRoomTrackingStatus.trackingEnabled ? "추적 중" : "추적 대기"}
                </span>
                <span className="student-study-room-tracking-card__meta">
                  권한 · {trackingPermissionLabel}
                </span>
              </div>
              <div className="student-study-room-tracking-card__meta-list">
                <span>
                  설정된 독서실 {studyRoomTrackingSummary.rooms.length}곳
                </span>
                <span>
                  마지막 heartbeat {formatTrackingDateTime(studyRoomTrackingStatus.lastHeartbeatAt)}
                </span>
              </div>
              {studyRoomTrackingStatus.lastError ? (
                <p className="settings-hint student-study-room-tracking-card__error">
                  최근 추적 오류 · {studyRoomTrackingStatus.lastError}
                </p>
              ) : null}
            </div>

            {studyRoomTrackingSummary.rooms.length > 0 ? (
              <div className="student-study-room-tracking-card__rooms">
                {studyRoomTrackingSummary.rooms.map(room => (
                  <div key={room.id} className="student-study-room-tracking-card__room">
                    <div className="student-study-room-tracking-card__room-name">
                      {room.name}
                    </div>
                    <div className="student-study-room-tracking-card__room-meta">
                      {room.address || `${room.latitude.toFixed(5)}, ${room.longitude.toFixed(5)}`}
                    </div>
                    <div className="student-study-room-tracking-card__room-meta">
                      근방 판정 반경 · {room.radiusMeters}m
                    </div>
                    <div className="student-study-room-tracking-card__room-meta">
                      연결 학부모 · {room.parentEmail}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="student-study-room-tracking-card__empty">
                아직 연결된 학부모가 독서실 위치를 설정하지 않았습니다.
              </div>
            )}

            <div className="student-study-room-tracking-card__actions">
              <button
                type="button"
                className="progress-footer-btn"
                onClick={() => void requestTrackingPermission()}
                disabled={studyRoomTrackingBusy}
              >
                위치 권한 확인
              </button>
              <button
                type="button"
                className="progress-footer-btn"
                onClick={() => void startTracking()}
                disabled={
                  studyRoomTrackingBusy ||
                  studyRoomTrackingSummary.rooms.length === 0 ||
                  studyRoomTrackingStatus.trackingEnabled
                }
              >
                추적 시작
              </button>
              <button
                type="button"
                className="progress-footer-btn"
                onClick={() => void stopTracking()}
                disabled={studyRoomTrackingBusy || !studyRoomTrackingStatus.trackingEnabled}
              >
                추적 중지
              </button>
            </div>

            {studyRoomTrackingMessage ? (
              <p className="settings-hint student-study-room-tracking-card__message">
                {studyRoomTrackingMessage}
              </p>
            ) : null}

            <div className="student-study-room-tracking-card__visits">
              <div className="student-study-room-tracking-card__visits-title">
                최근 체류 기록
              </div>
              {studyRoomTrackingLoading ? (
                <div className="student-study-room-tracking-card__empty">
                  체류 기록을 불러오는 중입니다.
                </div>
              ) : studyRoomTrackingSummary.recentVisits.length === 0 ? (
                <div className="student-study-room-tracking-card__empty">
                  아직 기록된 독서실 근방 체류 이력이 없습니다.
                </div>
              ) : (
                <div className="student-study-room-tracking-card__visit-list">
                  {studyRoomTrackingSummary.recentVisits.map(visit => (
                    <div key={visit.id} className="student-study-room-tracking-card__visit-item">
                      <div className="student-study-room-tracking-card__visit-title-row">
                        <span className="student-study-room-tracking-card__visit-title">
                          {visit.studyRoomName}
                        </span>
                        <span className="student-study-room-tracking-card__visit-pill">
                          {visit.exitedAt ? "체류 완료" : "체류 중"}
                        </span>
                      </div>
                      <div className="student-study-room-tracking-card__visit-meta">
                        {formatStudyRoomVisitPeriod(visit)}
                      </div>
                      <div className="student-study-room-tracking-card__visit-meta">
                        학부모 · {visit.parentEmail}
                        {visit.lastDistanceMeters != null
                          ? ` · 마지막 거리 ${Math.round(visit.lastDistanceMeters)}m`
                          : ""}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>
        )}

        <Card className="coach-card coach-card--padded student-profile-settings-card">
          <SectionHeader title="계정 및 앱" />
          <div className="student-profile-settings-list">
            <button type="button" className="settings-item" onClick={openAccountEdit}>
              <span className="settings-label">이메일 · 이름 · 비밀번호</span>
              <span className="settings-value">수정</span>
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
          </div>
        </Card>

        {meRole === "student" && (
          <Card className="coach-card coach-card--padded student-profile-parent-link-card">
            <SectionHeader title="학부모와 계정 연결" />
            {linkedParents.length > 0 && (
              <div className="student-profile-link-status student-profile-link-status--first">
                <span className="student-profile-link-status__title">연결된 학부모</span>
                {linkedParents.map(parent => (
                  <span key={parent.id} className="student-profile-link-status__hint">
                    {parent.email}
                  </span>
                ))}
              </div>
            )}
            <div className="student-profile-link-form">
              <div className="field student-profile-link-field">
                <label className="field-label" htmlFor="student-parent-email">
                  학부모 이메일
                </label>
                <input
                  id="student-parent-email"
                  className="field-input student-profile-link-input"
                  value={studentParentEmail}
                  onChange={e => setStudentParentEmail(e.target.value)}
                />
              </div>
              <button
                type="button"
                className="student-profile-link-submit"
                onClick={async () => {
                  if (!token) return;
                  const parentEmail = studentParentEmail.trim();
                  if (!parentEmail) {
                    setParentLinkFeedback("학부모 이메일을 입력해 주세요.");
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
                    setParentLinkFeedback("학부모에게 연결 요청을 보냈어요.");
                    hapticSuccess();
                  } catch {
                    setParentLinkFeedback("네트워크 오류로 연결 요청을 보내지 못했습니다.");
                    hapticWarning();
                  }
                }}
              >
                연결 요청 보내기
              </button>
              {parentLinkFeedback ? (
                <p className="settings-hint student-profile-link-feedback">
                  {parentLinkFeedback}
                </p>
              ) : null}
            </div>
            {studentWaitingOnParent.length > 0 && (
              <div className="student-profile-link-status">
                <span className="student-profile-link-status__title">학부모 승인 대기</span>
                {studentWaitingOnParent.map(row => (
                  <span key={row.id} className="student-profile-link-status__hint">
                    {row.parent_email}
                  </span>
                ))}
              </div>
            )}
            {studentWaitingOnMe.length > 0 && (
              <div className="student-profile-link-status student-profile-link-status--requests">
                <span className="student-profile-link-status__title">학부모 연결 요청</span>
                {studentWaitingOnMe.map(row => (
                  <div key={row.id} className="student-profile-link-request-row">
                    <span className="student-profile-link-status__hint">{row.parent_email}</span>
                    <div className="student-profile-link-request-row__actions">
                      <button
                        type="button"
                        className="student-profile-link-action-btn"
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
                            setParentLinkFeedback("학부모 계정과 연결했어요.");
                            hapticSuccess();
                        }}
                      >
                        승인 — 이 학부모와 연결
                      </button>
                      <button
                        type="button"
                        className="student-profile-link-action-btn student-profile-link-action-btn--danger"
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
          </Card>
        )}
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
                    <label className="field-label">나의 목표</label>
                    <textarea
                      className="field-input"
                      rows={4}
                      value={goalInput}
                      onChange={e => setGoalInput(e.target.value)}
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
