"use strict";

const POSITIVE_STUDENT = [
  "해봤어",
  "해봤어요",
  "됐어",
  "됐어요",
  "고마워",
  "감사해요",
  "맞아요",
  "그렇게 해볼게요",
  "알겠어요",
  "이해했어요",
  "좋아요",
  "해볼게",
  "시작했어",
  "시작했어요"
];

const NEGATIVE_STUDENT = [
  "모르겠어",
  "모르겠어요",
  "다시",
  "무슨 말이야",
  "이해 안 돼",
  "그게 아니라",
  "아니",
  "별로",
  "도움 안 됐어",
  "다른 방법",
  "왜요",
  "어떻게요"
];

const POSITIVE_PARENT = [
  "좋네요",
  "도움됐어요",
  "맞아요",
  "감사해요",
  "그렇군요",
  "해볼게요",
  "알겠어요",
  "좋은 것 같아요"
];

const NEGATIVE_PARENT = [
  "이게 맞나요",
  "다시 설명해줘",
  "모르겠어요",
  "아닌 것 같아요",
  "별로예요",
  "도움이 안 돼요",
  "다른 방법 없나요"
];

/**
 * @param {string} nextUserMessage
 * @param {'student'|'parent'} userType
 * @returns {{ signal: 'positive'|'negative'|'neutral', reason: string }}
 */
function detectSignal(nextUserMessage, userType) {
  // 스펙 원문은 trim 길이 <= 5였으나, 그렇게 하면 "해봤어요"(4)·"모르겠어요"(5)가
  // 키워드 매칭 전에 neutral 처리되어 cursor-step2-signal.md 검증과 맞지 않음.
  if (!nextUserMessage || nextUserMessage.trim().length <= 1) {
    return { signal: "neutral", reason: "메시지가 너무 짧음" };
  }

  const msg = nextUserMessage.trim();
  const positiveList = userType === "parent" ? POSITIVE_PARENT : POSITIVE_STUDENT;
  const negativeList = userType === "parent" ? NEGATIVE_PARENT : NEGATIVE_STUDENT;

  const hasPositive = positiveList.some(k => msg.includes(k));
  const hasNegative = negativeList.some(k => msg.includes(k));

  if (hasPositive && hasNegative) {
    return { signal: "neutral", reason: "긍정·부정 신호 동시 감지" };
  }
  if (hasPositive) {
    const matched = positiveList.find(k => msg.includes(k));
    return { signal: "positive", reason: `긍정 키워드 감지: "${matched}"` };
  }
  if (hasNegative) {
    const matched = negativeList.find(k => msg.includes(k));
    return { signal: "negative", reason: `부정 키워드 감지: "${matched}"` };
  }
  return { signal: "neutral", reason: "매칭 키워드 없음" };
}

module.exports = { detectSignal };
