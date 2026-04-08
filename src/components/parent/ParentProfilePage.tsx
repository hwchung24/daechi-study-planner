import React, { useEffect, useMemo, useState } from "react";
import { Card, SectionHeader } from "../../coach/ui/components";
import { useEffectiveBearer } from "../../lib/useEffectiveBearer";
import { useModalReveal } from "../../lib/useModalReveal";
import { StudyRoomPickerModal, type StudyRoomSetting } from "./StudyRoomPickerModal";
import type { ParentStudentRow } from "../../types/parent";
import type { StudyRoomVisitSession } from "../../types/studyRoomTracking";

type ParentLinkRow = {
  id: number;
  student_email: string;
  student_id: number;
  created_at: string;
};

type LocalParentProfile = {
  intro?: string;
};

const PARENT_PROFILE_LS_KEY = "daechi_parent_profile_custom";

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
    : "현재 근방 체류 중";
  return `${enteredAt} - ${exitedAt}`;
}

export function ParentProfilePage(props: {
  authToken: string | null;
  apiBase: string;
  userEmail: string | null;
  parentLinkEmail: string;
  setParentLinkEmail: (v: string) => void;
  parentWaitingOnStudent: ParentLinkRow[];
  parentWaitingOnMe: ParentLinkRow[];
  parentStudents: ParentStudentRow[];
  setParentWaitingOnStudent: (rows: ParentLinkRow[]) => void;
  setParentWaitingOnMe: (rows: ParentLinkRow[]) => void;
  setParentStudents: React.Dispatch<React.SetStateAction<ParentStudentRow[]>>;
  setParentStudentId: (id: number | null) => void;
  hapticWarning: () => void;
  hapticSuccess: () => void;
  onLogoutPress: () => void;
  onWithdrawPress: () => void;
  onUserEmailUpdated: (email: string) => void;
}) {
  const {
    apiBase,
    userEmail,
    parentLinkEmail,
    setParentLinkEmail,
    parentWaitingOnStudent,
    parentWaitingOnMe,
    parentStudents,
    setParentWaitingOnStudent,
    setParentWaitingOnMe,
    setParentStudents,
    setParentStudentId,
    hapticWarning,
    hapticSuccess,
    onLogoutPress,
    onWithdrawPress,
    onUserEmailUpdated
  } = props;
  const token = useEffectiveBearer(props.authToken);
  const [localProfile, setLocalProfile] = useState<LocalParentProfile | null>(() => {
    try {
      const raw = localStorage.getItem(PARENT_PROFILE_LS_KEY);
      return raw ? (JSON.parse(raw) as LocalParentProfile) : null;
    } catch {
      return null;
    }
  });
  const [editOpen, setEditOpen] = useState(false);
  const [introInput, setIntroInput] = useState("");
  const [accountEditOpen, setAccountEditOpen] = useState(false);
  const [accountEmail, setAccountEmail] = useState("");
  const [accountNewPw, setAccountNewPw] = useState("");
  const [accountNewPw2, setAccountNewPw2] = useState("");
  const [accountCurrentPw, setAccountCurrentPw] = useState("");
  const [accountSaving, setAccountSaving] = useState(false);
  const [accountError, setAccountError] = useState("");
  const [studyRoomStudentId, setStudyRoomStudentId] = useState<number | null>(null);
  const [studyRoomSaving, setStudyRoomSaving] = useState(false);
  const [studyRoomMessage, setStudyRoomMessage] = useState("");
  const [studyRoomVisits, setStudyRoomVisits] = useState<
    Record<number, StudyRoomVisitSession[]>
  >({});
  const [studyRoomVisitsLoading, setStudyRoomVisitsLoading] = useState(false);

  const accountModalReveal = useModalReveal(accountEditOpen);
  const profileEditModalReveal = useModalReveal(editOpen);
  const studyRoomModalReveal = useModalReveal(studyRoomStudentId !== null);

  const displayName = useMemo(() => {
    const email = String(userEmail || "").trim();
    if (!email) return "학부모";
    const localPart = email.split("@")[0]?.trim();
    return localPart || "학부모";
  }, [userEmail]);
  const introText =
    localProfile?.intro ||
    (parentStudents.length > 0
      ? `${parentStudents.length}명의 학생과 학습 루틴을 함께 보고 있어요.`
      : "아직 연결된 학생이 없어요.");
  const activeStudyRoomStudent =
    parentStudents.find(student => student.id === studyRoomStudentId) || null;

  const persistLocalProfile = (next: LocalParentProfile) => {
    setLocalProfile(next);
    try {
      localStorage.setItem(PARENT_PROFILE_LS_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const refreshLinkRequests = async () => {
    if (!props.authToken) return;
    const lr = await fetch(`${apiBase}/api/parent/link-requests`, {
      headers: {
        Authorization: `Bearer ${props.authToken}`
      }
    });
    if (!lr.ok) return;
    const data = await lr.json();
    setParentWaitingOnStudent(data.waitingOnStudent || []);
    setParentWaitingOnMe(data.waitingOnMe || []);
  };

  const refreshStudents = async () => {
    if (!props.authToken) return;
    const st = await fetch(`${apiBase}/api/parent/students`, {
      headers: {
        Authorization: `Bearer ${props.authToken}`
      }
    });
    if (!st.ok) return;
    const data = await st.json();
    const next = data.students || [];
    setParentStudents(next);
    setParentStudentId(next.length > 0 ? next[0].id : null);
  };

  useEffect(() => {
    if (!token) {
      setStudyRoomVisits({});
      return;
    }

    const studentsWithRooms = parentStudents.filter(student => student.studyRoom);
    if (studentsWithRooms.length === 0) {
      setStudyRoomVisits({});
      return;
    }

    let cancelled = false;
    setStudyRoomVisitsLoading(true);
    void (async () => {
      try {
        const entries = await Promise.all(
          studentsWithRooms.map(async student => {
            const res = await fetch(
              `${apiBase}/api/parent/students/${encodeURIComponent(String(student.id))}/study-room-visits?limit=4`,
              {
                cache: "no-store",
                headers: {
                  Authorization: `Bearer ${token}`
                }
              }
            );
            const data = (await res.json().catch(() => ({}))) as {
              visits?: StudyRoomVisitSession[];
            };
            return [student.id, Array.isArray(data.visits) ? data.visits : []] as const;
          })
        );
        if (cancelled) return;
        setStudyRoomVisits(Object.fromEntries(entries));
      } catch {
        if (cancelled) return;
      } finally {
        if (!cancelled) {
          setStudyRoomVisitsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [apiBase, parentStudents, token]);

  const openAccountEdit = () => {
    setAccountEmail((userEmail || "").trim());
    setAccountNewPw("");
    setAccountNewPw2("");
    setAccountCurrentPw("");
    setAccountError("");
    setAccountEditOpen(true);
  };

  const saveAccount = async () => {
    setAccountError("");
    const email = accountEmail.trim().toLowerCase();
    if (!email) {
      setAccountError("이메일을 입력해 주세요.");
      return;
    }
    if (accountNewPw !== accountNewPw2) {
      setAccountError("새 비밀번호가 일치하지 않습니다.");
      return;
    }
    const emailChanged = email !== String(userEmail || "").trim().toLowerCase();
    const passwordChanged = accountNewPw.length > 0;
    if ((emailChanged || passwordChanged) && !accountCurrentPw) {
      setAccountError("이메일 또는 비밀번호를 바꿀 때는 현재 비밀번호를 입력해 주세요.");
      return;
    }
    if (passwordChanged && accountNewPw.length < 4) {
      setAccountError("새 비밀번호는 4자 이상이어야 합니다.");
      return;
    }
    if (!token) return;
    setAccountSaving(true);
    try {
      const body: Record<string, string> = {
        email,
        currentPassword: accountCurrentPw
      };
      if (passwordChanged) body.newPassword = accountNewPw;
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
        // ignore non-json response
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
      hapticSuccess();
      accountModalReveal.beginClose(() => {
        setAccountEditOpen(false);
        setAccountNewPw("");
        setAccountNewPw2("");
        setAccountCurrentPw("");
      });
    } catch (e: unknown) {
      setAccountError(
        e instanceof Error && e.message
          ? e.message
          : "네트워크 오류입니다. 연결과 API 주소를 확인해 주세요."
      );
      hapticWarning();
    } finally {
      setAccountSaving(false);
    }
  };

  const saveLocalProfile = () => {
    const next: LocalParentProfile = {
      ...(localProfile || {}),
      intro: introInput.trim() || undefined
    };
    persistLocalProfile(next);
    profileEditModalReveal.beginClose(() => setEditOpen(false));
  };

  const saveStudyRoomSetting = (value: StudyRoomSetting) => {
    if (!token) return;
    setStudyRoomSaving(true);
    setStudyRoomMessage("");
    void (async () => {
      try {
        const res = await fetch(
          `${apiBase}/api/parent/students/${encodeURIComponent(String(value.studentId))}/study-room`,
          {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`
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
        hapticSuccess();
        setStudyRoomMessage("학생별 독서실 위치를 저장했습니다.");
        studyRoomModalReveal.beginClose(() => setStudyRoomStudentId(null));
      } catch (error) {
        setStudyRoomMessage(
          error instanceof Error && error.message
            ? error.message
            : "독서실 위치 저장 중 오류가 발생했습니다."
        );
        hapticWarning();
      } finally {
        setStudyRoomSaving(false);
      }
    })();
  };

  const removeStudyRoomSetting = (studentId: number) => {
    if (!token) return;
    setStudyRoomSaving(true);
    setStudyRoomMessage("");
    void (async () => {
      try {
        const res = await fetch(
          `${apiBase}/api/parent/students/${encodeURIComponent(String(studentId))}/study-room`,
          {
            method: "DELETE",
            headers: {
              Authorization: `Bearer ${token}`
            }
          }
        );
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(String(data.error || "독서실 위치 삭제에 실패했습니다."));
        }
        await refreshStudents();
        hapticSuccess();
        setStudyRoomMessage("학생 독서실 위치를 삭제했습니다.");
      } catch (error) {
        setStudyRoomMessage(
          error instanceof Error && error.message
            ? error.message
            : "독서실 위치 삭제 중 오류가 발생했습니다."
        );
        hapticWarning();
      } finally {
        setStudyRoomSaving(false);
      }
    })();
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
                  <span className="coach-profile-card__grade-pill">
                    연결 학생 {parentStudents.length}명
                  </span>
                </div>
                <div className="coach-profile-card__goal">
                  {introText ? `소개 · ${introText}` : "아직 소개를 설정하지 않았어요."}
                </div>
              </div>
              <button
                type="button"
                className="coach-primary-btn coach-profile-card__action"
                onClick={() => {
                  setIntroInput(localProfile?.intro || "");
                  setEditOpen(true);
                }}
              >
                프로필 편집
              </button>
            </div>
          </div>
        </Card>

        <Card className="coach-card coach-card--padded student-profile-settings-card">
          <SectionHeader title="계정 및 앱" />
          <div className="student-profile-settings-list">
            <button type="button" className="settings-item" onClick={openAccountEdit}>
              <span className="settings-label">이메일 · 비밀번호</span>
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

        <Card className="coach-card coach-card--padded student-profile-parent-link-card">
          <SectionHeader title="학생별 독서실 설정" />
          {parentStudents.length === 0 ? (
            <div className="parent-study-room-empty">
              연결된 학생이 생기면 학생별 독서실 위치를 지도에서 설정할 수 있어요.
            </div>
          ) : (
            <div className="parent-study-room-list">
              {parentStudents.map(student => {
                const setting = student.studyRoom || null;
                const visits = studyRoomVisits[student.id] || [];
                return (
                  <div key={student.id} className="parent-study-room-item">
                    <div className="parent-study-room-item__body">
                      <div className="parent-study-room-item__title-row">
                        <span className="parent-study-room-item__student">{student.email}</span>
                        <span className="parent-study-room-item__pill">
                          {setting ? "설정됨" : "미설정"}
                        </span>
                      </div>
                      <div className="parent-study-room-item__name">
                        {setting?.name || "아직 독서실 위치를 지정하지 않았어요."}
                      </div>
                      <div className="parent-study-room-item__meta">
                        {setting?.address
                          ? setting.address
                          : setting
                            ? `${setting.latitude.toFixed(5)}, ${setting.longitude.toFixed(5)}`
                            : "지도에서 위치를 눌러 학생별 독서실 위치를 저장하세요."}
                      </div>
                      {setting ? (
                        <div className="parent-study-room-item__meta">
                          근방 판정 반경 {setting.radiusMeters}m
                        </div>
                      ) : null}
                      {setting ? (
                        <div className="parent-study-room-item__visits">
                          <div className="parent-study-room-item__visits-title">
                            최근 독서실 근방 체류
                          </div>
                          {studyRoomVisitsLoading && visits.length === 0 ? (
                            <div className="parent-study-room-item__visit-empty">
                              체류 기록을 불러오는 중입니다.
                            </div>
                          ) : visits.length === 0 ? (
                            <div className="parent-study-room-item__visit-empty">
                              아직 저장된 체류 기록이 없습니다.
                            </div>
                          ) : (
                            <div className="parent-study-room-item__visit-list">
                              {visits.map(visit => (
                                <div
                                  key={visit.id}
                                  className="parent-study-room-item__visit-item"
                                >
                                  <div className="parent-study-room-item__visit-row">
                                    <span className="parent-study-room-item__visit-name">
                                      {visit.studyRoomName}
                                    </span>
                                    <span className="parent-study-room-item__visit-pill">
                                      {visit.exitedAt ? "체류 완료" : "체류 중"}
                                    </span>
                                  </div>
                                  <div className="parent-study-room-item__visit-meta">
                                    {formatStudyRoomVisitPeriod(visit)}
                                  </div>
                                  <div className="parent-study-room-item__visit-meta">
                                    {visit.lastDistanceMeters != null
                                      ? `마지막 거리 ${Math.round(visit.lastDistanceMeters)}m`
                                      : "거리 기록 없음"}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : null}
                    </div>
                    <div className="parent-study-room-item__actions">
                      <button
                        type="button"
                        className="progress-footer-btn"
                        disabled={studyRoomSaving}
                        onClick={() => setStudyRoomStudentId(student.id)}
                      >
                        {setting ? "수정" : "위치 설정"}
                      </button>
                      {setting ? (
                        <button
                          type="button"
                          className="progress-footer-btn"
                          disabled={studyRoomSaving}
                          onClick={() => removeStudyRoomSetting(student.id)}
                        >
                          삭제
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {studyRoomMessage ? (
            <p className="settings-hint" style={{ marginTop: 12 }}>
              {studyRoomMessage}
            </p>
          ) : null}
        </Card>

        <Card className="coach-card coach-card--padded student-profile-parent-link-card">
          <SectionHeader title="학생과 계정 연결" />
          {parentStudents.length > 0 && (
            <div className="student-profile-link-status" style={{ marginTop: 12 }}>
              <span className="student-profile-link-status__title">연결된 학생</span>
              {parentStudents.map(student => (
                <span key={student.id} className="student-profile-link-status__hint">
                  {student.email}
                </span>
              ))}
            </div>
          )}
          <div className="field" style={{ marginTop: 12 }}>
            <label className="field-label" htmlFor="parent-student-email">
              학생 이메일
            </label>
            <input
              id="parent-student-email"
              className="field-input"
              value={parentLinkEmail}
              onChange={e => setParentLinkEmail(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="coach-primary-btn"
            style={{ marginTop: 10 }}
            onClick={async () => {
              if (!props.authToken) return;
              const studentEmail = parentLinkEmail.trim();
              if (!studentEmail) return;
              try {
                const res = await fetch(`${apiBase}/api/parent/link-request`, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${props.authToken}`
                  },
                  body: JSON.stringify({ studentEmail })
                });
                if (!res.ok) return;
                setParentLinkEmail("");
                await refreshLinkRequests();
              } catch {
                // ignore
              }
            }}
          >
            연결 요청 보내기
          </button>
          {parentWaitingOnStudent.length > 0 && (
            <div className="student-profile-link-status">
              <span className="student-profile-link-status__title">학생 승인 대기</span>
              {parentWaitingOnStudent.map(row => (
                <span key={row.id} className="student-profile-link-status__hint">
                  {row.student_email}
                </span>
              ))}
            </div>
          )}
          {parentWaitingOnMe.length > 0 && (
            <div className="student-profile-link-status student-profile-link-status--requests">
              <span className="student-profile-link-status__title">학생 연결 요청</span>
              {parentWaitingOnMe.map(row => (
                <div key={row.id} className="student-profile-link-request-row">
                  <span className="student-profile-link-status__hint">{row.student_email}</span>
                  <div className="student-profile-link-request-row__actions">
                    <button
                      type="button"
                      className="progress-footer-btn"
                      onClick={async () => {
                        if (!props.authToken) return;
                        const res = await fetch(`${apiBase}/api/parent/link-confirm`, {
                          method: "POST",
                          headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${props.authToken}`
                          },
                          body: JSON.stringify({ requestId: row.id })
                        });
                        if (!res.ok) return;
                        await refreshLinkRequests();
                        await refreshStudents();
                      }}
                    >
                      승인 — 이 학생과 연결
                    </button>
                    <button
                      type="button"
                      className="progress-footer-btn"
                      onClick={async () => {
                        if (!props.authToken) return;
                        await fetch(`${apiBase}/api/link/reject`, {
                          method: "POST",
                          headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${props.authToken}`
                          },
                          body: JSON.stringify({ requestId: row.id })
                        });
                        await refreshLinkRequests();
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
      </div>

      <div
        className={"dday-modal" + (accountModalReveal.revealed ? " dday-modal--open" : "")}
        onClick={() => accountModalReveal.beginClose(() => setAccountEditOpen(false))}
      >
        <div className="dday-modal-inner" onClick={e => e.stopPropagation()}>
          <div className="dday-modal-header">
            <span className="dday-modal-title">계정 정보</span>
          </div>
          <div className="dday-modal-body">
            <div className="field">
              <label className="field-label" htmlFor="parent-account-email">
                이메일
              </label>
              <input
                id="parent-account-email"
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
              <label className="field-label" htmlFor="parent-account-new-pw">
                새 비밀번호
              </label>
              <input
                id="parent-account-new-pw"
                className="field-input"
                type="password"
                value={accountNewPw}
                onChange={e => setAccountNewPw(e.target.value)}
                autoComplete="new-password"
                placeholder="변경하지 않으면 비워 두세요"
              />
            </div>
            <div className="field" style={{ marginTop: 10 }}>
              <label className="field-label" htmlFor="parent-account-new-pw2">
                새 비밀번호 확인
              </label>
              <input
                id="parent-account-new-pw2"
                className="field-input"
                type="password"
                value={accountNewPw2}
                onChange={e => setAccountNewPw2(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <div className="field" style={{ marginTop: 10 }}>
              <label className="field-label" htmlFor="parent-account-current-pw">
                현재 비밀번호
              </label>
              <input
                id="parent-account-current-pw"
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
              onClick={() => accountModalReveal.beginClose(() => setAccountEditOpen(false))}
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
      </div>

      <div
        className={"dday-modal" + (profileEditModalReveal.revealed ? " dday-modal--open" : "")}
        onClick={() => profileEditModalReveal.beginClose(() => setEditOpen(false))}
      >
        <div className="dday-modal-inner" onClick={e => e.stopPropagation()}>
          <div className="dday-modal-header">
            <span className="dday-modal-title">프로필 편집</span>
          </div>
          <div className="dday-modal-body">
            <div className="field">
              <label className="field-label">한 줄 소개</label>
              <input
                className="field-input"
                value={introInput}
                onChange={e => setIntroInput(e.target.value)}
              />
            </div>
          </div>
          <div className="dday-modal-footer">
            <button
              type="button"
              className="modal-secondary"
              onClick={() => profileEditModalReveal.beginClose(() => setEditOpen(false))}
            >
              취소
            </button>
            <button type="button" className="modal-primary" onClick={saveLocalProfile}>
              저장
            </button>
          </div>
        </div>
      </div>

      <StudyRoomPickerModal
        open={studyRoomStudentId !== null}
        revealed={studyRoomModalReveal.revealed}
        student={activeStudyRoomStudent}
        initialValue={activeStudyRoomStudent?.studyRoom || undefined}
        saving={studyRoomSaving}
        onClose={() => studyRoomModalReveal.beginClose(() => setStudyRoomStudentId(null))}
        onSave={saveStudyRoomSetting}
      />
    </>
  );
}