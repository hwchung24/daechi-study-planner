import React, { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Plus, Trash2 } from "lucide-react";
import { TimePickerInline } from "../../components/TimePickerSheet";

const DAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"] as const;

const MODE_OPTIONS = [
  {
    key: "utility" as const,
    label: "유틸리티",
    color: "#ffcc00",
    defaultDays: [true, true, true, true, true, false, false],
    defaultStart: "09:00",
    defaultEnd: "18:00"
  },
  {
    key: "free" as const,
    label: "자유시간",
    color: "#ff3b30",
    defaultDays: [false, false, false, false, false, true, true],
    defaultStart: "10:00",
    defaultEnd: "22:00"
  },
  {
    key: "block" as const,
    label: "일괄 차단",
    color: "#334155",
    defaultDays: [true, true, true, true, true, true, true],
    defaultStart: "00:00",
    defaultEnd: "01:00"
  }
];

type ModeKey = (typeof MODE_OPTIONS)[number]["key"];

export type ModeScheduleModeKey = ModeKey;

export type ModeScheduleSlot = {
  id: string;
  mode: ModeKey;
  days: boolean[];
  start: string;
  end: string;
};

type ScheduleSlot = ModeScheduleSlot;

function newSlotId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `slot-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function createModeScheduleSlot(mode: ModeKey): ScheduleSlot {
  const def = MODE_OPTIONS.find(m => m.key === mode)!;
  return {
    id: newSlotId(),
    mode,
    days: [...def.defaultDays],
    start: def.defaultStart,
    end: def.defaultEnd
  };
}

function modeMeta(mode: ModeKey) {
  return MODE_OPTIONS.find(m => m.key === mode)!;
}

function summarizeDays(days: boolean[]): string {
  const count = days.filter(Boolean).length;
  if (count === 0) return "요일 미선택";
  if (count === 7) return "매일";

  const onlyWeekday = [0, 1, 2, 3, 4].every(i => days[i]) && ![5, 6].some(i => days[i]);
  if (onlyWeekday) return "평일";

  const onlyWeekend = [5, 6].every(i => days[i]) && ![0, 1, 2, 3, 4].some(i => days[i]);
  if (onlyWeekend) return "주말";

  return DAY_LABELS.filter((_, i) => days[i]).join(", ");
}

export default function ModeScheduleGrid(props: {
  initialSlots?: ModeScheduleSlot[] | null;
  onSlotsChange?: (slots: ModeScheduleSlot[]) => void;
  /** 단일 모드 팝업: 구간 추가 시 이 모드로만 생성, 모드 선택 UI 숨김 */
  fixedMode?: ModeScheduleModeKey;
}) {
  const fixedMode = props.fixedMode;
  const [slots, setSlots] = useState<ScheduleSlot[]>(() =>
    Array.isArray(props.initialSlots) ? props.initialSlots : []
  );
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [modePickerOpen, setModePickerOpen] = useState(false);

  const onSlotsChangeRef = useRef(props.onSlotsChange);
  onSlotsChangeRef.current = props.onSlotsChange;
  useEffect(() => {
    onSlotsChangeRef.current?.(slots);
  }, [slots]);

  useEffect(() => {
    const next = Array.isArray(props.initialSlots) ? props.initialSlots : [];
    setSlots(prev => {
      if (
        prev.length === next.length &&
        prev.every(
          (s, i) =>
            s.id === next[i]?.id &&
            s.mode === next[i]?.mode &&
            s.start === next[i]?.start &&
            s.end === next[i]?.end &&
            s.days.length === next[i]?.days.length &&
            s.days.every((d, j) => d === next[i]?.days[j])
        )
      ) {
        return prev;
      }
      return next;
    });
    setModePickerOpen(false);
  }, [props.initialSlots, fixedMode]);

  const updateSlot = useCallback((slotId: string, patch: Partial<ScheduleSlot>) => {
    setSlots(prev => prev.map(s => (s.id === slotId ? { ...s, ...patch } : s)));
  }, []);

  const toggleDay = useCallback((slotId: string, dayIndex: number) => {
    setSlots(prev =>
      prev.map(s => {
        if (s.id !== slotId) return s;
        const next = [...s.days];
        next[dayIndex] = !next[dayIndex];
        return { ...s, days: next };
      })
    );
  }, []);

  const addSlotWithMode = useCallback((mode: ModeKey) => {
    const slot = createModeScheduleSlot(mode);
    setSlots(prev => [...prev, slot]);
    setExpandedId(slot.id);
    setModePickerOpen(false);
  }, []);

  const removeSlot = useCallback((slotId: string) => {
    setSlots(prev => prev.filter(s => s.id !== slotId));
    setExpandedId(e => (e === slotId ? null : e));
  }, []);

  const toggleExpand = useCallback((slotId: string) => {
    setExpandedId(e => (e === slotId ? null : slotId));
  }, []);

  const openAddFlow = useCallback(() => {
    if (fixedMode) {
      addSlotWithMode(fixedMode);
      return;
    }
    setModePickerOpen(v => !v);
  }, [addSlotWithMode, fixedMode]);

  return (
    <div className="parent-mode-schedule-alarm">
      <div className="parent-mode-schedule-alarm__toolbar">
        <button
          type="button"
          className={
            "parent-mode-schedule-alarm__header-add" +
            (!fixedMode && modePickerOpen ? " parent-mode-schedule-alarm__header-add--active" : "")
          }
          onClick={openAddFlow}
          aria-expanded={fixedMode ? undefined : modePickerOpen}
          aria-label={fixedMode ? "구간 추가" : "구간 추가 — 모드 선택"}
        >
          <Plus size={22} strokeWidth={2.25} aria-hidden />
        </button>
      </div>

      {!fixedMode && modePickerOpen ? (
        <div className="parent-mode-schedule-alarm__mode-picker" role="group" aria-label="모드 선택">
          {MODE_OPTIONS.map(opt => (
            <button
              key={opt.key}
              type="button"
              className="parent-mode-schedule-alarm__mode-choice"
              style={{ "--choice-accent": opt.color } as React.CSSProperties}
              onClick={() => addSlotWithMode(opt.key)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      ) : null}

      {slots.length === 0 && !modePickerOpen ? (
        <div className="parent-mode-schedule-alarm__empty">
          <button type="button" className="parent-mode-schedule-alarm__empty-add" onClick={openAddFlow}>
            <Plus size={18} strokeWidth={2.25} aria-hidden />
            구간 추가
          </button>
        </div>
      ) : null}

      {slots.length > 0 ? (
        <ul className="parent-mode-schedule-alarm__list" role="list" aria-label="허용 구간 목록">
            {slots.map(slot => {
              const open = expandedId === slot.id;
              const meta = modeMeta(slot.mode);
              const summaryDays = summarizeDays(slot.days);
              const timeLine = `${slot.start} – ${slot.end}`;

              return (
                <li
                  key={slot.id}
                  className="parent-mode-schedule-alarm__list-item"
                  style={{ "--mode-accent": meta.color } as React.CSSProperties}
                >
                  <div
                    className={
                      "parent-mode-schedule-alarm__row" + (open ? " parent-mode-schedule-alarm__row--open" : "")
                    }
                  >
                    <button
                      type="button"
                      className="parent-mode-schedule-alarm__row-tap"
                      onClick={() => toggleExpand(slot.id)}
                      aria-expanded={open}
                    >
                      <span className="parent-mode-schedule-alarm__row-text">
                        <span className="parent-mode-schedule-alarm__row-line1">
                          <span className="parent-mode-schedule-alarm__mode-pill">{meta.label}</span>
                          <span className="parent-mode-schedule-alarm__row-time">{timeLine}</span>
                        </span>
                        <span className="parent-mode-schedule-alarm__row-days">{summaryDays}</span>
                      </span>
                      <ChevronDown
                        size={20}
                        className={
                          "parent-mode-schedule-alarm__row-chevron" +
                          (open ? " parent-mode-schedule-alarm__row-chevron--up" : "")
                        }
                        aria-hidden
                      />
                    </button>
                    <button
                      type="button"
                      className="parent-mode-schedule-alarm__row-delete"
                      onClick={e => {
                        e.stopPropagation();
                        removeSlot(slot.id);
                      }}
                      aria-label="이 구간 삭제"
                    >
                      <Trash2 size={18} strokeWidth={2} aria-hidden />
                    </button>
                  </div>

                  {open ? (
                    <div className="parent-mode-schedule-alarm__editor" id={`editor-${slot.id}`}>
                      {!fixedMode ? (
                      <div className="parent-mode-schedule-alarm__editor-modes" role="group" aria-label="모드">
                        {MODE_OPTIONS.map(opt => {
                          const selected = slot.mode === opt.key;
                          return (
                            <button
                              key={opt.key}
                              type="button"
                              className={
                                "parent-mode-schedule-alarm__editor-mode-chip" +
                                (selected ? " parent-mode-schedule-alarm__editor-mode-chip--selected" : "")
                              }
                              style={
                                selected
                                  ? ({ "--mode-accent": opt.color } as React.CSSProperties)
                                  : undefined
                              }
                              onClick={() => updateSlot(slot.id, { mode: opt.key })}
                            >
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>
                      ) : null}

                      <div className="parent-mode-schedule-alarm__days" role="group" aria-label="적용 요일">
                        {DAY_LABELS.map((label, dayIdx) => {
                          const on = slot.days[dayIdx];
                          return (
                            <button
                              key={label}
                              type="button"
                              className={
                                "parent-mode-schedule-alarm__day-chip" +
                                (on ? " parent-mode-schedule-alarm__day-chip--on" : "")
                              }
                              aria-pressed={on}
                              onClick={() => toggleDay(slot.id, dayIdx)}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>

                      <div className="parent-mode-schedule-alarm__times">
                        <div className="parent-mode-schedule-alarm__time-col">
                          <span className="parent-mode-schedule-alarm__time-label">시작</span>
                          <TimePickerInline
                            value={slot.start}
                            onChange={start => updateSlot(slot.id, { start })}
                          />
                        </div>
                        <span className="parent-mode-schedule-alarm__time-connector" aria-hidden>
                          ~
                        </span>
                        <div className="parent-mode-schedule-alarm__time-col">
                          <span className="parent-mode-schedule-alarm__time-label">종료</span>
                          <TimePickerInline
                            value={slot.end}
                            onChange={end => updateSlot(slot.id, { end })}
                          />
                        </div>
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
    </div>
  );
}
