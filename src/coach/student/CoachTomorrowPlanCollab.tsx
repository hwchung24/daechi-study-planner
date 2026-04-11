import { Capacitor } from "@capacitor/core";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { SendHorizontal } from "lucide-react";
import { CoachAvatar } from "../CoachAvatar";
import { API_BASE } from "../../lib/apiBase";
import { DAECHI_COACH_TOMORROW_STARTER_KEY } from "../../lib/coachEvents";
import { resolvePreferredSerial } from "../../lib/hashRouteUtils";
import type { ProgressBook, ProgressPlan, StudyBlock } from "../../types/planner";

export type CoachTomorrowPlanCollabProps = {
  apiToken: string;
  blocks: StudyBlock[];
  progressBooks: ProgressBook[];
  tomorrowPlan: ProgressPlan;
  studyEvaluation: string;
  metacognitionReflection: string;
  /** 오늘 생활 좋았던 점과 나빴던 점(발췌) — 내일 실천 짜기 맥락 */
  todayMemo: string;
  /** 기록 탭에 적어 둔「내일 실천할 한 가지」초안 */
  draftTomorrowPractice: string;
  /** 기록 탭「오늘 학습 시간」(분) — 없으면 null */
  todayStudyMinutes: number | null;
  onOpenScheduleManager: () => void;
  onApplyAndReturnToRecords: (next: ProgressPlan) => Promise<boolean>;
  onApplyTomorrowPracticeAndGoRecords: (text: string) => Promise<boolean>;
};

type CollabFocus = "study" | "life" | "appAllowance";

type AppAllowanceCandidate = {
  id: string;
  name: string;
  category: string;
  description?: string | null;
  bundleId?: string | null;
};

type AppAllowanceSlot = {
  localId: string;
  dayKey: "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
  title: string;
  source: "schedule" | "plan" | "free";
  startTime: string;
  endTime: string;
  reason: string;
  allowedApps: AppAllowanceCandidate[];
};

type AppAllowancePlan = {
  summary: string;
  slots: AppAllowanceSlot[];
  usedOpenAi: boolean;
  model: string | null;
  availableApps: AppAllowanceCandidate[];
};

const DAECHI_ROOT_APP_ID = "com.daechiroot.ios";
const DAECHI_ROOT_APP: AppAllowanceCandidate = {
  id: DAECHI_ROOT_APP_ID,
  name: "대치루트",
  category: "필수 앱",
  description: "대치루트 앱은 항상 허용됩니다.",
  bundleId: DAECHI_ROOT_APP_ID
};

const WEEKDAY_LABELS: Record<AppAllowanceSlot["dayKey"], string> = {
  mon: "월",
  tue: "화",
  wed: "수",
  thu: "목",
  fri: "금",
  sat: "토",
  sun: "일"
};

let appAllowanceSlotSequence = 0;

function createAppAllowanceSlotId() {
  appAllowanceSlotSequence += 1;
  return `coach-app-allowance-slot-${appAllowanceSlotSequence}`;
}

function isDaechiRootApp(app: AppAllowanceCandidate | null | undefined) {
  const id = String(app?.id || "").trim().toLowerCase();
  const bundleId = String(app?.bundleId || "").trim().toLowerCase();
  const name = String(app?.name || "").trim();
  return id === DAECHI_ROOT_APP_ID || bundleId === DAECHI_ROOT_APP_ID || name === "대치루트";
}

function normalizeAppAllowanceCandidates(rows: AppAllowanceCandidate[]): AppAllowanceCandidate[] {
  const seen = new Set<string>();
  const next = (Array.isArray(rows) ? rows : [])
    .map(app => ({
      id: String(app?.id || "").trim(),
      name: String(app?.name || "").trim(),
      category: String(app?.category || "").trim() || "기기 앱",
      description:
        app?.description != null && String(app.description).trim() !== ""
          ? String(app.description).trim()
          : null,
      bundleId:
        app?.bundleId != null && String(app.bundleId).trim() !== ""
          ? String(app.bundleId).trim()
          : null
    }))
    .filter(app => {
      if (!app.id || !app.name) return false;
      if (seen.has(app.id)) return false;
      seen.add(app.id);
      return true;
    });
  if (!next.some(isDaechiRootApp)) {
    next.unshift({ ...DAECHI_ROOT_APP });
  }
  const root = next.find(isDaechiRootApp) || { ...DAECHI_ROOT_APP };
  const others = next.filter(app => !isDaechiRootApp(app));
  return [root, ...others];
}

