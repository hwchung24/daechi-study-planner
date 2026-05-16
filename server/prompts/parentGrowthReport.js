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
      "주의: 일별 수면·스트레스 값이 모두 '데이터 없음'이면 특정 요일(화요일, 목요일 등)을 언급하지 말고, 기록이 쌓이면 패턴이 보인다는 안내만 2문장 이내로 작성한다.",
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

function formatMinutesAsHoursLabel(minutes) {
  const m = Number(minutes);
  if (!Number.isFinite(m) || m <= 0) return "0시간";
  const h = m / 60;
  return h >= 1 ? `${roundOrNull(h, 1)}시간` : `${Math.round(m)}분`;
}

function buildLearningPatternLines(input = {}) {
  const lines = [];
  if (input.studentGoal) lines.push(`- 학습 목표: ${input.studentGoal}`);
  if (input.targetGrade) lines.push(`- 목표 성적·등급: ${input.targetGrade}`);
  if (input.topSubjectsLine) lines.push(`- 과목별 학습 시간(많은 순): ${input.topSubjectsLine}`);
  if (input.planProgressLine) lines.push(`- 계획 실행: ${input.planProgressLine}`);
  if (input.completedHighlights) lines.push(`- 이번 주 잘 끝낸 계획: ${input.completedHighlights}`);
  if (input.carryOverPlans) lines.push(`- 다음 주로 넘길·이어갈 계획: ${input.carryOverPlans}`);
  if (input.studyPeakDay) lines.push(`- 학습량이 가장 많았던 요일: ${input.studyPeakDay}`);
  if (input.focusEfficiencyPercent != null && input.focusEfficiencyPercent !== "데이터 없음") {
    lines.push(`- 집중 효율(집중/학습): ${input.focusEfficiencyPercent}%`);
  }
  if (input.achievementRate != null && input.achievementRate !== "데이터 없음") {
    lines.push(`- 이번 주 계획 달성률: ${input.achievementRate}%`);
  }
  if (input.achievementDelta != null && input.achievementDelta !== "데이터 없음") {
    const deltaNum = Number(input.achievementDelta);
    const deltaLabel =
      Number.isFinite(deltaNum) && deltaNum > 0 ? "전주 대비 상승" : "전주 대비 하락·유지";
    lines.push(`- 전주 대비 달성률 변화: ${input.achievementDelta}%p (${deltaLabel})`);
  }
  if (input.bestFocusDay && input.bestFocusDay !== "데이터 없음") {
    lines.push(`- 집중이 잘 됐던 요일: ${input.bestFocusDay}`);
  }
  if (input.highStressDay && input.highStressDay !== "데이터 없음") {
    lines.push(
      `- 스트레스가 높았던 요일(학습 조절 참고): ${input.highStressDay} (지수 ${input.highStressScore10}/10)`
    );
  }
  return lines.length ? lines.join("\n") : "- 이번 주 학습·계획 기록이 아직 적어 패턴 추정이 제한됩니다.";
}

function isGenericWellnessSuggestion(text) {
  const t = String(text || "").trim();
  if (!t) return true;
  const wellness =
    /스트레칭|산책|명상|물\s*마시|기분\s*한\s*줄|휴식\s*루틴|가볍게\s*물러|산책|걷기|스트레칭/.test(t);
  const learningLinked = /계획|교재|학습|공부|집중|과목|블록|달성|이행|복습|문제|범위/.test(t);
  return wellness && !learningLinked;
}

