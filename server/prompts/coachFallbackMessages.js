"use strict";

const { getKoFallbacks, tpl } = require("./koFallbackLoader");

const k = () => getKoFallbacks().coachFallbackMessages;

function buildScheduleManagementReply() {
  return k().scheduleManagementLines.join("\n");
}

function buildMissingScheduleFieldsMessage(missing) {
  const m = k();
  if (!Array.isArray(missing) || missing.length === 0) {
    return m.missingScheduleAll;
  }
  if (missing.includes("종료 시간") && !missing.includes("시작 시간")) {
    return m.missingScheduleEndOnly;
  }
  if (missing.includes("시작 시간") && !missing.includes("종료 시간")) {
    return m.missingScheduleStartOnly;
  }
  if (missing.includes("시작 시간") && missing.includes("종료 시간")) {
    return m.missingScheduleBothTimes;
  }
  return `${missing.join(", ")}${m.missingScheduleGenericPrefix}`;
}

function buildScheduleConflictMessage(draft, conflicts) {
  const m = k();
  const lead = tpl(m.scheduleConflictLead, {
    start: draft?.startTime,
    end: draft?.endTime,
    title: draft?.title || ""
  });
  const details = (conflicts || [])
    .slice(0, 3)
    .map(item =>
      tpl(m.scheduleConflictDetailLine, {
        itemTitle: item.title,
        itemDate: item.date,
        itemStart: item.startTime,
        itemEndSuffix: item.endTime ? `~${item.endTime}` : ""
      })
    )
    .join("\n");
  return [lead, details, m.scheduleConflictTail1, m.scheduleConflictTail2].filter(Boolean).join("\n");
}

function buildAmbiguousDeleteMessageFromCandidates(candidates, formatLine) {
  const m = k();
  const fmt = typeof formatLine === "function" ? formatLine : () => "";
  const items = (candidates || [])
    .slice(0, 5)
    .map(row => fmt(row))
    .filter(Boolean)
    .join("\n");
  return [m.ambiguousDeleteLead, items, m.ambiguousDeleteTail].filter(Boolean).join("\n");
}

function weeklyAppRequestReplyWhenParsedEmpty(normalized) {
  const m = k();
  return normalized.slots.length > 0 ? m.weeklyAppRequestParsedSlots : m.weeklyAppRequestParsedEmpty;
}

function buildSuneungCoachTemplateFallback(heroNarrative) {
  const m = k();
  const narrative = String(heroNarrative || "").trim() || m.suneungTemplateNoHero;
  return m.suneungTemplateLines.map(line => tpl(line, { heroNarrative: narrative })).join("\n");
}

function buildLearningCoachTemplateFallback(heroNarrative, customizedActionParagraph) {
  const m = k();
  const narrative = String(heroNarrative || "").trim() || m.learningTemplateNoHero;
  const action = String(customizedActionParagraph || "").trim();
  return [tpl(m.learningTemplateFlowLine, { narrative }), action, m.learningTemplateClosing].join("\n\n");
}

const cm = getKoFallbacks().coachFallbackMessages;

module.exports = {
  scheduleValidationIntentResetNoOpenAi: cm.scheduleValidationIntentResetNoOpenAi,
  scheduleValidationDefaultNoOpenAi: cm.scheduleValidationDefaultNoOpenAi,
  scheduleIntentResetParsedFallback: cm.scheduleIntentResetParsedFallback,
  scheduleSaveDefaultMessage: cm.scheduleSaveDefaultMessage,
  weeklyAppRequestNoOpenAi: {
    reply: cm.weeklyAppRequestNoOpenAiReply,
    summary: "",
    slots: []
  },
  weeklyAppRequestReplyWhenParsedEmpty,
  appTimetableChatNoGptReply: cm.appTimetableChatNoGptReply,
  appTimetableChatParsedReplyFallback: cm.appTimetableChatParsedReplyFallback,
  defaultLearningCoachTopAction: cm.defaultLearningCoachTopAction,
  apiCoachChatGenerationFailed: cm.apiCoachChatGenerationFailed,
  buildSuneungCoachTemplateFallback,
  buildLearningCoachTemplateFallback,
  buildScheduleManagementReply,
  buildMissingScheduleFieldsMessage,
  buildScheduleConflictMessage,
  buildAmbiguousDeleteMessageFromCandidates
};
