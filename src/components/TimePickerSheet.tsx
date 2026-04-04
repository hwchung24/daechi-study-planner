import React, { useEffect, useRef, useState } from "react";

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);

function parseTimeHHmm(s: string): { h: number; m: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return { h: 9, m: 0 };
  const h = Math.min(23, Math.max(0, parseInt(m[1], 10)));
  const min = Math.min(59, Math.max(0, parseInt(m[2], 10)));
  return { h, m: min };
}

function formatHHmm(h: number, m: number): string {
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

type Props = {
  open: boolean;
  title: string;
  value: string;
  onClose: () => void;
  onConfirm: (hhmm: string) => void;
  hapticSelection?: () => void;
};

export function TimePickerSheet(props: Props) {
  const {
    open,
    title,
    value,
    onClose,
    onConfirm,
    hapticSelection
  } = props;
  const [hour, setHour] = useState(9);
  const [minute, setMinute] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const hourScrollRef = useRef<HTMLDivElement>(null);
  const minuteScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      setRevealed(false);
      return;
    }
    const { h, m } = parseTimeHHmm(value || "09:00");
    setHour(h);
    setMinute(m);
    setRevealed(false);
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => setRevealed(true));
    });
    return () => cancelAnimationFrame(id);
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      hourScrollRef.current
        ?.querySelector(`[data-hour="${hour}"]`)
        ?.scrollIntoView({ block: "center", behavior: "auto" });
      minuteScrollRef.current
        ?.querySelector(`[data-minute="${minute}"]`)
        ?.scrollIntoView({ block: "center", behavior: "auto" });
    }, 0);
    return () => window.clearTimeout(t);
  }, [open, hour, minute]);

  if (!open) return null;

  const preview = formatHHmm(hour, minute);

  return (
    <div
      className={
        "dday-modal time-picker-modal" +
        (revealed ? " dday-modal--open" : "")
      }
      onClick={onClose}
      role="presentation"
    >
      <div
        className="dday-modal-inner"
        role="dialog"
        aria-modal="true"
        aria-labelledby="time-picker-modal-title"
        onClick={e => e.stopPropagation()}
      >
        <div className="dday-modal-header">
          <span id="time-picker-modal-title" className="dday-modal-title">
            {title}
          </span>
        </div>
        <div className="dday-modal-body time-picker-modal-body">
          <div className="time-picker-preview" aria-live="polite">
            {preview}
          </div>
          <div className="time-picker-columns">
            <div className="time-picker-col">
              <span className="time-picker-col-label">시</span>
              <div className="time-picker-col-scroll" ref={hourScrollRef}>
                {HOURS.map(h => (
                  <button
                    key={h}
                    type="button"
                    data-hour={h}
                    className={
                      "time-picker-option" +
                      (hour === h ? " time-picker-option--active" : "")
                    }
                    onClick={() => {
                      hapticSelection?.();
                      setHour(h);
                    }}
                  >
                    {String(h).padStart(2, "0")}
                  </button>
                ))}
              </div>
            </div>
            <div className="time-picker-col">
              <span className="time-picker-col-label">분</span>
              <div className="time-picker-col-scroll" ref={minuteScrollRef}>
                {MINUTES.map(mn => (
                  <button
                    key={mn}
                    type="button"
                    data-minute={mn}
                    className={
                      "time-picker-option" +
                      (minute === mn ? " time-picker-option--active" : "")
                    }
                    onClick={() => {
                      hapticSelection?.();
                      setMinute(mn);
                    }}
                  >
                    {String(mn).padStart(2, "0")}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="dday-modal-footer">
          <button
            type="button"
            className="modal-secondary"
            onClick={onClose}
          >
            취소
          </button>
          <button
            type="button"
            className="modal-primary"
            onClick={() => onConfirm(formatHHmm(hour, minute))}
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );
}
