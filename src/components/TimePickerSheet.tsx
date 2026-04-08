import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useModalReveal } from "../lib/useModalReveal";

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);
const SCROLL_SELECT_DELAY_MS = 90;

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

function selectClosestScrollOption(
  container: HTMLDivElement | null,
  currentValue: number,
  dataKey: "hour" | "minute",
  onChange: (value: number) => void,
  hapticSelection?: () => void
) {
  if (!container) return;
  const options = Array.from(
    container.querySelectorAll<HTMLButtonElement>(`.time-picker-option[data-${dataKey}]`)
  );
  if (options.length === 0) return;

  const containerRect = container.getBoundingClientRect();
  const containerCenter = containerRect.top + containerRect.height / 2;
  let closestValue = currentValue;
  let minDistance = Number.POSITIVE_INFINITY;

  for (const option of options) {
    const raw = option.dataset[dataKey];
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    const rect = option.getBoundingClientRect();
    const center = rect.top + rect.height / 2;
    const distance = Math.abs(center - containerCenter);
    if (distance < minDistance) {
      minDistance = distance;
      closestValue = value;
    }
  }

  if (closestValue !== currentValue) {
    hapticSelection?.();
    onChange(closestValue);
  }
}

function centerOptionInScroll(
  container: HTMLDivElement | null,
  optionSelector: string
) {
  if (!container) return;
  const option = container.querySelector<HTMLElement>(optionSelector);
  if (!option) return;
  const targetTop =
    option.offsetTop - container.clientHeight / 2 + option.offsetHeight / 2;
  container.scrollTop = Math.max(0, targetTop);
}

function TimePickerColumns(props: ColumnsProps) {
  const { hour, minute, onHourChange, onMinuteChange, hapticSelection } =
    props;
  const hourScrollRef = useRef<HTMLDivElement>(null);
  const minuteScrollRef = useRef<HTMLDivElement>(null);
  const hourScrollTimerRef = useRef<number | null>(null);
  const minuteScrollTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => {
      centerOptionInScroll(hourScrollRef.current, `[data-hour="${hour}"]`);
      centerOptionInScroll(minuteScrollRef.current, `[data-minute="${minute}"]`);
    }, 0);
    return () => window.clearTimeout(t);
  }, [hour, minute]);

  useEffect(
    () => () => {
      if (hourScrollTimerRef.current != null) {
        window.clearTimeout(hourScrollTimerRef.current);
      }
      if (minuteScrollTimerRef.current != null) {
        window.clearTimeout(minuteScrollTimerRef.current);
      }
    },
    []
  );

  const queueHourSelection = () => {
    if (hourScrollTimerRef.current != null) {
      window.clearTimeout(hourScrollTimerRef.current);
    }
    hourScrollTimerRef.current = window.setTimeout(() => {
      selectClosestScrollOption(
        hourScrollRef.current,
        hour,
        "hour",
        onHourChange,
        hapticSelection
      );
    }, SCROLL_SELECT_DELAY_MS);
  };

  const queueMinuteSelection = () => {
    if (minuteScrollTimerRef.current != null) {
      window.clearTimeout(minuteScrollTimerRef.current);
    }
    minuteScrollTimerRef.current = window.setTimeout(() => {
      selectClosestScrollOption(
        minuteScrollRef.current,
        minute,
        "minute",
        onMinuteChange,
        hapticSelection
      );
    }, SCROLL_SELECT_DELAY_MS);
  };

  const preview = formatKoreanTimePreview(hour, minute);

  return (
    <div className="time-picker-scroll">
      <div className="time-picker-preview" aria-live="polite">
        {preview}
      </div>
      <div className="time-picker-columns">
        <div className="time-picker-col">
          <div
            className="time-picker-col-scroll"
            ref={hourScrollRef}
            onScroll={queueHourSelection}
          >
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
                  if (hour === h) return;
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
          <div
            className="time-picker-col-scroll"
            ref={minuteScrollRef}
            onScroll={queueMinuteSelection}
          >
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
                  if (minute === mn) return;
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

  return createPortal(
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
    </div>,
    document.body
  );
}
