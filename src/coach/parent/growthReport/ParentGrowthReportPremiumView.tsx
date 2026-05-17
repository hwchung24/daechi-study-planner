import React, { useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileDown,
  Home,
  Lock,
  Target,
  User,
  Zap
} from "lucide-react";
import { getDateKeySeoul } from "../../../lib/weekDates";
import {
  buildCoachBlocks,
  buildRadarScores,
  computeCompositeScore,
  computeFocusAttentionPct,
  computeStudyVolumePct,
  deltaColorClass,
  formatIssuedLabel,
  formatMetricDelta,
  formatStudentSubtitle,
  parseSuggestionCards,
  planGaugeColor,
  RADAR_DIMENSIONS,
  sleepQualityStars,
  splitBulletLines
} from "../../../lib/parentGrowthReportMetrics";
import { resolveFocusEfficiencyDisplay } from "../../../lib/growthReportFocusEfficiency";
import type { ParentGrowthReportPayload } from "../ParentGrowthReportTab";
import ko from "../../fallbacks/ko.json";
import {
  FocusRadarChart,
  FocusShareDonut,
  SleepLineChart,
  StressBarChart,
  SummaryDonut,
  WeeklyStudyBarChart
} from "./GrowthReportCharts";

const growthFb = ko.gptOutputFallbacks.parentGrowthReport;
const growthNarrativeFb = ko.parentGrowthReportNarrative;

function isLifeDataSparse(daily: ParentGrowthReportPayload["daily"] | undefined) {
  if (!daily?.length) return true;
  return !daily.some(row => row.sleepHours != null || row.stressBand != null);
}

function EmptyChartBlock(props: { message?: string }) {
  return (
    <div className="pgr-empty-chart" role="status">
      <Lock size={20} aria-hidden />
      <p>{props.message || "기록이 쌓이면 분석됩니다"}</p>
    </div>
  );
}

function SectionHeader(props: { title: string; id?: string }) {
  return (
    <header className="pgr-section__head" id={props.id}>
      <h2 className="pgr-section__title">{props.title}</h2>
    </header>
  );
}

function CoachQuote({ text, coachName }: { text: string; coachName: string }) {
  if (!text.trim()) return null;
  return (
    <blockquote className="pgr-coach-quote">
      <p>{text}</p>
      <footer>— {coachName}</footer>
    </blockquote>
  );
}

function DeltaBadge(props: { delta: ReturnType<typeof formatMetricDelta> }) {
  if (!props.delta) {
    return <span className="pgr-delta pgr-delta--flat">전주 비교 없음</span>;
  }
  return (
    <span className={`pgr-delta ${deltaColorClass(props.delta)}`}>{props.delta.label}</span>
  );
}

function PriorityTag(props: { priority: "high" | "medium" | "low" }) {
  const map = {
    high: { label: "중요", emoji: "🔴" },
    medium: { label: "권장", emoji: "🟡" },
    low: { label: "선택", emoji: "🟢" }
  };
  const t = map[props.priority];
  return (
    <span className={`pgr-priority pgr-priority--${props.priority}`}>
      {t.emoji} {t.label}
    </span>
  );
}

