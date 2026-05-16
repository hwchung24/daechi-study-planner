import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { SendHorizontal, User } from "lucide-react";
import { Card, EmptyState } from "../ui/components";
import { API_BASE } from "../../lib/apiBase";
import { isDocumentVisible, trackAsync } from "../../lib/perfMetrics";
import { stableStringify } from "../../lib/stableUiUpdate";
import { getDateKeySeoul, seoulDateKeyFromApiValue } from "../../lib/weekDates";

type AdminChatMessage = {
  id: number;
  senderRole: "student" | "parent";
  content: string;
  createdAt: string;
};

type StudentAdminChannelResponse = {
  channelAvailable?: boolean;
  parent?: {
    id: number;
    email: string;
  } | null;
  messages?: AdminChatMessage[];
};

type ParentAdminChannelResponse = {
  student?: {
    id: number;
    email: string;
  } | null;
  messages?: AdminChatMessage[];
};

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

function formatChatPeerDisplayName(opts: {
  name?: string | null;
  email?: string | null;
  fallback: string;
}) {
  const name = String(opts.name || "").trim();
  if (name) return name;
  const email = String(opts.email || "").trim();
  if (email) {
    const local = email.split("@")[0]?.trim();
    return local || email;
  }
  return opts.fallback;
}

function AdminChatPeerHeader(props: { displayName: string; roleLabel: string }) {
  return (
    <header
      className="coach-admin-chat__peer-header"
      aria-label={`${props.roleLabel} ${props.displayName}와 채팅`}
    >
      <DefaultChatAvatar label={props.displayName} />
      <div className="coach-admin-chat__peer-header-text">
        <span className="coach-admin-chat__peer-name">{props.displayName}</span>
        <span className="coach-admin-chat__peer-role">{props.roleLabel}</span>
      </div>
    </header>
  );
}

const SEOUL_TZ = "Asia/Seoul";

function formatChatMessageTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: SEOUL_TZ
  }).format(date);
}

function formatChatDateDividerLabel(dateKey: string) {
  const today = getDateKeySeoul(0);
  const yesterday = getDateKeySeoul(-1);
  if (dateKey === today) return "오늘";
  if (dateKey === yesterday) return "어제";
  const match = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return dateKey;
  const anchor = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  const dateLabel = new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: SEOUL_TZ
  }).format(anchor);
  const weekday = new Intl.DateTimeFormat("ko-KR", {
    weekday: "short",
    timeZone: SEOUL_TZ
  }).format(anchor);
  return `${dateLabel} ${weekday}`;
}

type ChatTimelineItem =
  | { kind: "date"; key: string; label: string }
  | { kind: "message"; key: string; message: AdminChatMessage };

