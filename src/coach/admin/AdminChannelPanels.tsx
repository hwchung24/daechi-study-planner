import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { Download, Paperclip, SendHorizontal, User } from "lucide-react";
import { Card, EmptyState } from "../ui/components";
import { API_BASE } from "../../lib/apiBase";
import { useModalReveal } from "../../lib/useModalReveal";
import { AppShell, canUseNativeAppShell } from "../../lib/nativeAppShell";
import { isDocumentVisible, trackAsync } from "../../lib/perfMetrics";
import { stableStringify } from "../../lib/stableUiUpdate";

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
const MAX_RENDERED_CHAT_MESSAGES = 60;

const ADMIN_CH_SESSION_PREFIX = "daechi:adminChannel:v1:";

function readStudentAdminChannelCache(
  token: string
): StudentAdminChannelResponse | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(
      `${ADMIN_CH_SESSION_PREFIX}s:${token.slice(0, 32)}`
    );
    if (!raw) return null;
    return JSON.parse(raw) as StudentAdminChannelResponse;
  } catch {
    return null;
  }
}

function writeStudentAdminChannelCache(
  token: string,
  data: StudentAdminChannelResponse
) {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(
      `${ADMIN_CH_SESSION_PREFIX}s:${token.slice(0, 32)}`,
      JSON.stringify(data)
    );
  } catch {
    // ignore quota / private mode
  }
}

function readParentAdminChannelCache(
  token: string,
  studentId: number
): ParentAdminChannelResponse | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(
      `${ADMIN_CH_SESSION_PREFIX}p:${studentId}:${token.slice(0, 24)}`
    );
    if (!raw) return null;
    return JSON.parse(raw) as ParentAdminChannelResponse;
  } catch {
    return null;
  }
}

