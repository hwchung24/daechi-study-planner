import React, { useMemo } from "react";
import { Building2 } from "lucide-react";
import type { StudyRoomVisitSession } from "../../types/studyRoomTracking";
import {
  minutesBetween,
  sumBlocksMinutesForDay,
  sumVisitStayMinutes,
  timeToMinutes
} from "./parentHomeMetrics";
import ko from "../fallbacks/ko.json";
import { tpl } from "../fallbacks/tpl";

const H = ko.parentHomeTab;

const DAY_MINUTES = 24 * 60;

function seoulMinutesFromIso(iso: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(new Date(iso));
  const h = Number(parts.find(p => p.type === "hour")?.value);
  const m = Number(parts.find(p => p.type === "minute")?.value);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

function visitSegmentStyle(enteredAt: string, exitedAt: string | null, nowMs: number) {
  const startMin = seoulMinutesFromIso(enteredAt);
  if (startMin == null) return null;
  const endIso = exitedAt || new Date(nowMs).toISOString();
  const endMin = seoulMinutesFromIso(endIso) ?? startMin + 30;
  const duration = Math.max(15, endMin - startMin);
  const leftPct = (startMin / DAY_MINUTES) * 100;
  const widthPct = (duration / DAY_MINUTES) * 100;
  return {
    left: `${Math.min(98, leftPct)}%`,
    width: `${Math.min(100 - leftPct, Math.max(2, widthPct))}%`
  };
}

function blockSegmentStyle(startTime: string, endTime: string) {
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  if (end <= start) return null;
  const leftPct = (start / DAY_MINUTES) * 100;
  const widthPct = ((end - start) / DAY_MINUTES) * 100;
  return { left: `${leftPct}%`, width: `${Math.max(1.5, widthPct)}%` };
}

export function ParentVisitStudyBar(props: {
  visits: StudyRoomVisitSession[];
  todayBlocks: Array<{ start_time: string; end_time: string; subject?: string }>;
  todayDayId: number | null;
  compact?: boolean;
}) {
  const nowMs = Date.now();
  const stayMinutes = useMemo(() => sumVisitStayMinutes(props.visits, nowMs), [props.visits, nowMs]);
  const plannedMinutes = useMemo(() => {
    if (props.todayDayId == null) return 0;
    return sumBlocksMinutesForDay(
      props.todayBlocks.map(b => ({
        ...b,
        study_day_id: props.todayDayId as number,
        subject: b.subject || ""
      })),
      props.todayDayId
    );
  }, [props.todayBlocks, props.todayDayId]);

  const recordPct = useMemo(() => {
    if (plannedMinutes <= 0 || stayMinutes <= 0) return null;
    return Math.min(100, Math.round((Math.min(stayMinutes, plannedMinutes) / plannedMinutes) * 100));
  }, [plannedMinutes, stayMinutes]);

  const hasBar = props.visits.length > 0 || props.todayBlocks.length > 0;
  if (!hasBar) return null;

  return (
    <div
      className={
        "parent-visit-bar" + (props.compact ? " parent-visit-bar--compact" : "")
      }
      aria-label={H.visitBarAria}
    >
      <div className="parent-visit-bar__head">
        <Building2 size={16} aria-hidden />
        {!props.compact ? (
          <span className="parent-type-caption">{H.visitBarAria}</span>
        ) : null}
      </div>
      <div className="parent-visit-bar__track" aria-hidden>
        {props.visits.map(v => {
          const style = visitSegmentStyle(v.enteredAt, v.exitedAt, nowMs);
          if (!style) return null;
          return (
            <span
              key={v.id}
              className="parent-visit-bar__seg parent-visit-bar__seg--visit"
              style={style}
              title={v.studyRoomName}
            />
          );
        })}
        {props.todayBlocks.map((b, i) => {
          const style = blockSegmentStyle(b.start_time, b.end_time);
          if (!style) return null;
          return (
            <span
              key={`${b.start_time}-${i}`}
              className="parent-visit-bar__seg parent-visit-bar__seg--plan"
              style={style}
              title={b.subject}
            />
          );
        })}
      </div>
      {recordPct != null && plannedMinutes > 0 ? (
        <p className="parent-type-caption parent-visit-bar__caption">
          {tpl(H.visitBarPlannedVsStay, {
            stay: String(stayMinutes),
            planned: String(plannedMinutes),
            pct: String(recordPct)
          })}
          <span className="parent-visit-bar__hint"> {H.visitBarPlannedVsStayHint}</span>
        </p>
      ) : null}
    </div>
  );
}
