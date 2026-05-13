"use strict";

const { getKoFallbacks, tpl } = require("./koFallbackLoader");

/**
 * 학부모 코치 커스터마이즈 → OpenAI system 보조 문단.
 * @param {{ persona: string; tone: string; controlIntensity: number; focusRules: string }} cfg
 *   `serializeParentCoachCustomization` 결과와 동일한 형태
 */
function buildSystemPromptFromConfig(cfg) {
  const c = cfg || {};
  const intensity = Number(c.controlIntensity);
  const intensityGuide =
    intensity <= 1
      ? "매우 낮음: 자율성을 존중하고 선택지를 제안하는 쪽으로 답한다."
      : intensity === 2
        ? "낮음: 부드럽게 권하지만 행동 제안은 분명하게 한다."
        : intensity === 3
          ? "보통: 공감과 기준 제시를 균형 있게 유지한다."
          : intensity === 4
            ? "높음: 미루기나 회피는 짚되, 학생을 깎아내리지 말고 바로 실행을 요구한다."
            : "매우 높음: 매우 분명하고 단호하게 방향을 제시하되, 위협·모욕·비난은 금지한다.";
  return [
    "연결된 학부모가 이 학생의 AI 코치 스타일을 다음과 같이 커스터마이징했다.",
    `- 페르소나: ${c.persona}`,
    `- 말투/화법: ${c.tone}`,
    `- 통제 강도: ${c.controlIntensity}/5. ${intensityGuide}`,
    `- 특히 강조할 원칙: ${c.focusRules}`,
    "이 설정을 우선 반영하되, 항상 한국어 존댓말을 유지하고 학생을 인격적으로 존중하라. 공격적·모욕적·위협적인 표현은 금지한다."
  ].join("\n");
}

/**
 * GPT 미사용 시 학습 코치 템플릿에 붙는 행동 문장 (이미 직렬화된 cfg 기준).
 * @param {{ controlIntensity: number }} cfg `serializeParentCoachCustomization` 결과
 */
function buildCustomizedFallbackAction(cfg, suggestedAction) {
  const c = cfg || {};
  const pc = getKoFallbacks().parentCoachCustomization;
  const intensity = Number(c.controlIntensity);
  const action = String(suggestedAction || pc.defaultSuggestedAction).trim();
  if (intensity <= 2) {
    return tpl(pc.fallbackIntensityLow, { action });
  }
  if (intensity === 3) {
    return tpl(pc.fallbackIntensityMid, { action });
  }
  return tpl(pc.fallbackIntensityHigh, { action });
}

module.exports = {
  buildSystemPromptFromConfig,
  buildCustomizedFallbackAction
};
