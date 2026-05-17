import React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type { ParentGrowthReportPayload } from "../ParentGrowthReportTab";
import { RADAR_DIMENSIONS, type RadarScores } from "../../../lib/parentGrowthReportMetrics";

const WEEK_SHORT = ["월", "화", "수", "목", "금", "토", "일"] as const;

export function SummaryDonut(props: { pct: number; size?: number; grade?: string }) {
  const gradId = React.useId().replace(/:/g, "");
  const size = props.size ?? 120;
  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, props.pct));
  const dash = (p / 100) * c;
  return (
    <div className="pgr-summary-donut" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.15)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#pgrDonut-${gradId})`}
          strokeWidth={stroke}
          strokeDasharray={`${dash} ${c}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <defs>
          <linearGradient id={`pgrDonut-${gradId}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#C9A84C" />
            <stop offset="100%" stopColor="#1E4FD8" />
          </linearGradient>
        </defs>
      </svg>
      <div className="pgr-summary-donut__center">
        <strong>{props.pct}</strong>
        <span>점</span>
        {props.grade ? <em>{props.grade}</em> : null}
      </div>
    </div>
  );
}

export function WeeklyStudyBarChart(props: {
  daily: ParentGrowthReportPayload["daily"];
  goalHoursPerDay: number;
  todayKey?: string;
}) {
  const goalMin = props.goalHoursPerDay * 60;
  const rows = props.daily.map((row, i) => ({
    label: WEEK_SHORT[i] ?? row.weekdayLabel,
    minutes: row.studyMinutesFromLog ?? 0,
    hoursLabel:
      row.studyMinutesFromLog != null && row.studyMinutesFromLog > 0
        ? `${(row.studyMinutesFromLog / 60).toFixed(1)}h`
        : "—",
    isToday: props.todayKey === row.dateKey,
    hasData: row.studyMinutesFromLog != null
  }));

  return (
    <div className="pgr-chart pgr-chart--study-bar">
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={rows} margin={{ top: 24, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
          <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#6B7280" }} />
          <YAxis
            tick={{ fontSize: 11, fill: "#6B7280" }}
            width={32}
            tickFormatter={v => `${Math.round(Number(v) / 60)}h`}
          />
          <Tooltip
            formatter={(v: number) => [`${(Number(v) / 60).toFixed(1)}시간`, "학습"]}
          />
          <ReferenceLine y={goalMin} stroke="#1E4FD8" strokeDasharray="4 4" label="" />
          <Bar dataKey="minutes" radius={[6, 6, 0, 0]} maxBarSize={36}>
            {rows.map((row, idx) => (
              <Cell
                key={idx}
                fill={row.isToday ? "#1E4FD8" : row.hasData ? "#4A7AE8" : "#CBD5E1"}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <p className="pgr-chart-legend">
        <span className="pgr-chart-legend__line pgr-chart-legend__line--goal" />
        일일 목표 {props.goalHoursPerDay.toFixed(1)}h
      </p>
    </div>
  );
}

export function FocusRadarChart(props: { thisWeek: RadarScores; prevWeek: RadarScores }) {
  const data = RADAR_DIMENSIONS.map(dim => ({
    subject: dim,
    thisWeek: props.thisWeek[dim],
    prevWeek: props.prevWeek[dim]
  }));

  return (
    <div className="pgr-chart pgr-chart--radar">
      <ResponsiveContainer width="100%" height={280}>
        <RadarChart data={data} cx="50%" cy="50%" outerRadius="72%">
          <PolarGrid stroke="#E2E8F0" />
          <PolarAngleAxis dataKey="subject" tick={{ fontSize: 11, fill: "#1A1F36" }} />
          <PolarRadiusAxis angle={30} domain={[0, 10]} tick={{ fontSize: 10 }} />
          <Radar
            name="지난 주"
            dataKey="prevWeek"
            stroke="#94A3B8"
            fill="#94A3B8"
            fillOpacity={0.15}
            strokeWidth={2}
          />
          <Radar
            name="이번 주"
            dataKey="thisWeek"
            stroke="#1E4FD8"
            fill="#1E4FD8"
            fillOpacity={0.25}
            strokeWidth={2}
          />
          <Tooltip formatter={(v: number) => [`${Number(v).toFixed(1)} / 10`, ""]} />
        </RadarChart>
      </ResponsiveContainer>
      <div className="pgr-radar-legend">
        <span>
          <i className="pgr-radar-legend__swatch pgr-radar-legend__swatch--this" />
          이번 주
        </span>
        <span>
          <i className="pgr-radar-legend__swatch pgr-radar-legend__swatch--prev" />
          지난 주
        </span>
      </div>
    </div>
  );
}

export function SleepLineChart(props: {
  daily: ParentGrowthReportPayload["daily"];
  sleepGoalHours: number;
}) {
  const rows = props.daily.map((row, i) => ({
    label: WEEK_SHORT[i] ?? row.weekdayLabel,
    hours: row.sleepHours
  }));

  return (
    <div className="pgr-chart pgr-chart--sleep">
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={rows} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
          <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#6B7280" }} />
          <YAxis domain={[0, 12]} tick={{ fontSize: 11, fill: "#6B7280" }} width={28} />
          <Tooltip formatter={(v: number) => [`${Number(v).toFixed(1)}시간`, "수면"]} />
          <ReferenceLine
            y={props.sleepGoalHours}
            stroke="#2E7D5E"
            strokeDasharray="4 4"
          />
          <ReferenceLine y={7} stroke="#2E7D5E" strokeOpacity={0.2} />
          <ReferenceLine y={9} stroke="#2E7D5E" strokeOpacity={0.2} />
          <Line
            type="monotone"
            dataKey="hours"
            stroke="#1E4FD8"
            strokeWidth={2.5}
            dot={{ r: 4, fill: "#1E4FD8" }}
            connectNulls={false}
          />
        </LineChart>
      </ResponsiveContainer>
      <p className="pgr-chart-legend">
        <span className="pgr-chart-legend__band" />
        권장 수면 7~9시간 · 목표 {props.sleepGoalHours}h
      </p>
    </div>
  );
}

const STRESS_COLORS: Record<string, string> = {
  high: "#C0392B",
  mid: "#E8A020",
  low: "#2E7D5E"
};

export function StressBarChart(props: { daily: ParentGrowthReportPayload["daily"] }) {
  const rows = props.daily.map((row, i) => ({
    label: WEEK_SHORT[i] ?? row.weekdayLabel,
    score: row.stressScore ?? 0,
    band: row.stressBand
  }));

  return (
    <div className="pgr-chart pgr-chart--stress">
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={rows} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
          <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#6B7280" }} />
          <YAxis domain={[0, 5]} tick={{ fontSize: 11, fill: "#6B7280" }} width={24} />
          <Tooltip />
          <Bar dataKey="score" radius={[4, 4, 0, 0]} maxBarSize={28}>
            {rows.map((row, idx) => (
              <Cell
                key={idx}
                fill={
                  row.band ? STRESS_COLORS[row.band] ?? "#94A3B8" : "#E2E8F0"
                }
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function FocusShareDonut(props: { pct: number | null; label: string }) {
  const gradId = React.useId().replace(/:/g, "");
  const size = 88;
  const stroke = 8;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = props.pct != null ? Math.max(0, Math.min(100, props.pct)) : 0;
  const dash = (p / 100) * c;
  return (
    <div className="pgr-focus-share-donut">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="#E2E8F0"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#pgrFocus-${gradId})`}
          strokeWidth={stroke}
          strokeDasharray={`${dash} ${c}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <defs>
          <linearGradient id={`pgrFocus-${gradId}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#1E4FD8" />
            <stop offset="100%" stopColor="#2E7D5E" />
          </linearGradient>
        </defs>
      </svg>
      <div className="pgr-focus-share-donut__label">
        <strong>{props.pct != null ? `${Math.round(props.pct)}%` : "—"}</strong>
        <span>{props.label}</span>
      </div>
    </div>
  );
}
