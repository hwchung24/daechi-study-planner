import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Building2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileDown,
  Home,
  Lightbulb,
  Moon,
  Sparkles,
  User
} from "lucide-react";
import { getWeekStartKeySeoul } from "../../lib/weekDates";
import { exportElementToPdf } from "../../lib/exportElementToPdf";
import type { ParentStudentRow } from "../../types/parent";
import ko from "../fallbacks/ko.json";
import { tpl } from "../fallbacks/tpl";

const growthFb = ko.gptOutputFallbacks.parentGrowthReport;
const growthNarrativeFb = ko.parentGrowthReportNarrative;

function isLifeDataSparse(daily: ParentGrowthReportPayload["daily"] | undefined) {
  if (!daily?.length) return true;
  return !daily.some(row => row.sleepHours != null || row.stressBand != null);
}

type StressBand = "high" | "mid" | "low" | null;

const WEEK_SHORT = ["월", "화", "수", "목", "금", "토", "일"] as const;

export type ParentGrowthReportPayload = {
  weekStart: string;
  weekEnd: string;
  studentName: string;
  gradeLine: string | null;
  headerBadgeWeek: string;
  dateRangeLabel: string;
  badgePlanDeltaPct: number | null;
  badgeSleepRecovery: boolean;
  sleepGoalHours: number;
  daily: Array<{
    dateKey: string;
    weekdayLabel: string;
    sleepHours: number | null;
    brainRecoveryIndex: number | null;
    stressScore: number | null;
    stressBand: StressBand;
    studyRoomMinutes: number;
    studyMinutesFromLog: number | null;
  }>;
  studyEfficiency: {
    studyRoomHours: number;
    actualStudyHours: number;
    focusBandHours: number;
    focusEfficiencyPct: number | null;
    vsPrevWeekEfficiencyDeltaPct: number | null;
  };
  planExecution: {
    achievementPct: number | null;
    completedCount: number;
    totalTracked: number;
    vsPrevWeekAchievementDeltaPct: number | null;
    bestCompleted: Array<{ title: string; completedDayLabel: string }>;
    carryOver: Array<{ title: string }>;
  };
  narrative: {
    weeklySummary: string;
    energyParentTip: string;
    studyEfficiencyInsight: string;
    planExecutionSummary: string;
    nextWeekForStudent: string;
    nextWeekForParent: string;
  };
  usedOpenAi: boolean;
};

const GROWTH_REPORT_CACHE_PREFIX = "parent-growth-report-v1";

function buildGrowthReportCacheKey(studentId: number, weekStart: string) {
  return `${GROWTH_REPORT_CACHE_PREFIX}:${studentId}:${weekStart}`;
}

