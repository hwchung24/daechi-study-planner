import React, { useEffect, useMemo, useRef, useState } from "react";
import { getDateKeySeoul } from "../lib/weekDates";

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

  const maxDay = daysInMonth(year, month);
  const days = Array.from({ length: maxDay }, (_, i) => i + 1);
  const months = Array.from({ length: 12 }, (_, i) => i + 1);

  useEffect(() => {
    const t = window.setTimeout(() => {
      yearScrollRef.current
        ?.querySelector(`[data-year="${year}"]`)
        ?.scrollIntoView({ block: "center", behavior: "auto" });
      monthScrollRef.current
        ?.querySelector(`[data-month="${month}"]`)
        ?.scrollIntoView({ block: "center", behavior: "auto" });
      dayScrollRef.current
        ?.querySelector(`[data-day="${day}"]`)
        ?.scrollIntoView({ block: "center", behavior: "auto" });
    }, 0);
    return () => window.clearTimeout(t);
  }, [year, month, day]);

  const preview = `${year}년 ${month}월 ${day}일`;

  return (
    <div className="time-picker-scroll">
      <div className="time-picker-preview" aria-live="polite">
        {preview}
      </div>
      <div className="time-picker-columns date-picker-columns">
        <div className="time-picker-col">
          <div className="time-picker-col-scroll" ref={yearScrollRef}>
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
          <div className="time-picker-col-scroll" ref={monthScrollRef}>
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
          <div className="time-picker-col-scroll" ref={dayScrollRef}>
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
