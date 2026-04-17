import React, { useState } from "react";

const DAYS = ["월", "화", "수", "목", "금", "토", "일"];
const SLOTS_PER_HOUR = 2;
const TOTAL_SLOTS = 24 * SLOTS_PER_HOUR;
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const SLOT_LABELS = Array.from({ length: TOTAL_SLOTS }, (_, i) => {
  const hour = Math.floor(i / SLOTS_PER_HOUR);
  const min = (i % SLOTS_PER_HOUR) * 30;
  return { hour, min, label: min === 0 ? `${hour}:00` : "" };
});
const DEFAULT_START_SLOT = 12; // 06:00
const DEFAULT_END_SLOT = 48;   // 24:00
const MODES = [
  { key: "utility", label: "유틸리티 모드", color: "#ffcc00" },
  { key: "free", label: "자유시간 모드", color: "#ff3b30" },
  { key: "delete", label: "삭제", color: "#bbb" }
];

// 각 셀: { mode: string | null }
function createEmptyGrid() {
  return DAYS.map(() => Array(TOTAL_SLOTS).fill(null));
}

export default function ModeScheduleGrid() {
  const [selectedMode, setSelectedMode] = useState(MODES[0].key);
  const [grid, setGrid] = useState(createEmptyGrid());
  const [dragging, setDragging] = useState(false);
  const [showNight, setShowNight] = useState(false);


  const handleCellMouseDown = (dayIdx: number, slotIdx: number) => {
    setDragging(true);
    setGrid(prev => {
      const next = prev.map(row => [...row]);
      next[dayIdx][slotIdx] = selectedMode === "delete" ? null : selectedMode;
      return next;
    });
  };

  const handleCellMouseEnter = (dayIdx: number, slotIdx: number) => {
    if (!dragging) return;
    setGrid(prev => {
      const next = prev.map(row => [...row]);
      next[dayIdx][slotIdx] = selectedMode === "delete" ? null : selectedMode;
      return next;
    });
  };

  const handleMouseUp = () => setDragging(false);

  React.useEffect(() => {
    window.addEventListener("mouseup", handleMouseUp);
    return () => window.removeEventListener("mouseup", handleMouseUp);
  }, []);

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {MODES.map(mode => (
          <button
            key={mode.key}
            style={{
              background: selectedMode === mode.key ? mode.color : "#eee",
              color: selectedMode === mode.key ? "#fff" : "#333",
              border: mode.key === "delete" ? "1px solid #888" : "none",
              borderRadius: 6,
              padding: "6px 16px",
              fontWeight: 600,
              cursor: "pointer"
            }}
            onClick={() => setSelectedMode(mode.key)}
          >
            {mode.label}
          </button>
        ))}
      </div>
      <div style={{ marginBottom: 8 }}>
        <button
          type="button"
          style={{
            background: showNight ? "#eee" : "#234",
            color: showNight ? "#234" : "#fff",
            border: "none",
            borderRadius: 6,
            padding: "4px 16px",
            fontWeight: 600,
            cursor: "pointer"
          }}
          onClick={() => setShowNight(v => !v)}
        >
          {showNight ? "야간(00:00~05:30) 접기" : "야간(00:00~05:30) 펼치기"}
        </button>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", minWidth: 700 }}>
          <thead>
            <tr>
              <th style={{ width: 40 }}></th>
              {DAYS.map(day => (
                <th key={day} style={{ padding: 4, fontWeight: 600 }}>{day}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(showNight ? SLOT_LABELS : SLOT_LABELS.slice(DEFAULT_START_SLOT, DEFAULT_END_SLOT)).map((slot, slotIdx) => {
              // 실제 slotIdx는 전체 grid 기준이어야 함
              const realIdx = showNight ? slotIdx : slotIdx + DEFAULT_START_SLOT;
              return (
                <tr key={realIdx}>
                  <td style={{ textAlign: "right", padding: 2, fontSize: 12, color: "#888" }}>{slot.label}</td>
                  {DAYS.map((_, dayIdx) => {
                    const modeKey = grid[dayIdx][realIdx];
                    const mode = MODES.find(m => m.key === modeKey);
                    return (
                      <td
                        key={dayIdx}
                        style={{
                          width: 32,
                          height: 20,
                          background: mode ? mode.color : "#f4f4f4",
                          cursor: "pointer",
                          border: "1px solid #e0e0e0",
                          transition: "background 0.1s"
                        }}
                        onMouseDown={() => handleCellMouseDown(dayIdx, realIdx)}
                        onMouseEnter={() => handleCellMouseEnter(dayIdx, realIdx)}
                        title={mode ? mode.label : ""}
                      >
                        {mode ? "" : null}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