function buildNextWeekSuggestionsFallback(input = {}) {
  const studentName = String(input.studentName || "학생").trim() || "학생";
  const carry = String(input.carryOverPlans || "").trim();
  const completed = String(input.completedHighlights || "").trim();
  const bestDay = String(input.bestFocusDay || "").trim();
  const topSubjects = String(input.topSubjectsLine || "").trim();
  const achievementDelta = Number(input.achievementDelta);

  let studentSuggestion = "";
  if (carry && carry !== "없음") {
    const firstBook = carry.split(",")[0]?.trim() || carry;
    studentSuggestion = bestDay && bestDay !== "데이터 없음"
      ? `${bestDay}에 '${firstBook}'만 25분 먼저 시작해 보는 건 어떨까요? 완료보다 시작 한 칸만 목표로 잡아 보세요.`
      : `다음 주는 '${firstBook}'부터 25분만 먼저 시작해 보는 건 어떨까요? 완료보다 '시작' 한 칸만 목표로 잡아 보세요.`;
  } else if (topSubjects) {
    const top = topSubjects.split(",")[0]?.trim() || topSubjects;
    studentSuggestion = `${top} 비중이 컸어요. 다음 주도 같은 과목을 하루 한 블록(30분)만 고정해 두면 리듬이 이어질 거예요.`;
  } else if (Number.isFinite(achievementDelta) && achievementDelta < 0) {
    studentSuggestion =
      "다음 주는 하루 계획을 2개만 적고, 하나만 끝내도 성공으로 인정해 보세요. 달성률을 조금씩 올리는 데 집중해 보세요.";
  } else {
    studentSuggestion =
      "이번 주처럼 기록을 이어 가면서, 다음 주 계획표에 가장 먼저 할 교재 1권만 적어 두고 그날 첫 블록에 넣어 보세요.";
  }

  let parentSuggestion = "";
  if (carry && carry !== "없음") {
    parentSuggestion = `이번 주 미완료 계획(${carry})이 있어요. 주말에 ${studentName}님과 '다음 주 첫 블록에 넣을 교재 1권'만 5분 같이 정해 보시면 부담이 줄어요.`;
  } else if (completed && completed !== "없음") {
    parentSuggestion = `이번 주 ${completed}을(를) 끝냈어요. 다음 주 계획을 세울 때 그 성공을 한 번 짚어 주시면 ${studentName}이 스스로 리듬을 잡기 쉬워요.`;
  } else if (input.highStressDay && input.highStressDay !== "데이터 없음") {
    parentSuggestion = `${input.highStressDay} 스트레스가 높았어요. 그날 저녁에는 성적 대신 '내일 첫 공부 25분만 무엇으로 할지'만 가볍게 맞춰 보세요.`;
  } else {
    parentSuggestion = `이번 주 학습 기록을 바탕으로, ${studentName}과 다음 주 '가장 먼저 할 교재·시간대' 한 가지만 짧게 맞춰 보시면 계획 실행에 도움이 돼요.`;
  }

  return { studentSuggestion, parentSuggestion };
}

const suggestion = {
  temperature: 0.35,
  jsonObject: true,
  system: [
    GROWTH_REPORT_PERSONA,
    "",
    "[이번 섹션 규칙 — 다음 주 제안]",
    "- 반드시 아래 '이번 주 학습 패턴'에 나온 사실(교재·과목·요일·달성률·미완료 계획)만 근거로 쓴다.",
    "- 학생 제안: 다음 주 계획·학습 습관에 대한 구체적 1가지(교재명·요일·시간·분량 중 2개 이상 명시). '~해보는 건 어떨까요?' 톤.",
    "- 부모 제안: 학습 실행을 돕는 구체적 행동 1가지(언제·무엇을 함께 정할지). 성적 잔소리·훈계 금지.",
    "- 스트레칭·산책·명상·수면 루틴·기분만 묻기 등 학습·계획과 무관한 일반 웰니스 조언은 쓰지 않는다.",
    "- 수면·스트레스는 '학습량·계획 조절'과 직접 연결될 때만 짧게 언급할 수 있다.",
    "- 데이터에 없는 교재명·요일을 지어내지 않는다. 없으면 '기록된 교재'·'집중이 잘 됐던 요일' 등으로만 표현.",
    "- 각 1-2문장, JSON만 출력"
  ].join("\n"),
  buildUser(input) {
    const learningPatterns = buildLearningPatternLines(input);
    return [
      `학생 이름: ${input.studentName}`,
      "",
      "이번 주 학습 패턴 (다음 주 제안의 유일한 근거):",
      learningPatterns,
      "",
      "보조 맥락 (학습 제안에 필요할 때만 참고):",
      `- 달성 못 한·이어갈 계획 요약: ${input.unfinishedPlans || "없음"}`,
      "",
      "작성:",
      "1. studentSuggestion — 다음 주 학습·계획 실행 제안 1-2문장",
      "2. parentSuggestion — 위 패턴을 바탕으로 학습 실행을 돕는 부모 행동 1-2문장",
      "",
      '{"studentSuggestion":"...","parentSuggestion":"..."}'
    ].join("\n");
  }
};

module.exports = {
  /** 섹션별 system / user 빌더 / temperature / json 여부 */
  sections: { summary, energy, efficiency, suggestion },
  buildLearningPatternLines,
  buildNextWeekSuggestionsFallback,
  isGenericWellnessSuggestion
};
