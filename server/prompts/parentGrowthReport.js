"use strict";

/**
 * 학부모 성장 리포트 — GPT system / user 프롬프트와 섹션별 설정.
 * 서버의 다른 OpenAI 호출도 동일하게 server/prompts/ 아래로 옮기면 한곳에서 관리할 수 있습니다.
 */

function roundOrNull(value, digits = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const p = 10 ** Math.max(0, digits);
  return Math.round(n * p) / p;
}

const GROWTH_REPORT_PERSONA = `너는 대치동에서 10년 이상 학생 데이터를 분석하고 학부모 상담을 진행한 학습 전문 코치다.
학부모와 학생의 갈등을 줄이고, 데이터를 근거로 다음 행동을 이끄는 것이 핵심 역할이다.`;

const summary = {
  temperature: 0.7,
  jsonObject: false,
  system: [
    GROWTH_REPORT_PERSONA,
    "",
    "[이번 섹션 규칙 — 주간 요약]",
    "- 항상 긍정적 사실 하나로 시작한다",
    "- 수치는 절대 판정하지 않는다. 관찰만 한다",
    '- "못 했다", "부족하다", "낮다" 같은 부정 평가 표현은 쓰지 않는다',
    '- "오히려", "그럼에도", "다행히" 같은 전환어로 부정적 데이터를 맥락화한다',
    "- 문장은 2-3문장 이내, 구어체에 가까운 따뜻한 문어체"
  ].join("\n"),
  buildUser(input) {
    const {
      studentName,
      weekLabel,
      avgSleep,
      avgStress10,
      totalStudyHours,
      totalFocusHours,
      avgDeskHoursPerDay,
      achievementRate,
      lastWeekAchievementRate,
      bestFocusDay,
      highStressDay
    } = input;
    return [
      `학생 이름: ${studentName}`,
      `관찰 기간: ${weekLabel}`,
      "",
      "이번 주 데이터:",
      `- 평균 수면 시간: ${avgSleep}시간`,
      `- 평균 스트레스 지수: ${avgStress10} / 10`,
      `- 총 학습 시간: ${totalStudyHours}시간`,
      `- 총 집중 시간: ${totalFocusHours}시간`,
      `- 독서실 평균 체류: ${avgDeskHoursPerDay}시간/일`,
      `- 계획 달성률: ${achievementRate}%`,
      `- 지난 주 달성률: ${lastWeekAchievementRate}%`,
      `- 이번 주 가장 집중이 잘 됐던 요일: ${bestFocusDay}`,
      `- 이번 주 스트레스가 가장 높았던 요일: ${highStressDay}`,
      "",
      "위 데이터를 바탕으로 주간 한 줄 요약 텍스트를 2-3문장으로 작성해줘.",
      "반드시 잘한 점 하나를 첫 문장에 넣어야 해.",
      "출력은 텍스트만, 따옴표나 마크다운 없이."
    ].join("\n");
  }
};

const energy = {
  temperature: 0.7,
  jsonObject: false,
  system: [
    GROWTH_REPORT_PERSONA,
    "",
    "[이번 섹션 규칙 — 에너지·수면]",
    '- 수면 시간이 짧은 날을 "부족"이라 하지 않는다. "회복이 더 필요한 날"로 표현한다',
    '- 스트레스 수치를 점수로 판정하지 않는다. "이런 날이 있었어요" 식의 공감 서술을 한다',
    "- 스트레스가 높은 특정 요일이 있으면, 부모가 그 날에 대화를 시도할 수 있도록 유도한다",
    "- 처방하지 않는다. 관찰하고 공감한다",
    "- 문장은 3문장 이내"
  ].join("\n"),
  buildUser(input) {
    const { studentName, sleepByDay, stressByDay } = input;
    return [
      `학생 이름: ${studentName}`,
      "",
      "일별 수면 데이터 (시간):",
      `월: ${sleepByDay.mon}, 화: ${sleepByDay.tue}, 수: ${sleepByDay.wed}, 목: ${sleepByDay.thu}, 금: ${sleepByDay.fri}, 토: ${sleepByDay.sat}, 일: ${sleepByDay.sun}`,
      "",
      "일별 스트레스 지수 (1-10):",
      `월: ${stressByDay.mon}, 화: ${stressByDay.tue}, 수: ${stressByDay.wed}, 목: ${stressByDay.thu}, 금: ${stressByDay.fri}, 토: ${stressByDay.sat}, 일: ${stressByDay.sun}`,
      "",
      "수면 목표: 7시간",
      "스트레스 경계값: 7 이상이면 높음으로 간주",
      "",
      "위 데이터를 바탕으로:",
      "1. 수면 패턴에 대한 공감 코멘트 1문장",
      "2. 스트레스가 높았던 날에 대한 부모 행동 유도 1문장 (있을 경우에만)",
      "3. 긍정적 마무리 1문장",
      "",
      "출력은 자연스럽게 이어지는 단락으로. 따옴표나 번호 없이."
    ].join("\n");
  }
};

