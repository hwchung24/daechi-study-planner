import React, { useState } from "react";
import { getDateKey, getWeekDays, getWeekRangeLabel } from "../../lib/weekDates";
import type { StudentLockStatus } from "../../types/lockStatus";
import type { ProgressBook, ProgressPlan, StudyBlock } from "../../types/planner";

export type TabKey = "today" | "week" | "store" | "settings";

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

const storeAppIcons: Record<string, string> = {
  "youtube-learning": "▶️",
  "khan-academy": "🎓",
  quizlet: "🧠",
  notion: "🗒️",
  "google-drive": "📁"
};

type StudentLinkRow = {
  id: number;
  parent_email: string;
  parent_user_id: number;
  created_at: string;
};

export function StudentLegacyView(props: {
  tab: TabKey;
  apiBase: string;
  authToken: string | null;
  userEmail: string | null;
  meRole: string | null;
  blocks: StudyBlock[];
  toggleDone: (id: number) => void;
  studentLockStatus: StudentLockStatus | null;
  studentLockMessage: string;
  progressWeekOffset: number;
  setProgressWeekOffset: React.Dispatch<React.SetStateAction<number>>;
  progressBooks: ProgressBook[];
  tomorrowPlan: ProgressPlan;
  setBooksModalOpen: (v: boolean) => void;
  setPlanTomorrowOpen: (v: boolean) => void;
  setCheckSettingsOpen: (v: boolean) => void;
  storeApps: StudyStoreApp[];
  storeLoading: boolean;
  storeError: string;
  storeSavingId: string | null;
  setStoreSavingId: (v: string | null) => void;
  setStoreError: (v: string) => void;
  setStoreApps: React.Dispatch<React.SetStateAction<StudyStoreApp[]>>;
  resolvePreferredSerial: () => string;
  studentParentEmail: string;
  setStudentParentEmail: (v: string) => void;
  studentWaitingOnParent: StudentLinkRow[];
  studentWaitingOnMe: StudentLinkRow[];
  setStudentWaitingOnParent: (rows: StudentLinkRow[]) => void;
  setStudentWaitingOnMe: (rows: StudentLinkRow[]) => void;
  editUnlocked: boolean;
  setEditUnlocked: (v: boolean) => void;
  setRequestSent: (v: boolean) => void;
  requestSent: boolean;
  setShowGuideModal: (v: boolean) => void;
  hapticSelection: () => void;
  hapticWarning: () => void;
  hapticImpactLight: () => void;
  hapticSuccess: () => void;
  handleLogout: () => void;
}) {
  const {
    tab,
    apiBase,
    authToken,
    userEmail,
    meRole,
    blocks,
    toggleDone,
    studentLockStatus,
    studentLockMessage,
    progressWeekOffset,
    setProgressWeekOffset,
    progressBooks,
    tomorrowPlan,
    setBooksModalOpen,
    setPlanTomorrowOpen,
    setCheckSettingsOpen,
    storeApps,
    storeLoading,
    storeError,
    storeSavingId,
    setStoreSavingId,
    setStoreError,
    setStoreApps,
    resolvePreferredSerial,
    studentParentEmail,
    setStudentParentEmail,
    studentWaitingOnParent,
    studentWaitingOnMe,
    setStudentWaitingOnParent,
    setStudentWaitingOnMe,
    editUnlocked,
    setEditUnlocked,
    setRequestSent,
    requestSent,
    setShowGuideModal,
    hapticSelection,
    hapticWarning,
    hapticImpactLight,
    hapticSuccess,
    handleLogout
  } = props;
  const [todaySleepHours, setTodaySleepHours] = useState("");
  const [todayStress, setTodayStress] = useState("3");
  const [todayConcentration, setTodayConcentration] = useState("3");
  const [todayMemo, setTodayMemo] = useState("");
  const [todayLogSaving, setTodayLogSaving] = useState(false);
  const [todayLogMessage, setTodayLogMessage] = useState("");

  const handleSaveTodayLog = async () => {
    if (!authToken) return;
    const sleepRaw = todaySleepHours.trim();
    if (!sleepRaw) {
      hapticWarning();
      setTodayLogMessage("수면시간을 입력해 주세요.");
      return;
    }
    const sleepHours = Number(sleepRaw);
    if (!Number.isFinite(sleepHours) || sleepHours < 0 || sleepHours > 24) {
      hapticWarning();
      setTodayLogMessage("수면시간은 0~24시간 범위로 입력해 주세요.");
      return;
    }
    setTodayLogSaving(true);
    setTodayLogMessage("");
    try {
      const res = await fetch(`${apiBase}/api/student/coach/log`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          date: getDateKey(0),
          sleepHours,
          stressScore: Number(todayStress),
          concentrationScore: Number(todayConcentration),
          memo: todayMemo.trim() || null
        })
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
      setTodayLogMessage("오늘 기록이 저장되었습니다.");
    } catch {
      hapticWarning();
      setTodayLogMessage("서버와 통신 중 오류가 발생했습니다.");
    } finally {
      setTodayLogSaving(false);
    }
  };

  return (
    <>
      {studentLockStatus?.locked && (
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
              예정 시각: {studentLockStatus.rules?.[0]?.lockTime || "21:00"} · 상태: 잠김
            </p>
            {studentLockMessage && (
              <p className="settings-hint" style={{ marginTop: 6 }}>
                {studentLockMessage}
              </p>
            )}
          </div>
        </section>
      )}

      {tab === "today" && (
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
                    <span className="subject-tag">{block.done ? "완료" : ""}</span>
                  </div>
                  <div className="check-col" aria-hidden="true">
                    <span className="check-circle">
                      {block.done && <span className="check-dot" />}
                    </span>
                  </div>
                </button>
              ))}
              {blocks.length === 0 && <p className="empty-state">아직 일정이 없어요.</p>}
            </div>
          </section>
          <section className="section section-sticky">
            <div className="section-header">
              <h2 className="section-title">오늘 기록</h2>
            </div>
            <div className="progress-card" style={{ marginTop: 12 }}>
              <div className="field">
                <label className="field-label">수면시간</label>
                <input
                  type="number"
                  min={0}
                  max={24}
                  step={0.5}
                  className="field-input"
                  value={todaySleepHours}
                  onChange={e => setTodaySleepHours(e.target.value)}
                />
              </div>
              <div className="field" style={{ marginTop: 10 }}>
                <label className="field-label">스트레스</label>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <input
                    type="range"
                    min={1}
                    max={5}
                    step={1}
                    value={todayStress}
                    onChange={e => setTodayStress(e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <span className="settings-value" style={{ minWidth: 24, textAlign: "right" }}>
                    {todayStress}
                  </span>
                </div>
              </div>
              <div className="field" style={{ marginTop: 10 }}>
                <label className="field-label">집중도</label>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <input
                    type="range"
                    min={1}
                    max={5}
                    step={1}
                    value={todayConcentration}
                    onChange={e => setTodayConcentration(e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <span className="settings-value" style={{ minWidth: 24, textAlign: "right" }}>
                    {todayConcentration}
                  </span>
                </div>
              </div>
              <div className="field" style={{ marginTop: 10 }}>
                <label className="field-label">회고 메모</label>
                <textarea
                  className="field-input"
                  value={todayMemo}
                  onChange={e => setTodayMemo(e.target.value)}
                  rows={4}
                  style={{ resize: "vertical" }}
                />
              </div>
              <button
                type="button"
                className="progress-footer-btn"
                style={{ marginTop: 12 }}
                disabled={todayLogSaving}
                onClick={handleSaveTodayLog}
                aria-label="오늘 기록 저장"
                title="오늘 기록 저장"
              >
                {todayLogSaving ? "⏳" : "💾"}
              </button>
              {todayLogMessage && (
                <p className="settings-hint" style={{ marginTop: 8 }}>
                  {todayLogMessage}
                </p>
              )}
            </div>
          </section>
        </>
      )}

      {tab === "week" && (
        <section className="section">
          <div className="week-switch">
            <button
              className="week-switch-btn week-switch-prev"
              onClick={() => setProgressWeekOffset(prev => prev + 1)}
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
              onClick={() => setProgressWeekOffset(prev => prev - 1)}
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
                      <div className="progress-day-card-header">{day.label}</div>
                      <div className="progress-day-card-body">
                        {progressBooks.map(book => (
                          <div key={book.id} className="progress-day-book">
                            <div className="progress-day-book-name">{book.name}</div>
                            <div className="progress-day-book-plan">
                              {isTodayCard && "오늘 계획: "}
                              {isTomorrowCard && "내일 계획: "}
                              {!isTodayCard && !isTomorrowCard && "계획: "}
                              {isTodayCard
                                ? (() => {
                                    const ranges = blocks
                                      .filter(b => b.subject === book.name)
                                      .map(b => `${b.start}~${b.end}`);
                                    return ranges.length > 0 ? ranges.join(", ") : "미설정";
                                  })()
                                : isTomorrowCard
                                  ? (() => {
                                      const value = tomorrowPlan[book.id];
                                      if (!value || !value.text?.trim()) {
                                        return "미설정";
                                      }
                                      const hasTime = value.start && value.end;
                                      if (hasTime) {
                                        return `${value.start}~${value.end} · ${value.text}`;
                                      }
                                      return value.text;
                                    })()
                                  : "미설정"}
                            </div>
                            <div className="progress-day-book-pct-row">
                              <div className="progress-day-book-pct-wrap">
                                <span className="progress-day-book-pct-label">중간</span>
                                <div className="progress-pct-input">-</div>
                              </div>
                              <div className="progress-day-book-pct-wrap">
                                <span className="progress-day-book-pct-label">최종</span>
                                <div className="progress-pct-input">-</div>
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
              aria-label="책 관리"
              title="책 관리"
            >
              <span aria-hidden>📚</span>
            </button>
            <button
              type="button"
              className="progress-footer-btn"
              onClick={() => setPlanTomorrowOpen(true)}
              aria-label="내일 계획"
              title="내일 계획"
            >
              <span aria-hidden>🗓️</span>
            </button>
            <button
              type="button"
              className="progress-footer-btn"
              onClick={() => setCheckSettingsOpen(true)}
              aria-label="점검 설정"
              title="점검 설정"
            >
              <span aria-hidden>⚙️</span>
            </button>
          </div>
        </section>
      )}

      {tab === "store" && (
        <section className="section">
          <div className="section-header">
            <h2 className="section-title">추천 학습 앱</h2>
            <span className="section-caption">앱 목록</span>
          </div>
          {storeError && <p className="empty-state">{storeError}</p>}
          {storeLoading && <p className="empty-state">앱 목록을 불러오는 중…</p>}
          <div className="store-grid">
            {storeApps.map(app => (
              <article key={app.id} className="store-card">
                <div className="store-card-top">
                  <span className="store-chip">{app.category}</span>
                  <h3 className="store-title">
                    <span aria-hidden style={{ marginRight: 8 }}>
                      {storeAppIcons[app.id] || "📱"}
                    </span>
                    {app.name}
                  </h3>
                </div>
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
                              serial: resolvePreferredSerial() || undefined
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
                        setStoreApps(prev =>
                          prev.map(item =>
                            item.id === app.id ? (data as { app?: StudyStoreApp }).app || item : item
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
                      ? "⏳"
                      : app.installed
                        ? "🗑️"
                        : "⬇️"}
                  </button>
                  <button
                    type="button"
                    className="store-open-btn"
                    onClick={() => {
                      hapticImpactLight();
                      window.open(app.url, "_blank", "noopener,noreferrer");
                    }}
                    aria-label="앱 열기"
                    title="앱 열기"
                  >
                    ↗️
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

      {tab === "settings" && (
        <section className="section">
          <div className="settings-list">
            <button className="settings-item">
              <span className="settings-label">이메일</span>
              <span className="settings-value">{userEmail || "로그인 필요"}</span>
            </button>
            <button
              className="settings-item"
              onClick={() => {
                setEditUnlocked(true);
                setRequestSent(false);
              }}
            >
              <span className="settings-label">오늘 플랜 수정 승인</span>
              <span className="settings-value">{editUnlocked ? "승인됨" : "대기"}</span>
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
              <span className="settings-label">AI 학습 코치</span>
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
                        const res = await fetch(`${apiBase}/api/student/request-parent`, {
                          method: "POST",
                          headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${authToken}`
                          },
                          body: JSON.stringify({ parentEmail })
                        });
                        if (!res.ok) return;
                        setStudentParentEmail("");
                        const lr = await fetch(`${apiBase}/api/student/link-requests`, {
                          headers: {
                            Authorization: `Bearer ${authToken}`
                          }
                        });
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
                  <div
                    className="settings-item"
                    style={{ cursor: "default", flexDirection: "column", alignItems: "stretch" }}
                  >
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
                    <span className="settings-label">학부모 연결 요청</span>
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
                                `${apiBase}/api/student/link-confirm`,
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
                              const lr = await fetch(`${apiBase}/api/student/link-requests`, {
                                headers: {
                                  Authorization: `Bearer ${authToken}`
                                }
                              });
                              if (lr.ok) {
                                const d = await lr.json();
                                setStudentWaitingOnParent(d.waitingOnParent || []);
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
                              await fetch(`${apiBase}/api/link/reject`, {
                                method: "POST",
                                headers: {
                                  "Content-Type": "application/json",
                                  Authorization: `Bearer ${authToken}`
                                },
                                body: JSON.stringify({ requestId: row.id })
                              });
                              const lr = await fetch(`${apiBase}/api/student/link-requests`, {
                                headers: {
                                  Authorization: `Bearer ${authToken}`
                                }
                              });
                              if (lr.ok) {
                                const d = await lr.json();
                                setStudentWaitingOnParent(d.waitingOnParent || []);
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
    </>
  );
}
