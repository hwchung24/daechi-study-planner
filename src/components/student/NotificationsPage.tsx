import React, { useEffect, useRef, useState } from "react";
import {
  scheduleBackgroundUiUpdate,
  stableStringify
} from "../../lib/stableUiUpdate";

type NotificationItem = {
  id: number | string;
  title: string;
  body?: string | null;
  read_at?: string | null;
  created_at: string;
};

export type ParentNotificationAction = {
  type: "parent_app_timetable_request";
  studentEmail?: string;
  targetDate?: string;
  summary?: string;
  slotSummary?: string;
  slots?: Array<{
    dayKey?: "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
    title?: string;
    source?: "schedule" | "plan" | "free";
    startTime?: string;
    endTime?: string;
    reason?: string;
    allowedApps?: Array<{
      id?: string;
      name?: string;
      category?: string;
      description?: string | null;
      bundleId?: string | null;
    }>;
  }>;
} | {
  type: "link_unlink_request";
  requestId: number;
  initiatorRole: "parent" | "student";
  counterpartEmail?: string;
};

const NOTIFICATION_ACTION_PREFIX = "[[DAECHI_ACTION]]";

function parseNotificationAction(body?: string | null): {
  visibleBody: string | null;
  action: ParentNotificationAction | null;
} {
  const raw = String(body || "");
  if (!raw.startsWith(NOTIFICATION_ACTION_PREFIX)) {
    return {
      visibleBody: raw.trim() || null,
      action: null
    };
  }

  const rest = raw.slice(NOTIFICATION_ACTION_PREFIX.length);
  const divider = rest.indexOf("\n\n");
  const jsonText = divider >= 0 ? rest.slice(0, divider).trim() : rest.trim();
  const visibleBody = divider >= 0 ? rest.slice(divider + 2).trim() : "";
  try {
    const parsed = JSON.parse(jsonText) as Partial<ParentNotificationAction>;
    if (parsed?.type === "parent_app_timetable_request") {
      return {
        visibleBody: visibleBody || null,
        action: {
          type: "parent_app_timetable_request",
          studentEmail:
            parsed.studentEmail != null ? String(parsed.studentEmail).trim() : undefined,
          targetDate:
            parsed.targetDate != null ? String(parsed.targetDate).trim() : undefined,
          summary: parsed.summary != null ? String(parsed.summary).trim() : undefined,
          slotSummary:
            parsed.slotSummary != null ? String(parsed.slotSummary).trim() : undefined,
          slots: Array.isArray(parsed.slots)
            ? parsed.slots.map(slot => ({
                title: slot?.title != null ? String(slot.title).trim() : undefined,
                source:
                  slot?.source === "schedule"
                    ? "schedule"
                    : slot?.source === "free"
                      ? "free"
                      : "plan",
                startTime:
                  slot?.startTime != null ? String(slot.startTime).trim() : undefined,
                endTime: slot?.endTime != null ? String(slot.endTime).trim() : undefined,
                reason: slot?.reason != null ? String(slot.reason).trim() : undefined,
                allowedApps: Array.isArray(slot?.allowedApps)
                  ? slot.allowedApps.map(app => ({
                      id: app?.id != null ? String(app.id).trim() : undefined,
                      name: app?.name != null ? String(app.name).trim() : undefined,
                      category:
                        app?.category != null ? String(app.category).trim() : undefined,
                      description:
                        app?.description != null ? String(app.description).trim() : null,
                      bundleId:
                        app?.bundleId != null ? String(app.bundleId).trim() : null
                    }))
                  : undefined
              }))
            : undefined
        }
      };
    }
    if (
      parsed?.type === "link_unlink_request" &&
      Number.isFinite(Number(parsed.requestId)) &&
      (parsed.initiatorRole === "parent" || parsed.initiatorRole === "student")
    ) {
      return {
        visibleBody: visibleBody || null,
        action: {
          type: "link_unlink_request",
          requestId: Number(parsed.requestId),
          initiatorRole: parsed.initiatorRole,
          counterpartEmail:
            parsed.counterpartEmail != null
              ? String(parsed.counterpartEmail).trim()
              : undefined
        }
      };
    }
  } catch {
    // ignore malformed action payload
  }
  return {
    visibleBody: visibleBody || raw.trim() || null,
    action: null
  };
}

function formatNotificationTime(value: string) {
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(dt);
}

const NOTIF_SESSION_CACHE_PREFIX = "daechi:notif:v1:";

function readCachedNotifications(
  role: string,
  token: string
): NotificationItem[] | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(
      `${NOTIF_SESSION_CACHE_PREFIX}${role}:${token.slice(0, 32)}`
    );
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed as NotificationItem[];
  } catch {
    return null;
  }
}

function writeCachedNotifications(
  role: string,
  token: string,
  items: NotificationItem[]
) {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(
      `${NOTIF_SESSION_CACHE_PREFIX}${role}:${token.slice(0, 32)}`,
      JSON.stringify(items)
    );
  } catch {
    // ignore quota / private mode
  }
}

