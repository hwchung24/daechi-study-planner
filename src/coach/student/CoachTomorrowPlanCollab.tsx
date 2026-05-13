import { Capacitor } from "@capacitor/core";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { SendHorizontal } from "lucide-react";
import { CoachAvatar } from "../CoachAvatar";
import { API_BASE } from "../../lib/apiBase";
import { DAECHI_COACH_TOMORROW_STARTER_KEY } from "../../lib/coachEvents";
import { resolvePreferredSerial } from "../../lib/hashRouteUtils";
import type { ProgressBook, ProgressPlan, StudyBlock } from "../../types/planner";
import ko from "../fallbacks/ko.json";
import { tpl } from "../fallbacks/tpl";

const fb = ko.gptOutputFallbacks.coachTomorrowPlanCollab;
const weekdayMonSun = ko.common.weekdaysMonSun;

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
  name: fb.daechiRootName,
  category: fb.requiredAppCategory,
  description: fb.daechiRootDescription,
  bundleId: DAECHI_ROOT_APP_ID
};

const WEEKDAY_LABELS: Record<AppAllowanceSlot["dayKey"], string> = {
  mon: weekdayMonSun[0] ?? "월",
  tue: weekdayMonSun[1] ?? "화",
  wed: weekdayMonSun[2] ?? "수",
  thu: weekdayMonSun[3] ?? "목",
  fri: weekdayMonSun[4] ?? "금",
  sat: weekdayMonSun[5] ?? "토",
  sun: weekdayMonSun[6] ?? "일"
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
  return id === DAECHI_ROOT_APP_ID || bundleId === DAECHI_ROOT_APP_ID || name === fb.daechiRootName;
}

