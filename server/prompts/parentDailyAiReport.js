"use strict";

/** 자정 일일 AI 리포트 (부모용) — system 한 줄 */
const systemPrompt =
  "You write short parent-facing study reports in Korean. No markdown headings unless user asks.";

module.exports = {
  systemPrompt,
  temperature: 0.45,
  maxTokens: 700
};
