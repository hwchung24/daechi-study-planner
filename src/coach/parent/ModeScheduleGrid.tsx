import React, { useEffect, useState } from "react";

const DAYS = ["월", "화", "수", "목", "금", "토", "일"];
const SLOTS_PER_HOUR = 2;
const TOTAL_SLOTS = 24 * SLOTS_PER_HOUR;
const SLOT_LABELS = Array.from({ length: TOTAL_SLOTS }, (_, i) => {
  const hour = Math.floor(i / SLOTS_PER_HOUR);
  const min = (i % SLOTS_PER_HOUR) * 30;
  return { hour, min, label: min === 0 ? `${hour}:00` : "" };
});
const DEFAULT_START_SLOT = 12; // 06:00
const DEFAULT_END_SLOT = 48; // 24:00
const MODES = [
  { key: "utility", label: "유틸리티 모드", color: "#ffcc00" },
  { key: "free", label: "자유시간 모드", color: "#ff3b30" },
  { key: "delete", label: "삭제", color: "#bbb" }
];

function createEmptyGrid() {
  return DAYS.map(() => Array(TOTAL_SLOTS).fill(null));
}

export default function ModeScheduleGrid() {
  const [selectedMode, setSelectedMode] = useState(MODES[0].key);
  const [grid, setGrid] = useState(createEmptyGrid);
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

  useEffect(() => {
    window.addEventListener("mouseup", handleMouseUp);
    return () => window.removeEventListener("mouseup", handleMouseUp);
  }, []);

  return (
    <div className="parent-mode-schedule-grid">
      <div className="parent-mode-schedule-grid__chips" role="toolbar" aria-label="칠하기 모드">
        {MODES.map(mode => {
          const selected = selectedMode === mode.key;
          return (
            <button
              key={mode.key}
              type="button"
              className={
                "parent-mode-schedule-grid__chip" +
                ` parent-mode-schedule-grid__chip--${mode.key}` +
                (selected ? " parent-mode-schedule-grid__chip--selected" : "")
              }
              style={
                selected && mode.key !== "delete"
                  ? ({ "--chip-fill": mode.color } as React.CSSProperties)
                  : undefined
              }
              onClick={() => setSelectedMode(mode.key)}
            >
              {mode.label}
            </button>
          );
        })}
      </div>
      <div className="parent-mode-schedule-grid__night-wrap">
        <button
          type="button"
          className={
            "parent-mode-schedule-grid__night" +
            (showNight ? " parent-mode-schedule-grid__night--active" : "")
          }
          onClick={() => setShowNight(v => !v)}
        >
          {showNight ? "야간(00:00~05:30) 접기" : "야간(00:00~05:30) 펼치기"}
        </button>
      </div>
      <div className="parent-mode-schedule-grid__table-wrap">
        <table className="parent-mode-schedule-grid__table">
          <thead>
            <tr>
              <th className="parent-mode-schedule-grid__th parent-mode-schedule-grid__th--corner" />
              {DAYS.map(day => (
                <th key={day} className="parent-mode-schedule-grid__th">
                  {day}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(showNight ? SLOT_LABELS : SLOT_LABELS.slice(DEFAULT_START_SLOT, DEFAULT_END_SLOT)).map(
              (slot, slotIdx) => {
                const realIdx = showNight ? slotIdx : slotIdx + DEFAULT_START_SLOT;
                return (
                  <tr key={realIdx}>
                    <td className="parent-mode-schedule-grid__time">{slot.label}</td>
                    {DAYS.map((_, dayIdx) => {
                      const modeKey = grid[dayIdx][realIdx];
                      const mode = MODES.find(m => m.key === modeKey);
                      return (
                        <td
                          key={dayIdx}
                          className="parent-mode-schedule-grid__cell"
                          style={
                            mode
                              ? ({
                                  "--cell-fill": mode.color
                                } as React.CSSProperties)
                              : undefined
                          }
                          data-filled={mode ? "true" : undefined}
                          onMouseDown={() => handleCellMouseDown(dayIdx, realIdx)}
                          onMouseEnter={() => handleCellMouseEnter(dayIdx, realIdx)}
                          title={mode ? mode.label : undefined}
                        />
                      );
                    })}
                  </tr>
                );
              }
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
