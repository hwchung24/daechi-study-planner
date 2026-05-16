import React, { useCallback, useEffect, useState } from "react";
import ko from "../fallbacks/ko.json";
import { tpl } from "../fallbacks/tpl";

const N = ko.parentNotificationsHub;

type PlanAddRequest = {
  id: number;
  student_user_id: number;
  target_date: string;
  start_time: string;
  end_time: string;
  subject_snapshot: string;
  student_email?: string;
};

export function ParentNotificationsPending(props: {
  apiBase: string;
  authToken: string | null;
  selectedStudentEmail?: string | null;
  onQueueChanged?: () => void;
}) {
  const [requests, setRequests] = useState<PlanAddRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [actingId, setActingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!props.authToken) {
      setRequests([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${props.apiBase}/api/parent/plan-add-requests?limit=20`, {
        headers: { Authorization: `Bearer ${props.authToken}` },
        cache: "no-store"
      });
      const data = (await res.json().catch(() => ({}))) as { requests?: PlanAddRequest[]; error?: string };
      if (!res.ok) throw new Error(data.error || N.loadFailed);
      let rows = Array.isArray(data.requests) ? data.requests : [];
      const email = String(props.selectedStudentEmail || "").trim().toLowerCase();
      if (email) {
        rows = rows.filter(r => String(r.student_email || "").toLowerCase() === email);
      }
      setRequests(rows.slice(0, 3));
    } catch (e) {
      setError(e instanceof Error ? e.message : N.loadFailed);
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, [props.apiBase, props.authToken, props.selectedStudentEmail]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (id: number, action: "approve" | "reject") => {
    if (!props.authToken || actingId != null) return;
    setActingId(id);
    try {
      const parentNote = String(notes[id] || "").trim() || undefined;
      const res = await fetch(
        `${props.apiBase}/api/parent/plan-add-requests/${id}/${action}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${props.authToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(parentNote ? { parentNote } : {})
        }
      );
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || N.actionFailed);
      setRequests(prev => prev.filter(r => r.id !== id));
      props.onQueueChanged?.();
    } catch (e) {
      alert(e instanceof Error ? e.message : N.actionFailed);
    } finally {
      setActingId(null);
    }
  };

  if (!props.authToken) return null;

  return (
    <div className="coach-card coach-card--padded parent-notifications-pending">
      <h2 className="coach-section-title">{N.pendingTitle}</h2>
      {loading ? (
        <div className="parent-skeleton parent-skeleton--phrase-short" aria-busy="true" />
      ) : error ? (
        <p className="parent-type-caption">{error}</p>
      ) : requests.length === 0 ? (
        <p className="parent-type-caption">{N.pendingEmpty}</p>
      ) : (
        <ul className="parent-notifications-pending__list">
          {requests.map(r => (
            <li key={r.id} className="parent-notifications-pending__item">
              <p className="parent-type-body">
                {tpl(N.planAddLine, {
                  date: r.target_date,
                  start: r.start_time,
                  end: r.end_time,
                  subject: r.subject_snapshot
                })}
              </p>
              <input
                type="text"
                className="parent-notifications-pending__note"
                placeholder={N.parentNotePlaceholder}
                value={notes[r.id] || ""}
                onChange={e => setNotes(prev => ({ ...prev, [r.id]: e.target.value }))}
              />
              <div className="parent-notifications-pending__actions">
                <button
                  type="button"
                  className="coach-ghost-btn"
                  disabled={actingId === r.id}
                  onClick={() => void act(r.id, "reject")}
                >
                  {N.reject}
                </button>
                <button
                  type="button"
                  className="timeline-save-button study-room-editor__save-button"
                  disabled={actingId === r.id}
                  onClick={() => void act(r.id, "approve")}
                >
                  {N.approve}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
