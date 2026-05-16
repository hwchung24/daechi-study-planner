import { getDateKeySeoul, seoulDateKeyFromApiValue } from "../../lib/weekDates";
import type { StudyRoomVisitSession } from "../../types/studyRoomTracking";

export function timeToMinutes(value: string) {
  const [hours, minutes] = String(value || "").split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 0;
  return hours * 60 + minutes;
}

export function minutesBetween(start: string, end: string) {
  return Math.max(0, timeToMinutes(end) - timeToMinutes(start));
}

export function formatSeoulClockNow() {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }).format(new Date());
}

export function formatElapsedMinutesKo(totalMinutes: number) {
  const m = Math.max(0, Math.floor(totalMinutes));
  if (m < 60) return `${m}분`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest > 0 ? `${h}시간 ${rest}분` : `${h}시간`;
}

export function elapsedMinutesFromIso(iso: string) {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 60_000));
}

type WeekBlock = {
  study_day_id: number | string;
  subject: string;
  start_time: string;
  end_time: string;
  done?: boolean;
};

type WeekDay = { id: number | string; date: string };

type WeekLog = {
  date: string;
  studyMinutes?: number | null;
  planCompletionRate?: number | null;
};

export function sumBlocksMinutesForDay(blocks: WeekBlock[], dayId: number) {
  return blocks
    .filter(b => Number(b.study_day_id) === dayId)
    .reduce((sum, b) => sum + minutesBetween(b.start_time, b.end_time), 0);
}

export function sumVisitStayMinutes(visits: StudyRoomVisitSession[], nowMs = Date.now()) {
  let total = 0;
  for (const v of visits) {
    const start = new Date(v.enteredAt).getTime();
    const endRaw = v.exitedAt ? new Date(v.exitedAt).getTime() : nowMs;
    if (Number.isNaN(start) || Number.isNaN(endRaw)) continue;
    total += Math.max(0, Math.floor((endRaw - start) / 60_000));
  }
  return total;
}

export function visitMinutesForDate(visits: StudyRoomVisitSession[]) {
  return sumVisitStayMinutes(visits);
}

export function aggregateWeekStudyMinutes(
  days: WeekDay[],
  blocks: WeekBlock[]
): { dateKey: string; label: string; minutes: number }[] {
  return days.map(day => {
    const dateKey = seoulDateKeyFromApiValue(day.date) || String(day.date).slice(0, 10);
    const dayId = Number(day.id);
    const minutes = Number.isFinite(dayId) ? sumBlocksMinutesForDay(blocks, dayId) : 0;
    const label = dateKey.length >= 10 ? dateKey.slice(5).replace("-", "/") : dateKey;
    return { dateKey, label, minutes };
  });
}

export function aggregateTopSubjects(
  blocks: WeekBlock[],
  limit = 3
): { subject: string; minutes: number }[] {
  const bySubject = new Map<string, number>();
  for (const b of blocks) {
    const subject = String(b.subject || "").trim() || "기타";
    bySubject.set(subject, (bySubject.get(subject) || 0) + minutesBetween(b.start_time, b.end_time));
  }
  const sorted = [...bySubject.entries()]
    .map(([subject, minutes]) => ({ subject, minutes }))
    .sort((a, b) => b.minutes - a.minutes);
  if (sorted.length <= limit) return sorted;
  const top = sorted.slice(0, limit);
  const restMinutes = sorted.slice(limit).reduce((s, x) => s + x.minutes, 0);
  if (restMinutes > 0) top.push({ subject: "기타", minutes: restMinutes });
  return top;
}

export function computeWeekInsightMetrics(
  days: WeekDay[],
  blocks: WeekBlock[],
  logs: WeekLog[]
) {
  const totalStudyMinutes = days.reduce((sum, day) => {
    const dayId = Number(day.id);
    if (!Number.isFinite(dayId)) return sum;
    return sum + sumBlocksMinutesForDay(blocks, dayId);
  }, 0);

  const rates: number[] = [];
  const logsByDate = new Map<string, WeekLog>();
  for (const log of logs) {
    const key = seoulDateKeyFromApiValue(log.date) || String(log.date).slice(0, 10);
    if (key) logsByDate.set(key, log);
  }
  for (const day of days) {
    const key = seoulDateKeyFromApiValue(day.date) || String(day.date).slice(0, 10);
    const rate = logsByDate.get(key)?.planCompletionRate;
    if (rate != null && Number.isFinite(Number(rate))) rates.push(Number(rate));
  }
  let planCompletionPct: number | null = null;
  if (rates.length > 0) {
    planCompletionPct = Math.round(rates.reduce((a, b) => a + b, 0) / rates.length);
  } else {
    const totalBlocks = blocks.length;
    const doneBlocks = blocks.filter(b => b.done).length;
    if (totalBlocks > 0) {
      planCompletionPct = Math.round((doneBlocks / totalBlocks) * 100);
    }
  }

  return { totalStudyMinutes, planCompletionPct };
}

export function todayVisitContext(
  visits: StudyRoomVisitSession[],
  todayKey = getDateKeySeoul(0)
) {
  const active = visits.find(v => !v.exitedAt) || null;
  const latest = visits[visits.length - 1] || null;
  return { active, latest, todayKey };
}