export function ParentGrowthReportPremiumView(props: {
  data: ParentGrowthReportPayload;
  loading: boolean;
  error: string | null;
  parentWeekOffset: number;
  setParentWeekOffset: React.Dispatch<React.SetStateAction<number>>;
  onPdfPreview: () => void;
  pdfPreviewDisabled: boolean;
}) {
  const { data, n } = { data: props.data, n: props.data.narrative };
  const [strategyTab, setStrategyTab] = useState<"student" | "parent">("student");

  const lifeDataSparse = useMemo(() => isLifeDataSparse(data.daily), [data.daily]);
  const todayKey = useMemo(() => getDateKeySeoul(), []);
  const composite = useMemo(() => computeCompositeScore(data), [data]);
  const studyVolumePct = useMemo(() => computeStudyVolumePct(data), [data]);
  const focusAttentionPct = useMemo(() => computeFocusAttentionPct(data), [data]);
  const planPct = data.planExecution.achievementPct ?? 0;
  const focusDisplay = useMemo(
    () => resolveFocusEfficiencyDisplay(data.studyEfficiency),
    [data.studyEfficiency]
  );
  const radar = useMemo(() => buildRadarScores(data), [data]);
  const coachBlocks = useMemo(() => buildCoachBlocks(n, data), [n, data]);
  const studentCards = useMemo(
    () => parseSuggestionCards(n.nextWeekForStudent),
    [n.nextWeekForStudent]
  );
  const parentCards = useMemo(
    () => parseSuggestionCards(n.nextWeekForParent),
    [n.nextWeekForParent]
  );
  const strategyCards = strategyTab === "student" ? studentCards : parentCards;

  const coachName = data.meta?.coachName ?? "대치루트 AI 코치";
  const issuedLabel = formatIssuedLabel(data.meta?.issuedAt, data.headerBadgeWeek);
  const subtitle = formatStudentSubtitle(data);
  const goalHoursWeek = data.meta?.weeklyStudyGoalHours ?? 14;
  const goalHoursDay = goalHoursWeek / 7;
  const sleepStars = sleepQualityStars(data.daily, data.sleepGoalHours);

  const studyDelta = formatMetricDelta(
    data.studyEfficiency.actualStudyHours,
    data.prevWeek?.actualStudyHours,
    { suffix: "h", decimals: 1 }
  );
  const focusDelta = formatMetricDelta(
    data.studyEfficiency.focusEfficiencyPct,
    data.prevWeek?.focusEfficiencyPct,
    { suffix: "%p", decimals: 0 }
  );
  const planDelta = formatMetricDelta(
    data.planExecution.achievementPct,
    data.prevWeek?.achievementPct,
    { suffix: "%p", decimals: 0 }
  );

  const roomDelta = formatMetricDelta(
    data.studyEfficiency.studyRoomHours,
    data.prevWeek?.studyRoomHours,
    { suffix: "h", decimals: 1 }
  );
  const actualDelta = formatMetricDelta(
    data.studyEfficiency.actualStudyHours,
    data.prevWeek?.actualStudyHours,
    { suffix: "h", decimals: 1 }
  );
  const focusHoursDelta = formatMetricDelta(
    data.studyEfficiency.focusBandHours,
    data.prevWeek?.actualStudyHours != null && data.prevWeek?.focusEfficiencyPct != null
      ? (data.prevWeek.focusEfficiencyPct / 100) * data.prevWeek.actualStudyHours
      : null,
    { suffix: "h", decimals: 1 }
  );

  const hasStudyBarData = data.daily.some(d => (d.studyMinutesFromLog ?? 0) > 0);
  const energyTip =
    lifeDataSparse ? growthNarrativeFb.energyTipWhenSparseData : n.energyParentTip;

  return (
    <div className="parent-growth-report parent-growth-report--premium">
      <header className="pgr-cover">
        <div className="pgr-cover__bar">
          <div className="pgr-cover__brand">
            <span className="pgr-cover__logo" aria-hidden>
              DR
            </span>
            <span className="pgr-cover__brand-text">주간 학습 분석 리포트</span>
          </div>
          <div className="pgr-cover__meta">
            <span>{coachName}</span>
            <span>{issuedLabel}</span>
          </div>
        </div>
        <div className="pgr-cover__actions parent-growth-report__pdf-skip">
          <button
            type="button"
            className="pgr-cover__pdf-btn"
            disabled={props.pdfPreviewDisabled}
            onClick={props.onPdfPreview}
          >
            <FileDown size={18} aria-hidden />
            PDF 저장
          </button>
          <div className="pgr-cover__week-nav">
            <button
              type="button"
              className="pgr-cover__week-btn"
              aria-label="이전 주"
              onClick={() => props.setParentWeekOffset(o => o + 1)}
            >
              <ChevronLeft size={18} />
            </button>
            <button
              type="button"
              className="pgr-cover__week-btn"
              aria-label="다음 주"
              disabled={props.parentWeekOffset <= 0}
              onClick={() => props.setParentWeekOffset(o => (o > 0 ? o - 1 : 0))}
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
        <h1 className="pgr-cover__student">
          {data.studentName} 학생 주간 리포트
        </h1>
        {subtitle ? <p className="pgr-cover__subtitle">{subtitle}</p> : null}
        <p className="pgr-cover__range">{data.dateRangeLabel}</p>
        <div className="pgr-cover__ids">
          {data.meta?.reportId ? (
            <span className="pgr-cover__id">리포트 {data.meta.reportId}</span>
          ) : null}
          {data.meta?.observedDaysCount != null ? (
            <span>관찰 {data.meta.observedDaysCount}일</span>
          ) : null}
        </div>
      </header>

      {props.loading && !n ? (
        <p className="pgr-loading">불러오는 중…</p>
      ) : null}
      {props.error ? (
        <p className="pgr-error" role="alert">
          {props.error}
        </p>
      ) : null}

      <section className="pgr-summary-card" aria-labelledby="pgr-summary-title">
        <div className="pgr-summary-card__inner">
          <div className="pgr-summary-card__gauge">
            <SummaryDonut pct={composite.score} grade={composite.grade} />
            <p className="pgr-summary-card__gauge-label" id="pgr-summary-title">
              종합 학습 점수
            </p>
          </div>
          <div className="pgr-summary-card__metrics">
            <div className="pgr-summary-metric">
              <span className="pgr-summary-metric__icon" aria-hidden>
                📚
              </span>
              <div className="pgr-summary-metric__body">
                <span className="pgr-summary-metric__label">학습량</span>
                <strong>{studyVolumePct}%</strong>
                <span className="pgr-summary-metric__sub">목표 대비</span>
                <DeltaBadge delta={studyDelta} />
              </div>
            </div>
            <div className="pgr-summary-metric">
              <span className="pgr-summary-metric__icon" aria-hidden>
                🎯
              </span>
              <div className="pgr-summary-metric__body">
                <span className="pgr-summary-metric__label">집중도</span>
                <strong>
                  {focusAttentionPct > 0 ? `${focusAttentionPct}%` : focusDisplay?.headline ?? "—"}
                </strong>
                <span className="pgr-summary-metric__sub">집중 구간 비율</span>
                <DeltaBadge delta={focusDelta} />
              </div>
            </div>
            <div className="pgr-summary-metric">
              <span className="pgr-summary-metric__icon" aria-hidden>
                ✅
              </span>
              <div className="pgr-summary-metric__body">
                <span className="pgr-summary-metric__label">계획 달성률</span>
                <strong>{planPct > 0 ? `${Math.round(planPct)}%` : "—"}</strong>
                <span className="pgr-summary-metric__sub">주간 계획</span>
                <DeltaBadge delta={planDelta} />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="pgr-section pgr-section--coach">
        <SectionHeader title="코치 진단 리포트" />
        <article className="pgr-coach-card">
          <div className="pgr-coach-card__profile">
            <div className="pgr-coach-card__avatar" aria-hidden>
              {coachName.slice(0, 1)}
            </div>
            <div>
              <strong>{coachName}</strong>
              <p>데이터 기반 주간 학습 코칭</p>
            </div>
          </div>
          <div className="pgr-coach-card__blocks">
            <div className="pgr-coach-block">
              <h3>🔍 이번 주 관찰</h3>
              <p>{coachBlocks.observation}</p>
            </div>
            <div className="pgr-coach-block">
              <h3>💡 진단</h3>
              <p>
                <strong>잘한 점</strong> {coachBlocks.diagnosisGood}
              </p>
              <p>
                <strong>개선점</strong> {coachBlocks.diagnosisImprove}
              </p>
            </div>
            <div className="pgr-coach-block">
              <h3>📋 다음 주 처방</h3>
              <ul>
                {(coachBlocks.prescriptions.length
                  ? coachBlocks.prescriptions
                  : splitBulletLines(n.nextWeekForStudent)
                ).map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </div>
          </div>
          {!data.usedOpenAi ? (
            <p className="pgr-ai-note">{growthFb.openAiKeyNotice}</p>
          ) : null}
        </article>
        <CoachQuote text={n.studyEfficiencyInsight} coachName={coachName} />
      </section>

      <section className="pgr-section">
        <SectionHeader title="학습량 분석" />
        <div className="pgr-card">
          {hasStudyBarData ? (
            <WeeklyStudyBarChart
              daily={data.daily}
              goalHoursPerDay={goalHoursDay}
              todayKey={todayKey}
            />
          ) : (
            <EmptyChartBlock />
          )}
          <div className="pgr-stat-trio">
            {[
              { label: "독서실 체류", value: data.studyEfficiency.studyRoomHours, delta: roomDelta },
              {
                label: "실제 학습(기록)",
                value: data.studyEfficiency.actualStudyHours,
                delta: actualDelta
              },
              {
                label: "집중 구간",
                value: data.studyEfficiency.focusBandHours,
                delta: focusHoursDelta
              }
            ].map(row => (
              <div key={row.label} className="pgr-stat-trio__item">
                <span className="pgr-stat-trio__label">{row.label}</span>
                <strong>{row.value.toFixed(1)}h</strong>
                <DeltaBadge delta={row.delta} />
              </div>
            ))}
          </div>
          <div className="pgr-focus-share-row">
            <FocusShareDonut
              pct={focusDisplay?.donutPct ?? null}
              label="집중도 비율 (집중/학습)"
            />
            <p className="pgr-focus-share-caption">
              {focusDisplay?.context || n.studyEfficiencyInsight}
            </p>
          </div>
        </div>
        <CoachQuote text={n.studyEfficiencyInsight} coachName={coachName} />
      </section>

      <section className="pgr-section">
        <SectionHeader title="집중력 분석" />
        <div className="pgr-card">
          <FocusRadarChart thisWeek={radar.thisWeek} prevWeek={radar.prevWeek} />
          <ul className="pgr-radar-scores">
            {RADAR_DIMENSIONS.map(dim => (
              <li key={dim}>
                <span>{dim}</span>
                <strong>{radar.thisWeek[dim].toFixed(1)}</strong>
                <span className="pgr-radar-scores__max">/ 10</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="pgr-section">
        <SectionHeader title="계획 실행력" />
        <div className="pgr-card">
          <div className="pgr-plan-gauge">
            <div
              className="pgr-plan-gauge__fill"
              style={{
                width: `${Math.min(100, Math.max(0, planPct))}%`,
                backgroundColor: planGaugeColor(planPct)
              }}
            />
          </div>
          <p className="pgr-plan-gauge__label">
            <strong>{planPct > 0 ? `${Math.round(planPct)}%` : "—"}</strong> 달성률
            {data.planExecution.vsPrevWeekAchievementDeltaPct != null ? (
              <span>
                {" "}
                · 전주{" "}
                {data.planExecution.vsPrevWeekAchievementDeltaPct >= 0 ? "+" : ""}
                {Math.round(data.planExecution.vsPrevWeekAchievementDeltaPct)}%p
              </span>
            ) : null}
          </p>
          <p className="pgr-plan-narr">{n.planExecutionSummary}</p>
          {data.planExecution.totalTracked === 0 ? (
            <p className="pgr-plan-empty">{growthFb.planEmptyHint}</p>
          ) : null}
          <ul className="pgr-plan-checklist">
            {data.planExecution.bestCompleted.map((t, i) => (
              <li key={`d-${i}`} className="pgr-plan-checklist__done">
                <CheckCircle2 size={16} aria-hidden />
                <span>{t.title}</span>
                <em>{t.completedDayLabel}</em>
              </li>
            ))}
            {data.planExecution.carryOver.map((t, i) => (
              <li key={`p-${i}`} className="pgr-plan-checklist__pending">
                <Clock size={16} aria-hidden />
                <span>{t.title}</span>
                <em>이월</em>
              </li>
            ))}
          </ul>
          <table className="pgr-plan-table">
            <thead>
              <tr>
                <th>항목</th>
                <th>계획</th>
                <th>실행</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>주간 학습 시간</td>
                <td>{goalHoursWeek.toFixed(1)}h</td>
                <td>{data.studyEfficiency.actualStudyHours.toFixed(1)}h</td>
              </tr>
              <tr>
                <td>집중 구간</td>
                <td>—</td>
                <td>{data.studyEfficiency.focusBandHours.toFixed(1)}h</td>
              </tr>
              <tr>
                <td>계획 완료</td>
                <td>{data.planExecution.totalTracked}개</td>
                <td>{data.planExecution.completedCount}개</td>
              </tr>
            </tbody>
          </table>
        </div>
        <CoachQuote text={n.planExecutionSummary} coachName={coachName} />
      </section>

      <section className="pgr-section">
        <SectionHeader title="에너지 & 컨디션" />
        <div className="pgr-card">
          {lifeDataSparse ? (
            <EmptyChartBlock message={growthFb.chartEmptyBlock} />
          ) : (
            <>
              <h3 className="pgr-card__h3">수면 시간 추이</h3>
              <SleepLineChart daily={data.daily} sleepGoalHours={data.sleepGoalHours} />
              <h3 className="pgr-card__h3">스트레스 지수</h3>
              <StressBarChart daily={data.daily} />
              <div className="pgr-sleep-quality">
                <span>수면의 질</span>
                <div className="pgr-sleep-quality__stars" aria-label={`${sleepStars}점 만점 중`}>
                  {Array.from({ length: 5 }, (_, i) => (
                    <span
                      key={i}
                      className={
                        i < sleepStars ? "pgr-sleep-quality__star--on" : "pgr-sleep-quality__star--off"
                      }
                    >
                      ★
                    </span>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
        <CoachQuote text={energyTip} coachName={coachName} />
      </section>

      <section className="pgr-section pgr-section--strategy">
        <SectionHeader title="다음 주 전략 제안" />
        <div className="pgr-strategy-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={strategyTab === "student"}
            className={
              "pgr-strategy-tabs__btn" +
              (strategyTab === "student" ? " pgr-strategy-tabs__btn--active" : "")
            }
            onClick={() => setStrategyTab("student")}
          >
            <User size={16} aria-hidden />
            학생에게
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={strategyTab === "parent"}
            className={
              "pgr-strategy-tabs__btn" +
              (strategyTab === "parent" ? " pgr-strategy-tabs__btn--active" : "")
            }
            onClick={() => setStrategyTab("parent")}
          >
            <Home size={16} aria-hidden />
            학부모님께
          </button>
        </div>
        <div className="pgr-strategy-cards">
          {strategyCards.length ? (
            strategyCards.map((card, i) => (
              <article key={i} className="pgr-strategy-card">
                <div className="pgr-strategy-card__head">
                  <span className="pgr-strategy-card__num">{i + 1}</span>
                  <PriorityTag priority={card.priority} />
                </div>
                <h3>{card.title}</h3>
                <p>{card.body}</p>
                <p className="pgr-strategy-card__effect">
                  <Target size={14} aria-hidden />
                  예상 효과: {card.effect}
                </p>
              </article>
            ))
          ) : (
            <p className="pgr-strategy-fallback">
              {strategyTab === "student" ? n.nextWeekForStudent : n.nextWeekForParent}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
