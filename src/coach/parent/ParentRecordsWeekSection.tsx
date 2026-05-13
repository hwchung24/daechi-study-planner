import React, { useEffect, useMemo, useState } from "react";
import { BookOpen, CalendarRange, CheckCircle2, ChevronLeft, ChevronRight, Library, ListChecks, NotebookPen } from "lucide-react";
import {
  getDateKeySeoul,
  getSeoulWeekRangeCompactLabel,
  getWeekDaysIncludingTomorrowSeoul,
  seoulDateKeyFromApiValue
} from "../../lib/weekDates";
import type { ParentStudentRow } from "../../types/parent";
import type { StudyRoomVisitSession } from "../../types/studyRoomTracking";
import { Card, EmptyState } from "../ui/components";
import { useParentStudyRoomLive } from "./useParentStudyRoomLive";

type ParentWeekDay = { id: number | string; date: string };
type ParentWeekBlock = {
  study_day_id: number | string;
  subject: string;
  start_time: string;
  end_time: string;
  done?: boolean;
  focus_score?: "◎" | "○" | "△" | "✕" | null;
  planned_range?: string | null;
};
type ParentWeekPlan = {
  id: number | string;
  study_day_id: number | string;
  book_name?: string | null;
  planned_range?: string | null;
  start_time?: string | null;
  end_time?: string | null;
};
type ParentCoachLog = {
  date: string;
  sleepHours?: number | null;
  concentrationScore?: number | null;
  stressScore?: number | null;
  steps?: number | null;
  planCompletionRate?: number | null;
  studyMinutes?: number | null;
  memo?: string | null;
  tomorrowPractice?: string | null;
  tomorrowPracticeDone?: boolean | null;
  studyEvaluation?: string | null;
  metacognitionReflection?: string | null;
};
export type ParentWeeklyRecordsReport = {
  days?: ParentWeekDay[];
  blocks?: ParentWeekBlock[];
  plans?: ParentWeekPlan[];
  logs?: ParentCoachLog[];
};


function timeToMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 0;
  return hours * 60 + minutes;
}

const SLEEP_HOURS_MAX = 14;
const STUDY_HOURS_MAX = SLEEP_HOURS_MAX;

function recordLifeSliderFillPct(value: string | number | null | undefined): string {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return "0%";
  const clamped = Math.max(1, Math.min(5, numericValue));
  const pct = ((clamped - 1) / 4) * 100;
  return `${pct}%`;
}

function recordSleepSliderFillPct(value: string | number | null | undefined): string {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return "0%";
  const clamped = Math.max(0, Math.min(SLEEP_HOURS_MAX, numericValue));
  const pct = (clamped / SLEEP_HOURS_MAX) * 100;
  return `${pct}%`;
}

function recordStudyHoursSliderFillPctFromMinutes(value: string | number | null | undefined): string {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return "0%";
  const clamped = Math.max(0, Math.min(STUDY_HOURS_MAX * 60, numericValue));
  const pct = ((clamped / 60) / STUDY_HOURS_MAX) * 100;
  return `${pct}%`;
}

function formatNumericHours(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const clamped = Math.max(0, Math.min(SLEEP_HOURS_MAX, Number(value)));
  return Number.isInteger(clamped) ? `${clamped}시간` : `${clamped.toFixed(1)}시간`;
}

function formatStudyHoursLabel(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const hours = Math.max(0, Math.min(STUDY_HOURS_MAX, Number(value) / 60));
  return Number.isInteger(hours) ? `${hours}시간` : `${hours.toFixed(1)}시간`;
}

function normalizeDateKey(value: string | null | undefined): string {
  return String(value || "").trim().slice(0, 10);
}

