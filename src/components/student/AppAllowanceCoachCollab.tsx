import React, { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { SendHorizontal } from "lucide-react";
import { CoachAvatar } from "../../coach/CoachAvatar";

type AppAllowanceCandidate = {
  id: string;
  name: string;
  category: string;
  description?: string | null;
  bundleId?: string | null;
};

type AppAllowanceSlot = {
  localId: string;
  title: string;
  source: "schedule" | "plan" | "free";
  startTime: string;
  endTime: string;
  reason: string;
  allowedApps: AppAllowanceCandidate[];
};

type AppAllowancePlan = {
  targetDate: string;
  summary: string;
  slots: AppAllowanceSlot[];
  usedOpenAi: boolean;
  model: string | null;
  availableApps: AppAllowanceCandidate[];
};

type ChatTurn = {
  role: "user" | "assistant";
  content: string;
};

const STARTERS = [
  "공부 시간대에는 학습 앱만 남겨줘",
  "쉬는 시간대는 아예 앱을 막아줘",
  "저녁 9시 이후에는 허용 앱 없이 정리해줘"
];

function normalizeCandidates(rows: AppAllowanceCandidate[]): AppAllowanceCandidate[] {
  const seen = new Set<string>();
  return (Array.isArray(rows) ? rows : []).filter(app => {
    const id = String(app?.id || "").trim();
    const name = String(app?.name || "").trim();
    if (!id || !name) return false;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function serializePlan(plan: AppAllowancePlan) {
  return {
    targetDate: plan.targetDate,
    summary: plan.summary,
    availableApps: plan.availableApps.map(app => ({
      id: app.id,
      name: app.name,
      category: app.category,
      description: app.description ?? null,
      bundleId: app.bundleId ?? null
    })),
    slots: plan.slots.map(slot => ({
      title: slot.title,
      source: slot.source,
      startTime: slot.startTime,
      endTime: slot.endTime,
      reason: slot.reason,
      allowedAppIds: slot.allowedApps.map(app => app.id),
      allowedAppNames: slot.allowedApps.map(app => app.name)
    }))
  };
}

export function AppAllowanceCoachCollab(props: {
  apiBase: string;
  authToken: string | null;
  plan: AppAllowancePlan;
  onReplacePlan: (next: {
    summary: string;
    slots: Array<Omit<AppAllowanceSlot, "localId">>;
    usedOpenAi: boolean;
    model: string | null;
    availableApps: AppAllowanceCandidate[];
  }) => void;
}) {
  const { apiBase, authToken, plan, onReplacePlan } = props;
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTo({ top: element.scrollHeight, behavior: "auto" });
  }, [messages, typing]);

  const sendMessage = async (raw: string) => {
    const text = raw.trim();
    if (!text || typing || !authToken) return;
    const before = messages;
    const userMessage: ChatTurn = { role: "user", content: text };
    setBanner(null);
    setDraft("");
    setMessages([...before, userMessage]);
    setTyping(true);
    try {
      const res = await fetch(`${apiBase}/api/student/coach/app-timetable/message`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          message: text,
          currentPlan: serializePlan(plan)
        })
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        reply?: string;
        summary?: string;
        slots?: Array<Omit<AppAllowanceSlot, "localId">>;
        usedOpenAi?: boolean;
        model?: string | null;
        availableApps?: AppAllowanceCandidate[];
      };
      if (!res.ok) {
        throw new Error(String(data.error || "시간표를 조정하지 못했습니다."));
      }
      const reply = String(data.reply || "").trim() || "말씀하신 방향으로 다시 정리해 봤어요.";
      const nextSlots = Array.isArray(data.slots)
        ? data.slots.map(slot => ({
            title: String(slot.title || "").trim() || "시간표",
            source:
              slot.source === "schedule"
                ? "schedule"
                : slot.source === "free"
                  ? "free"
                  : "plan",
            startTime: String(slot.startTime || "").trim(),
            endTime: String(slot.endTime || "").trim(),
            reason: String(slot.reason || "").trim(),
            allowedApps: normalizeCandidates(
              Array.isArray(slot.allowedApps) ? slot.allowedApps : []
            )
          }))
        : [];
      if (nextSlots.length > 0) {
        onReplacePlan({
          summary: String(data.summary || plan.summary).trim() || plan.summary,
          slots: nextSlots,
          usedOpenAi: Boolean(data.usedOpenAi),
          model:
            typeof data.model === "string" || data.model === null
              ? data.model ?? null
              : null,
          availableApps: normalizeCandidates(
            Array.isArray(data.availableApps) ? data.availableApps : plan.availableApps
          )
        });
      }
      setMessages([...before, userMessage, { role: "assistant", content: reply }]);
    } catch (error) {
      setMessages(before);
      setBanner(
        error instanceof Error && error.message
          ? error.message
          : "시간표를 조정하지 못했습니다."
      );
    } finally {
      setTyping(false);
    }
  };

  return (
    <section className="app-allow-plan-collab" aria-label="GPT 시간표 조정">
      <div className="app-allow-plan-collab__header">
        <strong className="app-allow-plan-collab__title">GPT와 시간표 조정</strong>
        <p className="app-allow-plan-collab__copy">
          원하는 규칙을 말하면 아래 시간표에 바로 반영해 드려요.
        </p>
      </div>
      {banner ? (
        <p className="app-allow-plan-collab__banner" role="alert">
          {banner}
        </p>
      ) : null}
      <div ref={scrollRef} className="app-allow-plan-collab__chat coach-chat">
        {messages.map((message, index) => (
          <div
            key={`${message.role}-${index}`}
            className={"coach-bubble-row " + (message.role === "user" ? "is-user" : "is-coach")}
          >
            {message.role === "assistant" ? <CoachAvatar /> : null}
            <motion.div
              className={
                "coach-bubble " +
                (message.role === "user" ? "coach-bubble--user" : "coach-bubble--coach")
              }
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18 }}
            >
              {message.content.split("\n").map((line, lineIndex) => (
                <div key={lineIndex} className="coach-bubble__line">
                  {line || "\u00A0"}
                </div>
              ))}
            </motion.div>
          </div>
        ))}
        {messages.length === 0 && !typing ? (
          <div className="coach-bubble-row is-coach app-allow-plan-collab__offer-row">
            <CoachAvatar />
            <motion.div
              className="coach-bubble coach-bubble--coach app-allow-plan-collab__offer"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18 }}
            >
              <div className="coach-bubble__line">
                내일 앱 허용 시간표를 어떻게 바꾸고 싶은지 말씀해 주세요.
              </div>
              <div className="coach-bubble__line">
                예를 들면 공부 시간대만 학습 앱으로 좁히거나, 밤 시간대는 전부 막아 달라고 할 수 있어요.
              </div>
              <div className="coach-tomorrow-collab__coach-picks">
                {STARTERS.map(starter => (
                  <button
                    key={starter}
                    type="button"
                    className="coach-tomorrow-collab__coach-pick"
                    disabled={!authToken || typing}
                    onClick={() => void sendMessage(starter)}
                  >
                    {starter}
                  </button>
                ))}
              </div>
            </motion.div>
          </div>
        ) : null}
        {typing ? (
          <div className="coach-bubble-row is-coach">
            <CoachAvatar />
            <div className="coach-bubble coach-bubble--coach">
              <span className="coach-typing">
                <span className="dot" />
                <span className="dot" />
                <span className="dot" />
              </span>
            </div>
          </div>
        ) : null}
      </div>
      <div className="app-allow-plan-collab__composer coach-chat-input">
        <input
          className="coach-chat-text"
          placeholder="예: 학원 끝난 뒤 30분만 유튜브 허용해줘"
          value={draft}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => {
            if (event.key === "Enter") {
              void sendMessage(draft);
            }
          }}
          disabled={!authToken || typing}
        />
        <button
          type="button"
          className="modal-primary app-allow-plan-collab__send"
          onClick={() => void sendMessage(draft)}
          disabled={!authToken || typing}
          aria-label="시간표 수정 요청 보내기"
        >
          <SendHorizontal size={15} strokeWidth={2.2} aria-hidden />
        </button>
      </div>
    </section>
  );
}