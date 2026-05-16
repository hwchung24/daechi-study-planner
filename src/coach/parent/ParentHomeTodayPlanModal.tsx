import React, { useMemo } from "react";
import { CalendarDays, Loader2 } from "lucide-react";
import ko from "../fallbacks/ko.json";
import { tpl } from "../fallbacks/tpl";

const H = ko.parentHomeTab;

export type ParentTodayPlanBlock = {
  study_day_id: number | string;
  subject: string;
  start_time: string;
  end_time: string;
  done?: boolean;
  focus_score?: "◎" | "○" | "△" | "✕" | null;
  planned_range?: string | null;
};

export type TodayPlanViewState = "loading" | "no_planner" | "empty_today" | "list";

function timeToMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 0;
  return hours * 60 + minutes;
}

function sortBlocks(blocks: ParentTodayPlanBlock[]) {
  return [...blocks].sort((left, right) => {
    const start = timeToMinutes(left.start_time) - timeToMinutes(right.start_time);
    if (start !== 0) return start;
    return String(left.subject || "").localeCompare(String(right.subject || ""), "ko");
  });
}

function trimText(value: string | null | undefined) {
  return String(value || "").trim();
}

export function getTodayPlanViewState(props: {
  blocks: ParentTodayPlanBlock[];
  reportLoaded: boolean;
  hasAnyWeekBlocks: boolean;
}): TodayPlanViewState {
  if (!props.reportLoaded) return "loading";
  if (!props.hasAnyWeekBlocks) return "no_planner";
  if (props.blocks.length === 0) return "empty_today";
  return "list";
}

export function ParentHomeTodayPlanModalBody(props: {
  blocks: ParentTodayPlanBlock[];
  reportLoaded: boolean;
  hasAnyWeekBlocks: boolean;
}) {
  const viewState = getTodayPlanViewState(props);
  const sortedBlocks = useMemo(() => sortBlocks(props.blocks), [props.blocks]);

  if (viewState === "loading") {
    return (
      <div className="parent-home__today-plan-empty parent-home__today-plan-empty--loading">
        <Loader2 className="parent-home__today-plan-empty-spinner" size={28} aria-hidden />
        <p className="parent-home__today-plan-empty-body">{H.todayPlanModalLoading}</p>
      </div>
    );
  }

  if (viewState === "no_planner") {
    return (
      <div className="parent-home__today-plan-empty">
        <div className="parent-home__today-plan-empty-icon" aria-hidden>
          <CalendarDays size={28} strokeWidth={1.75} />
        </div>
        <p className="parent-home__today-plan-empty-title">{H.todayPlanModalNoPlannerTitle}</p>
        <p className="parent-home__today-plan-empty-body">{H.todayPlanModalNoPlannerBody}</p>
      </div>
    );
  }

  if (viewState === "empty_today") {
    return (
      <div className="parent-home__today-plan-empty">
        <div
          className="parent-home__today-plan-empty-icon parent-home__today-plan-empty-icon--muted"
          aria-hidden
        >
          <CalendarDays size={28} strokeWidth={1.75} />
        </div>
        <p className="parent-home__today-plan-empty-title">{H.todayPlanModalEmptyTitle}</p>
        <p className="parent-home__today-plan-empty-body">{H.todayPlanModalEmpty}</p>
      </div>
    );
  }

  return (
    <div className="timeline-list parent-home__today-plan-list">
      {sortedBlocks.map((block, index) => (
        <div
          key={`${block.study_day_id}-${block.start_time}-${block.end_time}-${block.subject}-${index}`}
          className={"timeline-item" + (block.done ? " timeline-item-done" : "")}
        >
          <div className="time-col">
            <span className="time-main">
              {block.start_time} - {block.end_time}
            </span>
            <span className="timeline-book-name">{trimText(block.subject) || H.subjectUnset}</span>
            <span className="timeline-plan-range">
              {trimText(block.planned_range)
                ? trimText(block.planned_range)
                : block.focus_score
                  ? tpl(H.todayPlanFocusTpl, { score: block.focus_score })
                  : block.done
                    ? H.todayPlanBlockDone
                    : H.todayPlanBlockPending}
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