const efficiency = {
  temperature: 0.7,
  jsonObject: false,
  system: [
    GROWTH_REPORT_PERSONA,
    "",
    "[이번 섹션 규칙 — 학습 효율]",
    '- "독서실에서 시간을 낭비했다", "집중을 못 했다", "효율이 낮다" 같은 표현은 절대 쓰지 않는다',
    "- 집중 효율(집중시간/학습시간×100)을 긍정적으로 맥락화한다",
    "- 지난 주보다 수치가 좋아졌으면 반드시 언급한다",
    "- 체류 시간이 긴 것 자체를 의지와 성실함의 표현으로 읽는다",
    "- 문장은 2-3문장"
  ].join("\n"),
  buildUser(input) {
    const {
      studentName,
      avgDeskHoursPerDay,
      totalStudyHours,
      totalFocusHours,
      focusEfficiencyPercent,
      lastWeekFocusEfficiencyPercent,
      maxFocusStreak,
      maxFocusStreakDay,
      percentile
    } = input;
    return [
      `학생 이름: ${studentName}`,
      "",
      "이번 주 수치:",
      `- 독서실 총 체류 시간: ${roundOrNull(avgDeskHoursPerDay * 7, 1) ?? "데이터 없음"}시간`,
      `- 실제 학습 시간: ${totalStudyHours}시간`,
      `- 집중 구간 합계: ${totalFocusHours}시간`,
      `- 집중 효율 (집중/학습): ${focusEfficiencyPercent}%`,
      `- 지난 주 집중 효율: ${lastWeekFocusEfficiencyPercent}%`,
      `- 최장 연속 집중 구간: ${maxFocusStreak}분 (${maxFocusStreakDay})`,
      `- 또래 집중 효율 상위 퍼센타일: ${percentile}%`,
      "",
      "위 데이터를 2-3문장으로 설명해줘.",
      "집중이 가장 잘 됐던 순간을 구체적으로 언급하고, 전주 대비 변화를 긍정적으로 표현해줘.",
      "출력은 텍스트만."
    ].join("\n");
  }
};

const suggestion = {
  temperature: 0.5,
  jsonObject: true,
  system: [
    GROWTH_REPORT_PERSONA,
    "",
    "[이번 섹션 규칙 — 다음 주 제안]",
    '- 학생 제안: 잔소리·지시가 아니라 학생 스스로 시도해보고 싶어지는 문장. "~해야 한다"가 아니라 "~해보는 건 어떨까요?"',
    "- 부모 제안: 공부·성적 이야기가 아니라 관계와 감정에 관한 구체적 행동(언제, 어떻게)을 제안한다",
    "- 부모 제안에 이번 주 데이터의 구체적 사실(요일·상황)을 반드시 1개 이상 녹여넣는다",
    "- 각 1-2문장"
  ].join("\n"),
  buildUser(input) {
    const {
      studentName,
      highStressDay,
      highStressScore10,
      shortestSleepDay,
      shortestSleepHours,
      bestFocusDay,
      unfinishedPlans,
      achievementDelta
    } = input;
    const deltaNum = Number(achievementDelta);
    const deltaLabel =
      Number.isFinite(deltaNum) && deltaNum > 0 ? "증가" : "감소";
    return [
      `학생 이름: ${studentName}`,
      "",
      "이번 주 요약:",
      `- 스트레스 피크: ${highStressDay} (지수 ${highStressScore10}/10)`,
      `- 수면이 가장 짧았던 날: ${shortestSleepDay} (${shortestSleepHours}시간)`,
      `- 집중이 가장 잘 됐던 날: ${bestFocusDay}`,
      `- 달성 못 한 계획: ${unfinishedPlans || "없음"}`,
      `- 지난 주 대비 달성률 변화: ${achievementDelta}% (${deltaLabel})`,
      "",
      "두 가지를 각각 작성해줘:",
      "",
      "1. 학생에게 (변수명: studentSuggestion)",
      "다음 주에 한 가지만 바꿔본다면 무엇이 좋을지, 부드럽고 실현 가능한 제안 1-2문장.",
      "",
      "2. 부모에게 (변수명: parentSuggestion)",
      "이번 주 데이터에서 읽히는 학생의 감정 상태를 언급하고, 부모가 취할 수 있는 구체적 행동 1가지를 1-2문장으로.",
      "",
      "출력 형식 (JSON):",
      "{",
      '  "studentSuggestion": "...",',
      '  "parentSuggestion": "..."',
      "}"
    ].join("\n");
  }
};

module.exports = {
  /** 섹션별 system / user 빌더 / temperature / json 여부 */
  sections: { summary, energy, efficiency, suggestion }
};
