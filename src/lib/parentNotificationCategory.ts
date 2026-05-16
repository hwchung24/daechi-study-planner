const NOTIFICATION_ACTION_PREFIX = "[[DAECHI_ACTION]]";

export type ParentNotificationCategory =
  | "study_room"
  | "request"
  | "connection"
  | "message"
  | "report"
  | "homework"
  | "other";

export type ParentNotificationCategoryFilter = ParentNotificationCategory | "all";

export const PARENT_NOTIFICATION_CATEGORY_ORDER: ParentNotificationCategoryFilter[] = [
  "all",
  "study_room",
  "request",
  "connection",
  "message",
  "report",
  "homework"
];

function getEmbeddedActionType(body?: string | null): string | null {
  const raw = String(body || "");
  if (!raw.startsWith(NOTIFICATION_ACTION_PREFIX)) return null;
  const rest = raw.slice(NOTIFICATION_ACTION_PREFIX.length);
  const divider = rest.indexOf("\n\n");
  const jsonText = divider >= 0 ? rest.slice(0, divider).trim() : rest.trim();
  try {
    const parsed = JSON.parse(jsonText) as { type?: string };
    return parsed?.type != null ? String(parsed.type) : null;
  } catch {
    return null;
  }
}

export function classifyParentNotification(item: {
  title?: string | null;
  body?: string | null;
}): ParentNotificationCategory {
  const actionType = getEmbeddedActionType(item.body);
  if (actionType === "parent_app_timetable_request") return "request";
  if (actionType === "link_unlink_request") return "connection";

  const title = String(item.title || "");
  const body = String(item.body || "");
  const text = `${title} ${body}`;

  if (/독서실|체크인|체크아웃/.test(text)) return "study_room";
  if (/숙제/.test(text)) return "homework";
  if (/요청|허용 앱|계획 수정|타임테이블/.test(text)) return "request";
  if (/연결|해제|링크|끊기|MDM|기기/.test(text)) return "connection";
  if (/메시지|채널/.test(text)) return "message";
  if (/리포트|AI 리포트|성장/.test(text)) return "report";
  return "other";
}

export function matchesParentNotificationCategory(
  item: { title?: string | null; body?: string | null },
  filter: ParentNotificationCategoryFilter
) {
  if (filter === "all") return true;
  return classifyParentNotification(item) === filter;
}
