import React, { useEffect, useMemo, useRef, useState } from "react";
import { getDateKeySeoul } from "../lib/weekDates";

const SCROLL_SELECT_DELAY_MS = 90;

function parseYmd(
  s: string
): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || "").trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d))
    return null;
  return { y, m: mo, d };
}

function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

function clampDay(y: number, m: number, d: number): number {
  const max = daysInMonth(y, m);
  return Math.min(Math.max(1, d), max);
}

function formatYmd(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function defaultYmd(): { y: number; m: number; d: number } {
  const key = getDateKeySeoul(0);
  const p = parseYmd(key);
  if (p) return p;
  const t = new Date();
  return { y: t.getFullYear(), m: t.getMonth() + 1, d: t.getDate() };
}

type ColumnsProps = {
  year: number;
  month: number;
  day: number;
  years: number[];
  onYearChange: (y: number) => void;
  onMonthChange: (m: number) => void;
  onDayChange: (d: number) => void;
  hapticSelection?: () => void;
};

function selectClosestScrollOption(
  container: HTMLDivElement | null,
  currentValue: number,
  dataKey: "year" | "month" | "day",
  onChange: (value: number) => void,
  hapticSelection?: () => void
) {
  if (!container) return;
  const options = container.querySelectorAll<HTMLButtonElement>(
    `.time-picker-option[data-${dataKey}]`
  );
  const firstOption = options[0];
  if (!firstOption || options.length === 0) return;
  const optionHeight = firstOption.offsetHeight || 1;
  const centerY = container.scrollTop + container.clientHeight / 2;
  const firstCenterY = firstOption.offsetTop + optionHeight / 2;
  const approxIndex = Math.round((centerY - firstCenterY) / optionHeight);
  const safeIndex = Math.max(0, Math.min(options.length - 1, approxIndex));
  const raw = options[safeIndex]?.dataset[dataKey];
  const closestValue = Number(raw);
  if (!Number.isFinite(closestValue)) return;

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

function DatePickerColumns(props: ColumnsProps) {
  const {
    year,
    month,
    day,
    years,
    onYearChange,
    onMonthChange,
    onDayChange,
    hapticSelection
  } = props;
  const yearScrollRef = useRef<HTMLDivElement>(null);
  const monthScrollRef = useRef<HTMLDivElement>(null);
  const dayScrollRef = useRef<HTMLDivElement>(null);
  const yearScrollTimerRef = useRef<number | null>(null);
  const monthScrollTimerRef = useRef<number | null>(null);
  const dayScrollTimerRef = useRef<number | null>(null);

  const maxDay = daysInMonth(year, month);
  const days = Array.from({ length: maxDay }, (_, i) => i + 1);
  const months = Array.from({ length: 12 }, (_, i) => i + 1);

  useEffect(() => {
    const t = window.setTimeout(() => {
      centerOptionInScroll(yearScrollRef.current, `[data-year="${year}"]`);
      centerOptionInScroll(monthScrollRef.current, `[data-month="${month}"]`);
      centerOptionInScroll(dayScrollRef.current, `[data-day="${day}"]`);
    }, 0);
    return () => window.clearTimeout(t);
  }, [year, month, day]);

  useEffect(
    () => () => {
      if (yearScrollTimerRef.current != null) {
        window.clearTimeout(yearScrollTimerRef.current);
      }
      if (monthScrollTimerRef.current != null) {
        window.clearTimeout(monthScrollTimerRef.current);
      }
      if (dayScrollTimerRef.current != null) {
        window.clearTimeout(dayScrollTimerRef.current);
      }
    },
    []
  );

  const queueYearSelection = () => {
    if (yearScrollTimerRef.current != null) {
      window.clearTimeout(yearScrollTimerRef.current);
    }
    yearScrollTimerRef.current = window.setTimeout(() => {
      selectClosestScrollOption(
        yearScrollRef.current,
        year,
        "year",
        onYearChange,
        hapticSelection
      );
    }, SCROLL_SELECT_DELAY_MS);
  };

  const queueMonthSelection = () => {
    if (monthScrollTimerRef.current != null) {
      window.clearTimeout(monthScrollTimerRef.current);
    }
    monthScrollTimerRef.current = window.setTimeout(() => {
      selectClosestScrollOption(
        monthScrollRef.current,
        month,
        "month",
        onMonthChange,
        hapticSelection
      );
    }, SCROLL_SELECT_DELAY_MS);
  };

  const queueDaySelection = () => {
    if (dayScrollTimerRef.current != null) {
      window.clearTimeout(dayScrollTimerRef.current);
    }
    dayScrollTimerRef.current = window.setTimeout(() => {
      selectClosestScrollOption(
        dayScrollRef.current,
        day,
        "day",
        onDayChange,
        hapticSelection
      );
    }, SCROLL_SELECT_DELAY_MS);
  };

  const preview = `${year}년 ${month}월 ${day}일`;

  return (
    <div className="time-picker-scroll">
      <div className="time-picker-preview" aria-live="polite">
        {preview}
      </div>
      <div className="time-picker-columns date-picker-columns">
        <div className="time-picker-col">
          <div
            className="time-picker-col-scroll"
            ref={yearScrollRef}
            onScroll={queueYearSelection}
          >
            {years.map(y => (
              <button
                key={y}
                type="button"
                data-year={y}
                className={
                  "time-picker-option" +
                  (year === y ? " time-picker-option--active" : "")
                }
                onClick={() => {
                  if (year === y) return;
                  hapticSelection?.();
                  onYearChange(y);
                }}
              >
                {y}
              </button>
            ))}
          </div>
        </div>
        <div className="time-picker-col">
          <div
            className="time-picker-col-scroll"
            ref={monthScrollRef}
            onScroll={queueMonthSelection}
          >
            {months.map(mo => (
              <button
                key={mo}
                type="button"
                data-month={mo}
                className={
                  "time-picker-option" +
                  (month === mo ? " time-picker-option--active" : "")
                }
                onClick={() => {
                  if (month === mo) return;
                  hapticSelection?.();
                  onMonthChange(mo);
                }}
              >
                {mo}
              </button>
            ))}
          </div>
        </div>
        <div className="time-picker-col">
          <div
            className="time-picker-col-scroll"
            ref={dayScrollRef}
            onScroll={queueDaySelection}
          >
            {days.map(dn => (
              <button
                key={dn}
                type="button"
                data-day={dn}
                className={
                  "time-picker-option" +
                  (day === dn ? " time-picker-option--active" : "")
                }
                onClick={() => {
                  if (day === dn) return;
                  hapticSelection?.();
                  onDayChange(dn);
                }}
              >
                {dn}
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
  onChange: (ymd: string) => void;
  hapticSelection?: () => void;
};

/** 인라인 날짜 스크롤 — TimePicker와 동일한 시각 패턴 */
export function DatePickerScroll(props: InlineProps) {
  const { value, onChange, hapticSelection } = props;
  const initial = parseYmd(value) ?? defaultYmd();
  const [year, setYear] = useState(initial.y);
  const [month, setMonth] = useState(initial.m);
  const [day, setDay] = useState(initial.d);

  const nowKey = getDateKeySeoul(0);
  const ny = Number(nowKey.slice(0, 4));
  const YEAR_START = ny - 2;
  const YEAR_END = ny + 15;
  const years = useMemo(
    () =>
      Array.from(
        { length: YEAR_END - YEAR_START + 1 },
        (_, i) => YEAR_START + i
      ),
    [YEAR_START, YEAR_END]
  );

  const clampedDay = clampDay(year, month, day);

  useEffect(() => {
    const p = parseYmd(value);
    if (!p) return;
    setYear(p.y);
    setMonth(p.m);
    setDay(clampDay(p.y, p.m, p.d));
  }, [value]);

  const pushChange = (y: number, m: number, d: number) => {
    const dd = clampDay(y, m, d);
    onChange(formatYmd(y, m, dd));
  };

  return (
    <div className="time-picker-inline date-picker-inline">
      <DatePickerColumns
        year={year}
        month={month}
        day={clampedDay}
        years={years}
        onYearChange={y => {
          setYear(y);
          const nd = clampDay(y, month, day);
          setDay(nd);
          pushChange(y, month, nd);
        }}
        onMonthChange={m => {
          setMonth(m);
          const nd = clampDay(year, m, day);
          setDay(nd);
          pushChange(year, m, nd);
        }}
        onDayChange={d => {
          setDay(d);
          pushChange(year, month, d);
        }}
        hapticSelection={hapticSelection}
      />
    </div>
  );
}
