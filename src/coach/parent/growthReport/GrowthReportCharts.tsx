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

/** Matches --accent (#243b6b) in parent app theme */
const CHART_ACCENT = "#243b6b";
const CHART_ACCENT_SOFT = "#5a6d8c";
const CHART_GRID = "rgba(0, 0, 0, 0.08)";
const CHART_TICK = "#6b6b70";
const CHART_MUTED_BAR = "#d1d1d6";
const CHART_PREV = "#a8a8ad";

function PgrChartFrame(props: {
  className: string;
  layoutWidth?: number;
  height: number;
  children: (size: { width: number; height: number }) => React.ReactElement;
}) {
  if (props.layoutWidth) {
    return (
      <div
        className={props.className}
        style={{ width: props.layoutWidth, height: props.height }}
      >
        {props.children({ width: props.layoutWidth, height: props.height })}
      </div>
    );
  }
  return (
    <div className={props.className}>
      <ResponsiveContainer width="100%" height={props.height}>
        {props.children({ width: -1, height: props.height })}
      </ResponsiveContainer>
    </div>
  );
}

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
            <stop offset="0%" stopColor="rgba(255,255,255,0.95)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0.55)" />
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
  layoutWidth?: number;
}) {
  const goalMin = props.goalHoursPerDay * 60;
  const chartHeight = props.layoutWidth ? 155 : 200;
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
      <PgrChartFrame className="pgr-chart__frame" layoutWidth={props.layoutWidth} height={chartHeight}>
        {({ width, height }) => (
          <BarChart
            data={rows}
            width={width > 0 ? width : undefined}
            height={width > 0 ? height : undefined}
            margin={{ top: 24, right: 8, left: -16, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART_GRID} />
            <XAxis dataKey="label" tick={{ fontSize: 12, fill: CHART_TICK }} />
            <YAxis
              tick={{ fontSize: 11, fill: CHART_TICK }}
              width={32}
              tickFormatter={v => `${Math.round(Number(v) / 60)}h`}
            />
            <Tooltip
              formatter={(v: number) => [`${(Number(v) / 60).toFixed(1)}시간`, "학습"]}
            />
            <ReferenceLine y={goalMin} stroke={CHART_ACCENT} strokeDasharray="4 4" label="" />
            <Bar dataKey="minutes" radius={[6, 6, 0, 0]} maxBarSize={36}>
              {rows.map((row, idx) => (
                <Cell
                  key={idx}
                  fill={
                    row.isToday ? CHART_ACCENT : row.hasData ? CHART_ACCENT_SOFT : CHART_MUTED_BAR
                  }
                />
              ))}
            </Bar>
          </BarChart>
        )}
      </PgrChartFrame>
      <p className="pgr-chart-legend">
        <span className="pgr-chart-legend__line pgr-chart-legend__line--goal" />
        일일 목표 {props.goalHoursPerDay.toFixed(1)}h
      </p>
    </div>
  );
}

