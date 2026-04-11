import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Paperclip, SendHorizontal, User } from "lucide-react";
import { Card, EmptyState } from "../ui/components";
import { API_BASE } from "../../lib/apiBase";
import { useModalReveal } from "../../lib/useModalReveal";
import { AppShell, canUseNativeAppShell } from "../../lib/nativeAppShell";

type AdminChatMessage = {
  id: number;
  senderRole: "student" | "parent";
  content: string;
  createdAt: string;
};

type HomeworkReviewStatus = "pending" | "approved" | "needs_revision";

type HomeworkSubmission = {
  id: number;
  originalName: string;
  fileUrl: string;
  mimeType: string | null;
  fileSize: number | null;
  note: string;
  reviewStatus: HomeworkReviewStatus;
  reviewComment: string;
  createdAt: string;
  reviewedAt: string | null;
};

type StudentAdminChannelResponse = {
  channelAvailable?: boolean;
  parent?: {
    id: number;
    email: string;
  } | null;
  messages?: AdminChatMessage[];
  submissions?: HomeworkSubmission[];
};

type ParentAdminChannelResponse = {
  student?: {
    id: number;
    email: string;
  } | null;
  messages?: AdminChatMessage[];
  submissions?: HomeworkSubmission[];
};

type HomeworkReviewFilter = "pending" | "needs_revision" | "approved";

function DefaultChatAvatar(props: { label: string }) {
  return (
    <span className="coach-avatar coach-admin-chat__avatar" role="img" aria-label={props.label}>
      <User size={16} strokeWidth={2.1} aria-hidden />
    </span>
  );
}

function formatChatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "방금";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function formatFileSize(size: number | null) {
  if (!size || size <= 0) return "크기 정보 없음";
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 102.4) / 10)}KB`;
  return `${Math.round((size / (1024 * 1024)) * 10) / 10}MB`;
}

function resolveApiAssetUrl(fileUrl: string) {
  const raw = String(fileUrl || "").trim();
  if (!raw) return "#";
  if (/^https?:\/\//i.test(raw)) return raw;
  return `${API_BASE}${raw.startsWith("/") ? raw : `/${raw}`}`;
}

async function openSubmissionAsset(fileUrl: string) {
  const resolvedUrl = resolveApiAssetUrl(fileUrl);
  if (!resolvedUrl || resolvedUrl === "#") return;

  if (canUseNativeAppShell()) {
    try {
      await AppShell.openExternalUrl({ url: resolvedUrl });
      return;
    } catch {
      // Fall through to browser open.
    }
  }

  if (typeof window !== "undefined") {
    window.open(resolvedUrl, "_blank", "noopener,noreferrer");
  }
}

function ChatMessages(props: {
  messages: AdminChatMessage[];
  currentUserRole: "student" | "parent";
  peerLabel: string;
  emptyState?: React.ReactNode;
  trailingContent?: React.ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [props.messages, props.trailingContent]);

  return (
    <div ref={scrollRef} className="coach-chat coach-admin-chat__messages">
      {props.messages.length === 0 ? (
        props.emptyState || <div className="coach-admin-chat__empty">아직 대화가 없습니다. 첫 메시지를 보내 보세요.</div>
      ) : (
        props.messages.map(message => {
          const mine = message.senderRole === props.currentUserRole;
          return (
            <div
              key={message.id}
              className={"coach-bubble-row " + (mine ? "is-user" : "is-coach")}
            >
              {!mine && <DefaultChatAvatar label={props.peerLabel} />}
              <div
                className={
                  "coach-bubble " +
                  (mine ? "coach-bubble--user" : "coach-bubble--coach")
                }
              >
                {message.content.split("\n").map((line, index) => (
                  <div key={index} className="coach-bubble__line">
                    {line || "\u00A0"}
                  </div>
                ))}
              </div>
            </div>
          );
        })
      )}
      {props.trailingContent}
    </div>
  );
}

function AdminChatShell(props: {
  messages: AdminChatMessage[];
  currentUserRole: "student" | "parent";
  peerLabel: string;
  draft: string;
  setDraft: (value: string) => void;
  sending: boolean;
  onSend: (message: string) => Promise<void> | void;
  emptyState?: React.ReactNode;
  trailingContent?: React.ReactNode;
  triggerPlaceholder?: string;
  title?: string;
  hint?: string;
  showFrame?: boolean;
  showHeader?: boolean;
  starterContent?: React.ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const inputDockRef = useRef<HTMLDivElement | null>(null);
  const composerInputRef = useRef<HTMLInputElement | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);

  const handleSend = async () => {
    const message = props.draft.trim();
    if (!message || props.sending) return;
    await props.onSend(message);
    setComposerOpen(false);
  };

  useEffect(() => {
    if (!composerOpen) return;
    const frame = window.requestAnimationFrame(() => {
      composerInputRef.current?.focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [composerOpen]);

  useEffect(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
  }, [props.messages, props.trailingContent, composerOpen]);

  const content = (
    <>
      {props.showHeader === false ? null : (
        <div className="coach-chat-header">
          <div className="coach-chat-header__title">{props.title}</div>
          <div className="coach-admin-chat__hint">{props.hint}</div>
        </div>
      )}
      <div
        ref={rootRef}
        className={
          "coach-chat-embedded keyboard-dock-root coach-admin-chat-shell" +
          (composerOpen ? " coach-chat-composer-open" : "")
        }
      >
        {composerOpen && (
          <button
            type="button"
            className="coach-chat-composer-backdrop"
            aria-label="입력 닫기"
            onClick={() => setComposerOpen(false)}
          />
        )}
        <div ref={chatScrollRef} className="coach-admin-chat-scroll">
          <ChatMessages
            messages={props.messages}
            currentUserRole={props.currentUserRole}
            peerLabel={props.peerLabel}
            emptyState={props.emptyState}
            trailingContent={props.trailingContent}
          />
        </div>
        <div ref={inputDockRef} className="coach-chat-bottom-rail keyboard-dock coach-admin-chat-shell__rail">
          {!composerOpen && props.starterContent ? (
            <div className="coach-chat-starters" aria-label="추천 작업">
              {props.starterContent}
            </div>
          ) : null}
          {!composerOpen ? (
            <button
              type="button"
              className="coach-chat-trigger"
              onClick={() => setComposerOpen(true)}
              aria-label="메시지 입력"
            >
              <span className={props.draft.trim() ? "coach-chat-trigger__text" : "coach-chat-trigger__placeholder"}>
                {props.draft.trim() || props.triggerPlaceholder || "메시지를 입력해 보세요"}
              </span>
              <span className="coach-chat-trigger__icon" aria-hidden>
                <SendHorizontal size={15} strokeWidth={2.2} />
              </span>
            </button>
          ) : (
            <div className="coach-chat-composer" onMouseDown={event => event.stopPropagation()}>
              <div className="coach-chat-input coach-chat-input--composer">
                <input
                  ref={composerInputRef}
                  className="coach-chat-text"
                  value={props.draft}
                  enterKeyHint="send"
                  onBlur={() => {
                    window.requestAnimationFrame(() => {
                      if (document.activeElement !== composerInputRef.current) {
                        setComposerOpen(false);
                      }
                    });
                  }}
                  onChange={event => props.setDraft(event.target.value)}
                  onFocus={() => setComposerOpen(true)}
                  onKeyDown={event => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void handleSend();
                    }
                  }}
                />
                <button
                  type="button"
                  className="coach-primary-btn coach-primary-btn--sm"
                  onMouseDown={event => event.preventDefault()}
                  onClick={() => void handleSend()}
                  disabled={props.sending || !props.draft.trim()}
                  aria-label="메시지 보내기"
                  title="보내기"
                >
                  <SendHorizontal size={15} strokeWidth={2.2} aria-hidden />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );

  if (props.showFrame === false) {
    return <div className="coach-admin-chat-shell coach-admin-chat-shell--plain">{content}</div>;
  }

  return <Card className="coach-card coach-card--padded coach-admin-chat-card">{content}</Card>;
}

function SubmissionList(props: {
  submissions: HomeworkSubmission[];
  emptyText: string;
  renderActions?: (submission: HomeworkSubmission) => React.ReactNode;
  hideDefaultDownload?: boolean;
}) {
  if (!props.submissions.length) {
    return <div className="coach-admin-homework__empty">{props.emptyText}</div>;
  }

  return (
    <div className="coach-admin-homework__list">
      {props.submissions.map(submission => (
        <div key={submission.id} className="coach-admin-homework__item">
          <div className="coach-admin-homework__top">
            <div>
              <div className="coach-admin-homework__name">{submission.originalName}</div>
              <div className="coach-admin-homework__meta">
                {formatChatTimestamp(submission.createdAt)} · {formatFileSize(submission.fileSize)}
              </div>
            </div>
          </div>
          {submission.note && (
            <div className="coach-admin-homework__note">메모: {submission.note}</div>
          )}
          {submission.reviewComment && (
            <div className="coach-admin-homework__review">검토 메모: {submission.reviewComment}</div>
          )}
          <div className="coach-admin-homework__actions">
            {props.hideDefaultDownload ? null : (
              <button
                type="button"
                className="coach-ghost-btn coach-admin-homework__download"
                onClick={() => {
                  void openSubmissionAsset(submission.fileUrl);
                }}
              >
                <Download size={15} strokeWidth={2.1} /> 파일 보기
              </button>
            )}
            {props.renderActions?.(submission)}
          </div>
        </div>
      ))}
    </div>
  );
}

export function StudentAdminChannelPanel(props: { authToken: string }) {
  const [channel, setChannel] = useState<StudentAdminChannelResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [editingSubmission, setEditingSubmission] = useState<HomeworkSubmission | null>(null);
  const [showHomeworkComposer, setShowHomeworkComposer] = useState(false);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deletingSubmissionId, setDeletingSubmissionId] = useState<number | null>(null);
  const [submissionFilter, setSubmissionFilter] = useState<HomeworkReviewFilter>("pending");
  const homeworkModalReveal = useModalReveal(showHomeworkComposer);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/student/admin-channel`, {
        headers: { Authorization: `Bearer ${props.authToken}` },
        cache: "no-store"
      });
      const data = (await res.json().catch(() => ({}))) as StudentAdminChannelResponse & {
        error?: string;
      };
      if (!res.ok) throw new Error(String(data.error || "관리자 채널을 불러오지 못했습니다."));
      setChannel(data);
      setError("");
    } catch (fetchError) {
      setError(
        fetchError instanceof Error && fetchError.message
          ? fetchError.message
          : "관리자 채널을 불러오지 못했습니다."
      );
    } finally {
      setLoading(false);
    }
  }, [props.authToken]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (cancelled) return;
      await refresh();
    };
    void run();
    const timerId = window.setInterval(() => {
      void run();
    }, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timerId);
    };
  }, [refresh]);

  const sendMessage = async () => {
    const message = draft.trim();
    if (!message || sending) return;
    setSending(true);
    try {
      const res = await fetch(`${API_BASE}/api/student/admin-channel/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${props.authToken}`
        },
        body: JSON.stringify({ message })
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(String(data.error || "메시지 전송에 실패했습니다."));
      setDraft("");
      await refresh();
    } catch (sendError) {
      setError(
        sendError instanceof Error && sendError.message
          ? sendError.message
          : "메시지 전송에 실패했습니다."
      );
    } finally {
      setSending(false);
    }
  };

  const submitHomework = async () => {
    if ((!file && !editingSubmission) || uploading) return;
    setUploading(true);
    try {
      const form = new FormData();
      if (file) {
        form.append("file", file);
      }
      if (note.trim()) form.append("note", note.trim());
      const res = await fetch(
        editingSubmission
          ? `${API_BASE}/api/student/homework-submissions/${editingSubmission.id}`
          : `${API_BASE}/api/student/homework-submissions`,
        {
        method: editingSubmission ? "PATCH" : "POST",
        headers: {
          Authorization: `Bearer ${props.authToken}`
        },
        body: form
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(String(data.error || (editingSubmission ? "숙제 수정에 실패했습니다." : "숙제 제출에 실패했습니다.")));
      }
      setFile(null);
      setNote("");
      setEditingSubmission(null);
      if (editingSubmission) {
        setSubmissionFilter("pending");
      } else {
        homeworkModalReveal.beginClose(() => setShowHomeworkComposer(false));
      }
      await refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error && submitError.message
          ? submitError.message
          : editingSubmission
            ? "숙제 수정에 실패했습니다."
            : "숙제 제출에 실패했습니다."
      );
    } finally {
      setUploading(false);
    }
  };

  const startEditingSubmission = (submission: HomeworkSubmission) => {
    setEditingSubmission(submission);
    setFile(null);
    setNote(submission.note || "");
    setSubmissionFilter("pending");
  };

  const deleteSubmission = async (submission: HomeworkSubmission) => {
    if (deletingSubmissionId != null || uploading) return;
    if (typeof window !== "undefined") {
      const confirmed = window.confirm("이 제출 내역을 삭제할까요?");
      if (!confirmed) return;
    }
    setDeletingSubmissionId(submission.id);
    try {
      const res = await fetch(`${API_BASE}/api/student/homework-submissions/${submission.id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${props.authToken}`
        }
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(String(data.error || "숙제 삭제에 실패했습니다."));
      if (editingSubmission?.id === submission.id) {
        setEditingSubmission(null);
        setFile(null);
        setNote("");
      }
      await refresh();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error && deleteError.message
          ? deleteError.message
          : "숙제 삭제에 실패했습니다."
      );
    } finally {
      setDeletingSubmissionId(null);
    }
  };

  const openHomeworkComposer = () => {
    setEditingSubmission(null);
    setFile(null);
    setNote("");
    setSubmissionFilter("pending");
    setShowHomeworkComposer(true);
  };

  const closeHomeworkComposer = () => {
    setEditingSubmission(null);
    setFile(null);
    setNote("");
    homeworkModalReveal.beginClose(() => setShowHomeworkComposer(false));
  };

  if (loading && !channel) {
    return <div className="coach-admin-loading">관리자 채널을 불러오는 중입니다.</div>;
  }

  if (error && !channel) {
    return <EmptyState title="관리자 채널을 열 수 없어요" body={error} />;
  }

  if (!channel?.channelAvailable || !channel.parent) {
    return (
      <EmptyState
        title="연결된 관리자가 아직 없어요"
        body="프로필에서 관리자 연결을 완료하면 여기서 실시간 1:1 채팅과 숙제 제출을 사용할 수 있습니다."
      />
    );
  }

  const submissionCounts = {
    pending: (channel?.submissions || []).filter(submission => submission.reviewStatus === "pending")
      .length,
    needs_revision: (channel?.submissions || []).filter(
      submission => submission.reviewStatus === "needs_revision"
    ).length,
    approved: (channel?.submissions || []).filter(submission => submission.reviewStatus === "approved")
      .length
  };

  const filteredSubmissions = (channel?.submissions || []).filter(
    submission => submission.reviewStatus === submissionFilter
  );

  return (
    <div className="coach-admin-panel coach-admin-panel--student-chat">
      {error && <div className="coach-admin-error">{error}</div>}

      <div className="coach-admin-layout coach-admin-layout--single coach-admin-layout--student-chat">
        <AdminChatShell
          messages={channel.messages || []}
          currentUserRole="student"
          peerLabel="관리자"
          draft={draft}
          setDraft={setDraft}
          sending={sending}
          onSend={sendMessage}
          triggerPlaceholder="관리자에게 메시지를 입력해 보세요"
          showFrame={false}
          showHeader={false}
          starterContent={
            <button
              type="button"
              className="coach-starter coach-admin-chat__starter-button"
              onClick={openHomeworkComposer}
            >
              숙제 제출하기
            </button>
          }
        />
      </div>

      {showHomeworkComposer && (
        <div
          className={"dday-modal" + (homeworkModalReveal.revealed ? " dday-modal--open" : "")}
          onClick={closeHomeworkComposer}
        >
          <div
            className="dday-modal-inner coach-admin-review-modal"
            onClick={event => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="coach-admin-homework-modal-title"
          >
            <div className="dday-modal-header">
              <span id="coach-admin-homework-modal-title" className="dday-modal-title">
                {editingSubmission ? "숙제 수정" : "숙제 제출"}
              </span>
            </div>
            <div className="dday-modal-body">
              <div className="coach-admin-upload-box">
                <label className="coach-admin-upload-box__picker">
                  <Paperclip size={15} strokeWidth={2.1} />
                  <span>
                    {file
                      ? file.name
                      : editingSubmission
                        ? `새 파일 선택 (현재: ${editingSubmission.originalName})`
                        : "사진 또는 파일 선택"}
                  </span>
                  <input
                    type="file"
                    className="coach-admin-upload-box__input"
                    onChange={event => setFile(event.target.files?.[0] || null)}
                  />
                </label>
                <textarea
                  className="coach-textarea coach-admin-upload-box__note"
                  value={note}
                  placeholder="관리자에게 남길 메모가 있으면 적어 주세요"
                  onChange={event => setNote(event.target.value)}
                />
                <div className="coach-admin-upload-box__actions">
                  <button
                    type="button"
                    className="modal-primary coach-admin-upload-box__submit"
                    disabled={editingSubmission ? uploading : !file || uploading}
                    onClick={() => void submitHomework()}
                  >
                    {uploading ? (editingSubmission ? "수정 중..." : "제출 중...") : editingSubmission ? "숙제 수정하기" : "숙제 제출하기"}
                  </button>
                </div>
              </div>
              <div className="coach-admin-homework-inline coach-admin-chat__review-section">
                <div className="coach-section-header coach-admin-chat__review-header">
                  <h3 className="coach-section-title coach-admin-chat__review-title">이전 제출</h3>
                </div>
                <div className="coach-admin-review-tabs" role="tablist" aria-label="이전 제출 상태">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={submissionFilter === "pending"}
                    className={
                      "coach-admin-review-tabs__tab" +
                      (submissionFilter === "pending" ? " coach-admin-review-tabs__tab--active" : "")
                    }
                    onClick={() => setSubmissionFilter("pending")}
                  >
                    검토 대기
                    <span className="coach-admin-review-tabs__count">{submissionCounts.pending}</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={submissionFilter === "needs_revision"}
                    className={
                      "coach-admin-review-tabs__tab" +
                      (submissionFilter === "needs_revision"
                        ? " coach-admin-review-tabs__tab--active"
                        : "")
                    }
                    onClick={() => setSubmissionFilter("needs_revision")}
                  >
                    수정 요청
                    <span className="coach-admin-review-tabs__count">{submissionCounts.needs_revision}</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={submissionFilter === "approved"}
                    className={
                      "coach-admin-review-tabs__tab" +
                      (submissionFilter === "approved" ? " coach-admin-review-tabs__tab--active" : "")
                    }
                    onClick={() => setSubmissionFilter("approved")}
                  >
                    승인
                    <span className="coach-admin-review-tabs__count">{submissionCounts.approved}</span>
                  </button>
                </div>
                <SubmissionList
                  submissions={filteredSubmissions}
                  emptyText={
                    submissionFilter === "pending"
                      ? "검토 대기 중인 숙제가 없습니다."
                      : submissionFilter === "needs_revision"
                        ? "수정 요청된 숙제가 없습니다."
                        : "승인된 숙제가 없습니다."
                  }
                  hideDefaultDownload
                  renderActions={submission => (
                    <div className="coach-admin-review-actions">
                      <div className="coach-admin-review-actions__buttons">
                        <button
                          type="button"
                          className="coach-ghost-btn"
                          disabled={uploading || deletingSubmissionId === submission.id}
                          onClick={() => startEditingSubmission(submission)}
                        >
                          수정
                        </button>
                        <button
                          type="button"
                          className="coach-ghost-btn"
                          disabled={uploading || deletingSubmissionId === submission.id}
                          onClick={() => {
                            void deleteSubmission(submission);
                          }}
                        >
                          {deletingSubmissionId === submission.id ? "삭제 중..." : "삭제"}
                        </button>
                        <button
                          type="button"
                          className="coach-ghost-btn coach-admin-homework__download"
                          onClick={() => {
                            void openSubmissionAsset(submission.fileUrl);
                          }}
                        >
                          <Download size={15} strokeWidth={2.1} /> 파일 보기
                        </button>
                      </div>
                    </div>
                  )}
                />
              </div>
            </div>
            <div className="dday-modal-footer">
              <button type="button" className="modal-secondary" onClick={closeHomeworkComposer}>
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function ParentAdminChannelPanel(props: {
  authToken: string | null;
  studentId: number | null;
  studentLabel: string;
}) {
  const [channel, setChannel] = useState<ParentAdminChannelResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [reviewingId, setReviewingId] = useState<number | null>(null);
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [reviewFilter, setReviewFilter] = useState<HomeworkReviewFilter>("pending");
  const reviewModalReveal = useModalReveal(reviewModalOpen);

  const refresh = useCallback(async () => {
    if (!props.authToken || !props.studentId) {
      setChannel(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/parent/admin-channel?studentId=${encodeURIComponent(String(props.studentId))}`,
        {
          headers: { Authorization: `Bearer ${props.authToken}` },
          cache: "no-store"
        }
      );
      const data = (await res.json().catch(() => ({}))) as ParentAdminChannelResponse & {
        error?: string;
      };
      if (!res.ok) throw new Error(String(data.error || "학생 채널을 불러오지 못했습니다."));
      setChannel(data);
      setError("");
    } catch (fetchError) {
      setError(
        fetchError instanceof Error && fetchError.message
          ? fetchError.message
          : "학생 채널을 불러오지 못했습니다."
      );
    } finally {
      setLoading(false);
    }
  }, [props.authToken, props.studentId]);

  useEffect(() => {
    let cancelled = false;
    if (!props.authToken || !props.studentId) return;
    const run = async () => {
      if (cancelled) return;
      await refresh();
    };
    void run();
    const timerId = window.setInterval(() => {
      void run();
    }, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timerId);
    };
  }, [props.authToken, props.studentId, refresh]);

  const sendMessage = async () => {
    const message = draft.trim();
    if (!props.authToken || !props.studentId || !message || sending) return;
    setSending(true);
    try {
      const res = await fetch(`${API_BASE}/api/parent/admin-channel/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${props.authToken}`
        },
        body: JSON.stringify({ studentId: props.studentId, message })
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(String(data.error || "메시지 전송에 실패했습니다."));
      setDraft("");
      await refresh();
    } catch (sendError) {
      setError(
        sendError instanceof Error && sendError.message
          ? sendError.message
          : "메시지 전송에 실패했습니다."
      );
    } finally {
      setSending(false);
    }
  };

  const reviewSubmission = async (
    submission: HomeworkSubmission,
    reviewStatus: HomeworkReviewStatus
  ) => {
    if (!props.authToken || !props.studentId || reviewingId != null) return;
    setReviewingId(submission.id);
    try {
      const res = await fetch(
        `${API_BASE}/api/parent/homework-submissions/${submission.id}/review`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${props.authToken}`
          },
          body: JSON.stringify({
            studentId: props.studentId,
            reviewStatus,
            reviewComment: ""
          })
        }
      );
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(String(data.error || "검토 저장에 실패했습니다."));
      await refresh();
    } catch (reviewError) {
      setError(
        reviewError instanceof Error && reviewError.message
          ? reviewError.message
          : "검토 저장에 실패했습니다."
      );
    } finally {
      setReviewingId(null);
    }
  };

  const studentName = useMemo(() => {
    const email = channel?.student?.email || props.studentLabel;
    return String(email || "학생");
  }, [channel?.student?.email, props.studentLabel]);

  const reviewCounts = useMemo(() => {
    const submissions = channel?.submissions || [];
    return {
      pending: submissions.filter(submission => submission.reviewStatus === "pending").length,
      needs_revision: submissions.filter(submission => submission.reviewStatus === "needs_revision")
        .length,
      approved: submissions.filter(submission => submission.reviewStatus === "approved").length
    };
  }, [channel?.submissions]);

  const filteredReviewSubmissions = useMemo(() => {
    return (channel?.submissions || []).filter(submission => submission.reviewStatus === reviewFilter);
  }, [channel?.submissions, reviewFilter]);

  const openReviewModal = () => {
    setReviewFilter("pending");
    setReviewModalOpen(true);
  };

  const closeReviewModal = () => {
    reviewModalReveal.beginClose(() => setReviewModalOpen(false));
  };

  if (!props.studentId) {
    return (
      <EmptyState
        title="학생을 먼저 선택해 주세요"
        body="연결된 학생을 선택하면 1:1 채팅과 숙제 제출 현황을 볼 수 있습니다."
      />
    );
  }

  return (
    <div className="coach-admin-panel coach-admin-panel--student-chat">
      {error && <div className="coach-admin-error">{error}</div>}

      <div className="coach-admin-layout coach-admin-layout--single coach-admin-layout--student-chat">
        <AdminChatShell
          messages={channel?.messages || []}
          currentUserRole="parent"
          peerLabel={studentName}
          draft={draft}
          setDraft={setDraft}
          sending={sending}
          onSend={sendMessage}
          triggerPlaceholder="학생에게 메시지를 입력해 보세요"
          showFrame={false}
          showHeader={false}
          starterContent={
            <button
              type="button"
              className="coach-starter coach-admin-chat__starter-button"
              onClick={openReviewModal}
            >
              숙제 검수하기
            </button>
          }
        />
      </div>

      {reviewModalOpen && (
        <div
          className={"dday-modal" + (reviewModalReveal.revealed ? " dday-modal--open" : "")}
          onClick={closeReviewModal}
        >
          <div
            className="dday-modal-inner coach-admin-review-modal"
            onClick={event => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="coach-admin-review-modal-title"
          >
            <div className="dday-modal-header coach-admin-chat__review-header">
              <span id="coach-admin-review-modal-title" className="dday-modal-title">
                숙제 검수
              </span>
            </div>
            <div className="dday-modal-body coach-admin-review-section">
              <div className="coach-admin-review-tabs" role="tablist" aria-label="숙제 검수 상태">
                <button
                  type="button"
                  role="tab"
                  aria-selected={reviewFilter === "pending"}
                  className={
                    "coach-admin-review-tabs__tab" +
                    (reviewFilter === "pending" ? " coach-admin-review-tabs__tab--active" : "")
                  }
                  onClick={() => setReviewFilter("pending")}
                >
                  검토 대기
                  <span className="coach-admin-review-tabs__count">{reviewCounts.pending}</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={reviewFilter === "needs_revision"}
                  className={
                    "coach-admin-review-tabs__tab" +
                    (reviewFilter === "needs_revision"
                      ? " coach-admin-review-tabs__tab--active"
                      : "")
                  }
                  onClick={() => setReviewFilter("needs_revision")}
                >
                  수정 요청
                  <span className="coach-admin-review-tabs__count">{reviewCounts.needs_revision}</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={reviewFilter === "approved"}
                  className={
                    "coach-admin-review-tabs__tab" +
                    (reviewFilter === "approved" ? " coach-admin-review-tabs__tab--active" : "")
                  }
                  onClick={() => setReviewFilter("approved")}
                >
                  승인
                  <span className="coach-admin-review-tabs__count">{reviewCounts.approved}</span>
                </button>
              </div>
              <SubmissionList
                submissions={filteredReviewSubmissions}
                emptyText={
                  reviewFilter === "pending"
                    ? "검토 대기 중인 숙제가 없습니다."
                    : reviewFilter === "needs_revision"
                      ? "수정 요청한 숙제가 없습니다."
                      : "승인된 숙제가 없습니다."
                }
                hideDefaultDownload
                renderActions={submission => (
                  <div className="coach-admin-review-actions">
                    <div className="coach-admin-review-actions__buttons">
                      <button
                        type="button"
                        className="coach-primary-btn coach-primary-btn--sm"
                        disabled={reviewingId === submission.id}
                        onClick={() => void reviewSubmission(submission, "approved")}
                      >
                        승인
                      </button>
                      <button
                        type="button"
                        className="coach-ghost-btn"
                        disabled={reviewingId === submission.id}
                        onClick={() => void reviewSubmission(submission, "needs_revision")}
                      >
                        수정 요청
                      </button>
                      <button
                        type="button"
                        className="coach-ghost-btn coach-admin-homework__download"
                        onClick={() => {
                          void openSubmissionAsset(submission.fileUrl);
                        }}
                      >
                        <Download size={15} strokeWidth={2.1} /> 파일 보기
                      </button>
                    </div>
                  </div>
                )}
              />
            </div>
            <div className="dday-modal-footer">
              <button type="button" className="modal-secondary" onClick={closeReviewModal}>
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}