function DonutChart(props: { pct: number | null; size?: number }) {
  const gradId = React.useId().replace(/:/g, "");
  const size = props.size ?? 88;
  const stroke = 8;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = props.pct != null && Number.isFinite(props.pct) ? Math.max(0, Math.min(100, props.pct)) : 0;
  const dash = (p / 100) * c;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--growth-donut-track)"
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={`url(#growthDonutGrad-${gradId})`}
        strokeWidth={stroke}
        strokeDasharray={`${dash} ${c}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <defs>
        <linearGradient id={`growthDonutGrad-${gradId}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#8b7cff" />
          <stop offset="100%" stopColor="#5ec8d4" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function ParentGrowthReportTab(props: {
  apiBase: string;
  authToken: string | null;
  selectedStudent: ParentStudentRow;
  parentWeekOffset: number;
  setParentWeekOffset: React.Dispatch<React.SetStateAction<number>>;
}) {
  const [data, setData] = useState<ParentGrowthReportPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pdfExporting, setPdfExporting] = useState(false);
  const pdfCaptureRef = useRef<HTMLDivElement | null>(null);

  const weekStart = useMemo(
    () => getWeekStartKeySeoul(props.parentWeekOffset),
    [props.parentWeekOffset]
  );

  useEffect(() => {
    if (!props.authToken) {
      setData(null);
      return;
    }
    const cacheKey = buildGrowthReportCacheKey(props.selectedStudent.id, weekStart);
    let hasCached = false;
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached) as ParentGrowthReportPayload;
        if (parsed && typeof parsed === "object" && typeof parsed.weekStart === "string") {
          setData(parsed);
          setError(null);
          setLoading(false);
          hasCached = true;
        }
      }
    } catch {
      // ignore cache parse errors
    }
    if (hasCached) {
      return;
    }
    let cancelled = false;
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    void fetch(
      `${props.apiBase}/api/parent/growth-report?studentId=${encodeURIComponent(String(props.selectedStudent.id))}&weekStart=${encodeURIComponent(weekStart)}`,
      {
        signal: ac.signal,
        cache: "no-store",
        headers: { Authorization: `Bearer ${props.authToken}` }
      }
    )
      .then(async res => {
        const raw = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(String((raw as { error?: string }).error || growthFb.loadFailed));
        }
        if (cancelled) return;
        const payload = raw as ParentGrowthReportPayload;
        setData(payload);
        try {
          localStorage.setItem(cacheKey, JSON.stringify(payload));
        } catch {
          // ignore quota errors
        }
      })
      .catch((e: unknown) => {
        if (cancelled || (e instanceof DOMException && e.name === "AbortError")) return;
        setError(e instanceof Error ? e.message : growthFb.loadFailed);
        setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [props.apiBase, props.authToken, props.selectedStudent.id, weekStart]);

  const n = data?.narrative;
  const lifeDataSparse = useMemo(() => isLifeDataSparse(data?.daily), [data?.daily]);
  const energyTipText = useMemo(() => {
    if (!n) return "";
    if (lifeDataSparse) return growthNarrativeFb.energyTipWhenSparseData;
    return n.energyParentTip;
  }, [lifeDataSparse, n]);
  const focusEfficiencyContext = useMemo(() => {
    if (!data) return null;
    const pct = data.studyEfficiency.focusEfficiencyPct;
    const studyH = data.studyEfficiency.actualStudyHours;
    const focusH = data.studyEfficiency.focusBandHours;
    if (pct != null && pct <= 0 && studyH > 0 && focusH <= 0) {
      return tpl(growthFb.focusZeroWithStudyTpl, { hours: studyH.toFixed(1) });
    }
    if ((pct == null || pct <= 0) && studyH <= 0 && focusH <= 0) {
      return growthFb.focusNoStudyYet;
    }
    return null;
  }, [data]);
  const sleepBadgeText = useMemo(() => {
    if (!data?.daily?.length) return "수면 데이터 수집 중";
    const validSleep = data.daily
      .map(row => row.sleepHours)
      .filter((v): v is number => v != null && Number.isFinite(v));
    if (!validSleep.length) return "수면 데이터 수집 중";
    const avgSleepHours =
      validSleep.reduce((sum, hours) => sum + hours, 0) / Math.max(validSleep.length, 1);
    const belowGoalDays = data.daily.filter(
      row => row.sleepHours != null && row.sleepHours < data.sleepGoalHours
    ).length;
    if (data.badgeSleepRecovery) {
      return `평균 ${avgSleepHours.toFixed(1)}h · 목표 미달 ${belowGoalDays}일`;
    }
    return `평균 ${avgSleepHours.toFixed(1)}h · 수면 흐름 안정`;
  }, [data]);

  const handleSavePdf = useCallback(async () => {
    const root = pdfCaptureRef.current;
    if (!root || !data?.narrative) return;
    setPdfExporting(true);
    try {
      await exportElementToPdf(root, `성장리포트_${data.studentName}_${weekStart}`, {
        ignoreClassName: "parent-growth-report__pdf-skip",
        fitSinglePage: true,
        marginMm: 6
      });
    } catch (e) {
      alert(
        e instanceof Error
          ? e.message
          : growthFb.pdfExportFailedGeneric
      );
    } finally {
      setPdfExporting(false);
    }
  }, [data, weekStart]);

  return (
    <div className="coach-page parent-growth-report">
      <div ref={pdfCaptureRef} className="parent-growth-report__pdf-root">
      <div className="parent-growth-report__header">
        <div className="parent-growth-report__header-top">
          <span className="parent-growth-report__eyebrow">
            {data?.headerBadgeWeek || "—"}
          </span>
          <div className="parent-growth-report__header-actions">
            <button
              type="button"
              className="parent-growth-report__pdf-btn coach-ghost-btn parent-growth-report__pdf-skip"
              disabled={!n || loading || pdfExporting}
              onClick={() => void handleSavePdf()}
            >
              <FileDown size={18} aria-hidden />
              {pdfExporting ? "PDF 만드는 중…" : "PDF 저장"}
            </button>
            <div className="parent-growth-report__week-nav">
            <button
              type="button"
              className="parent-growth-report__week-btn"
              aria-label="이전 주"
              onClick={() => props.setParentWeekOffset(o => o + 1)}
            >
              <ChevronLeft size={18} />
            </button>
            <button
              type="button"
              className="parent-growth-report__week-btn"
              aria-label="다음 주"
              disabled={props.parentWeekOffset <= 0}
              onClick={() =>
                props.setParentWeekOffset(o => (o > 0 ? o - 1 : 0))
              }
            >
              <ChevronRight size={18} />
            </button>
            </div>
          </div>
        </div>
        <h1 className="parent-growth-report__title parent-type-kpi">
          {growthFb.reportTitle || "성장 리포트"}
        </h1>
        {data?.gradeLine ? (
          <p className="parent-growth-report__grade-line parent-type-caption">{data.gradeLine}</p>
        ) : null}
        <div className="parent-growth-report__badges">
          {data?.badgePlanDeltaPct != null ? (
            <span className="parent-growth-report__badge parent-growth-report__badge--plan">
              계획 달성{" "}
              {data.badgePlanDeltaPct >= 0 ? "↑" : "↓"}
              {Math.abs(Math.round(data.badgePlanDeltaPct))}%
            </span>
          ) : (
            <span className="parent-growth-report__badge parent-growth-report__badge--muted">
              {growthFb.badgeNoPrevWeek}
            </span>
          )}
          {data?.badgeSleepRecovery ? (
            <span className="parent-growth-report__badge parent-growth-report__badge--sleep">
              {sleepBadgeText}
            </span>
          ) : (
            <span className="parent-growth-report__badge parent-growth-report__badge--ok">
              {sleepBadgeText}
            </span>
          )}
        </div>
      </div>

      {loading && !data ? (
        <p className="coach-muted parent-growth-report__loading">불러오는 중…</p>
      ) : null}
      {error ? (
        <p className="coach-muted parent-growth-report__error" role="alert">
          {error}
        </p>
      ) : null}

      {n ? (
        <>
          <section className="parent-growth-report__insight parent-growth-report__section--summary coach-card coach-card--padded coach-home-insight-card">
            <Sparkles className="parent-growth-report__section-icon" aria-hidden />
            <p className="parent-growth-report__summary-text parent-type-body">{n.weeklySummary}</p>
            {lifeDataSparse ? (
              <p className="parent-growth-report__insight-caption parent-type-caption">
                {growthFb.sparseLifeDataNotice}
              </p>
            ) : null}
            {!data?.usedOpenAi ? (
              <p className="parent-growth-report__ai-note parent-type-caption">
                {growthFb.openAiKeyNotice}
              </p>
            ) : null}
          </section>

          <div className="parent-growth-report__kpi-row" role="list">
            <div className="parent-growth-report__kpi-chip" role="listitem">
              <span className="parent-type-caption">학습</span>
              <strong className="parent-type-kpi">
                {(data?.studyEfficiency.actualStudyHours ?? 0).toFixed(1)}h
              </strong>
            </div>
            <div className="parent-growth-report__kpi-chip" role="listitem">
              <span className="parent-type-caption">집중</span>
              <strong className="parent-type-kpi">
                {data?.studyEfficiency.focusEfficiencyPct != null
                  ? `${Math.round(data.studyEfficiency.focusEfficiencyPct)}%`
                  : "—"}
              </strong>
            </div>
            <div className="parent-growth-report__kpi-chip" role="listitem">
              <span className="parent-type-caption">계획</span>
              <strong className="parent-type-kpi">
                {data?.planExecution.achievementPct != null
                  ? `${Math.round(data.planExecution.achievementPct)}%`
                  : "—"}
              </strong>
            </div>
          </div>

          <section className="parent-growth-report__section">
            <h2 className="parent-growth-report__h2 parent-type-section">
              <Moon className="parent-growth-report__h2-icon" aria-hidden />
              에너지 &amp; 회복
            </h2>

            {lifeDataSparse ? (
              <p className="parent-growth-report__chart-empty parent-type-body">
                {growthFb.chartEmptyBlock}
              </p>
            ) : (
            <>
            <div className="parent-growth-report__subblock">
              <div className="parent-growth-report__subhead">
                일별 수면 · 뇌 회복 지표
                <span className="parent-growth-report__goal">
                  (목표 {data?.sleepGoalHours ?? 7}h)
                </span>
              </div>
              <div className="parent-growth-report__sleep-grid">
                {(data?.daily || []).map((row, i) => {
                  const goal = data?.sleepGoalHours ?? 7;
                  const h = row.sleepHours;
                  const pct =
                    h != null && goal > 0 ? Math.min(100, (h / goal) * 100) : 0;
                  const ok = h != null && h >= goal - 0.25;
                  return (
                    <div key={row.dateKey || i} className="parent-growth-report__sleep-cell">
                      <span className="parent-growth-report__sleep-wd">
                        {WEEK_SHORT[i] ?? row.weekdayLabel}
                      </span>
                      <div className="parent-growth-report__sleep-bar-track">
                        <div
                          className={
                            "parent-growth-report__sleep-bar-fill" +
                            (ok
                              ? " parent-growth-report__sleep-bar-fill--ok"
                              : " parent-growth-report__sleep-bar-fill--warn")
                          }
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span
                        className={
                          "parent-growth-report__sleep-val" +
                          (h == null ? " parent-growth-report__sleep-val--empty" : "")
                        }
                      >
                        {h != null ? `${h.toFixed(1)}h` : growthFb.chartNoSleepYet}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="parent-growth-report__subblock">
              <div className="parent-growth-report__subhead">일별 스트레스 흐름</div>
              <div className="parent-growth-report__stress-legend">
                <span>
                  <i className="parent-growth-report__dot parent-growth-report__dot--high" /> 높음
                </span>
                <span>
                  <i className="parent-growth-report__dot parent-growth-report__dot--mid" /> 보통
                </span>
                <span>
                  <i className="parent-growth-report__dot parent-growth-report__dot--low" /> 안정
                </span>
              </div>
              <div className="parent-growth-report__stress-row">
                {(data?.daily || []).map((row, i) => {
                  const band = row.stressBand;
                  const big =
                    band === "high" &&
                    (data?.daily || []).filter(d => d.stressBand === "high").length === 1 &&
                    row.stressScore != null &&
                    row.stressScore >= 4.2;
                  return (
                    <div key={row.dateKey || i} className="parent-growth-report__stress-cell">
                      <span className="parent-growth-report__stress-wd">
                        {WEEK_SHORT[i] ?? row.weekdayLabel}
                      </span>
                      <div
                        className={
                          "parent-growth-report__stress-bubble" +
                          (band === "high"
                            ? " parent-growth-report__stress-bubble--high"
                            : band === "mid"
                              ? " parent-growth-report__stress-bubble--mid"
                              : band === "low"
                                ? " parent-growth-report__stress-bubble--low"
                                : " parent-growth-report__stress-bubble--empty")
                        }
                        style={big ? { transform: "scale(1.15)" } : undefined}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
            </>
            )}

          </section>

          <details className="parent-growth-report__coach-comments">
            <summary className="parent-type-section">{growthFb.coachCommentsTitle}</summary>
            {energyTipText ? (
              <p className="parent-type-body parent-growth-report__coach-comment">{energyTipText}</p>
            ) : null}
            {n.studyEfficiencyInsight ? (
              <p className="parent-type-body parent-growth-report__coach-comment">
                {n.studyEfficiencyInsight}
              </p>
            ) : null}
          </details>

          <section className="parent-growth-report__section">
            <h2 className="parent-growth-report__h2 parent-type-section">
              <Building2 className="parent-growth-report__h2-icon" aria-hidden />
              학습 효율
            </h2>
            <div className="parent-growth-report__efficiency-layout">
              <div className="parent-growth-report__eff-bars">
                {[
                  {
                    label: "독서실 체류",
                    hours: data?.studyEfficiency.studyRoomHours ?? 0,
                    cls: "parent-growth-report__eff-track--room"
                  },
                  {
                    label: "실제 학습(기록)",
                    hours: data?.studyEfficiency.actualStudyHours ?? 0,
                    cls: "parent-growth-report__eff-track--study"
                  },
                  {
                    label: "집중 구간(◎·○)",
                    hours: data?.studyEfficiency.focusBandHours ?? 0,
                    cls: "parent-growth-report__eff-track--focus"
                  }
                ].map(row => {
                  const max = Math.max(
                    data?.studyEfficiency.studyRoomHours ?? 0,
                    data?.studyEfficiency.actualStudyHours ?? 0,
                    data?.studyEfficiency.focusBandHours ?? 0,
                    0.5
                  );
                  const w = max > 0 ? (row.hours / max) * 100 : 0;
                  return (
                    <div key={row.label} className="parent-growth-report__eff-row">
                      <span className="parent-growth-report__eff-label">{row.label}</span>
                      <div className={"parent-growth-report__eff-track " + row.cls}>
                        <div
                          className="parent-growth-report__eff-fill"
                          style={{ width: `${w}%` }}
                        />
                      </div>
                      <span className="parent-growth-report__eff-num">
                        {row.hours.toFixed(1)}h
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="parent-growth-report__donut-wrap">
                <DonutChart pct={data?.studyEfficiency.focusEfficiencyPct ?? null} />
                <div className="parent-growth-report__donut-label">
                  <strong>
                    {data?.studyEfficiency.focusEfficiencyPct != null
                      ? `${Math.round(data.studyEfficiency.focusEfficiencyPct)}%`
                      : "—"}
                  </strong>
                  <span>집중 효율</span>
                  {focusEfficiencyContext ? (
                    <span className="parent-growth-report__donut-context">{focusEfficiencyContext}</span>
                  ) : null}
                  {data?.studyEfficiency.vsPrevWeekEfficiencyDeltaPct != null ? (
                    <span className="parent-growth-report__delta">
                      전주 대비{" "}
                      {data.studyEfficiency.vsPrevWeekEfficiencyDeltaPct >= 0 ? "+" : ""}
                      {Math.round(data.studyEfficiency.vsPrevWeekEfficiencyDeltaPct)}%p
                    </span>
                  ) : (
                    <span className="parent-growth-report__delta muted">전주 비교 없음</span>
                  )}
                </div>
              </div>
            </div>
          </section>

          <section className="parent-growth-report__section">
            <h2 className="parent-growth-report__h2 parent-type-section">
              <CheckCircle2 className="parent-growth-report__h2-icon" aria-hidden />
              계획 실행력
            </h2>
            <div className="parent-growth-report__plan-head">
              <div className="parent-growth-report__plan-rate">
                <div className="parent-growth-report__plan-rate-bar">
                  <div
                    className="parent-growth-report__plan-rate-fill"
                    style={{
                      width: `${Math.min(100, Math.max(0, data?.planExecution.achievementPct ?? 0))}%`
                    }}
                  />
                </div>
                <div className="parent-growth-report__plan-rate-text">
                  <strong>
                    {data?.planExecution.achievementPct != null
                      ? `${Math.round(data.planExecution.achievementPct)}%`
                      : "—"}
                  </strong>{" "}
                  달성률
                </div>
              </div>
              <p className="parent-growth-report__plan-meta">
                {data
                  ? `${data.planExecution.completedCount}개 완료 · 총 ${data.planExecution.totalTracked}개 항목 추적`
                  : ""}
                {data?.planExecution.vsPrevWeekAchievementDeltaPct != null
                  ? ` · 전주 대비 ${data.planExecution.vsPrevWeekAchievementDeltaPct >= 0 ? "+" : ""}${Math.round(data.planExecution.vsPrevWeekAchievementDeltaPct)}%p`
                  : ""}
              </p>
            </div>
            <p className="parent-growth-report__plan-narr">{n.planExecutionSummary}</p>
            {data?.planExecution.totalTracked === 0 ? (
              <p className="parent-growth-report__plan-empty-hint">{growthFb.planEmptyHint}</p>
            ) : null}
            <div className="parent-growth-report__plan-grid">
              {data?.planExecution.bestCompleted.map((t, i) => (
                <div
                  key={`b-${i}`}
                  className="parent-growth-report__plan-card parent-growth-report__plan-card--done"
                >
                  <CheckCircle2 size={18} aria-hidden />
                  <div>
                    <div className="parent-growth-report__plan-title">{t.title}</div>
                    <div className="parent-growth-report__plan-sub">{t.completedDayLabel}</div>
                  </div>
                </div>
              ))}
              {data?.planExecution.carryOver.map((t, i) => (
                <div
                  key={`c-${i}`}
                  className="parent-growth-report__plan-card parent-growth-report__plan-card--pending"
                >
                  <Clock size={18} aria-hidden />
                  <div>
                    <div className="parent-growth-report__plan-title">{t.title}</div>
                    <div className="parent-growth-report__plan-sub">다음 주 이월</div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <details className="parent-growth-report__section parent-growth-report__section--last parent-growth-report__next-week">
            <summary className="parent-growth-report__h2 parent-type-section">
              <Lightbulb className="parent-growth-report__h2-icon" aria-hidden />
              다음 주 제안
            </summary>
            <div className="parent-growth-report__suggest-grid">
              <div className="parent-growth-report__suggest-card">
                <div className="parent-growth-report__suggest-head">
                  <User size={18} aria-hidden />
                  <span>{data?.studentName ?? "학생"}에게</span>
                </div>
                <p>{n.nextWeekForStudent}</p>
              </div>
              <div className="parent-growth-report__suggest-card parent-growth-report__suggest-card--parent">
                <div className="parent-growth-report__suggest-head">
                  <Home size={18} aria-hidden />
                  <span>부모님께</span>
                </div>
                <p>{n.nextWeekForParent}</p>
              </div>
            </div>
          </details>
        </>
      ) : !loading && !error ? (
        <p className="coach-muted">표시할 데이터가 없습니다.</p>
      ) : null}
      </div>
    </div>
  );
}
