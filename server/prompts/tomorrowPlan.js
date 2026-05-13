"use strict";

const { getKoFallbacks, tpl } = require("./koFallbackLoader");

const t0 = getKoFallbacks().tomorrowPlan;

/** 내일 계획 협업 대화 — 단일 system 블록 (상황 JSON 포함) */
function buildTomorrowPlanCollabSystemBlock(focus, context) {
  const ctxJson = JSON.stringify(context);
  if (focus === "life") {
    return `너는 한국 중·고등학생의 '내일 실천할 한 가지'를 기록 탭에 적을 문장으로 함께 다듬는 AI 코치다.
규칙:
- 항상 한국어 존댓말로, 짧고 구체적으로 답한다.
- 아래 JSON의 오늘 생활 좋았던 점과 나빴던 점(memo)·기록한 학습 시간(todayStudyMinutes)·지금 적어 둔 내일 실천 초안(draftTomorrowPractice)을 근거로, 실행 가능한 한 가지 실천을 한 문장~두 문장으로 정하도록 질문하거나 제안한다.
- 하루 전체 시간표·루틴을 쭉 짜는 것이 아니라, '내일 실천할 한 가지' 하나에만 집중한다.
- 의학적 진단·자해 조장·시험 부정행위는 거절한다.

[학생 상황 JSON]
${ctxJson}`;
  }
  return `너는 한국 중·고등학생의 '내일 학습 계획'을 함께 세우는 AI 코치다.
규칙:
- 항상 한국어 존댓말로, 짧고 구체적으로 답한다.
- 아래 JSON(학생 상황)의 오늘 이행률·시간표 칸·기록한 학습 시간(todayStudyMinutes)·오늘 공부 좋았던 점과 나빴던 점(studyEvaluation)·오늘 공부한 내용 설명(metacognitionReflection)·책별 초안 내일 계획을 근거로 내일 범위(쪽·단원·문항)와 시간을 질문하거나 제안한다.
- 한 번에 한두 가지만 묻거나 제안한다.
- 의학적 진단·자해 조장·시험 부정행위는 거절한다.

[학생 상황 JSON]
${ctxJson}`;
}

const tomorrowPracticeSynthesizeSystem = `너는 한국 학생의 '내일 실천할 한 가지' 문장을 기록 탭에 넣을 수 있게 정리한다.
대화와 상황 JSON을 반영해, 실행 가능한 한 가지 실천을 한 문장 또는 짧은 두 문장(500자 이내)으로만 출력한다.

출력: JSON 객체 하나만. 설명·마크다운·코드펜스 금지.
스키마: {"tomorrowPractice":"..."}`;

function buildTomorrowPlanBooksSynthesizeSystem(bookIdsJson) {
  return `너는 한국 학생의 내일 학습 계획을 책(교재)별로 정리한다.
대화와 상황 JSON을 반영해 각 책에 대해 내일 공부 범위(plannedRange)와 가능하면 시작·종료 시각을 제안한다.

출력: JSON 배열만. 설명·마크다운·코드펜스 금지.
스키마: [{"bookId":number,"plannedRange":string,"startTime":string|null,"endTime":string|null}]
bookId는 반드시 다음 중 하나만: ${bookIdsJson}
시각은 "HH:MM" 24시간 형식이거나 null.`;
}

function wrapSituationJsonForSynthesize(context) {
  return `[상황 JSON]\n${JSON.stringify(context)}`;
}

const synthesizeTomorrowPracticeUserInstruction =
  "위 대화를 반영해 내일 실천할 한 가지 문장만 JSON 객체로 출력하라.";

const synthesizeBookPlansUserInstruction =
  "위 대화 전체를 반영해, 각 등록 교재에 대한 내일 계획만 JSON 배열로 출력하라.";

function collabNoGptStudyReply(pct) {
  const p = Number(pct) || 0;
  return tpl(getKoFallbacks().tomorrowPlan.collabNoGptStudyReply, { pct: String(p) });
}

function synthesizeBooksNoGptPlannedRangeLine(bookName, pct) {
  const p = Number(pct) || 0;
  return tpl(getKoFallbacks().tomorrowPlan.synthesizeBooksNoGptPlannedRangeLine, {
    bookName: String(bookName || ""),
    pct: String(p)
  });
}

module.exports = {
  buildTomorrowPlanCollabSystemBlock,
  tomorrowPracticeSynthesizeSystem,
  buildTomorrowPlanBooksSynthesizeSystem,
  wrapSituationJsonForSynthesize,
  synthesizeTomorrowPracticeUserInstruction,
  synthesizeBookPlansUserInstruction,
  collabNoGptLifeReply: t0.collabNoGptLifeReply,
  collabNoGptStudyReply,
  synthesizeLifeNoGptTomorrowPractice: t0.synthesizeLifeNoGptTomorrowPractice,
  synthesizeBooksNoGptPlannedRangeLine,
  apiEmptyGptCollabReply: t0.apiEmptyGptCollabReply,
  apiLifePracticeJsonDecodeError: t0.apiLifePracticeJsonDecodeError,
  apiBookPlansJsonDecodeError: t0.apiBookPlansJsonDecodeError,
  apiNoValidBookPlansError: t0.apiNoValidBookPlansError,
  apiTomorrowPlanMessageFailed: t0.apiTomorrowPlanMessageFailed,
  apiTomorrowPlanSynthesizeFailed: t0.apiTomorrowPlanSynthesizeFailed,
  defaultPlannedRangeWhenModelEmpty: t0.defaultPlannedRangeWhenModelEmpty,
  collabTemperature: 0.45,
  collabMaxTokens: 700,
  lifeSynthesizeTemperature: 0.35,
  lifeSynthesizeMaxTokens: 400,
  booksSynthesizeTemperature: 0.25,
  booksSynthesizeMaxTokens: 1200
};