function hydrateAppAllowancePlan(raw: {
  summary?: string;
  slots?: Array<Omit<AppAllowanceSlot, "localId">>;
  usedOpenAi?: boolean;
  model?: string | null;
  availableApps?: AppAllowanceCandidate[];
}): AppAllowancePlan {
  return {
    summary: String(raw.summary || "").trim(),
    slots: (Array.isArray(raw.slots) ? raw.slots : []).map(slot => ({
      localId: createAppAllowanceSlotId(),
      dayKey:
        slot.dayKey === "tue" ||
        slot.dayKey === "wed" ||
        slot.dayKey === "thu" ||
        slot.dayKey === "fri" ||
        slot.dayKey === "sat" ||
        slot.dayKey === "sun"
          ? slot.dayKey
          : "mon",
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
      allowedApps: normalizeAppAllowanceCandidates(
        Array.isArray(slot.allowedApps) ? slot.allowedApps : []
      )
    })),
    usedOpenAi: Boolean(raw.usedOpenAi),
    model:
      typeof raw.model === "string" || raw.model === null ? raw.model ?? null : null,
    availableApps: normalizeAppAllowanceCandidates(
      Array.isArray(raw.availableApps) ? raw.availableApps : []
    )
  };
}

function serializeAppAllowancePlan(plan: AppAllowancePlan) {
  return {
    summary: plan.summary,
    availableApps: plan.availableApps.map(app => ({
      id: app.id,
      name: app.name,
      category: app.category,
      description: app.description ?? null,
      bundleId: app.bundleId ?? null
    })),
    slots: plan.slots.map(slot => ({
      dayKey: slot.dayKey,
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

function buildAppAllowanceAssistantOpening(plan: AppAllowancePlan) {
  if (plan.slots.length === 0) {
    return plan.summary || "원하는 요일, 시간, 허용할 앱 이름을 같이 알려 주세요.";
  }
  const preview = plan.slots
    .slice(0, 3)
    .map(slot => {
      const dayLabel = WEEKDAY_LABELS[slot.dayKey] || slot.dayKey;
      const appNames = slot.allowedApps
        .map(app => app.name)
        .filter(Boolean)
        .slice(0, 2)
        .join(", ");
      return `${dayLabel} ${slot.startTime}-${slot.endTime}${appNames ? ` ${appNames}` : ""}`;
    })
    .join(", ");
  return [
    plan.summary || "관리자에게 전달할 허용 앱 요청 내용을 정리했어요.",
    "",
    preview ? `정리된 요청: ${preview}` : "",
    "",
    "수정할 내용이 있으면 요일, 시간, 앱 이름을 다시 말씀해 주세요."
  ]
    .filter(Boolean)
    .join("\n");
}

const IS_NATIVE_PLATFORM = Capacitor.isNativePlatform();
const NATIVE_KEYBOARD_DISMISS_EVENT = "daechi:native-keyboard-input-dismiss";
const NATIVE_KEYBOARD_SUBMIT_EVENT = "daechi:native-keyboard-input-submit";

type ChatTurn = {
  role: "user" | "assistant";
  /** 화면에 보이는 문장 */
  content: string;
  /** 사용자 메시지: API·모델에 넘길 본문(없으면 content와 동일) */
  apiContent?: string;
};

function chatTurnsForApi(turns: ChatTurn[]): { role: "user" | "assistant"; content: string }[] {
  return turns.map(t => ({
    role: t.role,
    content: t.role === "user" ? String(t.apiContent ?? t.content) : t.content
  }));
}

function parseApiJson(text: string): Record<string, unknown> {
  const t = String(text || "").trim();
  if (!t) return {};
  try {
    const v = JSON.parse(t);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function httpErrorMessage(res: Response, bodyText: string, fallback: string): string {
  const data = parseApiJson(bodyText);
  const err = data.error;
  if (typeof err === "string" && err.trim()) return err.trim();
  const flat = bodyText.trim().replace(/\s+/g, " ");
  const snip = flat.slice(0, 220);
  if (res.status === 404) {
    return `API를 찾을 수 없습니다(404). 백엔드(server 폴더에서 npm start, 포트 3000)가 켜져 있고 index.js에 내일 계획 API가 포함된 최신 코드인지 확인해 주세요.`;
  }
  if (snip && !snip.startsWith("<")) {
    return `서버 오류 ${res.status}: ${snip}`;
  }
  return `${fallback} (HTTP ${res.status})`;
}

function isLikelyNetworkTypeError(error: TypeError): boolean {
  const msg = String(error.message || "");
  return /fetch|network|load failed|failed to fetch/i.test(msg);
}

function buildCollabContext(params: {
  blocks: StudyBlock[];
  progressBooks: ProgressBook[];
  tomorrowPlan: ProgressPlan;
  studyEvaluation: string;
  metacognitionReflection: string;
  todayProgressPercent: number;
  collabFocus: "study" | "life";
  todayMemo: string;
  draftTomorrowPractice: string;
  todayStudyMinutes: number | null;
}) {
  const {
    blocks,
    progressBooks,
    tomorrowPlan,
    studyEvaluation,
    metacognitionReflection,
    todayProgressPercent,
    collabFocus,
    todayMemo,
    draftTomorrowPractice,
    todayStudyMinutes
  } = params;
  const total = blocks.length;
  const done = blocks.filter(b => b.done).length;
  const booksById = new Map(progressBooks.map(book => [book.id, book.name]));
  return {
    collabFocus,
    books: progressBooks.map(book => ({
      id: Number(book.id),
      name: String(book.name || "").trim()
    })),
    todayProgressPercent,
    todayBlocksSummary: {
      totalSlots: total,
      doneSlots: done,
      pendingSlots: Math.max(0, total - done)
    },
    todayBlocks: blocks.map(block => ({
      id: block.id,
      subject: String(block.subject || "").trim(),
      start: String(block.start || "").trim(),
      end: String(block.end || "").trim(),
      done: Boolean(block.done),
      bookId: Number.isFinite(Number(block.bookId)) ? Number(block.bookId) : null,
      bookName:
        block.bookId != null && booksById.has(Number(block.bookId))
          ? String(booksById.get(Number(block.bookId)) || "")
          : "",
      plannedRange: String(block.plannedRange || "").trim()
    })),
    tomorrowPlanDraft: progressBooks.map(book => {
      const draft = tomorrowPlan[book.id];
      return {
        bookId: book.id,
        bookName: String(book.name || "").trim(),
        plannedRange: String(draft?.text || "").trim(),
        startTime: String(draft?.start || "").trim(),
        endTime: String(draft?.end || "").trim()
      };
    }),
    studyEvaluation: String(studyEvaluation || "").trim(),
    metacognitionReflection: String(metacognitionReflection || "").trim(),
    todayMemo: String(todayMemo || "").trim(),
    draftTomorrowPractice: String(draftTomorrowPractice || "").trim(),
    todayStudyMinutes:
      todayStudyMinutes != null && Number.isFinite(Number(todayStudyMinutes))
        ? Number(todayStudyMinutes)
        : null
  };
}

function openingAssistantText(ctx: ReturnType<typeof buildCollabContext>): string {
  const {
    todayProgressPercent,
    todayBlocksSummary,
    studyEvaluation,
    metacognitionReflection,
    todayStudyMinutes
  } = ctx;
  const { totalSlots, doneSlots } = todayBlocksSummary;
  const se = studyEvaluation ? studyEvaluation.slice(0, 220) + (studyEvaluation.length > 220 ? "…" : "") : "(아직 없음)";
  const me = metacognitionReflection
    ? metacognitionReflection.slice(0, 220) + (metacognitionReflection.length > 220 ? "…" : "")
    : "(아직 없음)";
  const sm =
    todayStudyMinutes != null && Number.isFinite(Number(todayStudyMinutes))
      ? `${Math.round(Number(todayStudyMinutes))}분`
      : "(아직 없음)";
  return [
    "오늘 기록을 바탕으로 내일 계획을 같이 잡아 볼게요.",
    "",
    `· 오늘 계획 칸 기준 이행률: ${todayProgressPercent}% (${doneSlots}/${totalSlots || 0}칸 완료)`,
    `· 오늘 기록한 학습 시간: ${sm}`,
    `· 오늘 공부 좋았던 점과 나빴던 점(발췌): ${se}`,
    `· 오늘 공부한 내용(발췌): ${me}`,
    "",
    "책별 범위와 시간은 아래에서 대화로 함께 맞춰 가요."
  ].join("\n");
}

function openingLifePracticeText(ctx: ReturnType<typeof buildCollabContext>): string {
  const memo = ctx.todayMemo
    ? ctx.todayMemo.slice(0, 220) + (ctx.todayMemo.length > 220 ? "…" : "")
    : "(아직 없음)";
  const draft = ctx.draftTomorrowPractice
    ? ctx.draftTomorrowPractice.slice(0, 220) +
      (ctx.draftTomorrowPractice.length > 220 ? "…" : "")
    : "(아직 없음)";
  const sm =
    ctx.todayStudyMinutes != null && Number.isFinite(Number(ctx.todayStudyMinutes))
      ? `${Math.round(Number(ctx.todayStudyMinutes))}분`
      : "(아직 없음)";
  return [
    "오늘 생활 기록을 바탕으로, 기록 탭에 쓸「내일 실천할 한 가지」를 같이 정해 볼게요.",
    "",
    `· 오늘 생활 좋았던 점과 나빴던 점(발췌): ${memo}`,
    `· 오늘 기록한 학습 시간: ${sm}`,
    `· 지금 적어 둔 실천 초안: ${draft}`,
    "",
    "한 가지로 구체적으로 정하면 아래 대화로 다듬은 뒤 기록에 반영할 수 있어요."
  ].join("\n");
}

/** 학습 계획 짜기 클릭 시에만 오늘 기록 요약 인사(openingAssistantText)를 코치 답변 앞에 붙임 */
const STUDY_PLAN_STARTER_LABEL = "학습 계획 짜기";
/** 생활 = 기록 탭「내일 실천할 한 가지」문장 협업 */
const LIFE_PLAN_STARTER_LABEL = "내일 실천 짜기";
const APP_ALLOWANCE_STARTER_LABEL = "허용 앱 관리";

const TOMORROW_PLAN_STARTERS: { label: string; message: string }[] = [
  {
    label: STUDY_PLAN_STARTER_LABEL,
    message:
      "내일 학습 계획을 같이 짜고 싶어요. 등록한 교재별로 목표 범위와 공부 시간을 제안해 주세요."
  },
  {
    label: LIFE_PLAN_STARTER_LABEL,
    message:
      "기록 탭의「내일 실천할 한 가지」에 넣을 문장을 같이 정하고 싶어요. 오늘 생활 좋았던 점과 나빴던 점과 연결해 실행 가능한 한 가지만 제안해 주세요."
  },
  {
    label: APP_ALLOWANCE_STARTER_LABEL,
    message:
      "허용 앱을 관리하고 싶어요. 제가 원하는 요일, 시간, 앱을 말하면 관리자에게 요청할 수 있게 정리해 주세요."
  }
];

const STARTER_LABEL_SET = new Set(TOMORROW_PLAN_STARTERS.map(s => s.label));

export function CoachTomorrowPlanCollab(props: CoachTomorrowPlanCollabProps) {
  const {
    apiToken,
    blocks,
    progressBooks,
    tomorrowPlan,
    studyEvaluation,
    metacognitionReflection,
    todayMemo,
    draftTomorrowPractice,
    todayStudyMinutes,
    onOpenScheduleManager,
    onApplyAndReturnToRecords,
    onApplyTomorrowPracticeAndGoRecords
  } = props;

  const todayProgressPercent = useMemo(() => {
    const n = blocks.length;
    if (n === 0) return 0;
    return Math.round((blocks.filter(b => b.done).length / n) * 100);
  }, [blocks]);

  const [messages, setMessages] = useState<ChatTurn[]>([]);

  const collabFocus = useMemo((): CollabFocus => {
    const u = messages.find(m => m.role === "user");
    if (u?.content === LIFE_PLAN_STARTER_LABEL) return "life";
    if (u?.content === APP_ALLOWANCE_STARTER_LABEL) return "appAllowance";
    return "study";
  }, [messages]);

  const context = useMemo(
    () =>
      buildCollabContext({
        blocks,
        progressBooks,
        tomorrowPlan,
        studyEvaluation,
        metacognitionReflection,
        todayProgressPercent,
        collabFocus,
        todayMemo,
        draftTomorrowPractice,
        todayStudyMinutes
      }),
    [
      blocks,
      progressBooks,
      tomorrowPlan,
      studyEvaluation,
      metacognitionReflection,
      todayProgressPercent,
      collabFocus,
      todayMemo,
      draftTomorrowPractice,
      todayStudyMinutes
    ]
  );

  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState(false);
  const [applyBusy, setApplyBusy] = useState(false);
  const [appAllowanceRequesting, setAppAllowanceRequesting] = useState(false);
  const [appAllowancePlan, setAppAllowancePlan] = useState<AppAllowancePlan | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const footerRef = useRef<HTMLDivElement | null>(null);
  const composerInputRef = useRef<HTMLInputElement | null>(null);

  const scrollChatToBottom = (behavior: ScrollBehavior = "auto") => {
    const element = chatScrollRef.current;
    if (!element) return;
    element.scrollTo({
      top: element.scrollHeight,
      behavior: behavior === "smooth" ? "auto" : behavior
    });
  };

  const requestAppAllowanceAdjustment = async (message: string, history: ChatTurn[]) => {
    if (!apiToken) {
      throw new Error("로그인이 필요합니다.");
    }
    const res = await fetch(`${API_BASE}/api/student/coach/weekly-app-request/message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiToken}`
      },
      body: JSON.stringify({
        message,
        history: chatTurnsForApi(history),
        serial: resolvePreferredSerial() || undefined
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
      throw new Error(String(data.error || "허용 앱 요청을 정리하지 못했습니다."));
    }
    return {
      reply:
        String(data.reply || "").trim() || "말씀하신 내용을 관리자 요청 형태로 정리했어요.",
      plan: hydrateAppAllowancePlan({
        summary: String(data.summary || "").trim(),
        slots: Array.isArray(data.slots) ? data.slots : [],
        usedOpenAi: Boolean(data.usedOpenAi),
        model: typeof data.model === "string" || data.model === null ? data.model ?? null : null,
        availableApps: Array.isArray(data.availableApps) ? data.availableApps : []
      })
    };
  };

  const requestParentAppAllowanceReview = async () => {
    if (!apiToken || !appAllowancePlan || appAllowanceRequesting) return;
    setBanner(null);
    setAppAllowanceRequesting(true);
    try {
      const res = await fetch(`${API_BASE}/api/student/coach/app-timetable-request`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiToken}`
        },
        body: JSON.stringify({
          summary: appAllowancePlan.summary,
          slots: appAllowancePlan.slots.map(slot => ({
            dayKey: slot.dayKey,
            title: slot.title,
            startTime: slot.startTime,
            endTime: slot.endTime,
            source: slot.source,
            reason: slot.reason,
            allowedApps: slot.allowedApps.map(app => ({
              id: app.id,
              name: app.name,
              category: app.category,
              description: app.description ?? null,
              bundleId: app.bundleId ?? null
            })),
            allowedAppNames: slot.allowedApps.map(app => app.name)
          }))
        })
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
      };
      if (!res.ok) {
        throw new Error(
          String(data.error || "").trim() ||
            (data.code === "NO_LINKED_PARENT"
              ? "연결된 관리자 계정이 없어 요청을 보낼 수 없습니다."
              : "관리자에게 요청을 보내지 못했습니다.")
        );
      }
      setBanner("관리자 페이지 알림으로 허용 앱 요청을 보냈습니다.");
    } catch (error) {
      setBanner(
        error instanceof Error && error.message
          ? error.message
          : "네트워크 오류로 요청을 보내지 못했습니다."
      );
    } finally {
      setAppAllowanceRequesting(false);
    }
  };

  const sendMessage = async (
    raw: string,
    opts?: { clearDraft?: boolean; displayAs?: string }
  ) => {
    const apiText = raw.trim();
    if (!apiText || typing || !apiToken) return;
    const displayText = String(opts?.displayAs ?? raw).trim() || apiText;
    setBanner(null);
    if (opts?.clearDraft !== false) setDraft("");
    const before = messages;
    const userMsg: ChatTurn =
      displayText === apiText
        ? { role: "user", content: displayText }
        : { role: "user", content: displayText, apiContent: apiText };
    setMessages([...before, userMsg]);
    setTyping(true);
    const focusForThisSend: CollabFocus =
      opts?.displayAs === LIFE_PLAN_STARTER_LABEL
        ? "life"
        : opts?.displayAs === APP_ALLOWANCE_STARTER_LABEL
          ? "appAllowance"
        : opts?.displayAs === STUDY_PLAN_STARTER_LABEL
          ? "study"
          : collabFocus;
    if (focusForThisSend === "appAllowance") {
      try {
        const adjusted = await requestAppAllowanceAdjustment(apiText, before);
        const nextPlan = adjusted.plan;
        const assistantContent =
          adjusted.reply ||
          buildAppAllowanceAssistantOpening(nextPlan) ||
          "원하는 요일, 시간, 허용 앱을 더 자세히 알려 주세요.";
        setAppAllowancePlan(nextPlan);
        setMessages([...before, userMsg, { role: "assistant", content: assistantContent }]);
      } catch (e) {
        const netHint =
          e instanceof TypeError && isLikelyNetworkTypeError(e)
            ? `서버에 연결할 수 없습니다. 터미널에서 백엔드(node server, 보통 포트 3000)를 켠 뒤 다시 시도해 주세요.${
                API_BASE ? ` (API: ${API_BASE})` : ""
              }`
            : null;
        setBanner(netHint || (e instanceof Error ? e.message : "전송에 실패했습니다."));
        setMessages(before);
      } finally {
        setTyping(false);
      }
      requestAnimationFrame(() => {
        scrollChatToBottom("auto");
      });
      return;
    }
    const ctxForApi = buildCollabContext({
      blocks,
      progressBooks,
      tomorrowPlan,
      studyEvaluation,
      metacognitionReflection,
      todayProgressPercent,
      collabFocus: focusForThisSend,
      todayMemo,
      draftTomorrowPractice,
      todayStudyMinutes
    });
    try {
      const res = await fetch(`${API_BASE}/api/student/coach/tomorrow-plan/message`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiToken}`
        },
        body: JSON.stringify({
          context: ctxForApi,
          history: chatTurnsForApi(before),
          message: apiText
        })
      });
      const rawText = await res.text();
      const data = parseApiJson(rawText);
      if (!res.ok) {
        throw new Error(httpErrorMessage(res, rawText, "응답을 처리하지 못했습니다"));
      }
      const reply = String(data.reply || "").trim();
      const studyIntro =
        opts?.displayAs === STUDY_PLAN_STARTER_LABEL ? openingAssistantText(ctxForApi) : null;
      const lifeIntro =
        opts?.displayAs === LIFE_PLAN_STARTER_LABEL ? openingLifePracticeText(ctxForApi) : null;
      const headIntro = studyIntro || lifeIntro;
      const assistantContent = headIntro
        ? reply
          ? `${headIntro}\n\n${reply}`
          : headIntro
        : reply || "답변이 비어 있어요.";
      setMessages([
        ...before,
        userMsg,
        { role: "assistant", content: assistantContent }
      ]);
    } catch (e) {
      const netHint =
        e instanceof TypeError && isLikelyNetworkTypeError(e)
          ? `서버에 연결할 수 없습니다. 터미널에서 백엔드(node server, 보통 포트 3000)를 켠 뒤 다시 시도해 주세요.${
              API_BASE ? ` (API: ${API_BASE})` : ""
            }`
          : null;
      setBanner(netHint || (e instanceof Error ? e.message : "전송에 실패했습니다."));
      setMessages(before);
    } finally {
      setTyping(false);
    }
    requestAnimationFrame(() => {
      scrollChatToBottom("auto");
    });
  };

  const sendMessageRef = useRef(sendMessage);
  sendMessageRef.current = sendMessage;
  const autoTomorrowStarterDoneRef = useRef(false);

  useEffect(() => {
    if (!IS_NATIVE_PLATFORM) {
      return;
    }

    const handleNativeDismiss = (event: Event) => {
      const detail = (event as CustomEvent<{ source?: EventTarget | null }>).detail;
      if (detail?.source !== composerInputRef.current) {
        return;
      }
    };

    const handleNativeSubmit = (event: Event) => {
      const detail = (event as CustomEvent<{ source?: EventTarget | null; value?: string }>).detail;
      if (detail?.source !== composerInputRef.current) {
        return;
      }

      void sendMessage(String(detail?.value || draft));
    };

    window.addEventListener(NATIVE_KEYBOARD_DISMISS_EVENT, handleNativeDismiss);
    window.addEventListener(NATIVE_KEYBOARD_SUBMIT_EVENT, handleNativeSubmit);
    return () => {
      window.removeEventListener(NATIVE_KEYBOARD_DISMISS_EVENT, handleNativeDismiss);
      window.removeEventListener(NATIVE_KEYBOARD_SUBMIT_EVENT, handleNativeSubmit);
    };
  }, [draft, sendMessage]);

  const handleComposerBlur = () => {
    window.requestAnimationFrame(() => {
      if (composerInputRef.current?.dataset.nativeKeyboardSource === "true") {
        return;
      }
    });
  };

  useEffect(() => {
    if (autoTomorrowStarterDoneRef.current) return;
    if (!String(apiToken || "").trim()) return;
    if (messages.length > 0) return;
    let kind: string | null = null;
    try {
      kind = sessionStorage.getItem(DAECHI_COACH_TOMORROW_STARTER_KEY);
    } catch {
      return;
    }
    if (kind !== "study" && kind !== "life" && kind !== "app-allowance") return;
    autoTomorrowStarterDoneRef.current = true;
    try {
      sessionStorage.removeItem(DAECHI_COACH_TOMORROW_STARTER_KEY);
    } catch {
      // ignore
    }
    const starter =
      kind === "study"
        ? TOMORROW_PLAN_STARTERS[0]
        : kind === "life"
          ? TOMORROW_PLAN_STARTERS[1]
          : TOMORROW_PLAN_STARTERS[2];
    void sendMessageRef.current(starter.message, {
      clearDraft: true,
      displayAs: starter.label
    });
  }, [apiToken, messages.length]);

  const hasUserTurn = messages.some(m => m.role === "user");
  const firstUserMessage = messages.find(m => m.role === "user");
  const startedFromStarter = Boolean(
    firstUserMessage && STARTER_LABEL_SET.has(firstUserMessage.content)
  );
  const startedFromAppAllowance = firstUserMessage?.content === APP_ALLOWANCE_STARTER_LABEL;
  const startedFromPlanOrLifeStarter = Boolean(startedFromStarter && !startedFromAppAllowance);

  const applyToRecords = async () => {
    if (!apiToken || applyBusy) return;
    setBanner(null);
    setApplyBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/student/coach/tomorrow-plan/synthesize`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiToken}`
        },
        body: JSON.stringify({
          context,
          history: chatTurnsForApi(messages)
        })
      });
      const rawSynth = await res.text();
      const data = parseApiJson(rawSynth);
      if (!res.ok) {
        throw new Error(httpErrorMessage(res, rawSynth, "계획을 만들지 못했습니다"));
      }
      if (collabFocus === "life") {
        const tp = String(data.tomorrowPractice ?? "").trim();
        if (!tp) {
          throw new Error(
            "내일 실천 문장이 비어 있습니다. 대화를 조금 더 나눈 뒤 다시 시도해 주세요."
          );
        }
        const ok = await onApplyTomorrowPracticeAndGoRecords(tp);
        if (!ok) {
          setBanner("저장에 실패했습니다. 네트워크를 확인해 주세요.");
        }
        return;
      }
      const raw = data.plans;
      if (!Array.isArray(raw) || raw.length === 0) {
        throw new Error("책별 계획이 비어 있습니다. 대화를 조금 더 나눈 뒤 다시 시도해 주세요.");
      }
      const bookIds = new Set(progressBooks.map(b => b.id));
      const next: ProgressPlan = { ...tomorrowPlan };
      for (const row of raw) {
        const id = Number((row as { bookId?: unknown }).bookId);
        if (!Number.isFinite(id) || !bookIds.has(id)) continue;
        next[id] = {
          text: String((row as { plannedRange?: unknown }).plannedRange ?? "").trim(),
          start: String((row as { startTime?: unknown }).startTime ?? "").trim() || undefined,
          end: String((row as { endTime?: unknown }).endTime ?? "").trim() || undefined
        };
      }
      const ok = await onApplyAndReturnToRecords(next);
      if (!ok) {
        setBanner("저장에 실패했습니다. 잠금이나 네트워크를 확인해 주세요.");
      }
    } catch (e) {
      setBanner(e instanceof Error ? e.message : "반영에 실패했습니다.");
    } finally {
      setApplyBusy(false);
    }
  };

  return (
    <div ref={rootRef} className="coach-tomorrow-collab keyboard-dock-root">
      {banner && (
        <p className="coach-tomorrow-collab__banner" role="alert">
          {banner}
        </p>
      )}

      <div ref={chatScrollRef} className="coach-tomorrow-collab__chat coach-chat">
        {messages.map((m, idx) => (
          <div
            key={idx}
            className={"coach-bubble-row " + (m.role === "user" ? "is-user" : "is-coach")}
          >
            {m.role === "assistant" && <CoachAvatar />}
            <motion.div
              className={
                "coach-bubble " + (m.role === "user" ? "coach-bubble--user" : "coach-bubble--coach")
              }
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18 }}
            >
              {m.content.split("\n").map((line, i) => (
                <div key={i} className="coach-bubble__line">
                  {line || "\u00A0"}
                </div>
              ))}
              {m.role === "assistant" && startedFromPlanOrLifeStarter && (
                <div className="coach-tomorrow-collab__apply-in-bubble">
                  <button
                    type="button"
                    className="coach-primary-btn coach-tomorrow-collab__apply-bubble-btn"
                    disabled={!apiToken || typing || applyBusy}
                    onClick={() => void applyToRecords()}
                  >
                    {applyBusy ? "반영 중…" : "내일 계획에 반영"}
                  </button>
                </div>
              )}
              {m.role === "assistant" && startedFromAppAllowance && appAllowancePlan ? (
                <div className="coach-tomorrow-collab__apply-in-bubble">
                  <button
                    type="button"
                    className="coach-primary-btn coach-tomorrow-collab__apply-bubble-btn"
                    disabled={
                      !apiToken ||
                      typing ||
                      appAllowanceRequesting ||
                      appAllowancePlan.slots.length === 0
                    }
                    onClick={() => void requestParentAppAllowanceReview()}
                  >
                    {appAllowanceRequesting ? "요청 중…" : "관리자에게 요청하기"}
                  </button>
                </div>
              ) : null}
            </motion.div>
          </div>
        ))}
        {!hasUserTurn && !typing && (
          <div
            className="coach-bubble-row is-coach coach-tomorrow-collab__coach-offer-row"
            aria-label="코치 선택지"
          >
            <CoachAvatar />
            <motion.div
              className="coach-bubble coach-bubble--coach coach-tomorrow-collab__coach-offer"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18 }}
            >
              <div className="coach-bubble__line">
                학습 계획(교재별) 또는 내일 실천 한 가지(생활 기록) 중에서 골라 주세요. 직접 입력하셔도 돼요.
              </div>
              <div className="coach-tomorrow-collab__coach-picks">
                {TOMORROW_PLAN_STARTERS.map(s => (
                  <button
                    key={s.label}
                    type="button"
                    className="coach-tomorrow-collab__coach-pick"
                    disabled={!apiToken}
                    onClick={() =>
                      void sendMessage(s.message, {
                        clearDraft: true,
                        displayAs: s.label
                      })
                    }
                  >
                    {s.label}
                  </button>
                ))}
                <button
                  type="button"
                  className="coach-tomorrow-collab__coach-pick"
                  onClick={onOpenScheduleManager}
                >
                  일정 관리
                </button>
              </div>
            </motion.div>
          </div>
        )}
        {typing && (
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
        )}
        <div id="coach-tomorrow-collab-bottom" />
      </div>

      <div ref={footerRef} className="coach-tomorrow-collab__footer coach-chat-bottom-rail keyboard-dock">
        <div className="coach-chat-composer" onMouseDown={e => e.stopPropagation()}>
          <div className="coach-chat-input coach-chat-input--composer coach-tomorrow-collab__input">
            <input
              ref={composerInputRef}
              className="coach-chat-text"
              placeholder="내일 하고 싶은 것, 고민을 적어 주세요…"
              value={draft}
              enterKeyHint="send"
              data-native-keyboard-submit="custom"
              onBlur={handleComposerBlur}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") {
                  void sendMessage(draft);
                }
              }}
              disabled={!apiToken || typing}
            />
            <button
              type="button"
              className="coach-primary-btn coach-primary-btn--sm"
              onMouseDown={e => e.preventDefault()}
              onClick={() => {
                void sendMessage(draft);
              }}
              disabled={!apiToken || typing}
              aria-label="보내기"
            >
              <SendHorizontal size={15} strokeWidth={2.2} aria-hidden />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
