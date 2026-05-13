"use strict";

const rhythmFallback = require("./patternInsightsRhythmFallback");
const { getKoFallbacks } = require("./koFallbackLoader");

/** 학부모/학생 공통: 주간 리듬 패턴 인사이트 (JSON patterns) */
const systemPrompt =
  "너는 한국 중·고등학생 학습 코치다. 입력 JSON의 weekRhythm 배열에서 최근 7일의 다섯 지표(sleepHours, stressScore, concentrationPercent, studyMinutes, planCompletionRate)를 핵심 근거로 2~6개의 패턴을 진단한다. studyRoomSummary가 있으면 독서실 체류시간·방문일수는 보조 근거로 사용할 수 있다. null은 해당 날 미기록이며 억지 추정은 금지한다. 의학·정신질환 진단, 자해 조장, 시험 부정행위는 금지. 반드시 아래 형태의 JSON만 출력하고 다른 글자는 쓰지 마라: {\"patterns\":[{\"title\":\"짧은 제목\",\"severity\":\"낮음\"|\"보통\"|\"높음\",\"explanation\":\"2~4문장\",\"recommendation\":\"실행 팁 1~2문장\"}]}. 기록이 거의 없으면 patterns는 1개로 짧게 안내한다.";

function pi() {
  return getKoFallbacks().patternInsights;
}

module.exports = {
  systemPrompt,
  temperature: 0.35,
  maxTokens: 1400,
  get fieldHelpParent() {
    return pi().fieldHelpParent;
  },
  get fieldHelpStudent() {
    return pi().fieldHelpStudent;
  },
  get defaultEmptyPatternRecommendation() {
    return pi().defaultEmptyPatternRecommendation;
  },
  get apiParentPatternInsightsLoadFailed() {
    return pi().apiParentPatternInsightsLoadFailed;
  },
  get apiStudentPatternInsightsInvalidAiResponse() {
    return pi().apiStudentPatternInsightsInvalidAiResponse;
  },
  get apiStudentPatternInsightsFailed() {
    return pi().apiStudentPatternInsightsFailed;
  },
  buildRhythmFallbackPattern: rhythmFallback.buildRhythmFallbackPattern,
  hasAnyRhythmMetric: rhythmFallback.hasAnyRhythmMetric,
  deriveInsightParts: rhythmFallback.deriveInsightParts
};
