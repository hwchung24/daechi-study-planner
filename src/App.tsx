import React, { useState } from "react";

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

const App: React.FC = () => {
  const [blocks, setBlocks] = useState<StudyBlock[]>([
    { id: 1, subject: "수학", start: "07:00", end: "09:00", done: false },
    { id: 2, subject: "영어", start: "09:30", end: "11:00", done: false },
    { id: 3, subject: "국어", start: "20:00", end: "22:00", done: false }
  ]);

  const [subjectInput, setSubjectInput] = useState("");
  const [startInput, setStartInput] = useState("18:00");
  const [endInput, setEndInput] = useState("19:00");

  const toggleDone = (id: number) => {
    setBlocks(prev =>
      prev.map(b => (b.id === id ? { ...b, done: !b.done } : b))
    );
  };

  const handleAdd = () => {
    if (!subjectInput.trim()) return;
    setBlocks(prev => [
      ...prev,
      {
        id: Date.now(),
        subject: subjectInput.trim(),
        start: startInput,
        end: endInput,
        done: false
      }
    ]);
    setSubjectInput("");
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
              <span className="header-sub">오늘 플랜</span>
              <h1 className="header-title">Daechi Planner</h1>
            </div>
            <button className="profile-chip" aria-label="오늘 목표">
              <span className="profile-avatar">D</span>
              <span className="profile-label">목표 100%</span>
            </button>
          </div>

          <div className="header-date-row">
            <span className="today-label">{getTodayLabel()}</span>
            <span className="today-badge">수험생 모드</span>
          </div>

          <div className="progress-card">
            <div className="progress-row">
              <span className="progress-label">오늘 학습 달성도</span>
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
                {blocks.filter(b => b.done).length}개 완료 · {blocks.length}개
                계획
              </span>
              <span className="progress-meta-strong">밤 11시 전 마무리!</span>
            </div>
          </div>
        </header>

        <main className="app-main" aria-label="오늘 학습 계획">
          <section className="section">
            <div className="section-header">
              <h2 className="section-title">타임라인</h2>
              <span className="section-caption">시간대별 학습 블록</span>
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
                    <span className="time-sub">집중 {block.subject}</span>
                  </div>
                  <div className="subject-col">
                    <span className="subject-pill">{block.subject}</span>
                    <span className="subject-tag">
                      {block.done ? "완료" : "진행 예정"}
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
                <p className="empty-state">아직 오늘 플랜이 없어요. 아래에서 추가해 보세요.</p>
              )}
            </div>
          </section>

          <section className="section section-sticky">
            <div className="section-header">
              <h2 className="section-title">블록 추가</h2>
              <span className="section-caption">과목, 시간 빠르게 설정</span>
            </div>

            <div className="add-card">
              <div className="add-row">
                <div className="field">
                  <label className="field-label">과목</label>
                  <input
                    className="field-input"
                    placeholder="예: 수학 N제, 영어 문법"
                    value={subjectInput}
                    onChange={e => setSubjectInput(e.target.value)}
                  />
                </div>
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
              <button
                type="button"
                className="primary-button"
                onClick={handleAdd}
                disabled={!subjectInput.trim()}
              >
                오늘 플랜에 추가
              </button>
            </div>
          </section>
        </main>

        <nav className="bottom-nav" aria-label="하단 내비게이션">
          <button className="nav-item nav-item-active">
            <span className="nav-icon">●</span>
            <span className="nav-label">오늘</span>
          </button>
          <button className="nav-item">
            <span className="nav-icon">▦</span>
            <span className="nav-label">주간</span>
          </button>
          <button className="nav-item">
            <span className="nav-icon">☻</span>
            <span className="nav-label">마이</span>
          </button>
        </nav>
      </div>
    </div>
  );
};

export default App;