function normalizeAppAllowanceCandidates(rows: AppAllowanceCandidate[]): AppAllowanceCandidate[] {
  const seen = new Set<string>();
  const next = (Array.isArray(rows) ? rows : [])
    .map(app => ({
      id: String(app?.id || "").trim(),
      name: String(app?.name || "").trim(),
      category: String(app?.category || "").trim() || fb.defaultAppCategory,
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
    const rootApp: (typeof next)[number] = {
      id: DAECHI_ROOT_APP.id,
      name: DAECHI_ROOT_APP.name,
      category: DAECHI_ROOT_APP.category,
      description: DAECHI_ROOT_APP.description ?? null,
      bundleId: DAECHI_ROOT_APP.bundleId ?? null
    };
    next.unshift(rootApp);
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
      title: String(slot.title || "").trim() || fb.defaultSlotTitle,
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
    return plan.summary || fb.allowanceSummaryNoAi;
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
    plan.summary || fb.allowanceReplyLineDefault,
    "",
    preview ? `${fb.allowancePreviewPrefix}${preview}` : "",
    "",
    fb.allowanceReplyFooter
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
    return fb.httpTomorrow404;
  }
  if (snip && !snip.startsWith("<")) {
    return tpl(fb.httpServerErrorLineTpl, { status: res.status, snip });
  }
  return tpl(fb.httpErrorWithStatusTpl, { fallback, status: res.status });
}

function isLikelyNetworkTypeError(error: TypeError): boolean {
  const msg = String(error.message || "");
  return /fetch|network|load failed|failed to fetch/i.test(msg);
}

function buildNetworkInstallHint(): string {
  return tpl(fb.networkBackendHintTpl, {
    apiBaseSuffix: API_BASE ? tpl(fb.networkApiBaseSuffixTpl, { apiBase: API_BASE }) : ""
  });
}

function buildCollabContext(params: {
  blocks: StudyBlock[];
  progressBooks: ProgressBook[];
  tomorrowPlan: ProgressPlan;
  studyEvaluation: string;
  metacognitionReflection: string;
  todayProgressPercent: number;
  collabFocus: CollabFocus;
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
  const se = studyEvaluation ? studyEvaluation.slice(0, 220) + (studyEvaluation.length > 220 ? "…" : "") : fb.valueNotYetRecorded;
  const me = metacognitionReflection
    ? metacognitionReflection.slice(0, 220) + (metacognitionReflection.length > 220 ? "…" : "")
    : fb.valueNotYetRecorded;
  const sm =
    todayStudyMinutes != null && Number.isFinite(Number(todayStudyMinutes))
      ? `${Math.round(Number(todayStudyMinutes))}분`
      : fb.valueNotYetRecorded;
  return [
    fb.studyPlanAssistIntro,
    "",
    `· 오늘 계획 칸 기준 이행률: ${todayProgressPercent}% (${doneSlots}/${totalSlots || 0}칸 완료)`,
    `· 오늘 기록한 학습 시간: ${sm}`,
    `· 오늘 공부 좋았던 점과 나빴던 점(발췌): ${se}`,
    `· 오늘 공부한 내용(발췌): ${me}`,
    "",
    fb.studyPlanAssistSub
  ].join("\n");
}

function openingLifePracticeText(ctx: ReturnType<typeof buildCollabContext>): string {
  const memo = ctx.todayMemo
    ? ctx.todayMemo.slice(0, 220) + (ctx.todayMemo.length > 220 ? "…" : "")
    : fb.valueNotYetRecorded;
  const draft = ctx.draftTomorrowPractice
    ? ctx.draftTomorrowPractice.slice(0, 220) +
      (ctx.draftTomorrowPractice.length > 220 ? "…" : "")
    : fb.valueNotYetRecorded;
  const sm =
    ctx.todayStudyMinutes != null && Number.isFinite(Number(ctx.todayStudyMinutes))
      ? `${Math.round(Number(ctx.todayStudyMinutes))}분`
      : fb.valueNotYetRecorded;
  return [
    fb.lifePlanAssistIntro,
    "",
    `· 오늘 생활 좋았던 점과 나빴던 점(발췌): ${memo}`,
    `· 오늘 기록한 학습 시간: ${sm}`,
    `· 지금 적어 둔 실천 초안: ${draft}`,
    "",
    fb.lifePlanAssistSub
  ].join("\n");
}

/** 학습 계획 짜기 클릭 시에만 오늘 기록 요약 인사(openingAssistantText)를 코치 답변 앞에 붙임 */
const STUDY_PLAN_STARTER_LABEL = fb.studyPlanStarterLabel;
/** 생활 = 기록 탭「내일 실천할 한 가지」문장 협업 */
const LIFE_PLAN_STARTER_LABEL = fb.lifePlanStarterLabel;
const APP_ALLOWANCE_STARTER_LABEL = fb.appAllowanceStarterLabel;

const TOMORROW_PLAN_STARTERS: { label: string; message: string }[] = [
  {
    label: STUDY_PLAN_STARTER_LABEL,
    message: fb.studyPlanStarterMessage
  },
  {
    label: LIFE_PLAN_STARTER_LABEL,
    message: fb.lifePlanStarterMessage
  },
  {
    label: APP_ALLOWANCE_STARTER_LABEL,
    message: fb.appAllowanceStarterMessage
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
      throw new Error(fb.loginRequired);
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
      throw new Error(String(data.error || fb.allowanceRequestFailed));
    }
    return {
      reply:
        String(data.reply || "").trim() || fb.allowanceReplyDefault,
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
            (data.code === "NO_LINKED_PARENT" ? fb.noParentLinked : fb.parentRequestSendFailed)
        );
      }
      setBanner(fb.parentRequestSentBanner);
    } catch (error) {
      setBanner(
        error instanceof Error && error.message
          ? error.message
          : fb.networkSendFailed
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
          fb.allowanceDetailHint;
        setAppAllowancePlan(nextPlan);
        setMessages([...before, userMsg, { role: "assistant", content: assistantContent }]);
      } catch (e) {
        const netHint =
          e instanceof TypeError && isLikelyNetworkTypeError(e) ? buildNetworkInstallHint() : null;
        setBanner(netHint || (e instanceof Error ? e.message : fb.transferFailed));
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
        throw new Error(httpErrorMessage(res, rawText, fb.httpParseFailed));
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
        : reply || fb.emptyReply;
      setMessages([
        ...before,
        userMsg,
        { role: "assistant", content: assistantContent }
      ]);
    } catch (e) {
      const netHint =
        e instanceof TypeError && isLikelyNetworkTypeError(e) ? buildNetworkInstallHint() : null;
      setBanner(netHint || (e instanceof Error ? e.message : fb.transferFailed));
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
        throw new Error(httpErrorMessage(res, rawSynth, fb.planSynthFailed));
      }
      if (collabFocus === "life") {
        const tp = String(data.tomorrowPractice ?? "").trim();
        if (!tp) {
          throw new Error(fb.tomorrowPracticeEmpty);
        }
        const ok = await onApplyTomorrowPracticeAndGoRecords(tp);
        if (!ok) {
          setBanner(fb.saveFailedNetwork);
        }
        return;
      }
      const raw = data.plans;
      if (!Array.isArray(raw) || raw.length === 0) {
        throw new Error(fb.studyPlanEmpty);
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
        setBanner(fb.saveFailedLockNetwork);
      }
    } catch (e) {
      setBanner(e instanceof Error ? e.message : fb.applyFailed);
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
                    {applyBusy ? fb.applyButtonApplying : fb.applyButtonApplyToTomorrow}
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
                    {appAllowanceRequesting ? fb.requestButtonRequesting : fb.requestButtonSendToParent}
                  </button>
                </div>
              ) : null}
            </motion.div>
          </div>
        ))}
        {!hasUserTurn && !typing && (
          <div
            className="coach-bubble-row is-coach coach-tomorrow-collab__coach-offer-row"
            aria-label={fb.coachPicksAria}
          >
            <CoachAvatar />
            <motion.div
              className="coach-bubble coach-bubble--coach coach-tomorrow-collab__coach-offer"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18 }}
            >
              <div className="coach-bubble__line">
                {fb.coachOfferIntro}
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
                  {fb.scheduleManagerButton}
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
              placeholder={fb.composerPlaceholder}
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
              aria-label={fb.composerSendAria}
            >
              <SendHorizontal size={15} strokeWidth={2.2} aria-hidden />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
