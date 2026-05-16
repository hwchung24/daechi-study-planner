import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, Bell, Search, Users, Link2, Clock, Brain } from "lucide-react";
import { SuperAdminFewshotPanel } from "./SuperAdminFewshotPanel";

type SuperAdminUser = {
  id: number;
  email: string;
  role: "student" | "parent" | string;
  createdAt: string | null;
  studentName: string | null;
  parentPhone: string | null;
};

type SuperAdminLink = {
  parentUserId: number;
  parentEmail: string;
  studentUserId: number;
  studentEmail: string;
  studentName: string | null;
};

type SuperAdminPendingLink = {
  id: number;
  parentUserId: number;
  parentEmail: string;
  studentUserId: number;
  studentEmail: string;
  studentName: string | null;
  initiatedBy: string;
  createdAt: string | null;
};

type SuperAdminOverview = {
  users: SuperAdminUser[];
  links: SuperAdminLink[];
  pendingLinks: SuperAdminPendingLink[];
};

type NotifyTarget = SuperAdminUser | null;

function roleLabel(role: string) {
  if (role === "parent") return "학부모";
  if (role === "student") return "학생";
  return role;
}

function formatDate(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "short",
      day: "numeric"
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

function displayName(user: SuperAdminUser) {
  if (user.role === "student" && user.studentName) return user.studentName;
  return user.email.split("@")[0] || user.email;
}

export function SuperAdminPage(props: {
  apiBase: string;
  authToken: string;
  userEmail: string;
  onExit: () => void;
}) {
  const [overview, setOverview] = useState<SuperAdminOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | "student" | "parent">("all");
  const [mainTab, setMainTab] = useState<"accounts" | "fewshot">("accounts");
  const [section, setSection] = useState<"users" | "links" | "pending">("users");
  const [notifyTarget, setNotifyTarget] = useState<NotifyTarget>(null);
  const [notifyTitle, setNotifyTitle] = useState("");
  const [notifyBody, setNotifyBody] = useState("");
  const [notifyPush, setNotifyPush] = useState(true);
  const [notifySending, setNotifySending] = useState(false);
  const [notifyMessage, setNotifyMessage] = useState("");

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${props.apiBase}/api/super-admin/overview`, {
        headers: { Authorization: `Bearer ${props.authToken}` }
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "목록을 불러오지 못했습니다.");
      }
      const data = (await res.json()) as SuperAdminOverview;
      setOverview(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [props.apiBase, props.authToken]);

  useEffect(() => {
    if (mainTab !== "accounts") return;
    void loadOverview();
  }, [loadOverview, mainTab]);

  const stats = useMemo(() => {
    const users = overview?.users ?? [];
    return {
      total: users.length,
      students: users.filter(u => u.role === "student").length,
      parents: users.filter(u => u.role === "parent").length,
      links: overview?.links.length ?? 0,
      pending: overview?.pendingLinks.length ?? 0
    };
  }, [overview]);

  const filteredUsers = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (overview?.users ?? []).filter(user => {
      if (roleFilter !== "all" && user.role !== roleFilter) return false;
      if (!q) return true;
      const hay = [
        user.email,
        user.studentName ?? "",
        user.parentPhone ?? "",
        String(user.id)
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [overview?.users, query, roleFilter]);

  const filteredLinks = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (overview?.links ?? []).filter(link => {
      if (!q) return true;
      const hay = [
        link.parentEmail,
        link.studentEmail,
        link.studentName ?? "",
        String(link.parentUserId),
        String(link.studentUserId)
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [overview?.links, query]);

  const sendNotification = async () => {
    if (!notifyTarget) return;
    const title = notifyTitle.trim();
    const body = notifyBody.trim();
    if (!title) {
      setNotifyMessage("제목을 입력해 주세요.");
      return;
    }
    setNotifySending(true);
    setNotifyMessage("");
    try {
      const res = await fetch(`${props.apiBase}/api/super-admin/notify`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${props.authToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          userId: notifyTarget.id,
          title,
          body,
          sendPush: notifyPush
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "알림 전송에 실패했습니다.");
      }
      setNotifyMessage("알림을 보냈습니다.");
      setNotifyTitle("");
      setNotifyBody("");
    } catch (e) {
      setNotifyMessage(e instanceof Error ? e.message : "알림 전송에 실패했습니다.");
    } finally {
      setNotifySending(false);
    }
  };

  return (
    <div className="super-admin">
      <header className="super-admin__header">
        <button
          type="button"
          className="super-admin__back"
          aria-label="돌아가기"
          onClick={props.onExit}
        >
          <ChevronLeft size={22} />
        </button>
        <div className="super-admin__header-text">
          <h1 className="super-admin__title">총괄 관리</h1>
          <p className="super-admin__subtitle">{props.userEmail}</p>
        </div>
        {mainTab === "accounts" ? (
          <button
            type="button"
            className="super-admin__refresh"
            onClick={() => void loadOverview()}
            disabled={loading}
          >
            새로고침
          </button>
        ) : null}
      </header>

      <div className="super-admin__main-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mainTab === "accounts"}
          className={
            "super-admin__main-tab" +
            (mainTab === "accounts" ? " super-admin__main-tab--active" : "")
          }
          onClick={() => setMainTab("accounts")}
        >
          <Users size={16} /> 사용자·연결
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mainTab === "fewshot"}
          className={
            "super-admin__main-tab" +
            (mainTab === "fewshot" ? " super-admin__main-tab--active" : "")
          }
          onClick={() => setMainTab("fewshot")}
        >
          <Brain size={16} /> Few-shot·신호
        </button>
      </div>

      {mainTab === "fewshot" ? (
        <SuperAdminFewshotPanel apiBase={props.apiBase} authToken={props.authToken} />
      ) : null}

      {mainTab === "accounts" ? (
        <>
      <div className="super-admin__stats">
        <div className="super-admin__stat">
          <Users size={16} />
          <span>전체 {stats.total}</span>
        </div>
        <div className="super-admin__stat">학생 {stats.students}</div>
        <div className="super-admin__stat">학부모 {stats.parents}</div>
        <div className="super-admin__stat">
          <Link2 size={16} />
          <span>연결 {stats.links}</span>
        </div>
        {stats.pending > 0 ? (
          <div className="super-admin__stat super-admin__stat--warn">
            <Clock size={16} />
            <span>대기 {stats.pending}</span>
          </div>
        ) : null}
      </div>

      <div className="super-admin__toolbar">
        <label className="super-admin__search">
          <Search size={16} />
          <input
            type="search"
            placeholder="이메일, 이름, ID 검색"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </label>
        <div className="super-admin__tabs" role="tablist">
          {(
            [
              ["users", "사용자"],
              ["links", "연결"],
              ["pending", "연결 대기"]
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={section === key}
              className={
                "super-admin__tab" + (section === key ? " super-admin__tab--active" : "")
              }
              onClick={() => setSection(key)}
            >
              {label}
            </button>
          ))}
        </div>
        {section === "users" ? (
          <div className="super-admin__filters">
            {(
              [
                ["all", "전체"],
                ["student", "학생"],
                ["parent", "학부모"]
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={
                  "super-admin__filter" +
                  (roleFilter === key ? " super-admin__filter--active" : "")
                }
                onClick={() => setRoleFilter(key)}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <main className="super-admin__main">
        {loading ? <p className="super-admin__status">불러오는 중…</p> : null}
        {error ? (
          <p className="super-admin__status super-admin__status--error">{error}</p>
        ) : null}

        {!loading && !error && section === "users" ? (
          <ul className="super-admin__list">
            {filteredUsers.map(user => (
              <li key={user.id} className="super-admin__card">
                <div className="super-admin__card-main">
                  <span
                    className={
                      "super-admin__badge super-admin__badge--" + user.role
                    }
                  >
                    {roleLabel(user.role)}
                  </span>
                  <strong className="super-admin__card-title">{displayName(user)}</strong>
                  <span className="super-admin__card-meta">{user.email}</span>
                  {user.studentName ? (
                    <span className="super-admin__card-meta">이름: {user.studentName}</span>
                  ) : null}
                  {user.parentPhone ? (
                    <span className="super-admin__card-meta">전화: {user.parentPhone}</span>
                  ) : null}
                  <span className="super-admin__card-meta">
                    ID {user.id} · 가입 {formatDate(user.createdAt)}
                  </span>
                </div>
                <button
                  type="button"
                  className="super-admin__notify-btn"
                  onClick={() => {
                    setNotifyTarget(user);
                    setNotifyMessage("");
                  }}
                >
                  <Bell size={16} />
                  알림
                </button>
              </li>
            ))}
            {!filteredUsers.length ? (
              <li className="super-admin__empty">검색 결과가 없습니다.</li>
            ) : null}
          </ul>
        ) : null}

        {!loading && !error && section === "links" ? (
          <ul className="super-admin__list">
            {filteredLinks.map(link => (
              <li key={`${link.parentUserId}-${link.studentUserId}`} className="super-admin__card">
                <div className="super-admin__card-main">
                  <strong className="super-admin__card-title">학부모 ↔ 학생</strong>
                  <span className="super-admin__card-meta">학부모: {link.parentEmail}</span>
                  <span className="super-admin__card-meta">
                    학생: {link.studentName || link.studentEmail}
                  </span>
                  <span className="super-admin__card-meta">
                    ID {link.parentUserId} → {link.studentUserId}
                  </span>
                </div>
                <div className="super-admin__card-actions">
                  <button
                    type="button"
                    className="super-admin__notify-btn"
                    onClick={() => {
                      const parent = overview?.users.find(u => u.id === link.parentUserId);
                      if (parent) {
                        setNotifyTarget(parent);
                        setNotifyMessage("");
                      }
                    }}
                  >
                    학부모 알림
                  </button>
                  <button
                    type="button"
                    className="super-admin__notify-btn"
                    onClick={() => {
                      const student = overview?.users.find(u => u.id === link.studentUserId);
                      if (student) {
                        setNotifyTarget(student);
                        setNotifyMessage("");
                      }
                    }}
                  >
                    학생 알림
                  </button>
                </div>
              </li>
            ))}
            {!filteredLinks.length ? (
              <li className="super-admin__empty">연결된 계정이 없습니다.</li>
            ) : null}
          </ul>
        ) : null}

        {!loading && !error && section === "pending" ? (
          <ul className="super-admin__list">
            {(overview?.pendingLinks ?? []).map(req => (
              <li key={req.id} className="super-admin__card">
                <div className="super-admin__card-main">
                  <span className="super-admin__badge super-admin__badge--pending">
                    연결 대기
                  </span>
                  <span className="super-admin__card-meta">
                    요청: {req.initiatedBy === "parent" ? "학부모" : "학생"}
                  </span>
                  <span className="super-admin__card-meta">학부모: {req.parentEmail}</span>
                  <span className="super-admin__card-meta">
                    학생: {req.studentName || req.studentEmail}
                  </span>
                  <span className="super-admin__card-meta">
                    {formatDate(req.createdAt)}
                  </span>
                </div>
              </li>
            ))}
            {!overview?.pendingLinks.length ? (
              <li className="super-admin__empty">대기 중인 연결 요청이 없습니다.</li>
            ) : null}
          </ul>
        ) : null}
      </main>

      {notifyTarget ? (
        <div
          className="super-admin__modal-backdrop"
          role="presentation"
          onClick={() => setNotifyTarget(null)}
        >
          <div
            className="super-admin__modal"
            role="dialog"
            aria-labelledby="super-admin-notify-title"
            onClick={e => e.stopPropagation()}
          >
            <h2 id="super-admin-notify-title" className="super-admin__modal-title">
              알림 보내기
            </h2>
            <p className="super-admin__modal-target">
              {roleLabel(notifyTarget.role)} · {notifyTarget.email}
            </p>
            <label className="super-admin__field">
              <span>제목</span>
              <input
                type="text"
                value={notifyTitle}
                onChange={e => setNotifyTitle(e.target.value)}
                placeholder="알림 제목"
                maxLength={120}
              />
            </label>
            <label className="super-admin__field">
              <span>내용</span>
              <textarea
                value={notifyBody}
                onChange={e => setNotifyBody(e.target.value)}
                placeholder="알림 본문 (선택)"
                rows={4}
                maxLength={2000}
              />
            </label>
            <label className="super-admin__checkbox">
              <input
                type="checkbox"
                checked={notifyPush}
                onChange={e => setNotifyPush(e.target.checked)}
              />
              푸시 알림도 함께 보내기
            </label>
            {notifyMessage ? (
              <p
                className={
                  "super-admin__notify-msg" +
                  (notifyMessage.includes("보냈") ? " super-admin__notify-msg--ok" : "")
                }
              >
                {notifyMessage}
              </p>
            ) : null}
            <div className="super-admin__modal-actions">
              <button type="button" onClick={() => setNotifyTarget(null)}>
                취소
              </button>
              <button
                type="button"
                className="super-admin__modal-submit"
                disabled={notifySending}
                onClick={() => void sendNotification()}
              >
                {notifySending ? "전송 중…" : "보내기"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
        </>
      ) : null}
    </div>
  );
}