function shiftDateKey(dateKey: string, offsetDays: number): string {
  const base = new Date(`${normalizeDateKey(dateKey)}T12:00:00+09:00`);
  if (Number.isNaN(base.getTime())) return normalizeDateKey(dateKey);
  base.setDate(base.getDate() + offsetDays);
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}-${String(base.getDate()).padStart(2, "0")}`;
}

function sortBlocks(blocks: ParentWeekBlock[]) {
  return [...blocks].sort((left, right) => {
    const start = timeToMinutes(left.start_time) - timeToMinutes(right.start_time);
    if (start !== 0) return start;
    return String(left.subject || "").localeCompare(String(right.subject || ""), "ko");
  });
}

function trimText(value: string | null | undefined): string {
  return String(value || "").trim();
}

function hasStudyLogContent(log: ParentCoachLog | null | undefined) {
  if (!log) return false;
  return (
    log.studyMinutes != null ||
    trimText(log.studyEvaluation).length > 0 ||
    trimText(log.metacognitionReflection).length > 0
  );
}

function hasLifeLogContent(log: ParentCoachLog | null | undefined) {
  if (!log) return false;
  return (
    log.sleepHours != null ||
    log.stressScore != null ||
    log.concentrationScore != null ||
    trimText(log.memo).length > 0 ||
    trimText(log.tomorrowPractice).length > 0 ||
    typeof log.tomorrowPracticeDone === "boolean"
  );
}

function ReadonlySliderField(props: {
  label: string;
  fillWidth: string;
  valueLabel: string;
  className?: string;
}) {
  return (
    <div className={"field record-day-field" + (props.className ? ` ${props.className}` : "")}>
      <label className="field-label">{props.label}</label>
      <div className="record-slider-row" aria-label={`${props.label} ${props.valueLabel}`}>
        <div className="record-slider-pill" aria-hidden="true">
          <div className="record-slider-pill__fill" style={{ width: props.fillWidth }} />
        </div>
        <span className="record-slider-value">{props.valueLabel}</span>
      </div>
    </div>
  );
}

function ReadonlyTextField(props: {
  label: string;
  value: string | null | undefined;
  className?: string;
  emptyText?: string;
}) {
  const text = trimText(props.value);
  const empty = text.length === 0;
  return (
    <div className={"field record-day-field" + (props.className ? ` ${props.className}` : "")}>
      <label className="field-label">{props.label}</label>
      <div className={"record-readonly-value" + (empty ? " record-readonly-value--empty" : "") }>
        {empty ? props.emptyText || "미입력" : text}
      </div>
    </div>
  );
}

function RecordSubgroupHeading(props: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <h3 className="record-life-group-title record-life-group-title--with-icon">
      <span className="record-life-group-title__glyph" aria-hidden>
        {props.icon}
      </span>
      <span>{props.children}</span>
    </h3>
  );
}

function PlanList(props: { plans: ParentWeekPlan[]; emptyText?: string }) {
  if (!props.plans.length) {
    return <div className="record-readonly-empty">{props.emptyText || "저장된 계획이 없습니다."}</div>;
  }

  return (
    <>
      {props.plans.map(plan => {
        const range = trimText(plan.planned_range);
        const start = trimText(plan.start_time);
        const end = trimText(plan.end_time);
        const timePart = start || end ? `${start || "—"} ~ ${end || "—"}` : "";
        return (
          <div key={plan.id} className="progress-day-book">
            <div className="progress-day-book-name">{trimText(plan.book_name) || "과목 미기록"}</div>
            <div className="progress-day-book-plan">
              내일 계획: {range || "미설정"}
              {timePart ? ` · ${timePart}` : ""}
            </div>
          </div>
        );
      })}
    </>
  );
}

function TimelineListView(props: {
  blocks: ParentWeekBlock[];
  commitmentText?: string;
  commitmentDone?: boolean | null;
  emptyText?: string;
}) {
  const commitmentText = trimText(props.commitmentText);
  const hasCommitment = commitmentText.length > 0;
  const blocks = sortBlocks(props.blocks);

  if (!hasCommitment && blocks.length === 0) {
    return <div className="record-readonly-empty">{props.emptyText || "등록된 계획이 없습니다."}</div>;
  }

  return (
    <div className="timeline-list">
      {hasCommitment ? (
        <div
          className={
            "timeline-item timeline-item--commitment" +
            (props.commitmentDone === true ? " timeline-item-done" : "")
          }
        >
          <div className="time-col">
            <span className="time-main">오늘의 핵심</span>
            <span className="timeline-book-name">{commitmentText}</span>
            <span className="timeline-plan-range">
              {props.commitmentDone === true
                ? "실천했어요"
                : props.commitmentDone === false
                  ? "미실천"
                  : "기록 없음"}
            </span>
          </div>
          <div className="check-col" aria-hidden="true">
            <span className="check-circle">
              {props.commitmentDone === true ? <span className="check-dot" /> : null}
            </span>
          </div>
        </div>
      ) : null}
      {blocks.map((block, index) => (
        <div
          key={`${block.study_day_id}-${block.start_time}-${block.end_time}-${block.subject}-${index}`}
          className={"timeline-item" + (block.done ? " timeline-item-done" : "")}
        >
          <div className="time-col">
            <span className="time-main">
              {block.start_time} - {block.end_time}
            </span>
            <span className="timeline-book-name">{trimText(block.subject) || "과목 미기록"}</span>
            <span className="timeline-plan-range">
              {trimText(block.planned_range)
                ? trimText(block.planned_range)
                : block.focus_score
                  ? `집중도 ${block.focus_score}`
                  : block.done
                    ? "완료"
                    : "미완료"}
            </span>
          </div>
          <div className="check-col" aria-hidden="true">
            <span className="check-circle">{block.done ? <span className="check-dot" /> : null}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function formatStudyRoomVisitDateLabel(value: string | null) {
  if (!value) return "날짜 미확인";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "날짜 미확인";
  const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
  return `${date.getMonth() + 1}.${date.getDate()} ${weekdays[date.getDay()]}요일`;
}

function formatCompactWeekLabel(dateKey: string, fallbackLabel: string): string {
  if (!dateKey) return fallbackLabel;
  const date = new Date(`${dateKey}T00:00:00+09:00`);
  if (Number.isNaN(date.getTime())) return fallbackLabel;
  const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
  const weekday = weekdays[date.getDay()] || "";
  return `${weekday} ${date.getMonth() + 1}.${date.getDate()}`;
}

function formatStudyRoomVisitTimeRange(visit: StudyRoomVisitSession) {
  const formatTime = (raw: string | null) => {
    if (!raw) return null;
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleTimeString("ko-KR", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    });
  };

  const start = formatTime(visit.enteredAt) || "--:--";
  const end = visit.exitedAt ? formatTime(visit.exitedAt) || "--:--" : "현재 체크인";
  return `${start} ~ ${end}`;
}

export type ParentRecordsWeekSectionProps = {
  apiBase: string;
  authToken: string | null;
  selectedStudent: ParentStudentRow | null;
  parentReport: ParentWeeklyRecordsReport | null;
  parentWeekOffset: number;
  setParentWeekOffset: React.Dispatch<React.SetStateAction<number>>;
};

export function ParentRecordsWeekSection(props: ParentRecordsWeekSectionProps) {
  const days = Array.isArray(props.parentReport?.days) ? props.parentReport.days : [];
  const blocks = Array.isArray(props.parentReport?.blocks) ? props.parentReport.blocks : [];
  const plans = Array.isArray(props.parentReport?.plans) ? props.parentReport.plans : [];
  const logs = Array.isArray(props.parentReport?.logs) ? props.parentReport.logs : [];
  const {
    studyRoomVisits,
    studyRoomVisitsLoading,
    hasStudyRoomConfig,
    studyRoomVisitsByDate
  } = useParentStudyRoomLive({
    apiBase: props.apiBase,
    authToken: props.authToken,
    studentId: props.selectedStudent?.id ?? null,
    hasStudyRoomSettingHint: Boolean(props.selectedStudent?.studyRoom)
  });

  const daysByDate = useMemo(
    () =>
      new Map(
        days.map(day => [seoulDateKeyFromApiValue(day.date), day] as const)
      ),
    [days]
  );
  const blocksByDayId = useMemo(() => {
    const next = new Map<number, ParentWeekBlock[]>();
    for (const block of blocks) {
      const sid = Number(block.study_day_id);
      if (!Number.isFinite(sid)) continue;
      const list = next.get(sid) || [];
      list.push(block);
      next.set(sid, list);
    }
    return next;
  }, [blocks]);
  const plansByDayId = useMemo(() => {
    const next = new Map<number, ParentWeekPlan[]>();
    for (const plan of plans) {
      const sid = Number(plan.study_day_id);
      if (!Number.isFinite(sid)) continue;
      const list = next.get(sid) || [];
      list.push(plan);
      next.set(sid, list);
    }
    return next;
  }, [plans]);
  const logsByDate = useMemo(() => {
    const next = new Map<string, ParentCoachLog>();
    for (const log of logs) {
      const key = seoulDateKeyFromApiValue(log.date);
      if (key && !next.has(key)) next.set(key, log);
    }
    return next;
  }, [logs]);

  const todayKey = getDateKeySeoul(0);
  const tomorrowKey = getDateKeySeoul(1);
  const tomorrowDay = daysByDate.get(tomorrowKey) || null;

  const renderStudyCard = (dayKey: string) => {
    const day = daysByDate.get(dayKey) || null;
    const dayLog = logsByDate.get(dayKey) || null;
    const dayIdNum = day != null ? Number(day.id) : NaN;
    const dayBlocks =
      day && Number.isFinite(dayIdNum)
        ? sortBlocks(blocksByDayId.get(dayIdNum) || [])
        : [];
    const tomorrowDayId = tomorrowDay != null ? Number(tomorrowDay.id) : NaN;
    const tomorrowPlans =
      tomorrowDay && Number.isFinite(tomorrowDayId)
        ? plansByDayId.get(tomorrowDayId) || []
        : [];
    const dayPlans =
      day && Number.isFinite(dayIdNum) ? plansByDayId.get(dayIdNum) || [] : [];
    const isToday = dayKey === todayKey;
    const isTomorrow = dayKey === tomorrowKey;
    const hasAnyContent = hasStudyLogContent(dayLog) || dayBlocks.length > 0 || dayPlans.length > 0;

    if (!isToday && !isTomorrow && !hasAnyContent) {
      return <div className="record-readonly-empty">저장된 학습 기록이 없습니다.</div>;
    }

    return (
      <>
        {hasStudyLogContent(dayLog) ? (
          <div className="record-life-group">
            <RecordSubgroupHeading icon={<BookOpen />}>오늘 기록</RecordSubgroupHeading>
            <div className="record-study-reflection-card">
              <ReadonlySliderField
                label="오늘 학습 시간"
                fillWidth={recordStudyHoursSliderFillPctFromMinutes(dayLog?.studyMinutes)}
                valueLabel={formatStudyHoursLabel(dayLog?.studyMinutes)}
              />
              <ReadonlyTextField
                label="오늘 공부 좋았던 점과 나빴던 점"
                value={dayLog?.studyEvaluation}
                className="record-day-memo"
              />
              <ReadonlyTextField
                label="오늘의 공부 메모"
                value={dayLog?.metacognitionReflection}
                className="record-day-memo"
              />
            </div>
          </div>
        ) : null}
        {dayBlocks.length > 0 ? (
          <div className="record-life-group">
            <RecordSubgroupHeading icon={<ListChecks />}>공부 계획</RecordSubgroupHeading>
            <TimelineListView blocks={dayBlocks} emptyText="등록된 계획이 없습니다." />
          </div>
        ) : null}
        {isToday ? (
          <div className="record-life-group">
            <RecordSubgroupHeading icon={<CalendarRange />}>내일 계획</RecordSubgroupHeading>
            <PlanList plans={tomorrowPlans} emptyText="내일 계획이 아직 없습니다." />
          </div>
        ) : null}
        {isTomorrow ? (
          <div className="record-life-group">
            <RecordSubgroupHeading icon={<CalendarRange />}>내일 계획</RecordSubgroupHeading>
            <PlanList plans={dayPlans} emptyText="내일 계획이 아직 없습니다." />
          </div>
        ) : null}
        {!isToday && !isTomorrow && dayPlans.length > 0 ? (
          <div className="record-life-group">
            <RecordSubgroupHeading icon={<CalendarRange />}>저장된 계획</RecordSubgroupHeading>
            <PlanList plans={dayPlans} emptyText="저장된 계획이 없습니다." />
          </div>
        ) : null}
      </>
    );
  };

  const renderLifeCard = (dayKey: string) => {
    const dayLog = logsByDate.get(dayKey) || null;
    const prevLog = logsByDate.get(shiftDateKey(dayKey, -1)) || null;
    const commitmentText = trimText(prevLog?.tomorrowPractice);
    const commitmentDone = dayLog?.tomorrowPracticeDone ?? null;
    const hasAnyContent = hasLifeLogContent(dayLog) || commitmentText.length > 0;

    if (!hasAnyContent) {
      return <div className="record-readonly-empty">저장된 생활 기록이 없습니다.</div>;
    }

    return (
      <>
        {dayLog ? (
          <div className="record-life-group">
            <RecordSubgroupHeading icon={<NotebookPen />}>오늘 기록</RecordSubgroupHeading>
            <div className="record-day-block">
              <ReadonlySliderField
                label="수면시간"
                fillWidth={recordSleepSliderFillPct(dayLog.sleepHours)}
                valueLabel={formatNumericHours(dayLog.sleepHours)}
              />
              <ReadonlySliderField
                label="스트레스"
                fillWidth={recordLifeSliderFillPct(dayLog.stressScore)}
                valueLabel={dayLog.stressScore != null ? String(dayLog.stressScore) : "—"}
              />
              <ReadonlySliderField
                label="집중도"
                fillWidth={recordLifeSliderFillPct(dayLog.concentrationScore)}
                valueLabel={dayLog.concentrationScore != null ? String(dayLog.concentrationScore) : "—"}
              />
              <ReadonlyTextField
                label="오늘 생활 좋았던 점과 나빴던 점"
                value={dayLog.memo}
                className="record-day-memo"
              />
            </div>
          </div>
        ) : null}
        {trimText(dayLog?.tomorrowPractice) ? (
          <div className="record-life-group">
            <RecordSubgroupHeading icon={<CalendarRange />}>내일 계획</RecordSubgroupHeading>
            <div className="record-day-block">
              <ReadonlyTextField
                label="내일 실천할 한 가지"
                value={dayLog?.tomorrowPractice}
                className="record-day-memo"
              />
            </div>
          </div>
        ) : null}
        {commitmentText ? (
          <div className="record-life-group">
            <RecordSubgroupHeading icon={<CheckCircle2 />}>이행여부</RecordSubgroupHeading>
            <div className="record-day-block">
              <ReadonlyTextField
                label="어제 정한 실천"
                value={commitmentText}
                className="record-day-memo"
              />
              <ReadonlyTextField
                label="오늘 이행 상태"
                value={
                  commitmentDone === true
                    ? "실천했어요"
                    : commitmentDone === false
                      ? "미실천"
                      : "기록 없음"
                }
              />
            </div>
          </div>
        ) : null}
      </>
    );
  };

  const renderStudyRoomVisitOverviewCard = (dayKey: string) => {
    const dayVisits = studyRoomVisitsByDate.get(dayKey) || [];
    if (!hasStudyRoomConfig) {
      return <div className="record-readonly-empty">등록된 독서실이 없습니다.</div>;
    }
    if (studyRoomVisitsLoading && studyRoomVisits.length === 0) {
      return <div className="record-readonly-empty">불러오는 중...</div>;
    }
    if (dayVisits.length === 0) {
      return <div className="record-readonly-empty">해당 날짜 체크인 기록이 없습니다.</div>;
    }
    return (
      <div className="parent-study-room-item__visit-list">
        {dayVisits.map(visit => (
          <div key={visit.id} className="parent-study-room-item__visit-item">
            <div className="parent-study-room-item__visit-row">
              <span className="parent-study-room-item__visit-name">{visit.studyRoomName}</span>
              <span className="parent-study-room-item__visit-pill">
                {visit.exitedAt ? "체크아웃" : "체크인"}
              </span>
            </div>
            <div className="parent-study-room-item__visit-meta">{formatStudyRoomVisitTimeRange(visit)}</div>
            <div className="parent-study-room-item__visit-meta">
              {visit.lastDistanceMeters != null ? `마지막 거리 ${Math.round(visit.lastDistanceMeters)}m` : "-"}
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <section className="parent-home__records-week" aria-label="날짜별 기록">
      {!props.selectedStudent ? (
        <EmptyState title="학생을 선택하세요" />
      ) : (
        <>
          <div className="coach-records-page-grid coach-records-page-grid--unified">
            <Card className="coach-card coach-card--padded coach-records-overview-card parent-home__status-card parent-home__status-card--records">
              <div className="parent-home__status-card-head parent-home__status-card-head--records">
                <span className="parent-home__status-card-head-left">
                  <CalendarRange size={18} strokeWidth={2} aria-hidden />
                  <span className="parent-home__status-card-title">날짜별 기록</span>
                </span>
                <div className="parent-growth-report__week-nav" aria-label="날짜별 기록 주차 이동">
                  <button
                    type="button"
                    className="parent-growth-report__week-btn"
                    aria-label="이전 주"
                    onClick={() => props.setParentWeekOffset(offset => offset + 1)}
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <button
                    type="button"
                    className="parent-growth-report__week-btn"
                    aria-label="다음 주"
                    disabled={props.parentWeekOffset <= 0}
                    onClick={() =>
                      props.setParentWeekOffset(offset => (offset > 0 ? offset - 1 : 0))
                    }
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>
              </div>
              <p className="parent-home__records-week-label">
                {getSeoulWeekRangeCompactLabel(props.parentWeekOffset)}
              </p>
              <section className="coach-records-unified-week" aria-label="날짜별 공부·독서실·생활 기록">
                <div className="week-frame coach-records-week-frame">
                  <div className="progress-cards-scroll">
                    <div className="progress-cards-container">
                      {getWeekDaysIncludingTomorrowSeoul(props.parentWeekOffset).map(day => (
                        <div
                          key={`parent-records-unified-${day.key}`}
                          className={
                            "parent-home__records-day-sheet" +
                            (day.key === todayKey ? " parent-home__records-day-sheet--today" : "")
                          }
                        >
                          <div className="parent-home__records-day-head">
                            {formatCompactWeekLabel(day.key, day.label)}
                          </div>
                          <div className="parent-home__records-day-body coach-records-unified-day-body">
                            {hasStudyRoomConfig ? (
                              <div className="coach-records-unified-block">
                                <RecordSubgroupHeading icon={<Library aria-hidden />}>
                                  독서실 체크인
                                </RecordSubgroupHeading>
                                {renderStudyRoomVisitOverviewCard(day.key)}
                              </div>
                            ) : null}
                            <div className="coach-records-unified-block">
                              {renderStudyCard(day.key)}
                            </div>
                            <div className="coach-records-unified-block">
                              <RecordSubgroupHeading icon={<NotebookPen aria-hidden />}>
                                생활 기록
                              </RecordSubgroupHeading>
                              {renderLifeCard(day.key)}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </section>
            </Card>
          </div>
        </>
      )}
    </section>
  );
}
