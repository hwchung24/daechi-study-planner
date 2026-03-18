import React, { useEffect, useState } from "react";

type StudyBlock = {
  id: number;
  subject: string;
  start: string;
  end: string;
  done: boolean;
};

const presetSubjects = ["수학", "국어", "영어", "과탐", "사탐", "논술", "자습"];

const getTodayLabel = () => {
  const now = new Date();
  const weekday = ["일", "월", "화", "수", "목", "금", "토"][now.getDay()];
  return `${now.getMonth() + 1}월 ${now.getDate()}일 (${weekday})`;
};

type TabKey = "today" | "week" | "settings";

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

const API_BASE =
  (import.meta as any).env?.VITE_API_BASE || "http://localhost:3000";

const App: React.FC = () => {
  const now = new Date();
  const hour = now.getHours();
  const isSetupWindow = hour >= 21; // 전날 밤 9시 이후는 세팅 시간

  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [showAuth, setShowAuth] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [authRole, setAuthRole] = useState<"student" | "parent">("student");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [blocks, setBlocks] = useState<StudyBlock[]>([]);

  const [tab, setTab] = useState<TabKey>("today");
  const [page, setPage] = useState<"student" | "parent">(() => {
    if (typeof window === "undefined") return "student";
    return window.location.hash === "#/parent" ? "parent" : "student";
  });
  const [meRole, setMeRole] = useState<string | null>(null);
  const [subjectInput, setSubjectInput] = useState("");
  const [startInput, setStartInput] = useState("18:00");
  const [endInput, setEndInput] = useState("19:00");
  const [showAddModal, setShowAddModal] = useState(false);
  const [showRequestModal, setShowRequestModal] = useState(false);
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

  const isLocked = !isSetupWindow && !editUnlocked;

  useEffect(() => {
    try {
      const savedEmail = localStorage.getItem("daechi_planner_user_email");
      const savedToken = localStorage.getItem("daechi_planner_token");
      if (savedEmail && savedToken) {
        setUserEmail(savedEmail);
        setAuthToken(savedToken);
        setShowAuth(false);
      } else {
        setShowAuth(true);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const onHash = () => {
      setPage(window.location.hash === "#/parent" ? "parent" : "student");
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

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
      await fetch(`${API_BASE}/api/blocks`, {
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
      if (!authToken || page !== "parent" || meRole !== "parent") return;
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
  }, [authToken, page, meRole]);

  // 학부모 페이지: 학생별 주간 리포트 로딩
  useEffect(() => {
    const run = async () => {
      if (!authToken || page !== "parent") return;
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
  }, [authToken, page, parentStudentId, parentWeekOffset]);

  const toggleDone = (id: number) => {
    setBlocks(prev => {
      const next = prev.map(b =>
        b.id === id ? { ...b, done: !b.done } : b
      );
      syncBlocksToServer(next);
      return next;
    });
  };

  const handleAdd = () => {
    if (!subjectInput.trim()) return;
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

  return (
    <div className="app-root">
      <div className="app-shell">
        <header className="app-header">
          <div className="status-bar-safe" />
          <div className="header-top">
            <div className="header-title-group">
              <span className="header-sub">{getTodayLabel()}</span>
              <h1 className="header-title">
                {page === "parent" && "학부모 리포트"}
                {page !== "parent" && tab === "today" && "오늘 공부"}
                {page !== "parent" && tab === "week" && "이번 주"}
                {page !== "parent" && tab === "settings" && "설정"}
              </h1>
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

          {page !== "parent" && tab === "today" && (
            <div className="lock-row">
              <span className="lock-badge">자정 락다운 플래너</span>
              <span className="lock-text">
                {isLocked ? "오늘은 수정 불가 · 요청 필요" : "지금은 계획 세팅 시간"}
              </span>
            </div>
          )}

          {page !== "parent" && tab === "today" && (
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
          {page === "parent" && (
            <section className="section">
              <div className="section-header">
                <h2 className="section-title">학부모 리포트</h2>
              </div>

              {meRole === null ? (
                <p className="empty-state">권한을 확인하는 중이에요.</p>
              ) : meRole !== "parent" ? (
                <p className="empty-state">
                  학부모 계정으로 로그인해야 리포트를 볼 수 있어요.
                </p>
              ) : (
                <>
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

                  {parentStudents.length === 0 ? (
                    <div className="settings-list" style={{ marginTop: 14 }}>
                      <div className="field" style={{ marginTop: 6 }}>
                        <label className="field-label">학생 이메일</label>
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
                              `${API_BASE}/api/parent/link-student`,
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
                            // 학생 목록 새로고침
                            const listRes = await fetch(
                              `${API_BASE}/api/parent/students`,
                              {
                                headers: {
                                  Authorization: `Bearer ${authToken}`
                                }
                              }
                            );
                            if (!listRes.ok) return;
                            const listData = await listRes.json();
                            const nextStudents = listData.students || [];
                            setParentStudents(nextStudents);
                            setParentStudentId(
                              nextStudents[0]?.id ? nextStudents[0].id : null
                            );
                          } catch {
                            // ignore
                          }
                        }}
                      >
                        학생 연결하기
                      </button>
                    </div>
                  ) : (
                    <div className="settings-list" style={{ marginTop: 14 }}>
                      <div className="settings-item" style={{ cursor: "default" }}>
                        <span className="settings-label">학생 선택</span>
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
                              집중도 분포(◎/○/△/✕):{" "}
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
                </>
              )}
            </section>
          )}

          {page !== "parent" && tab === "today" && (
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

          {page !== "parent" && tab === "week" && (
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

          {page !== "parent" && tab === "settings" && (
            <section className="section">
              <div className="section-header">
                <h2 className="section-title">프로필</h2>
              </div>
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
                  <span className="settings-label">오늘 플랜 수정 승인 (시뮬레이션)</span>
                  <span className="settings-value">
                    {editUnlocked ? "승인됨" : "대기"}
                  </span>
                </button>
                <button
                  className="settings-item"
                  onClick={() => {
                    window.location.hash = "#/parent";
                  }}
                >
                  <span className="settings-label">학부모 리포트 보기</span>
                  <span className="settings-value">열기</span>
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

        {page !== "parent" && (
          <nav className="bottom-nav" aria-label="하단 내비게이션">
          <button
            className={
              "nav-item" + (tab === "today" ? " nav-item-active" : "")
            }
            onClick={() => setTab("today")}
          >
            <span className="nav-icon">●</span>
            <span className="nav-label">오늘</span>
          </button>
          <button
            className={
              "nav-item" + (tab === "week" ? " nav-item-active" : "")
            }
            onClick={() => setTab("week")}
          >
            <span className="nav-label">주간</span>
          </button>
          <button
            className={
              "nav-item" + (tab === "settings" ? " nav-item-active" : "")
            }
            onClick={() => setTab("settings")}
          >
            <span className="nav-label">프로필</span>
          </button>
          </nav>
        )}

        {page !== "parent" && tab === "today" && (
          <button
            type="button"
            className="floating-add-button"
            onClick={() => {
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
                      setShowAuth(true);
                      return;
                    }
                    try {
                      await fetch(`${API_BASE}/api/plan`, {
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

        {showAuth && (
          <div className="auth-overlay">
            <div className="auth-modal">
              <h2 className="auth-title">
                {authMode === "login" ? "로그인" : "회원가입"}
              </h2>
              <p className="auth-desc">
                계정으로 로그인하면 학습 플랜이 계정별로 안전하게 저장됩니다.
              </p>
              <div className="auth-tabs">
                <button
                  type="button"
                  className={
                    "auth-tab" + (authMode === "login" ? " active" : "")
                  }
                  onClick={() => {
                    setAuthMode("login");
                    setAuthError("");
                  }}
                >
                  로그인
                </button>
                <button
                  type="button"
                  className={
                    "auth-tab" + (authMode === "signup" ? " active" : "")
                  }
                  onClick={() => {
                    setAuthMode("signup");
                    setAuthError("");
                  }}
                >
                  회원가입
                </button>
              </div>
              {authMode === "signup" && (
                <div className="auth-tabs" style={{ marginTop: 10 }}>
                  <button
                    type="button"
                    className={
                      "auth-tab" +
                      (authRole === "student" ? " active" : "")
                    }
                    onClick={() => setAuthRole("student")}
                  >
                    학생
                  </button>
                  <button
                    type="button"
                    className={
                      "auth-tab" +
                      (authRole === "parent" ? " active" : "")
                    }
                    onClick={() => setAuthRole("parent")}
                  >
                    학부모
                  </button>
                </div>
              )}
              <form
                className="auth-form"
                onSubmit={async e => {
                  e.preventDefault();
                  const email = authEmail.trim().toLowerCase();
                  const password = authPassword;
                  if (!email) {
                    setAuthError("이메일을 입력해 주세요.");
                    return;
                  }
                  if (password.length < 4) {
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
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          email,
                          password,
                          role: authMode === "signup" ? authRole : undefined
                        })
                      }
                    );
                    const data = await res.json();
                    if (!res.ok) {
                      setAuthError(data.error || "로그인에 실패했습니다.");
                      return;
                    }
                    const token = data.token as string;
                    setUserEmail(data.email);
                    setAuthToken(token);
                    localStorage.setItem(
                      "daechi_planner_user_email",
                      data.email
                    );
                    localStorage.setItem("daechi_planner_token", token);
                    setShowAuth(false);
                  } catch {
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
                    value={authPassword}
                    onChange={e => setAuthPassword(e.target.value)}
                    placeholder="4자 이상"
                  />
                </div>
                {authError && (
                  <div className="auth-error">{authError}</div>
                )}
                <button type="submit" className="auth-submit">
                  {authMode === "login" ? "로그인" : "회원가입 후 로그인"}
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;

