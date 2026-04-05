import React, { useEffect, useRef, useState } from "react";
import { useModalReveal } from "../lib/useModalReveal";

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

/** 상단 미리보기용 (저장 값은 formatHHmm 유지) */
function formatKoreanTimePreview(h: number, m: number): string {
  const minutePart = m > 0 ? ` ${m}분` : "";
  if (h === 0) {
    return `오전 12시${minutePart}`;
  }
  if (h < 12) {
    return `오전 ${h}시${minutePart}`;
  }
  if (h === 12) {
    return `오후 12시${minutePart}`;
  }
  return `오후 ${h - 12}시${minutePart}`;
}

type ColumnsProps = {
  hour: number;
  minute: number;
  onHourChange: (h: number) => void;
  onMinuteChange: (m: number) => void;
  hapticSelection?: () => void;
};

function TimePickerColumns(props: ColumnsProps) {
  const { hour, minute, onHourChange, onMinuteChange, hapticSelection } =
    props;
  const hourScrollRef = useRef<HTMLDivElement>(null);
  const minuteScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = window.setTimeout(() => {
      hourScrollRef.current
        ?.querySelector(`[data-hour="${hour}"]`)
        ?.scrollIntoView({ block: "center", behavior: "auto" });
      minuteScrollRef.current
        ?.querySelector(`[data-minute="${minute}"]`)
        ?.scrollIntoView({ block: "center", behavior: "auto" });
    }, 0);
    return () => window.clearTimeout(t);
  }, [hour, minute]);

  const preview = formatKoreanTimePreview(hour, minute);

  return (
    <div className="time-picker-scroll">
      <div className="time-picker-preview" aria-live="polite">
        {preview}
      </div>
      <div className="time-picker-columns">
        <div className="time-picker-col">
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
                  onHourChange(h);
                }}
              >
                {String(h).padStart(2, "0")}
              </button>
            ))}
          </div>
        </div>
        <div className="time-picker-col">
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
                  onMinuteChange(mn);
                }}
              >
                {String(mn).padStart(2, "0")}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

type InlineProps = {
  value: string;
  onChange: (hhmm: string) => void;
  hapticSelection?: () => void;
};

/** 모달 안에 넣는 인라인 시간 스크롤 */
export function TimePickerInline(props: InlineProps) {
  const { value, onChange, hapticSelection } = props;
  const initial = parseTimeHHmm(value || "09:00");
  const [hour, setHour] = useState(initial.h);
  const [minute, setMinute] = useState(initial.m);

  useEffect(() => {
    const { h, m } = parseTimeHHmm(value || "09:00");
    setHour(h);
    setMinute(m);
  }, [value]);

  return (
    <div className="time-picker-inline">
      <TimePickerColumns
        hour={hour}
        minute={minute}
        onHourChange={nh => {
          setHour(nh);
          setMinute(m => {
            onChange(formatHHmm(nh, m));
            return m;
          });
        }}
        onMinuteChange={nm => {
          setMinute(nm);
          setHour(h => {
            onChange(formatHHmm(h, nm));
            return h;
          });
        }}
        hapticSelection={hapticSelection}
      />
    </div>
  );
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
  const modalReveal = useModalReveal(open);

  useEffect(() => {
    if (!open) return;
    const { h, m } = parseTimeHHmm(value || "09:00");
    setHour(h);
    setMinute(m);
  }, [open, value]);

  if (!open) return null;

  const closeModal = () => modalReveal.beginClose(onClose);

  return (
    <div
      className={
        "dday-modal time-picker-modal" +
        (modalReveal.revealed ? " dday-modal--open" : "")
      }
      onClick={closeModal}
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
          <TimePickerColumns
            hour={hour}
            minute={minute}
            onHourChange={setHour}
            onMinuteChange={setMinute}
            hapticSelection={hapticSelection}
          />
        </div>
        <div className="dday-modal-footer">
          <button
            type="button"
            className="modal-secondary"
            onClick={closeModal}
          >
            취소
          </button>
          <button
            type="button"
            className="modal-primary"
            onClick={() => {
              modalReveal.beginClose(() => onConfirm(formatHHmm(hour, minute)));
            }}
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );
}
