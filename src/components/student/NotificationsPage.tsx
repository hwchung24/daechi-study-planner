import React, { useEffect, useState } from "react";

type NotificationItem = {
  id: number | string;
  title: string;
  body?: string | null;
  read_at?: string | null;
  created_at: string;
};

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
      {items.map(item => (
        <div key={item.id} className="notifications-page__item">
          <div className="notifications-page__item-title">{item.title}</div>
          {item.body ? <div className="notifications-page__item-body">{item.body}</div> : null}
          <div className="notifications-page__item-time">
            {formatNotificationTime(item.created_at)}
          </div>
        </div>
      ))}
    </div>
  );
}