export function NotificationsPage(props: {
  apiBase: string;
  authToken: string | null;
  meRole: string | null;
  parentStudentEmail?: string | null;
  onReadAll?: () => void;
  onNotificationAction?: (action: ParentNotificationAction) => void;
}) {
  const token = String(props.authToken || "").trim();
  const role = String(props.meRole || "").trim().toLowerCase();
  const cachedInitial =
    token && (role === "student" || role === "parent")
      ? readCachedNotifications(role, token)
      : null;
  const [items, setItems] = useState<NotificationItem[]>(() => cachedInitial ?? []);
  const [loading, setLoading] = useState(
    () => !(cachedInitial && cachedInitial.length > 0)
  );
  const [error, setError] = useState("");
  const itemsSigRef = useRef<string | null>(
    cachedInitial ? stableStringify(cachedInitial) : null
  );

  useEffect(() => {
    if (!token || (role !== "student" && role !== "parent")) {
      setItems([]);
      setLoading(false);
      setError("");
      itemsSigRef.current = null;
      return;
    }

    let cancelled = false;
    const listUrl =
      role === "parent"
        ? `${props.apiBase}/api/parent/notifications`
        : `${props.apiBase}/api/student/notifications`;
    const readAllUrl =
      role === "parent"
        ? `${props.apiBase}/api/parent/notifications/read-all`
        : `${props.apiBase}/api/student/notifications/read-all`;

    const cached = readCachedNotifications(role, token);
    if (cached && cached.length > 0) {
      scheduleBackgroundUiUpdate(() => {
        if (cancelled) return;
        setItems(cached);
        setLoading(false);
        setError("");
      });
    } else {
      setLoading(true);
    }
    setError("");

    (async () => {
      try {
        const res = await fetch(listUrl, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store"
        });
        if (!res.ok) {
          throw new Error("알림을 불러오지 못했습니다.");
        }
        const data = await res.json();
        const rawNext = Array.isArray(data?.notifications) ? data.notifications : [];
        const targetEmail =
          role === "parent" ? String(props.parentStudentEmail || "").trim().toLowerCase() : "";
        const next = targetEmail
          ? rawNext.filter((item: NotificationItem) => {
              const parsed = parseNotificationAction(item.body);
              const action = parsed.action;
              if (action?.type === "parent_app_timetable_request") {
                const email = String(action.studentEmail || "").trim().toLowerCase();
                return email === targetEmail;
              }
              if (action?.type === "link_unlink_request") {
                const email = String(action.counterpartEmail || "").trim().toLowerCase();
                return email === targetEmail;
              }
              const title = String(item.title || "").toLowerCase();
              const body = String(item.body || "").toLowerCase();
              return title.includes(targetEmail) || body.includes(targetEmail);
            })
          : rawNext;
        const sig = stableStringify(next);
        if (!cancelled) {
          if (itemsSigRef.current !== sig) {
            itemsSigRef.current = sig;
            writeCachedNotifications(role, token, next);
            scheduleBackgroundUiUpdate(() => setItems(next));
          }
        }
        await fetch(readAllUrl, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!cancelled) props.onReadAll?.();
      } catch (e) {
        if (!cancelled) {
          if (!cached || cached.length === 0) {
            setItems([]);
          }
          setError(
            e instanceof Error && e.message ? e.message : "알림을 불러오지 못했습니다."
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [props.apiBase, props.authToken, props.meRole, props.onReadAll, props.parentStudentEmail, role, token]);

  return (
    <div className="notifications-page__modal-content">
      {loading ? (
        <div
          className="notifications-page__skeleton-list"
          role="status"
          aria-live="polite"
          aria-label="알림을 불러오는 중"
        >
          <span className="sr-only">알림을 불러오는 중</span>
          {[0, 1, 2, 3].map(key => (
            <div key={key} className="notifications-page__skeleton-item" aria-hidden>
              <div className="notifications-page__skeleton-title" />
              <div className="notifications-page__skeleton-body" />
              <div className="notifications-page__skeleton-body notifications-page__skeleton-body--narrow" />
              <div className="notifications-page__skeleton-time" />
            </div>
          ))}
        </div>
      ) : error ? (
        <p className="notifications-page__empty notifications-page__empty--modal">
          {error}
        </p>
      ) : !items.length ? (
        <p className="notifications-page__empty notifications-page__empty--modal">
          알림이 없습니다.
        </p>
      ) : (
        <div className="notifications-page__list">
          {items.map(item => {
            const parsed = parseNotificationAction(item.body);
            const actionable = parsed.action != null;
            return (
              <div
                key={item.id}
                className={
                  "notifications-page__item" +
                  (actionable ? " notifications-page__item--actionable" : "")
                }
                role={actionable ? "button" : undefined}
                tabIndex={actionable ? 0 : undefined}
                onClick={() => {
                  if (parsed.action) props.onNotificationAction?.(parsed.action);
                }}
                onKeyDown={event => {
                  if (!parsed.action) return;
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    props.onNotificationAction?.(parsed.action);
                  }
                }}
              >
                <div className="notifications-page__item-title">{item.title}</div>
                {parsed.visibleBody ? (
                  <div className="notifications-page__item-body">{parsed.visibleBody}</div>
                ) : null}
                {actionable ? (
                  <div className="notifications-page__item-link">눌러서 확인</div>
                ) : null}
                <div className="notifications-page__item-time">
                  {formatNotificationTime(item.created_at)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
