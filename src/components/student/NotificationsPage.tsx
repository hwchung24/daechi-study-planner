import React, { useEffect, useState } from "react";

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
            parsed.slotSummary != null ? String(parsed.slotSummary).trim() : undefined
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

export function NotificationsPage(props: {
  apiBase: string;
  authToken: string | null;
  meRole: string | null;
  onReadAll?: () => void;
  onNotificationAction?: (action: ParentNotificationAction) => void;
}) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const token = String(props.authToken || "").trim();
    const role = String(props.meRole || "").trim().toLowerCase();
    if (!token || (role !== "student" && role !== "parent")) {
      setItems([]);
      setLoading(false);
      setError("");
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

    setLoading(true);
    setError("");

    (async () => {
      try {
        const res = await fetch(listUrl, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store"
        });
        if (!res.ok) {
          throw new Error("알림 목록을 불러오지 못했습니다.");
        }
        const data = await res.json();
        if (!cancelled) {
          setItems(Array.isArray(data?.notifications) ? data.notifications : []);
        }
        await fetch(readAllUrl, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!cancelled) props.onReadAll?.();
      } catch (e) {
        if (!cancelled) {
          setItems([]);
          setError(
            e instanceof Error && e.message ? e.message : "알림을 불러오지 못했습니다."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [props.apiBase, props.authToken, props.meRole, props.onReadAll]);

  if (loading) {
    return (
      <p className="notifications-page__empty notifications-page__empty--modal">
        알림을 불러오는 중입니다.
      </p>
    );
  }

  if (error) {
    return (
      <p className="notifications-page__empty notifications-page__empty--modal">
        {error}
      </p>
    );
  }

  if (!items.length) {
    return (
      <p className="notifications-page__empty notifications-page__empty--modal">
        새 알림이 없습니다.
      </p>
    );
  }

  return (
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
      )})}
    </div>
  );
}