function writeParentAdminChannelCache(
  token: string,
  studentId: number,
  data: ParentAdminChannelResponse
) {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(
      `${ADMIN_CH_SESSION_PREFIX}p:${studentId}:${token.slice(0, 24)}`,
      JSON.stringify(data)
    );
  } catch {
    // ignore
  }
}

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
  const messages = useMemo(
    () =>
      props.messages.length > MAX_RENDERED_CHAT_MESSAGES
        ? props.messages.slice(-MAX_RENDERED_CHAT_MESSAGES)
        : props.messages,
    [props.messages]
  );

  const scrollLayoutSig = useMemo(
    () =>
      stableStringify(
        messages.map(m => ({
          id: m.id,
          c: m.content,
          t: m.createdAt
        }))
      ) + (props.trailingContent ? "\u0001t" : ""),
    [messages, props.trailingContent]
  );

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [scrollLayoutSig]);

  return (
    <div
      ref={scrollRef}
      className="coach-chat coach-admin-chat__messages coach-admin-chat__messages--stable"
    >
      {messages.length === 0 ? (
        props.emptyState !== undefined ? (
          props.emptyState
        ) : (
          <div className="coach-admin-chat__empty">아직 대화가 없습니다. 첫 메시지를 보내 보세요.</div>
        )
      ) : (
        messages.map(message => {
          const mine = message.senderRole === props.currentUserRole;
          const lines = String(message.content || "").split("\n");
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
                {lines.map((line, index) => (
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
  /** 첫 API 응답 전 등 — 입력만 막고 레이아웃은 동일하게 유지 */
  composerDisabled?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputDockRef = useRef<HTMLDivElement | null>(null);
  const composerInputRef = useRef<HTMLInputElement | null>(null);

  const handleSend = async () => {
    if (props.composerDisabled) return;
    const message = props.draft.trim();
    if (!message || props.sending) return;
    await props.onSend(message);
  };

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
          (props.composerDisabled ? " coach-admin-chat-shell--composer-disabled" : "")
        }
      >
        <div className="coach-admin-chat-scroll">
          <ChatMessages
            messages={props.messages}
            currentUserRole={props.currentUserRole}
            peerLabel={props.peerLabel}
            emptyState={props.emptyState}
            trailingContent={props.trailingContent}
          />
        </div>
        <div ref={inputDockRef} className="coach-chat-bottom-rail keyboard-dock coach-admin-chat-shell__rail">
          {props.starterContent ? (
            <div className="coach-chat-starters" aria-label="추천 작업">
              {props.starterContent}
            </div>
          ) : null}
          <div className="coach-chat-composer" onMouseDown={event => event.stopPropagation()}>
            <div className="coach-chat-input coach-chat-input--composer">
              <input
                ref={composerInputRef}
                className="coach-chat-text"
                value={props.draft}
                enterKeyHint="send"
                placeholder={props.triggerPlaceholder}
                disabled={props.composerDisabled}
                onChange={event => props.setDraft(event.target.value)}
                onKeyDown={event => {
                  if (props.composerDisabled) return;
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
                disabled={
                  props.composerDisabled || props.sending || !props.draft.trim()
                }
                aria-label="메시지 보내기"
                title="보내기"
              >
                <SendHorizontal size={15} strokeWidth={2.2} aria-hidden />
              </button>
            </div>
          </div>
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

export function StudentAdminChannelPanel(props: {
  authToken: string;
  /** true면 네트워크 폴링 안 함(다른 코치 탭을 보는 동안 등) */
  pollingPaused?: boolean;
}) {
  const channelSigRef = useRef<string | null>(null);
  const [channel, setChannel] = useState<StudentAdminChannelResponse | null>(() => {
    const c = readStudentAdminChannelCache(props.authToken);
    channelSigRef.current = c ? stableStringify(c) : null;
    return c;
  });
  /** 첫 서버 응답 전까지 — 캐시가 있으면 처음부터 true (레이아웃 유지) */
  const [initialSyncDone, setInitialSyncDone] = useState(
    () => readStudentAdminChannelCache(props.authToken) != null
  );
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
      const res = await trackAsync("panel.studentAdmin.refresh", () =>
        fetch(`${API_BASE}/api/student/admin-channel?messageLimit=40&submissionLimit=12`, {
          headers: { Authorization: `Bearer ${props.authToken}` },
          cache: "no-store"
        })
      );
      const data = (await res.json().catch(() => ({}))) as StudentAdminChannelResponse & {
        error?: string;
      };
      if (!res.ok) throw new Error(String(data.error || "학원 메시지를 불러오지 못했습니다."));
      const sig = stableStringify(data);
      if (channelSigRef.current !== sig) {
        channelSigRef.current = sig;
        writeStudentAdminChannelCache(props.authToken, data);
        setChannel(data);
      }
      setError("");
    } catch (fetchError) {
      setError(
        fetchError instanceof Error && fetchError.message
          ? fetchError.message
          : "학원 메시지를 불러오지 못했습니다."
      );
    } finally {
      setInitialSyncDone(true);
    }
  }, [props.authToken]);

  const prevStudentTokenRef = useRef(props.authToken);
  useEffect(() => {
    if (prevStudentTokenRef.current === props.authToken) return;
    prevStudentTokenRef.current = props.authToken;
    const cached = readStudentAdminChannelCache(props.authToken);
    if (cached) {
      const sig = stableStringify(cached);
      channelSigRef.current = sig;
      setChannel(cached);
      setInitialSyncDone(true);
    } else {
      channelSigRef.current = null;
      setChannel(null);
      setInitialSyncDone(false);
    }
  }, [props.authToken]);

  useEffect(() => {
    if (props.pollingPaused) return;
    let cancelled = false;
    const run = async () => {
      if (cancelled) return;
      await refresh();
    };
    void run();
    const timerId = window.setInterval(() => {
      void run();
    }, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(timerId);
    };
  }, [refresh, props.pollingPaused]);

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

  if (initialSyncDone && error && !channel) {
    return <EmptyState title="학원 메시지를 열 수 없어요" body={error} />;
  }

  if (
    initialSyncDone &&
    channel &&
    (!channel.channelAvailable || !channel.parent)
  ) {
    return (
      <EmptyState
        title="연결된 학부모가 아직 없어요"
        body="내 정보에서 학부모 연결을 마치면 1:1 채팅과 숙제 제출을 쓸 수 있어요."
      />
    );
  }

  const awaitingFirstPayload = !initialSyncDone && !channel;

  const submissionList = channel?.submissions || [];
  const submissionCounts = {
    pending: submissionList.filter(submission => submission.reviewStatus === "pending").length,
    needs_revision: submissionList.filter(
      submission => submission.reviewStatus === "needs_revision"
    ).length,
    approved: submissionList.filter(submission => submission.reviewStatus === "approved").length
  };

  const filteredSubmissions = submissionList.filter(
    submission => submission.reviewStatus === submissionFilter
  );

  return (
    <div
      className="coach-admin-panel coach-admin-panel--student-chat"
      aria-busy={awaitingFirstPayload || undefined}
    >
      {error && <div className="coach-admin-error">{error}</div>}

      <div className="coach-admin-layout coach-admin-layout--single coach-admin-layout--student-chat">
        <AdminChatShell
          messages={channel?.messages || []}
          currentUserRole="student"
          peerLabel="학부모"
          draft={draft}
          setDraft={setDraft}
          sending={sending}
          onSend={sendMessage}
          emptyState={null}
          triggerPlaceholder="학부모에게 메시지를 입력하세요"
          showFrame={false}
          showHeader={false}
          composerDisabled={awaitingFirstPayload}
          starterContent={
            awaitingFirstPayload ? null : (
              <button
                type="button"
                className="coach-starter coach-admin-chat__starter-button"
                onClick={openHomeworkComposer}
              >
                숙제 제출하기
              </button>
            )
          }
        />
      </div>

      {showHomeworkComposer && channel && (
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
                  placeholder="학부모에게 남길 메모가 있으면 적으세요"
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
  const parentChannelSigRef = useRef<string | null>(null);
  const [channel, setChannel] = useState<ParentAdminChannelResponse | null>(() => {
    if (!props.authToken || props.studentId == null) return null;
    const c = readParentAdminChannelCache(props.authToken, props.studentId);
    parentChannelSigRef.current = c ? stableStringify(c) : null;
    return c;
  });
  const [loading, setLoading] = useState(() => {
    if (!props.authToken || props.studentId == null) return false;
    return !readParentAdminChannelCache(props.authToken, props.studentId);
  });
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [reviewingId, setReviewingId] = useState<number | null>(null);
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [reviewFilter, setReviewFilter] = useState<HomeworkReviewFilter>("pending");
  const reviewModalReveal = useModalReveal(reviewModalOpen);

  const refresh = useCallback(async () => {
    if (!props.authToken || !props.studentId) {
      parentChannelSigRef.current = null;
      setChannel(null);
      setLoading(false);
      return;
    }
    if (!isDocumentVisible()) return;
    try {
      const res = await trackAsync("panel.parentAdmin.refresh", () =>
        fetch(
          `${API_BASE}/api/parent/admin-channel?studentId=${encodeURIComponent(String(props.studentId))}&messageLimit=40&submissionLimit=12`,
          {
            headers: { Authorization: `Bearer ${props.authToken}` },
            cache: "no-store"
          }
        )
      );
      const data = (await res.json().catch(() => ({}))) as ParentAdminChannelResponse & {
        error?: string;
      };
      if (!res.ok) throw new Error(String(data.error || "학생 채널을 불러오지 못했습니다."));
      const sig = stableStringify(data);
      if (parentChannelSigRef.current !== sig) {
        parentChannelSigRef.current = sig;
        if (props.authToken && props.studentId != null) {
          writeParentAdminChannelCache(props.authToken, props.studentId, data);
        }
        setChannel(data);
        setLoading(false);
      } else {
        setLoading(false);
      }
      setError("");
    } catch (fetchError) {
      setError(
        fetchError instanceof Error && fetchError.message
          ? fetchError.message
          : "학생 채널을 불러오지 못했습니다."
      );
      setLoading(false);
    }
  }, [props.authToken, props.studentId]);

  const prevParentScopeKeyRef = useRef("");
  useEffect(() => {
    const key = `${props.authToken ?? ""}\0${String(props.studentId ?? "")}`;
    if (prevParentScopeKeyRef.current === key) return;
    prevParentScopeKeyRef.current = key;
    if (!props.authToken || props.studentId == null) {
      parentChannelSigRef.current = null;
      setChannel(null);
      setLoading(false);
      return;
    }
    const cached = readParentAdminChannelCache(props.authToken, props.studentId);
    if (cached) {
      parentChannelSigRef.current = stableStringify(cached);
      setChannel(cached);
      setLoading(false);
    } else {
      parentChannelSigRef.current = null;
      setChannel(null);
      setLoading(true);
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
    }, 15000);
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