export function FocusRadarChart(props: {
  thisWeek: RadarScores;
  prevWeek: RadarScores;
  layoutWidth?: number;
}) {
  const chartHeight = props.layoutWidth ? 220 : 280;
  const data = RADAR_DIMENSIONS.map(dim => ({
    subject: dim,
    thisWeek: props.thisWeek[dim],
    prevWeek: props.prevWeek[dim]
  }));

  return (
    <div className="pgr-chart pgr-chart--radar">
      <PgrChartFrame className="pgr-chart__frame" layoutWidth={props.layoutWidth} height={chartHeight}>
        {({ width, height }) => (
          <RadarChart
            data={data}
            width={width > 0 ? width : undefined}
            height={width > 0 ? height : undefined}
            cx={width > 0 ? width / 2 : "50%"}
            cy={width > 0 ? height / 2 : "50%"}
            outerRadius={width > 0 ? Math.min(width, height) * 0.34 : "72%"}
          >
            <PolarGrid stroke={CHART_GRID} />
            <PolarAngleAxis dataKey="subject" tick={{ fontSize: 11, fill: CHART_TICK }} />
            <PolarRadiusAxis angle={30} domain={[0, 10]} tick={{ fontSize: 10, fill: CHART_TICK }} />
            <Radar
              name="지난 주"
              dataKey="prevWeek"
              stroke={CHART_PREV}
              fill={CHART_PREV}
              fillOpacity={0.12}
              strokeWidth={2}
            />
            <Radar
              name="이번 주"
              dataKey="thisWeek"
              stroke={CHART_ACCENT}
              fill={CHART_ACCENT}
              fillOpacity={0.2}
              strokeWidth={2}
            />
            <Tooltip formatter={(v: number) => [`${Number(v).toFixed(1)} / 10`, ""]} />
          </RadarChart>
        )}
      </PgrChartFrame>
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
  layoutWidth?: number;
}) {
  const chartHeight = props.layoutWidth ? 150 : 180;
  const rows = props.daily.map((row, i) => ({
    label: WEEK_SHORT[i] ?? row.weekdayLabel,
    hours: row.sleepHours
  }));

  return (
    <div className="pgr-chart pgr-chart--sleep">
      <PgrChartFrame className="pgr-chart__frame" layoutWidth={props.layoutWidth} height={chartHeight}>
        {({ width, height }) => (
          <LineChart
            data={rows}
            width={width > 0 ? width : undefined}
            height={width > 0 ? height : undefined}
            margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART_GRID} />
            <XAxis dataKey="label" tick={{ fontSize: 12, fill: CHART_TICK }} />
            <YAxis domain={[0, 12]} tick={{ fontSize: 11, fill: CHART_TICK }} width={28} />
            <Tooltip formatter={(v: number) => [`${Number(v).toFixed(1)}시간`, "수면"]} />
            <ReferenceLine
              y={props.sleepGoalHours}
              stroke={CHART_ACCENT}
              strokeDasharray="4 4"
              strokeOpacity={0.55}
            />
            <ReferenceLine y={7} stroke={CHART_ACCENT} strokeOpacity={0.12} />
            <ReferenceLine y={9} stroke={CHART_ACCENT} strokeOpacity={0.12} />
            <Line
              type="monotone"
              dataKey="hours"
              stroke={CHART_ACCENT}
              strokeWidth={2}
              dot={{ r: 3, fill: CHART_ACCENT }}
              connectNulls={false}
            />
          </LineChart>
        )}
      </PgrChartFrame>
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

export function StressBarChart(props: {
  daily: ParentGrowthReportPayload["daily"];
  layoutWidth?: number;
}) {
  const chartHeight = props.layoutWidth ? 130 : 160;
  const rows = props.daily.map((row, i) => ({
    label: WEEK_SHORT[i] ?? row.weekdayLabel,
    score: row.stressScore ?? 0,
    band: row.stressBand
  }));

  return (
    <div className="pgr-chart pgr-chart--stress">
      <PgrChartFrame className="pgr-chart__frame" layoutWidth={props.layoutWidth} height={chartHeight}>
        {({ width, height }) => (
          <BarChart
            data={rows}
            width={width > 0 ? width : undefined}
            height={width > 0 ? height : undefined}
            margin={{ top: 8, right: 8, left: -20, bottom: 0 }}
          >
            <XAxis dataKey="label" tick={{ fontSize: 12, fill: CHART_TICK }} />
            <YAxis domain={[0, 5]} tick={{ fontSize: 11, fill: CHART_TICK }} width={24} />
            <Tooltip />
            <Bar dataKey="score" radius={[4, 4, 0, 0]} maxBarSize={28}>
              {rows.map((row, idx) => (
                <Cell
                  key={idx}
                  fill={row.band ? STRESS_COLORS[row.band] ?? CHART_PREV : CHART_MUTED_BAR}
                />
              ))}
            </Bar>
          </BarChart>
        )}
      </PgrChartFrame>
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
          stroke={CHART_MUTED_BAR}
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
            <stop offset="0%" stopColor={CHART_ACCENT} />
            <stop offset="100%" stopColor={CHART_ACCENT_SOFT} />
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
