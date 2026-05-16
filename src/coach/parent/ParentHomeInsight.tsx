import React, { useMemo } from "react";
import { Clock, Target } from "lucide-react";
import { MetricCard } from "../ui/components";
import { setAppPath } from "../../lib/appNavigation";
import type { ParentWeeklyRecordsReport } from "./ParentRecordsWeekSection";
import { computeWeekInsightMetrics } from "./parentHomeMetrics";
import ko from "../fallbacks/ko.json";
import { tpl } from "../fallbacks/tpl";
import { bodyAfterHeadline, firstSentence, stripEmbeddedDateRanges } from "./parentTextUtils";

const H = ko.parentHomeTab;

function formatStudyHours(totalMinutes: number) {
  if (totalMinutes <= 0) return H.insightMetricUnset;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h <= 0) return tpl(H.recordsSummaryMinutes, { m: String(m) });
  if (m <= 0) return tpl(H.recordsSummaryHours, { h: String(h) });
  return `${h}시간 ${m}분`;
}

export function ParentHomeInsight(props: {
  fullPhrase: string | null;
  loading?: boolean;
  parentReport?: ParentWeeklyRecordsReport | null;
}) {
  const full = stripEmbeddedDateRanges(String(props.fullPhrase || "").trim());
  const headline = useMemo(() => {
    const fromCoach = firstSentence(full);
    return fromCoach || H.insightGreetingFallback;
  }, [full]);
  const body = useMemo(() => bodyAfterHeadline(full, headline), [full, headline]);

  const metrics = useMemo(() => {
    const days = Array.isArray(props.parentReport?.days) ? props.parentReport.days : [];
    const blocks = Array.isArray(props.parentReport?.blocks) ? props.parentReport.blocks : [];
    const logs = Array.isArray(props.parentReport?.logs) ? props.parentReport.logs : [];
    return computeWeekInsightMetrics(days, blocks, logs);
  }, [props.parentReport]);

  const showMetrics =
    !props.loading &&
    props.parentReport &&
    (metrics.totalStudyMinutes > 0 || metrics.planCompletionPct != null);

  return (
    <article
      className="coach-card coach-card--padded coach-home-insight-card parent-home__insight-card"
      aria-busy={props.loading}
    >
      {props.loading ? (
        <div className="parent-home__insight-head" aria-label={H.loadingCoachPhrase}>
          <div className="parent-skeleton parent-skeleton--phrase" />
          <div className="parent-skeleton parent-skeleton--phrase-short" />
        </div>
      ) : (
        <>
          <header className="parent-home__insight-head">
            <h2 className="parent-home__insight-greeting">{headline}</h2>
          </header>
          {body ? <p className="parent-home__insight-body">{body}</p> : null}
        </>
      )}

      {showMetrics ? (
        <div className="coach-grid coach-analysis-metric-grid parent-home__insight-metrics">
          <MetricCard
            title={H.insightMetricStudy}
            value={formatStudyHours(metrics.totalStudyMinutes)}
            hint=""
            icon={<Clock size={18} aria-hidden />}
          />
          <MetricCard
            title={H.insightMetricPlan}
            value={
              metrics.planCompletionPct != null
                ? `${metrics.planCompletionPct}%`
                : H.insightMetricUnset
            }
            hint=""
            icon={<Target size={18} aria-hidden />}
          />
        </div>
      ) : null}

      <div className="parent-home__insight-actions">
        <button
          type="button"
          className="parent-home__chip-btn parent-home__chip-btn--grow"
          onClick={() => setAppPath("#/parent/analysis")}
        >
          {H.insightCtaReport}
        </button>
      </div>
    </article>
  );
}
