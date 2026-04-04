import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { TimePickerSheet } from "../TimePickerSheet";
import { GradientHeroCard } from "../../coach/ui/components";
import {
  getDateKey,
  getWeekDaysIncludingTomorrow,
  getWeekTitle
} from "../../lib/weekDates";
import type { StudentLockStatus } from "../../types/lockStatus";
import type {
  ProgressBook,
  ProgressPlan,
  StudyBlock
} from "../../types/planner";

export type TabKey = "today" | "week" | "store" | "settings";

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

const storeAppIcons: Record<string, string> = {
  "youtube-learning": "/icons/youtube-learning.svg",
  "khan-academy": "/icons/khan-academy.svg",
  quizlet: "/icons/quizlet.svg",
  notion: "/icons/notion.svg",
  "google-drive": "/icons/google-drive.svg"
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
  timelineSyncError: string;
  onDismissTimelineSyncError: () => void;
  progressWeekOffset: number;
  setProgressWeekOffset: React.Dispatch<React.SetStateAction<number>>;
  progressBooks: ProgressBook[];
  removeProgressBook: (bookId: number) => Promise<void>;
  tomorrowPlan: ProgressPlan;
  setTomorrowPlan: React.Dispatch<React.SetStateAction<ProgressPlan>>;
  saveTomorrowPlan: () => Promise<void>;
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
  handleWithdrawAccount: () => void;
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
    timelineSyncError,
    onDismissTimelineSyncError,
    progressWeekOffset,
    setProgressWeekOffset,
    progressBooks,
    removeProgressBook,
    tomorrowPlan,
    setTomorrowPlan,
    saveTomorrowPlan,
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
    handleLogout,
    handleWithdrawAccount
  } = props;
  const [todaySleepHours, setTodaySleepHours] = useState("");
  const [todayStress, setTodayStress] = useState("3");
  const [todayConcentration, setTodayConcentration] = useState("3");
  const [todayMemo, setTodayMemo] = useState("");
  const [todayLogSaving, setTodayLogSaving] = useState(false);
  const [todayLogMessage, setTodayLogMessage] = useState("");
  const [todayDdayLabel, setTodayDdayLabel] = useState("디데이");
  const [ddayEditOpen, setDdayEditOpen] = useState(false);
  const [ddayEditTitle, setDdayEditTitle] = useState("");
  const [ddayEditDate, setDdayEditDate] = useState("");
  const weekDayScrollRef = useRef<HTMLDivElement | null>(null);
  const [tomorrowPlanSaving, setTomorrowPlanSaving] = useState(false);
  const [timePicker, setTimePicker] = useState<{
    bookId: number;
    field: "start" | "end";
  } | null>(null);
  const [storeDetailApp, setStoreDetailApp] = useState<StudyStoreApp | null>(
    null
  );

  useEffect(() => {
    if (tab !== "store") {
      setStoreDetailApp(null);
      setStoreCategoryFilter(null);
    }
  }, [tab]);

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
    if (tab !== "week") return;
    const scrollToTodayOrStart = () => {
      const el = weekDayScrollRef.current;
      if (!el) return;
      const days = getWeekDaysIncludingTomorrow(progressWeekOffset);
      const todayKey = getDateKey(0);
      const todayIdx = days.findIndex(d => d.key === todayKey);
      const scrollToIdx =
        progressWeekOffset === 0 && todayIdx >= 0 ? todayIdx : 0;
      const cards = el.querySelectorAll<HTMLElement>("[data-weekday-card]");
      const target = cards[scrollToIdx];
      target?.scrollIntoView({ behavior: "auto", inline: "center", block: "nearest" });
    };
    scrollToTodayOrStart();
    const t0 = window.setTimeout(scrollToTodayOrStart, 0);
    const t1 = window.setTimeout(scrollToTodayOrStart, 120);
    return () => {
      window.clearTimeout(t0);
      window.clearTimeout(t1);
    };
  }, [tab, progressWeekOffset]);

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
      {studentLockStatus?.locked && tab !== "today" && (
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
          <div className="today-study-layout">
            {studentLockStatus?.locked && (
              <section className="section">
                <div className="progress-card" style={{ marginTop: 0 }}>
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
                    <div className="progress-card today-summary-card">
                      <div className="today-summary-row">
                        <button
                          type="button"
                          className="today-dday-label"
                          onClick={() => setDdayEditOpen(true)}
                        >
                          {todayDdayLabel}
                        </button>
                        <span className="today-date-label">{getTodayTitle()}</span>
                      </div>
                      <div className="today-progress-bar-row">
                        <div className="progress-bar-track">
                          <div
                            className="progress-bar-fill"
                            style={{ width: `${todayProgress}%` }}
                          />
                        </div>
                        <span className="today-progress-text">{todayProgress}%</span>
                      </div>
                    </div>

                    <div className="progress-card timeline-card-with-action">
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
                              {block.plannedRange ? (
                                <span className="time-plan-range">
                                  {block.plannedRange}
                                </span>
                              ) : null}
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
                      </div>
                      <button
                        type="button"
                        className="timeline-add-button"
                        onClick={() => {
                          hapticSelection();
                          onOpenAddPlan();
                        }}
                        aria-label="계획 추가하기"
                      >
                        <span className="timeline-add-button__icon">＋</span>
                      </button>
                    </div>

                    <GradientHeroCard
                      eyebrow="오늘의 핵심"
                      title="오늘의 핵심"
                      body={
                        todayProgress === 0
                          ? "오늘 타임라인을 채우고 첫 계획을 시작해보세요."
                          : `오늘 계획의 ${todayProgress}%를 채웠어요. 마무리까지 한 번 달려볼까요?`
                      }
                      showHeader={false}
                    />
                  </div>

                  <div className="progress-card today-log-card">
                    <div className="today-log-card__header">
                      <span className="progress-value">오늘 기록</span>
                    </div>
                    <div className="today-log-card__body today-log-card__body--open">
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
                        <div
                          style={{ display: "flex", alignItems: "center", gap: 10 }}
                        >
                          <input
                            type="range"
                            min={1}
                            max={5}
                            step={1}
                            value={todayStress}
                            onChange={e => setTodayStress(e.target.value)}
                            style={{ flex: 1 }}
                          />
                          <span
                            className="settings-value"
                            style={{ minWidth: 24, textAlign: "right" }}
                          >
                            {todayStress}
                          </span>
                        </div>
                      </div>
                      <div className="field" style={{ marginTop: 10 }}>
                        <label className="field-label">집중도</label>
                        <div
                          style={{ display: "flex", alignItems: "center", gap: 10 }}
                        >
                          <input
                            type="range"
                            min={1}
                            max={5}
                            step={1}
                            value={todayConcentration}
                            onChange={e => setTodayConcentration(e.target.value)}
                            style={{ flex: 1 }}
                          />
                          <span
                            className="settings-value"
                            style={{ minWidth: 24, textAlign: "right" }}
                          >
                            {todayConcentration}
                          </span>
                        </div>
                      </div>
                      <div className="field today-log-memo-field">
                        <label className="field-label">회고 메모</label>
                        <textarea
                          className="field-input"
                          value={todayMemo}
                          onChange={e => setTodayMemo(e.target.value)}
                          rows={4}
                          style={{ resize: "vertical" }}
                        />
                      </div>
                      <div className="today-log-card__footer">
                        <button
                          type="button"
                          className="timeline-save-button"
                          disabled={todayLogSaving}
                          onClick={handleSaveTodayLog}
                        >
                          {todayLogSaving ? "저장 중..." : "오늘 기록 저장"}
                        </button>
                        {todayLogMessage && (
                          <p className="settings-hint" style={{ marginTop: 8 }}>
                            {todayLogMessage}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </div>

          <div
            className={"dday-modal" + (ddayEditOpen ? " dday-modal--open" : "")}
            onClick={() => setDdayEditOpen(false)}
          >
            <div className="dday-modal-inner" onClick={e => e.stopPropagation()}>
              <div className="dday-modal-header">
                <span className="dday-modal-title">디데이 설정</span>
              </div>
              <div className="dday-modal-body">
                <div className="field">
                  <label className="field-label">제목 (선택)</label>
                  <input
                    className="field-input"
                    value={ddayEditTitle}
                    onChange={e => setDdayEditTitle(e.target.value)}
                    placeholder="예: 중간고사"
                  />
                </div>
                <div className="field" style={{ marginTop: 10 }}>
                  <label className="field-label">날짜</label>
                  <input
                    type="date"
                    className="field-input"
                    value={ddayEditDate}
                    onChange={e => setDdayEditDate(e.target.value)}
                  />
                </div>
              </div>
              <div className="dday-modal-footer">
                <button
                  type="button"
                  className="modal-secondary"
                  onClick={() => setDdayEditOpen(false)}
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
                    setDdayEditOpen(false);
                  }}
                  disabled={!ddayEditDate}
                >
                  저장
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {tab === "week" && (
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
                  ‹
                </button>
                <div className="week-switch-center">
                  <span className="week-switch-label">
                    {getWeekTitle(progressWeekOffset)}
                  </span>
                </div>
                <button
                  type="button"
                  className="week-switch-btn week-switch-next"
                  onClick={() => setProgressWeekOffset(prev => prev - 1)}
                  aria-label="다음 주"
                >
                  ›
                </button>
              </div>
            </div>
            <div className="week-frame">
              <div className="progress-cards-scroll" ref={weekDayScrollRef}>
                <div className="progress-cards-container">
                  {getWeekDaysIncludingTomorrow(progressWeekOffset).map(day => {
                    const todayKey = getDateKey(0);
                    const tomorrowKey = getDateKey(1);
                    const isTodayCard = day.key === todayKey;
                    const isTomorrowCard = day.key === tomorrowKey;
                    return (
                      <div
                        key={day.key}
                        data-weekday-card
                        className={
                          "progress-day-card" +
                          (isTodayCard ? " progress-day-card--today" : "")
                        }
                      >
                        <div className="progress-day-card-header">{day.label}</div>
                        <div className="progress-day-card-body">
                          {progressBooks.map(book =>
                            isTomorrowCard ? (
                              <div
                                key={book.id}
                                className="progress-day-book progress-day-book--editable"
                              >
                                <div className="progress-day-book-name">{book.name}</div>
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
                            ) : (
                              <div key={book.id} className="progress-day-book">
                                <div className="progress-day-book-name">{book.name}</div>
                                <div className="progress-day-book-plan">
                                  {isTodayCard ? "오늘 계획: " : "계획: "}
                                  {isTodayCard
                                    ? (() => {
                                        const ranges = blocks
                                          .filter(b => b.subject === book.name)
                                          .map(b => `${b.start}~${b.end}`);
                                        return ranges.length > 0 ? ranges.join(", ") : "미설정";
                                      })()
                                    : "미설정"}
                                </div>
                              </div>
                            )
                          )}
                          {isTomorrowCard && progressBooks.length > 0 && (
                            <button
                              type="button"
                              className="progress-footer-btn week-tomorrow-save"
                              disabled={tomorrowPlanSaving}
                              onClick={async () => {
                                setTomorrowPlanSaving(true);
                                try {
                                  await saveTomorrowPlan();
                                  hapticSuccess();
                                } finally {
                                  setTomorrowPlanSaving(false);
                                }
                              }}
                            >
                              {tomorrowPlanSaving ? "저장 중…" : "내일 계획 저장"}
                            </button>
                          )}
                          {isTomorrowCard && progressBooks.length === 0 && (
                            <p className="week-hint">책 관리에서 책을 먼저 추가해 주세요.</p>
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
        </>
      )}

      {tab === "store" && (
        <section className="section store-section">
          {storeError && <p className="empty-state">{storeError}</p>}
          {storeLoading && <p className="empty-state">앱 목록을 불러오는 중…</p>}
          {!storeLoading && storeApps.length > 0 && (
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
          {!storeLoading && (
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
                            setStoreApps(prev =>
                              prev.map(item =>
                                item.id === app.id
                                  ? (data as { app?: StudyStoreApp }).app ||
                                    item
                                  : item
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
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
          {!storeLoading &&
            storeApps.length === 0 &&
            !storeError && (
              <p className="empty-state">아직 등록된 앱이 없어요.</p>
            )}
          {!storeLoading &&
            storeApps.length > 0 &&
            displayedStoreApps.length === 0 &&
            !storeError && (
              <p className="empty-state">이 종류의 앱이 없어요.</p>
            )}

          {storeDetailApp ? (
            <div
              className="dday-modal dday-modal--open"
              onClick={() => setStoreDetailApp(null)}
            >
              <div
                className="dday-modal-inner"
                onClick={e => e.stopPropagation()}
              >
                <div className="dday-modal-header">
                  <span className="dday-modal-title">{storeDetailApp.name}</span>
                </div>
                <div className="dday-modal-body">
                  {storeDetailApp.category ? (
                    <p className="store-detail-category">{storeDetailApp.category}</p>
                  ) : null}
                  <p className="store-detail-description">
                    {String(storeDetailApp.description ?? "").trim() ||
                      "등록된 설명이 없습니다."}
                  </p>
                </div>
                <div className="dday-modal-footer">
                  <button
                    type="button"
                    className="modal-primary"
                    onClick={() => setStoreDetailApp(null)}
                  >
                    닫기
                  </button>
                </div>
              </div>
            </div>
          ) : null}
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
                handleWithdrawAccount();
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

      {timePicker !== null && (
        <TimePickerSheet
          open
          title={
            timePicker.field === "start" ? "시작 시간" : "종료 시간"
          }
          value={
            tomorrowPlan[timePicker.bookId]?.[timePicker.field] || ""
          }
          onClose={() => setTimePicker(null)}
          onConfirm={hhmm => {
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
            setTimePicker(null);
            hapticSuccess();
          }}
          hapticSelection={hapticSelection}
        />
      )}
    </>
  );
}
