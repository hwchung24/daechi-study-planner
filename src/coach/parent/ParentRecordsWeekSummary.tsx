import React, { useMemo, useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { setAppPath } from "../../lib/appNavigation";
import type { ParentWeeklyRecordsReport } from "./ParentRecordsWeekSection";
import { aggregateTopSubjects, aggregateWeekStudyMinutes } from "./parentHomeMetrics";
import ko from "../fallbacks/ko.json";
import { tpl } from "../fallbacks/tpl";

const H = ko.parentHomeTab;

function formatMinutesLabel(minutes: number) {
  if (minutes <= 0) return H.recordsSummaryZeroDay;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h <= 0) return tpl(H.recordsSummaryMinutes, { m: String(m) });
  if (m <= 0) return tpl(H.recordsSummaryHours, { h: String(h) });
  return `${tpl(H.recordsSummaryHours, { h: String(h) })} ${tpl(H.recordsSummaryMinutes, { m: String(m) })}`;
}

export function ParentRecordsWeekSummary(props: {
  parentReport: ParentWeeklyRecordsReport | null;
}) {
  const [tab, setTab] = useState<"daily" | "weekly">("weekly");
  const days = Array.isArray(props.parentReport?.days) ? props.parentReport.days : [];
  const blocks = Array.isArray(props.parentReport?.blocks) ? props.parentReport.blocks : [];
  const weekRows = useMemo(() => aggregateWeekStudyMinutes(days, blocks), [days, blocks]);
  const subjects = useMemo(() => aggregateTopSubjects(blocks), [blocks]);
  const maxSubjectMin = useMemo(
    () => Math.max(1, ...subjects.map(s => s.minutes)),
    [subjects]
  );

  if (days.length === 0) return null;

  return (
    <div className="parent-records-summary coach-card coach-card--padded">
      <div className="parent-records-summary__tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "daily"}
          className={
            "coach-analysis-trend-tab" + (tab === "daily" ? " coach-analysis-trend-tab--active" : "")
          }
          onClick={() => setTab("daily")}
        >
          {H.recordsSummaryTabDaily}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "weekly"}
          className={
            "coach-analysis-trend-tab" + (tab === "weekly" ? " coach-analysis-trend-tab--active" : "")
          }
          onClick={() => setTab("weekly")}
        >
          {H.recordsSummaryTabWeekly}
        </button>
      </div>
      {tab === "weekly" ? (
        <>
          <p className="parent-type-section parent-records-summary__title">{H.recordsSummaryWeeklyTitle}</p>
          <div className="parent-records-summary__chart" aria-hidden={weekRows.every(r => r.minutes === 0)}>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={weekRows} margin={{ top: 8, right: 4, left: -20, bottom: 0 }}>
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} width={28} />
                <Tooltip formatter={(v: number) => formatMinutesLabel(Number(v))} />
                <Bar dataKey="minutes" fill="var(--accent)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          {subjects.length > 0 ? (
            <div className="parent-records-summary__subjects">
              <p className="parent-type-caption">{H.recordsSummarySubjectsTitle}</p>
              <ul className="parent-records-summary__subject-list">
                {subjects.map(row => (
                  <li key={row.subject} className="parent-records-summary__subject-row">
                    <span className="parent-records-summary__subject-name">{row.subject}</span>
                    <span className="parent-records-summary__subject-bar-wrap" aria-hidden>
                      <span
                        className="parent-records-summary__subject-bar"
                        style={{ width: `${(row.minutes / maxSubjectMin) * 100}%` }}
                      />
                    </span>
                    <span className="parent-type-caption">{formatMinutesLabel(row.minutes)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : (
        <p className="parent-type-caption">{H.recordsExpand}</p>
      )}
      <button
        type="button"
        className="coach-ghost-btn parent-records-summary__cta"
        onClick={() => setAppPath("#/parent/analysis")}
      >
        {H.recordsSummaryGrowthCta}
      </button>
    </div>
  );
}