function buildChatTimelineItems(messages: AdminChatMessage[]): ChatTimelineItem[] {
  const items: ChatTimelineItem[] = [];
  let lastDateKey = "";
  for (const message of messages) {
    const dateKey = seoulDateKeyFromApiValue(message.createdAt);
    if (dateKey && dateKey !== lastDateKey) {
      items.push({
        kind: "date",
        key: `date-${dateKey}`,
        label: formatChatDateDividerLabel(dateKey)
      });
      lastDateKey = dateKey;
    }
    items.push({ kind: "message", key: `msg-${message.id}`, message });
  }
  return items;
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

  const timelineItems = useMemo(() => buildChatTimelineItems(messages), [messages]);

  const scrollLayoutSig = useMemo(
    () =>
      stableStringify(
        timelineItems.map(item =>
          item.kind === "date"
            ? { d: item.key, l: item.label }
            : {
                id: item.message.id,
                c: item.message.content,
                t: item.message.createdAt
              }
        )
      ) + (props.trailingContent ? "\u0001t" : ""),
    [timelineItems, props.trailingContent]
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
        timelineItems.map(item => {
          if (item.kind === "date") {
            return (
              <div
                key={item.key}
                className="coach-admin-chat__date-divider"
                role="separator"
                aria-label={item.label}
              >
                <span className="coach-admin-chat__date-divider-label">{item.label}</span>
              </div>
            );
          }

          const message = item.message;
          const mine = message.senderRole === props.currentUserRole;
          const lines = String(message.content || "").split("\n");
          const timeLabel = formatChatMessageTime(message.createdAt);
          return (
            <div
              key={item.key}
              className={"coach-bubble-row " + (mine ? "is-user" : "is-coach")}
            >
              {!mine && <DefaultChatAvatar label={props.peerLabel} />}
              <div className="coach-admin-chat__bubble-col">
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
                {timeLabel ? (
                  <time
                    className="coach-admin-chat__message-time"
                    dateTime={message.createdAt}
                  >
                    {timeLabel}
                  </time>
                ) : null}
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
  /** 채팅 상단에 표시할 상대 이름 */
  peerDisplayName?: string;
  /** 채팅 상단 부제(예: 학부모, 학생) */
  peerRoleLabel?: string;
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

  const peerHeader = props.peerDisplayName ? (
    <AdminChatPeerHeader
      displayName={props.peerDisplayName}
      roleLabel={props.peerRoleLabel || props.peerLabel}
    />
  ) : null;

  if (props.showFrame === false) {
    return (
      <div className="coach-admin-chat-shell coach-admin-chat-shell--plain">
        {peerHeader}
        {content}
      </div>
    );
  }

  return (
    <Card className="coach-card coach-card--padded coach-admin-chat-card">
      {peerHeader}
      {content}
    </Card>
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
  const [sending, setSending] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await trackAsync("panel.studentAdmin.refresh", () =>
        fetch(`${API_BASE}/api/student/admin-channel?messageLimit=40`, {
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
        body="내 정보에서 학부모 연결을 마치면 1:1 채팅을 쓸 수 있어요."
      />
    );
  }

  const awaitingFirstPayload = !initialSyncDone && !channel;

  const parentDisplayName = useMemo(
    () =>
      formatChatPeerDisplayName({
        email: channel?.parent?.email,
        fallback: "학부모"
      }),
    [channel?.parent?.email]
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
          peerDisplayName={parentDisplayName}
          peerRoleLabel="학부모"
          draft={draft}
          setDraft={setDraft}
          sending={sending}
          onSend={sendMessage}
          emptyState={null}
          triggerPlaceholder="학부모에게 메시지를 입력하세요"
          showFrame={false}
          showHeader={false}
          composerDisabled={awaitingFirstPayload}
        />
      </div>
    </div>
  );
}

export function ParentAdminChannelPanel(props: {
  authToken: string | null;
  studentId: number | null;
  studentLabel: string;
  /** 프로필 이름 등 — 없으면 이메일에서 표시 */
  studentDisplayName?: string | null;
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
          `${API_BASE}/api/parent/admin-channel?studentId=${encodeURIComponent(String(props.studentId))}&messageLimit=40`,
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

  const studentDisplayName = useMemo(
    () =>
      formatChatPeerDisplayName({
        name: props.studentDisplayName,
        email: channel?.student?.email || props.studentLabel,
        fallback: "학생"
      }),
    [props.studentDisplayName, channel?.student?.email, props.studentLabel]
  );

  if (!props.studentId) {
    return (
      <EmptyState
        title="학생을 먼저 선택해 주세요"
        body="연결된 학생을 선택하면 1:1 채팅을 볼 수 있습니다."
      />
    );
  }

  const showChatSkeleton = loading && channel == null;

  return (
    <div className="coach-admin-panel coach-admin-panel--student-chat">
      {error && <div className="coach-admin-error">{error}</div>}

      <div className="coach-admin-layout coach-admin-layout--single coach-admin-layout--student-chat">
        {showChatSkeleton ? (
          <div className="coach-admin-chat-shell coach-admin-chat-shell--plain">
            <AdminChatPeerHeader displayName={studentDisplayName} roleLabel="학생" />
            <div className="coach-chat-embedded keyboard-dock-root coach-admin-chat-shell coach-admin-chat-shell--composer-disabled">
              <div className="coach-admin-chat-scroll">
                <div
                  className="coach-admin-hydrate-shell coach-admin-panel--hydrating"
                  role="status"
                  aria-live="polite"
                  aria-label="채팅 불러오는 중"
                >
                  <span className="sr-only">채팅 불러오는 중</span>
                  <div className="coach-admin-hydrate-shell__messages" aria-hidden>
                    <div className="coach-admin-hydrate-shell__shimmer" />
                    <div className="coach-admin-hydrate-shell__shimmer coach-admin-hydrate-shell__shimmer--short" />
                    <div className="coach-admin-hydrate-shell__shimmer coach-admin-hydrate-shell__shimmer--right coach-admin-hydrate-shell__shimmer--short" />
                    <div className="coach-admin-hydrate-shell__shimmer" style={{ maxWidth: "68%" }} />
                  </div>
                </div>
              </div>
              <div className="coach-chat-bottom-rail keyboard-dock coach-admin-chat-shell__rail coach-admin-hydrate-shell__rail">
                <div className="coach-admin-hydrate-shell__composer-fake" aria-hidden>
                  <div
                    className="coach-admin-hydrate-shell__shimmer coach-admin-hydrate-shell__shimmer--short"
                    style={{ height: 16, maxWidth: "48%" }}
                  />
                </div>
              </div>
            </div>
          </div>
        ) : (
          <AdminChatShell
            messages={channel?.messages || []}
            currentUserRole="parent"
            peerLabel="학생"
            peerDisplayName={studentDisplayName}
            peerRoleLabel="학생"
            draft={draft}
            setDraft={setDraft}
            sending={sending}
            onSend={sendMessage}
            triggerPlaceholder="학생에게 메시지를 입력해 보세요"
            showFrame={false}
            showHeader={false}
          />
        )}
      </div>
    </div>
  );
}
