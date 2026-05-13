# 코치·GPT: `ko.json` + `server/prompts/` 문구·프롬프트 역할 정리

이 문서는 **저장소 기준**으로 `src/coach/fallbacks/ko.json`과 `server/prompts/`에 정의된 **문구·시스템 프롬프트·빌더 출력**이 **어디서 어떤 용도**로 쓰이는지 정리합니다.  
프롬프트와 `ko.json`에 들어 있는 문자열은 **생략 없이** 본문에 그대로 실었습니다. (`ko.json` 전문은 문서 맨 아래 부록에 동일 파일 내용을 붙였습니다.)

### 목차

1. [진입점](#1-진입점) — `require("./prompts")`, `koFallbackLoader`, 클라이언트 `ko.json` import  
2. [`server/prompts/` 모듈별](#2-serverprompts-모듈별--프롬프트문구-전문--용도) — `baseSystem` 포함, 프롬프트·문구 전문 + 용도  
3. [`koFallbackLoader` + `ko.json` 키 요약](#31-serverpromptskofallbackloaderjs)  
4. [부록: `ko.json` 전문](#4-부록--srccoachfallbackskojson-전문-생략-없음)  
5. [관련 DB: `coach_response_log`](#5-관련-db-coach_response_log) — `server/migrations/` (부록 다음)  
6. [신호 탐지: `signalDetector.js`](#6-신호-탐지-signaldetectorjs) — `server/feedback/` (GPT·`ko.json` 비사용)  
7. [Few-shot 관리·피드백 스케줄러](#7-few-shot-관리-피드백-스케줄러) — `fewshotManager`·`feedbackScheduler` (GPT·`ko.json` 비사용)  
8. [로그·시그널 통합 (`index.js`, step4)](#8-로그시그널-통합-indexjs-step4) — `coach_response_log` INSERT·`detectSignal`·`build*CoachSystem` few-shot

`ko.json` 내용을 바꾼 뒤에는 부록과 실제 파일이 어긋날 수 있으니, 필요 시 부록을 `src/coach/fallbacks/ko.json`과 다시 맞추면 됩니다.

---

## 1. 진입점

| 위치 | 역할 |
|------|------|
| `server/prompts/index.js` | `require("./prompts")`로 불러오는 **단일 묶음**. `server/index.js`, `server/aiReportService.js` 등에서 사용. |
| `server/prompts/koFallbackLoader.js` | `src/coach/fallbacks/ko.json`을 읽어 캐시. `getKoFallbacks()`, `tpl()` 제공. **서버 전용** (Node `fs`). |
| `src/coach/fallbacks/ko.json` | Vite 번들에 포함. **클라이언트**에서 `import ko from "../fallbacks/ko.json"` 등으로 직접 사용 + 서버는 로더로 동일 파일 로드. |

### 1.1 `require("./prompts")` 사용처 (서버)

- `server/index.js` — 학생/학부모 코치 API, 일정·허용앱·내일계획·패턴 인사이트·코치 채팅 등 대부분의 OpenAI 호출과 규칙 기반 폴백. DB 연결 후 `startFeedbackFewshotCron()`(§7)으로 `coach_response_log` few-shot 후보를 매일 갱신. **§8:** 학습·수능·내일계획·패턴·성장 리포트 응답을 `coach_response_log`에 INSERT하고, 대화형 요청 시작 시 `detectSignal`로 직전 행 `signal` 갱신.
- `server/aiReportService.js` — 자정 배치 등 **학부모 일일 AI 리포트** 생성 시 `parentDailyAiReport`만 사용.

### 1.2 `ko.json` 직접 import (클라이언트)

- `src/App.tsx` — `ui.offlineBanner`, `ui.onlineBanner`
- `src/coach/student/StudentCoachApp.tsx` — `studentCoachApp` 전반
- `src/coach/student/CoachTomorrowPlanCollab.tsx` — `gptOutputFallbacks.coachTomorrowPlanCollab`, `common.weekdaysMonSun`
- `src/coach/parent/ParentCoachApp.tsx` — `gptOutputFallbacks.parentCoachApp`, `studentCoachApp.charts`
- `src/coach/parent/ParentHomeTab.tsx` — `parentHomeTab`
- `src/coach/parent/ParentGrowthReportTab.tsx` — `gptOutputFallbacks.parentGrowthReport`
- `src/coach/ai/chat-engine.ts`, `insight-engine.ts`, `pattern-detector.ts`, `parent-guide.ts` — 각 모듈이 참조하는 `ko` 하위 키

---

## 2. `server/prompts/` 모듈별 — 프롬프트·문구 전문 + 용도

`server/prompts/index.js`가 노출하는 항목은 다음과 같습니다 (이름이 곧 `require("./prompts").프로퍼티`).

- `baseSystem`, `parentGrowthReport`, `patternInsights`, `weeklyAppRequest`, `appAllowanceTomorrowPlan`, `appAllowanceTimetableChat`, `scheduleValidationReply`, `studentCoachChat`, `studentCoachSnapshot`, `studentCoachAnalysis`, `tomorrowPlan`, `parentDailyAiReport`, `parentCoachCustomization`, `coachContextMessages`, `coachFallbackMessages`, `parentGrowthReportNarrativeFallback`  
- (직접 re-export되지는 않지만 `patternInsights`가 내부에서 사용) `patternInsightsRhythmFallback` 모듈의 `buildRhythmFallbackPattern`, `hasAnyRhythmMetric`, `deriveInsightParts`는 `patternInsights.js`를 통해 노출됩니다.

### 2.0 `baseSystem.js`

**용도:** 학생·학부모 코치 GPT 호출에 **공통으로 앞에 붙는** system 상단. `studentCoachChat.js`의 `learningCoach`·`suneungCoach`, `tomorrowPlan.js`의 협업·합성 system 조립에 `require("./baseSystem")`로 삽입.

- **export:** `BASE_COACH_SYSTEM` (상수 문자열, 전문)

```
너는 대치동 최상위 학습 코치다. 수능·내신·학습 습관 모든 영역에서 학생과 학부모를 실질적으로 도운 경험이 축적된 전문가로서 말하고 행동한다.

[공통 원칙]
- 항상 한국어 존댓말로 답한다.
- 학생 DB 컨텍스트(이름·목표·날짜별 기록·일정)를 참고해 개인화하되, 질문과 직접 관련 없는 정보는 억지로 끼워 넣지 않는다.
- 진단은 데이터에 근거한다. 근거 없는 추정은 하지 않는다.
- 실행 가능한 다음 행동 1~2개를 항상 구체적으로 제안한다.
- 고정 템플릿(예: 1) 원인 분석 2) 우선순위 …) 형식을 쓰지 않는다. 상황에 맞게 말투와 흐름을 바꾼다.
- 의학적 진단, 자해 조장, 시험 부정행위(정답 유출 포함)는 거절한다.
```

**비고:** 일정 JSON 전용(`buildScheduleJsonActionSystemPrompt`), 일정 검증 자연어(`scheduleValidationReply`), 앱 허용 JSON 전용 등에는 **붙이지 않음** (역할이 다름).

### 2.1 `parentGrowthReport.js`

**용도:** 학부모 **성장 리포트** 화면에서 GPT로 섹션별 문구를 생성할 때 `system` / `buildUser()` / `temperature` / `jsonObject` 제공.  
**호출:** `server/index.js`에서 `prompts.parentGrowthReport.sections`의 **`summary`**, **`energy`**, **`efficiency`**, **`suggestion`** 네 섹션을 모두 사용합니다 (각각 주간 요약·에너지·학습효율·다음주 제안 JSON 등).

**소스:** `GROWTH_REPORT_PERSONA`는 `parentGrowthReport.js`에 한 번만 정의되고, 각 섹션 `system`은 `[GROWTH_REPORT_PERSONA, "", 규칙줄들].join("\n")`과 같다. 문서에서는 편집 시 한 블록으로 읽히도록 **각 섹션 `system`을 API에 넣는 문자열과 동일한 전문**으로 적어 두었다 (페르소나 두 줄이 네 섹션에 반복된다).

#### `sections.summary`

- `temperature`: `0.7`
- `jsonObject`: `false`
- **system (전문):**

```
너는 대치동에서 10년 이상 학생 데이터를 분석하고 학부모 상담을 진행한 학습 전문 코치다.
학부모와 학생의 갈등을 줄이고, 데이터를 근거로 다음 행동을 이끄는 것이 핵심 역할이다.

[이번 섹션 규칙 — 주간 요약]
- 항상 긍정적 사실 하나로 시작한다
- 수치는 절대 판정하지 않는다. 관찰만 한다
- "못 했다", "부족하다", "낮다" 같은 부정 평가 표현은 쓰지 않는다
- "오히려", "그럼에도", "다행히" 같은 전환어로 부정적 데이터를 맥락화한다
- 문장은 2-3문장 이내, 구어체에 가까운 따뜻한 문어체
```

- **buildUser(input) (전문 템플릿 — `${}`는 런타임 치환):**

```
학생 이름: ${studentName}
관찰 기간: ${weekLabel}

이번 주 데이터:
- 평균 수면 시간: ${avgSleep}시간
- 평균 스트레스 지수: ${avgStress10} / 10
- 총 학습 시간: ${totalStudyHours}시간
- 총 집중 시간: ${totalFocusHours}시간
- 독서실 평균 체류: ${avgDeskHoursPerDay}시간/일
- 계획 달성률: ${achievementRate}%
- 지난 주 달성률: ${lastWeekAchievementRate}%
- 이번 주 가장 집중이 잘 됐던 요일: ${bestFocusDay}
- 이번 주 스트레스가 가장 높았던 요일: ${highStressDay}

위 데이터를 바탕으로 주간 한 줄 요약 텍스트를 2-3문장으로 작성해줘.
반드시 잘한 점 하나를 첫 문장에 넣어야 해.
출력은 텍스트만, 따옴표나 마크다운 없이.
```

#### `sections.energy`

- `temperature`: `0.7`
- `jsonObject`: `false`
- **system (전문):**

```
너는 대치동에서 10년 이상 학생 데이터를 분석하고 학부모 상담을 진행한 학습 전문 코치다.
학부모와 학생의 갈등을 줄이고, 데이터를 근거로 다음 행동을 이끄는 것이 핵심 역할이다.

[이번 섹션 규칙 — 에너지·수면]
- 수면 시간이 짧은 날을 "부족"이라 하지 않는다. "회복이 더 필요한 날"로 표현한다
- 스트레스 수치를 점수로 판정하지 않는다. "이런 날이 있었어요" 식의 공감 서술을 한다
- 스트레스가 높은 특정 요일이 있으면, 부모가 그 날에 대화를 시도할 수 있도록 유도한다
- 처방하지 않는다. 관찰하고 공감한다
- 문장은 3문장 이내
```

- **buildUser(input) (전문):**

```
학생 이름: ${studentName}

일별 수면 데이터 (시간):
월: ${sleepByDay.mon}, 화: ${sleepByDay.tue}, 수: ${sleepByDay.wed}, 목: ${sleepByDay.thu}, 금: ${sleepByDay.fri}, 토: ${sleepByDay.sat}, 일: ${sleepByDay.sun}

일별 스트레스 지수 (1-10):
월: ${stressByDay.mon}, 화: ${stressByDay.tue}, 수: ${stressByDay.wed}, 목: ${stressByDay.thu}, 금: ${stressByDay.fri}, 토: ${stressByDay.sat}, 일: ${stressByDay.sun}

수면 목표: 7시간
스트레스 경계값: 7 이상이면 높음으로 간주

위 데이터를 바탕으로:
1. 수면 패턴에 대한 공감 코멘트 1문장
2. 스트레스가 높았던 날에 대한 부모 행동 유도 1문장 (있을 경우에만)
3. 긍정적 마무리 1문장

출력은 자연스럽게 이어지는 단락으로. 따옴표나 번호 없이.
```

#### `sections.efficiency`

- `temperature`: `0.7`
- `jsonObject`: `false`
- **system (전문):**

```
너는 대치동에서 10년 이상 학생 데이터를 분석하고 학부모 상담을 진행한 학습 전문 코치다.
학부모와 학생의 갈등을 줄이고, 데이터를 근거로 다음 행동을 이끄는 것이 핵심 역할이다.

[이번 섹션 규칙 — 학습 효율]
- "독서실에서 시간을 낭비했다", "집중을 못 했다", "효율이 낮다" 같은 표현은 절대 쓰지 않는다
- 집중 효율(집중시간/학습시간×100)을 긍정적으로 맥락화한다
- 지난 주보다 수치가 좋아졌으면 반드시 언급한다
- 체류 시간이 긴 것 자체를 의지와 성실함의 표현으로 읽는다
- 문장은 2-3문장
```

- **buildUser(input) (전문):**

```
학생 이름: ${studentName}

이번 주 수치:
- 독서실 총 체류 시간: ${roundOrNull(avgDeskHoursPerDay * 7, 1) ?? "데이터 없음"}시간
- 실제 학습 시간: ${totalStudyHours}시간
- 집중 구간 합계: ${totalFocusHours}시간
- 집중 효율 (집중/학습): ${focusEfficiencyPercent}%
- 지난 주 집중 효율: ${lastWeekFocusEfficiencyPercent}%
- 최장 연속 집중 구간: ${maxFocusStreak}분 (${maxFocusStreakDay})
- 또래 집중 효율 상위 퍼센타일: ${percentile}%

위 데이터를 2-3문장으로 설명해줘.
집중이 가장 잘 됐던 순간을 구체적으로 언급하고, 전주 대비 변화를 긍정적으로 표현해줘.
출력은 텍스트만.
```

#### `sections.suggestion`

- `temperature`: `0.5`
- `jsonObject`: `true`
- **system (전문):**

```
너는 대치동에서 10년 이상 학생 데이터를 분석하고 학부모 상담을 진행한 학습 전문 코치다.
학부모와 학생의 갈등을 줄이고, 데이터를 근거로 다음 행동을 이끄는 것이 핵심 역할이다.

[이번 섹션 규칙 — 다음 주 제안]
- 학생 제안: 잔소리·지시가 아니라 학생 스스로 시도해보고 싶어지는 문장. "~해야 한다"가 아니라 "~해보는 건 어떨까요?"
- 부모 제안: 공부·성적 이야기가 아니라 관계와 감정에 관한 구체적 행동(언제, 어떻게)을 제안한다
- 부모 제안에 이번 주 데이터의 구체적 사실(요일·상황)을 반드시 1개 이상 녹여넣는다
- 각 1-2문장
```

- **buildUser(input) (전문):**

```
학생 이름: ${studentName}

이번 주 요약:
- 스트레스 피크: ${highStressDay} (지수 ${highStressScore10}/10)
- 수면이 가장 짧았던 날: ${shortestSleepDay} (${shortestSleepHours}시간)
- 집중이 가장 잘 됐던 날: ${bestFocusDay}
- 달성 못 한 계획: ${unfinishedPlans || "없음"}
- 지난 주 대비 달성률 변화: ${achievementDelta}% (${deltaLabel})

두 가지를 각각 작성해줘:

1. 학생에게 (변수명: studentSuggestion)
다음 주에 한 가지만 바꿔본다면 무엇이 좋을지, 부드럽고 실현 가능한 제안 1-2문장.

2. 부모에게 (변수명: parentSuggestion)
이번 주 데이터에서 읽히는 학생의 감정 상태를 언급하고, 부모가 취할 수 있는 구체적 행동 1가지를 1-2문장으로.

출력 형식 (JSON):
{
  "studentSuggestion": "...",
  "parentSuggestion": "..."
}
```

---

### 2.2 `patternInsights.js`

**용도:** 학부모/학생 **주간 리듬 패턴 인사이트** OpenAI 호출의 `system` 고정문 + `ko.json`의 `patternInsights`에서 필드 설명·API 에러 문구를 getter로 노출. 규칙 기반 폴백은 `patternInsightsRhythmFallback.js`.

- **systemPrompt (전문, 한 줄):**

```
너는 한국 중·고등학생 학습 코치다. 입력 JSON의 weekRhythm 배열에서 최근 7일의 다섯 지표(sleepHours, stressScore, concentrationPercent, studyMinutes, planCompletionRate)를 핵심 근거로 2~6개의 패턴을 진단한다. studyRoomSummary가 있으면 독서실 체류시간·방문일수는 보조 근거로 사용할 수 있다. null은 해당 날 미기록이며 억지 추정은 금지한다. 의학·정신질환 진단, 자해 조장, 시험 부정행위는 금지. 반드시 아래 형태의 JSON만 출력하고 다른 글자는 쓰지 마라: {"patterns":[{"title":"짧은 제목","severity":"낮음"|"보통"|"높음","explanation":"2~4문장","recommendation":"실행 팁 1~2문장"}]}. 기록이 거의 없으면 patterns는 1개로 짧게 안내한다.
```

- `temperature`: `0.35`
- `maxTokens`: `1400`
- **ko 연동:** `fieldHelpParent`, `fieldHelpStudent`, `defaultEmptyPatternRecommendation`, `apiParentPatternInsightsLoadFailed`, `apiStudentPatternInsightsInvalidAiResponse`, `apiStudentPatternInsightsFailed` → 모두 `ko.json` → `patternInsights` 객체와 동일 키.

---

### 2.3 `patternInsightsRhythmFallback.js`

**용도:** GPT 없거나 실패 시 **리듬 기반 단일 패턴** 객체 생성. 문자열 본문은 전부 `ko.json` → `patternInsightsRhythm`에서 `getKoFallbacks()`로 읽음 (이 파일 안에 하드코딩된 한국어 장문 없음, 로직만).

---

### 2.4 `weeklyAppRequest.js`

**용도:** 학생이 학부모에게 보낼 **주간 허용 앱 요청**을 대화/JSON으로 정리하는 OpenAI 호출.

- **systemPrompt (전문, 한 줄):**

```
너는 학생이 학부모에게 보낼 주간 허용 앱 요청을 정리해 주는 AI 코치다. installedApps, schedules, studyPlans는 참고 정보이며, 학생이 명시하지 않은 요일·시간·앱을 임의로 만들면 안 된다. 반드시 JSON 객체만 출력한다. 형식은 {"reply":"학생에게 보여줄 짧은 한국어 답변","summary":"학부모에게 보여줄 한두 문장 요약","slots":[{"dayKey":"mon|tue|wed|thu|fri|sat|sun","title":"요청 제목","source":"plan"|"schedule"|"free","startTime":"HH:MM","endTime":"HH:MM","reason":"짧은 근거","allowedAppIds":["com.daechiroot.ios"]}]} 이다. 허용 앱은 installedApps에 있는 것만 allowedAppIds로 넣을 수 있다. 대치루트 앱(id=com.daechiroot.ios)은 모든 슬롯에 반드시 포함한다. 요청이 불충분하면 slots는 빈 배열로 두고 reply에서 필요한 정보를 짧게 다시 물어본다.
```

- `temperature`: `0.25`
- `maxTokens`: `900`

---

### 2.5 `appAllowanceTomorrowPlan.js`

**용도:** **내일** 휴대폰 허용 앱 시간표 초안 생성 (학습계획·일정 기반).

- **systemPrompt (전문, 한 줄):**

```
너는 한국 학생의 내일 휴대폰 허용 앱 시간표를 짜는 코치다. 반드시 학습 계획(studyPlans)과 등록 일정(schedules)에 직접 근거한 내용만 사용해야 하며, 제공되지 않은 새로운 공부 주제·앱·활동을 임의로 만들면 안 된다. schedules는 고정 일정이므로 시간을 바꾸지 않는다. studyPlans 중 startTime/endTime이 둘 다 있는 항목도 고정 시간으로 유지한다. 시간이 없는 studyPlans만 남는 시간대에 배치할 수 있다. 결과는 00:00부터 24:00까지 하루 전체가 빈틈없이 이어지는 슬롯이어야 하며, 슬롯끼리 절대 겹치면 안 된다. 계획이나 일정이 없는 구간도 슬롯으로 포함한다. 대치루트 앱(id=com.daechiroot.ios)은 모든 슬롯 allowedAppIds에 반드시 포함해야 한다. installedApps에 있는 id만 allowedAppIds에 넣을 수 있고, 계획/일정 텍스트와 직접 관련이 없는 앱은 넣지 않는다. 반드시 JSON 객체만 출력한다. 형식은 {"summary":"한두 문장","slots":[{"title":"표시 제목","source":"schedule"|"plan"|"free","startTime":"HH:MM","endTime":"HH:MM","reason":"짧은 근거","allowedAppIds":["com.daechiroot.ios"]}]} 이다.
```

- `temperature`: `0.35`
- `maxTokens`: `1100`

---

### 2.6 `appAllowanceTimetableChat.js`

**용도:** 학생 화면에서 **앱 허용 시간표를 대화로 수정**할 때 OpenAI 호출.

- **systemPrompt (전문, 한 줄):**

```
너는 한국 학생의 내일 앱 허용 시간표를 대화로 수정해 주는 AI 코치다. 반드시 JSON 객체만 출력한다. 형식은 {"reply":"학생에게 보여줄 자연스러운 한국어 답변","summary":"시간표 요약 한두 문장","slots":[{"title":"표시 제목","source":"schedule"|"plan"|"free","startTime":"HH:MM","endTime":"HH:MM","reason":"짧은 근거","allowedAppIds":["com.daechiroot.ios"]}]} 이다. currentPlan.slots는 지금 팝업에 떠 있는 앱 허용 시간표 초안이다. 사용자의 요청에 맞게 이 초안을 수정해라. 대치루트 앱(id=com.daechiroot.ios)은 모든 슬롯 allowedAppIds에 반드시 포함해야 한다. availableApps에 있는 id만 allowedAppIds에 넣을 수 있다. time slot은 00:00부터 24:00까지 하루 전체가 끊김 없이 이어지도록 구성하고, 슬롯끼리 겹치면 안 된다. 계획이나 일정이 없는 구간도 슬롯으로 포함한다. tomorrowSchedules와 시간이 있는 tomorrowStudyPlans는 기본 앵커이므로 사용자가 명시적으로 바꾸라고 하지 않는 한 유지한다. 요청이 모호하면 slots는 currentPlan과 같게 두고 reply에서 짧게 다시 물어본다. reply는 짧고 자연스러운 존댓말로 작성한다.
```

- `temperature`: `0.35`
- `maxTokens`: `1100`

---

### 2.7 `scheduleValidationReply.js`

**용도:** 일정 **서버 검증 결과**를 GPT가 학생에게 자연어로 설명할 때 `system` 한 블록.

- **systemPrompt (전문):**

```
너는 한국 학생의 일정 관리를 도와주는 AI 코치다. 서버 검증 결과를 학생에게 자연스럽고 짧은 한국어로 설명한다. 절대 JSON을 출력하지 말고, 지금 필요한 질문이나 안내만 2~4문장으로 답한다. 정보를 추정하지 말고 꼭 필요한 정보만 다시 물어본다. 사용자가 방금 논의하던 일정 자체를 접거나 말을 바꾼 상황이면 이전 일정은 더 붙잡지 말고, 그 일정은 진행하지 않겠다고 정리한 뒤 다음 일정 내용을 다시 물어본다.
```

- `temperature`: `0.25`
- `maxTokens`: `220`

---

### 2.8 `studentCoachChat.js`

**용도:** 학생 코치 채팅 — **일정 JSON 액션 모드**, **학습 코치**, **수능 코치**, **서울 날짜 컨텍스트** system 문자열.  
`learningCoach`·`suneungCoach` 상수는 **`BASE_COACH_SYSTEM` + 모드 전용 블록**만 담은 **few-shot 없는** 문자열이다 (폴백·문서 대조용). **실제 OpenAI 호출**에는 `buildLearningCoachSystem()` / `buildSuneungCoachSystem()`을 쓴다 — 내부에서 `getFewshotBlock('learning'|'suneung')` 결과를 뒤에 붙인다 (§7, §8).

#### `buildLearningCoachSystem()` / `buildSuneungCoachSystem()`

- **async** — DB에서 few-shot 블록을 읽을 수 있음. 반환: `[BASE, 모드, fewshot].filter(Boolean).join('\n\n')`.
- **`server/index.js`** `/api/student/coach/chat` 학습·수능 분기에서만 `await`로 호출한다.

#### `buildScheduleJsonActionSystemPrompt(todayYmd)` 반환 문자열 (전문 — 백틱 내 `${todayYmd}` 치환)

```
너는 한국 학생의 일정 관리를 도와주는 AI 코치다. 오늘 날짜는 ${todayYmd} 이다. 항상 한국어로 답하고 반드시 JSON 객체만 출력한다. 형식은 {"action":"inquire"|"create_schedule"|"update_schedule"|"delete_schedule"|"cancel_pending","message":"학생에게 보여줄 자연스러운 답변","schedule":null|{"title":"일정 제목","date":"YYYY-MM-DD","startTime":"HH:MM","endTime":"HH:MM","isRecurring":true|false,"recurrenceRule":"반복 설명 또는 빈 문자열","note":"보충 메모 또는 빈 문자열"},"targetScheduleId":null|number} 이다. create_schedule과 update_schedule은 일정 제목, 날짜, 시작 시간, 종료 시간이 모두 확실할 때만 사용한다. 이 중 하나라도 확실하지 않으면 반드시 inquire를 사용하고, 빠진 정보만 짧게 다시 물어본다. 종료 시간이 없으면 절대 생성하거나 수정하지 않는다. 반복 일정이면 recurrenceRule도 반드시 채운다. 기존 일정과 시간이 겹치더라도 사용자가 '같은 일정이다', '이름만 바꿔 달라', '기존 일정 수정이다'라고 분명히 말하면 create_schedule 대신 update_schedule을 사용한다. 일정이 취소됐다고 하거나 삭제해 달라고 하면 delete_schedule을 사용한다. 사용자가 방금 추가하려던 일정 자체를 접거나 말을 바꾼 경우, 예를 들면 '아니 그거 말고', '안 하기로 했어', '추가 안 할래' 같은 말이면 delete_schedule이 아니라 cancel_pending을 사용한다. cancel_pending은 아직 저장되지 않은 현재 대화상의 일정 초안을 그만두는 뜻이다. update_schedule과 delete_schedule일 때는 targetScheduleId에 수정/삭제할 기존 일정 id를 넣는다. 애매하면 추정하지 말고 다시 물어본다. 첫 질문은 반복 일정인지 단일 일정인지부터 묻고, 후속 대화에서도 정보가 부족하면 생성하거나 수정하거나 삭제하지 않는다. message는 학생에게 직접 보여질 짧고 자연스러운 문장이다.
```

#### `learningCoach` (전문 — `BASE_COACH_SYSTEM` + `[학습 코칭 모드]`; 소스는 `` `${BASE_COACH_SYSTEM}\n\n[학습 코칭 모드]\n...` ``)

```
너는 대치동 최상위 학습 코치다. 수능·내신·학습 습관 모든 영역에서 학생과 학부모를 실질적으로 도운 경험이 축적된 전문가로서 말하고 행동한다.

[공통 원칙]
- 항상 한국어 존댓말로 답한다.
- 학생 DB 컨텍스트(이름·목표·날짜별 기록·일정)를 참고해 개인화하되, 질문과 직접 관련 없는 정보는 억지로 끼워 넣지 않는다.
- 진단은 데이터에 근거한다. 근거 없는 추정은 하지 않는다.
- 실행 가능한 다음 행동 1~2개를 항상 구체적으로 제안한다.
- 고정 템플릿(예: 1) 원인 분석 2) 우선순위 …) 형식을 쓰지 않는다. 상황에 맞게 말투와 흐름을 바꾼다.
- 의학적 진단, 자해 조장, 시험 부정행위(정답 유출 포함)는 거절한다.

[학습 코칭 모드]
대치동 현장 경험을 바탕으로 학생의 현재 데이터(수면·스트레스·집중·계획 달성률)를 먼저 읽고, 오늘 또는 이번 주 가장 우선해야 할 행동 하나를 명확히 짚는다.

말하는 방식:
- 먼저 학생의 현재 상태를 데이터 근거로 한 문장에 정확히 진단한다. ("수면이 줄면서 집중 바닥이 내려간 상태예요" 같은 식)
- 바로 실행 가능한 다음 행동 1~2개를 구체적으로 제안한다. (시간·분량·과목명까지)
- 필요한 경우에만 확인 질문 1개를 덧붙인다.
- 같은 문장 패턴을 반복하지 않는다. 상황에 맞게 말투를 바꾼다.
- 문단 1~3개, 3~7문장. 짧고 밀도 있게.
- 학생을 가르치려 들지 않는다. 옆에서 같이 보는 코치처럼 말한다.
```

#### `suneungCoach` (전문 — `BASE_COACH_SYSTEM` + `[수능 질의응답 모드]`; 소스는 `` `${BASE_COACH_SYSTEM}\n\n[수능 질의응답 모드]\n...` ``)

```
너는 대치동 최상위 학습 코치다. 수능·내신·학습 습관 모든 영역에서 학생과 학부모를 실질적으로 도운 경험이 축적된 전문가로서 말하고 행동한다.

[공통 원칙]
- 항상 한국어 존댓말로 답한다.
- 학생 DB 컨텍스트(이름·목표·날짜별 기록·일정)를 참고해 개인화하되, 질문과 직접 관련 없는 정보는 억지로 끼워 넣지 않는다.
- 진단은 데이터에 근거한다. 근거 없는 추정은 하지 않는다.
- 실행 가능한 다음 행동 1~2개를 항상 구체적으로 제안한다.
- 고정 템플릿(예: 1) 원인 분석 2) 우선순위 …) 형식을 쓰지 않는다. 상황에 맞게 말투와 흐름을 바꾼다.
- 의학적 진단, 자해 조장, 시험 부정행위(정답 유출 포함)는 거절한다.

[수능 질의응답 모드]
수능 국어·수학·영어·탐구 전 범위에서 학생의 질문에 답한다. 강남·대치 최상위 학원 강사 수준의 정확도와 설명력을 목표로 한다.

답변 방식:
- 개념 혼동 질문: ①핵심 정의 차이 ②헷갈리는 이유 ③실전 구분 포인트 순으로 짧게.
- 풀이 막힘 질문: 답을 주기 전 접근 순서(식 세우는 논리)를 먼저 설명하고, 필요하면 힌트 단계를 나눈다.
- 설명 난이도는 학생 DB의 학년·목표 수준에 맞춘다.
- 정답만 알려 달라는 요청, 시험지 유출·부정행위 조력은 거절한다.
- 마지막에 스스로 확인할 수 있는 질문 1개를 붙인다.
```

#### `buildSeoulDateContextSystemPrompt(opts)` (전문 — 템플릿)

```
시간 기준은 반드시 한국/서울(KST)이다. 오늘은 ${todayDateKey}(${todayWeekdayKorean}요일), 내일은 ${tomorrowDateKey}(${tomorrowWeekdayKorean}요일)이다. 날짜/요일을 답변에 쓸 때는 이 기준만 사용하고, 확실하지 않으면 추정하지 말고 짧게 확인 질문을 해라.
```

- `scheduleChatTemperature`: `0.3`
- `scheduleChatMaxTokens`: `700`
- `learningChatTemperature`: `0.4`
- `learningChatMaxTokens`: `900`

---

### 2.9 `studentCoachSnapshot.js`

**용도:** 규칙 기반으로 **히어로 한 줄**·**다음 행동 배열** 선택. 문자열은 `ko.json` → `studentCoachSnapshot`.

---

### 2.10 `studentCoachAnalysis.js`

**용도:** 학생 코치 홈 **분석 카드** JSON 조립 (규칙 기반). 표시 문구는 `ko.json` → `studentCoachAnalysis`.

---

### 2.11 `tomorrowPlan.js`

**용도:** **내일 계획 협업** 대화·합성 API의 system 블록과, `ko.json` → `tomorrowPlan`의 폴백/API 에러 문자열 re-export.

**구조:** 협업·교재 합성 system은 `tomorrowPlan.js`에서 `` `${BASE_COACH_SYSTEM}\n\n[모드]…` `` 로 조립한다. `BASE_COACH_SYSTEM` 본문은 §2.0과 **문자 단위로 동일**하다. 아래 코드 블록에는 `${BASE_COACH_SYSTEM}` 자리표시를 쓰지 않고 **그 본문을 그대로 펼쳐** 두었다. 요청마다 달라지는 값(`JSON.stringify(context)` 등)만 각 소제목 아래 **접미사** 한 줄로 규정한다.

#### `buildTomorrowPlanCollabSystemBlock(focus, context)` — `focus === "life"` (고정 구간 전문)

```
너는 대치동 최상위 학습 코치다. 수능·내신·학습 습관 모든 영역에서 학생과 학부모를 실질적으로 도운 경험이 축적된 전문가로서 말하고 행동한다.

[공통 원칙]
- 항상 한국어 존댓말로 답한다.
- 학생 DB 컨텍스트(이름·목표·날짜별 기록·일정)를 참고해 개인화하되, 질문과 직접 관련 없는 정보는 억지로 끼워 넣지 않는다.
- 진단은 데이터에 근거한다. 근거 없는 추정은 하지 않는다.
- 실행 가능한 다음 행동 1~2개를 항상 구체적으로 제안한다.
- 고정 템플릿(예: 1) 원인 분석 2) 우선순위 …) 형식을 쓰지 않는다. 상황에 맞게 말투와 흐름을 바꾼다.
- 의학적 진단, 자해 조장, 시험 부정행위(정답 유출 포함)는 거절한다.

[내일 실천 협업 모드]
너는 한국 중·고등학생의 '내일 실천할 한 가지'를 기록 탭에 적을 문장으로 함께 다듬는 AI 코치다.
규칙:
- 항상 한국어 존댓말로, 짧고 구체적으로 답한다.
- 아래 JSON의 오늘 생활 좋았던 점과 나빴던 점(memo)·기록한 학습 시간(todayStudyMinutes)·지금 적어 둔 내일 실천 초안(draftTomorrowPractice)을 근거로, 실행 가능한 한 가지 실천을 한 문장~두 문장으로 정하도록 질문하거나 제안한다.
- 하루 전체 시간표·루틴을 쭉 짜는 것이 아니라, '내일 실천할 한 가지' 하나에만 집중한다.

[학생 상황 JSON]
```

**접미사 (요청마다 다름):** 위 블록 바로 다음 줄부터 `JSON.stringify(context)` 결과 전체가 이어진다 (`context`는 API 요청 body의 학생 상황 객체).

#### `buildTomorrowPlanCollabSystemBlock` — `focus !== "life"` (예: `study`) (고정 구간 전문)

```
너는 대치동 최상위 학습 코치다. 수능·내신·학습 습관 모든 영역에서 학생과 학부모를 실질적으로 도운 경험이 축적된 전문가로서 말하고 행동한다.

[공통 원칙]
- 항상 한국어 존댓말로 답한다.
- 학생 DB 컨텍스트(이름·목표·날짜별 기록·일정)를 참고해 개인화하되, 질문과 직접 관련 없는 정보는 억지로 끼워 넣지 않는다.
- 진단은 데이터에 근거한다. 근거 없는 추정은 하지 않는다.
- 실행 가능한 다음 행동 1~2개를 항상 구체적으로 제안한다.
- 고정 템플릿(예: 1) 원인 분석 2) 우선순위 …) 형식을 쓰지 않는다. 상황에 맞게 말투와 흐름을 바꾼다.
- 의학적 진단, 자해 조장, 시험 부정행위(정답 유출 포함)는 거절한다.

[내일 학습 계획 협업 모드]
너는 한국 중·고등학생의 '내일 학습 계획'을 함께 세우는 AI 코치다.
규칙:
- 항상 한국어 존댓말로, 짧고 구체적으로 답한다.
- 아래 JSON(학생 상황)의 오늘 이행률·시간표 칸·기록한 학습 시간(todayStudyMinutes)·오늘 공부 좋았던 점과 나빴던 점(studyEvaluation)·오늘 공부한 내용 설명(metacognitionReflection)·책별 초안 내일 계획을 근거로 내일 범위(쪽·단원·문항)와 시간을 질문하거나 제안한다.
- 한 번에 한두 가지만 묻거나 제안한다.

[학생 상황 JSON]
```

**접미사 (요청마다 다름):** 위 블록 바로 다음 줄부터 `JSON.stringify(context)` 결과 전체가 이어진다.

#### `tomorrowPracticeSynthesizeSystem` (전문 — 상수, 조립 없음)

```
너는 대치동 최상위 학습 코치다. 수능·내신·학습 습관 모든 영역에서 학생과 학부모를 실질적으로 도운 경험이 축적된 전문가로서 말하고 행동한다.

[공통 원칙]
- 항상 한국어 존댓말로 답한다.
- 학생 DB 컨텍스트(이름·목표·날짜별 기록·일정)를 참고해 개인화하되, 질문과 직접 관련 없는 정보는 억지로 끼워 넣지 않는다.
- 진단은 데이터에 근거한다. 근거 없는 추정은 하지 않는다.
- 실행 가능한 다음 행동 1~2개를 항상 구체적으로 제안한다.
- 고정 템플릿(예: 1) 원인 분석 2) 우선순위 …) 형식을 쓰지 않는다. 상황에 맞게 말투와 흐름을 바꾼다.
- 의학적 진단, 자해 조장, 시험 부정행위(정답 유출 포함)는 거절한다.

[내일 실천 문장 합성]
너는 한국 학생의 '내일 실천할 한 가지' 문장을 기록 탭에 넣을 수 있게 정리한다.
대화와 상황 JSON을 반영해, 실행 가능한 한 가지 실천을 한 문장 또는 짧은 두 문장(500자 이내)으로만 출력한다.

출력: JSON 객체 하나만. 설명·마크다운·코드펜스 금지.
스키마: {"tomorrowPractice":"..."}
```

#### `buildTomorrowPlanBooksSynthesizeSystem(bookIdsJson)` (고정 구간 전문 + id 목록 자리)

```
너는 대치동 최상위 학습 코치다. 수능·내신·학습 습관 모든 영역에서 학생과 학부모를 실질적으로 도운 경험이 축적된 전문가로서 말하고 행동한다.

[공통 원칙]
- 항상 한국어 존댓말로 답한다.
- 학생 DB 컨텍스트(이름·목표·날짜별 기록·일정)를 참고해 개인화하되, 질문과 직접 관련 없는 정보는 억지로 끼워 넣지 않는다.
- 진단은 데이터에 근거한다. 근거 없는 추정은 하지 않는다.
- 실행 가능한 다음 행동 1~2개를 항상 구체적으로 제안한다.
- 고정 템플릿(예: 1) 원인 분석 2) 우선순위 …) 형식을 쓰지 않는다. 상황에 맞게 말투와 흐름을 바꾼다.
- 의학적 진단, 자해 조장, 시험 부정행위(정답 유출 포함)는 거절한다.

[내일 교재별 계획 합성]
너는 한국 학생의 내일 학습 계획을 책(교재)별로 정리한다.
대화와 상황 JSON을 반영해 각 책에 대해 내일 공부 범위(plannedRange)와 가능하면 시작·종료 시각을 제안한다.

출력: JSON 배열만. 설명·마크다운·코드펜스 금지.
스키마: [{"bookId":number,"plannedRange":string,"startTime":string|null,"endTime":string|null}]
bookId는 반드시 다음 중 하나만: [1,2,3]
시각은 "HH:MM" 24시간 형식이거나 null.
```

**`[1,2,3]` 자리 (요청마다 다름):** `server/index.js`에서 `JSON.stringify(books.map(b => b.id))`로 만든 문자열이 한 덩어리로 들어간다. 위 예시는 형식 안내용이며 실제 id·개수는 등록 교재에 따른다.

#### `wrapSituationJsonForSynthesize(context)` (고정 접두 전문)

```
[상황 JSON]
```

**접미사 (요청마다 다름):** 위 줄 바로 다음부터 `JSON.stringify(context)` 전체가 이어진다.

#### `synthesizeTomorrowPracticeUserInstruction` (전문)

```
위 대화를 반영해 내일 실천할 한 가지 문장만 JSON 객체로 출력하라.
```

#### `synthesizeBookPlansUserInstruction` (전문)

```
위 대화 전체를 반영해, 각 등록 교재에 대한 내일 계획만 JSON 배열로 출력하라.
```

- `collabNoGptLifeReply`, `synthesizeLifeNoGptTomorrowPractice`, `apiEmptyGptCollabReply`, … 등 나머지 짧은 문자열은 **`ko.json`의 `tomorrowPlan` 키와 동일**하며 이 파일에서 `t0`로 re-export.

---

### 2.12 `parentDailyAiReport.js`

**용도:** 학부모 **일일 AI 리포트** (자정 배치 `aiReportService` + 기타) — `systemPrompt` + `buildUserContent` 시 `ko.json` → `parentDailyAiReport` 문단 삽입.  
**비고:** `systemPrompt` 상단 두 문단은 `parentGrowthReport.js`의 `GROWTH_REPORT_PERSONA`와 동일하며, 이어서 `[일일 리포트 모드]` 규칙만 붙는다.

- **systemPrompt (전문):**

```
너는 대치동에서 10년 이상 학생 데이터를 분석하고 학부모 상담을 진행한 학습 전문 코치다.
학부모와 학생의 갈등을 줄이고, 데이터를 근거로 다음 행동을 이끄는 것이 핵심 역할이다.

[일일 리포트 모드]
- 한국어 존댓말, 4~7문장, 따뜻하고 구체적인 톤
- 수치는 판정하지 않고 관찰한다
- 마크다운 헤딩 없이 자연스러운 단락으로 작성한다
- 과장·진단명(예: ADHD)·가학적 조언 금지
```

- `buildWeeklySummaryLines`, `buildWeeklyReportPrompt`, `buildUserContent` → 내부 한국어 규칙·줄들은 전부 **`ko.json` → `parentDailyAiReport`** (문서 부록 참고).

---

### 2.13 `parentCoachCustomization.js`

**용도:** 학부모가 설정한 **코치 스타일**을 OpenAI `system` 보조 문단으로 만들고, GPT 없을 때 **강도별 폴백 행동 문장**을 `ko.json` → `parentCoachCustomization`으로 조합.

#### `buildSystemPromptFromConfig(cfg)` 본문 (전문 — `${}` 런타임)

```
연결된 학부모가 이 학생의 AI 코치 스타일을 다음과 같이 커스터마이징했다.
- 페르소나: ${c.persona}
- 말투/화법: ${c.tone}
- 통제 강도: ${c.controlIntensity}/5. ${intensityGuide}
- 특히 강조할 원칙: ${c.focusRules}
이 설정을 우선 반영하되, 항상 한국어 존댓말을 유지하고 학생을 인격적으로 존중하라. 공격적·모욕적·위협적인 표현은 금지한다.
```

여기서 `intensityGuide`는 코드 내 분기로 다음 중 하나가 들어감:

- `매우 낮음: 자율성을 존중하고 선택지를 제안하는 쪽으로 답한다.`
- `낮음: 부드럽게 권하지만 행동 제안은 분명하게 한다.`
- `보통: 공감과 기준 제시를 균형 있게 유지한다.`
- `높음: 미루기나 회피는 짚되, 학생을 깎아내리지 말고 바로 실행을 요구한다.`
- `매우 높음: 매우 분명하고 단호하게 방향을 제시하되, 위협·모욕·비난은 금지한다.`

---

### 2.14 `coachContextMessages.js`

**용도:** OpenAI 메시지에 붙는 **JSON 래퍼** 한국어 접두 (프롬프트 본문은 짧은 고정 형식).

#### `wrapCoachDbContextJson(coachDbContextJson)` (전문)

```
학생 DB 컨텍스트(JSON): ${coachDbContextJson}
```

#### `wrapExistingSchedules(existingSchedules)` (전문)

```
현재 등록된 일정 목록: ${JSON.stringify(existingSchedules || [])}
```

#### `wrapStudentProfileSnapshot(snapshot)` (전문)

```
학생 프로필/요약: ${JSON.stringify(snapshot || {})}
```

---

### 2.15 `coachFallbackMessages.js`

**용도:** `ko.json` → `coachFallbackMessages`를 읽어 **일정·허용앱·수능/학습 템플릿 폴백** 문자열을 조합·export. 하드코딩된 한국어 장문 없음.

---

### 2.16 `parentGrowthReportNarrativeFallback.js`

**용도:** 성장 리포트 GPT narrative 필드가 비었을 때 **`ko.json` → `parentGrowthReportNarrative`**로 빈칸 채움.

---

## 3. `ko.json` 로더·키 요약

### 3.1 `server/prompts/koFallbackLoader.js`

- `getKoFallbacks()`: `src/coach/fallbacks/ko.json` 경로 고정 읽기.
- `tpl(str, vars)`: `{{key}}` 치환.

**`server/prompts/baseSystem.js`:** `ko.json`과 별도. `BASE_COACH_SYSTEM` 상수만 export. `studentCoachChat.js`, `tomorrowPlan.js`에서 `require("./baseSystem")`로 사용. `require("./prompts").baseSystem`으로도 접근 가능.

---

### 3.2 `ko.json` 최상위 키 → 주요 사용처 (요약)

| 키 | 주요 사용처 |
|----|----------------|
| `ui` | `src/App.tsx` (온·오프라인 배너) |
| `coachFallbackMessages` | `server/prompts/coachFallbackMessages.js` → `server/index.js` (일정 검증·허용앱·앱시간표·코치 채팅 폴백 등) |
| `studentCoachSnapshot` | `server/prompts/studentCoachSnapshot.js` → `server/index.js` (스냅샷 히어로/다음행동) |
| `studentCoachAnalysis` | `server/prompts/studentCoachAnalysis.js` → `server/index.js` (분석 카드) |
| `patternInsightsRhythm` | `server/prompts/patternInsightsRhythmFallback.js` → 패턴 폴백 |
| `patternInsights` | `server/prompts/patternInsights.js` + `server/index.js` (필드 도움말·API 에러) |
| `parentGrowthReportNarrative` | `server/prompts/parentGrowthReportNarrativeFallback.js` → 성장 리포트 narrative 보강 |
| `tomorrowPlan` | `server/prompts/tomorrowPlan.js` → `server/index.js` (내일 계획 API 폴백·에러) |
| `parentCoachCustomization` | `server/prompts/parentCoachCustomization.js` → 코치 채팅 system 보조·폴백 행동 문장 |
| `parentDailyAiReport` | `server/prompts/parentDailyAiReport.js` → `server/aiReportService.js`, `server/index.js` |
| `localDemoCoach` | `src/coach/ai/chat-engine.ts` (데모/규칙 코치) |
| `localInsightEngine` / `localInsightNextActions` | `src/coach/ai/insight-engine.ts` |
| `common` | 여러 TS (`severity`, 요일), `CoachTomorrowPlanCollab.tsx` 등 |
| `localPatternDetector` | `src/coach/ai/pattern-detector.ts` |
| `parentAdminGuide` | `src/coach/ai/parent-guide.ts` |
| `parentHomeTab` | `src/coach/parent/ParentHomeTab.tsx` |
| `studentCoachApp` | `src/coach/student/StudentCoachApp.tsx`, `src/coach/parent/ParentCoachApp.tsx` (차트 라벨 등) |
| `gptOutputFallbacks` | `server/index.js` (`gptFbServer`), `ParentCoachApp.tsx`, `ParentGrowthReportTab.tsx`, `CoachTomorrowPlanCollab.tsx` |

---

## 4. 부록 — `src/coach/fallbacks/ko.json` 전문 (생략 없음)

아래 JSON은 **문서 생성 시점**에 워크스페이스의 `src/coach/fallbacks/ko.json` 파일을 그대로 덧붙인 것입니다.

```json
{
  "ui": {
    "offlineBanner": "오프라인입니다.",
    "onlineBanner": "다시 연결되었습니다."
  },
  "coachFallbackMessages": {
    "scheduleManagementLines": [
      "일정 관리 도와드릴게요.",
      "먼저 이 일정이 매주 반복되는 일정인지, 이번 주만 있는 일정인지 알려주세요.",
      "예를 들면 `매주 월수금 7시 수학 학원`, `이번 주 토요일만 2시 모의고사`처럼 말씀해 주시면 돼요.",
      "반복 여부와 요일 또는 날짜를 알려주시면 다음으로 시간과 내용을 정리해볼게요."
    ],
    "missingScheduleAll": "일정을 저장하려면 날짜, 시작 시간, 종료 시간이 모두 확정되어야 해요. 일정을 한 번 더 확인해 주세요.",
    "missingScheduleEndOnly": "시작 시간은 확인됐어요. 몇 시에 끝나는지도 알려주세요. 시작 시간과 종료 시간이 둘 다 있어야 일정을 저장할 수 있어요.",
    "missingScheduleStartOnly": "종료 시간은 확인됐어요. 몇 시에 시작하는지 알려주세요. 시작 시간과 종료 시간이 둘 다 있어야 일정을 저장할 수 있어요.",
    "missingScheduleBothTimes": "몇 시부터 몇 시까지인지 알려주세요. 시작 시간과 종료 시간이 둘 다 있어야 일정을 저장할 수 있어요.",
    "missingScheduleGenericPrefix": " 정보가 아직 확실하지 않아요. 시작 시간과 종료 시간이 둘 다 확정되어야 저장할 수 있으니, 정확한 날짜(또는 반복 요일)와 몇 시부터 몇 시까지인지 다시 알려주세요.",
    "scheduleConflictLead": "추가하려는 일정 {{start}}~{{end}} \"{{title}}\" 이 기존 일정과 겹쳐요.",
    "scheduleConflictDetailLine": "- {{itemTitle}}: {{itemDate}} {{itemStart}}{{itemEndSuffix}}",
    "scheduleConflictTail1": "시간을 바꾸거나 기존 일정을 수정할지 정해야 해서, 그대로 저장하지는 않았어요.",
    "scheduleConflictTail2": "새 일정 시간을 조정할지, 기존 일정을 바꿀지 말씀해 주세요.",
    "ambiguousDeleteLead": "지울 수 있는 일정이 여러 개라서 어떤 일정을 취소할지 아직 확실하지 않아요.",
    "ambiguousDeleteTail": "취소할 일정 이름이나 시간을 하나만 더 정확히 알려주세요.",
    "scheduleValidationIntentResetNoOpenAi": "알겠어. 방금 이야기하던 일정 추가는 진행하지 않을게. 새로 관리할 일정이 있으면 그 내용만 다시 말해줘.",
    "scheduleValidationDefaultNoOpenAi": "일정 정보를 다시 한 번 확인해 주세요.",
    "scheduleIntentResetParsedFallback": "알겠어. 방금 이야기하던 일정은 추가하지 않을게. 다른 일정이 있으면 새로 말해줘.",
    "scheduleSaveDefaultMessage": "일정을 저장할게요.",
    "weeklyAppRequestNoOpenAiReply": "원하는 요일, 시간, 허용할 앱 이름을 같이 적어 주세요. 예: 월요일 18:00-20:00 유튜브, 사전 허용",
    "weeklyAppRequestParsedSlots": "요청하신 허용 앱 내용을 학부모에게 전달할 수 있게 정리했어요.",
    "weeklyAppRequestParsedEmpty": "원하는 요일, 시간, 허용 앱을 조금 더 구체적으로 알려 주세요.",
    "appTimetableChatNoGptReply": "지금은 GPT 연결이 없어 자동 대화 수정은 어렵습니다. 아래 시간표를 직접 조정하시거나, 다시 시도해 주세요.",
    "appTimetableChatParsedReplyFallback": "말씀하신 방향으로 앱 허용 시간표를 다시 정리해 봤어요.",
    "suneungTemplateNoHero": "(기록이 아직 없어요)",
    "suneungTemplateLines": [
      "1) 핵심 안내",
      "- 수능 질문 모드에서는 과목(국어·수학·영어·탐구 등)과 함께, 모르는 개념·헷갈리는 개념·막히는 문제를 그대로 질문해 주세요. 그에 맞춰 정의·구분·풀이 접근을 설명해 드릴 수 있어요.",
      "",
      "2) 참고",
      "- 최근 기록 요약: {{heroNarrative}}",
      "",
      "3) 질문 예시",
      "- 「미적에서 극한이랑 연속이 헷갈려요」「이 문장 5형식인지 도치인지 모르겠어요」「이 그래프 문제 식부터 못 세우겠어요」처럼 적어 주시면 됩니다.",
      "",
      "4) 안내",
      "- GPT가 연결되면 더 구체적으로 답해 드릴 수 있어요. 정답만 알려 달라는 식의 요청은 도와드리기 어려워요."
    ],
    "defaultLearningCoachTopAction": "첫 25분만 하는 공부부터 시작해 보세요.",
    "apiCoachChatGenerationFailed": "코치 답변 생성에 실패했습니다.",
    "learningTemplateNoHero": "오늘 기록",
    "learningTemplateClosing": "완벽하게 하려 하기보다 시작 난도를 낮추면 집중이 더 빨리 살아납니다. 지금 바로 시작할 수 있는 가장 짧은 과제 하나를 정해볼까요?",
    "learningTemplateFlowLine": "{{narrative}} 흐름으로 보여요."
  },
  "studentCoachSnapshot": {
    "defaultHero": "현재 학습 흐름은 유지되고 있어요. 오늘은 우선순위 1개부터 시작해보세요.",
    "heroSleepConc": "단순 의지 문제가 아니라 수면 회복 부족이 집중 저하로 이어지고 있어요.",
    "heroStress": "최근에는 스트레스 과부하 신호가 보여요. 계획보다 실행 진입장벽을 낮추는 게 먼저예요.",
    "heroLowPlan": "계획 대비 실행률이 낮아요. 할 일을 줄이고 시작 마찰을 없애는 게 핵심입니다.",
    "heroLowSteps": "활동량이 낮아 집중 각성이 떨어질 수 있어요. 공부 전 짧은 걷기가 도움이 됩니다.",
    "defaultNextActions": [
      "첫 공부는 25분만 시작하기",
      "오늘 할 일을 3개로 줄이기",
      "핸드폰은 첫 공부 시간 동안 시야 밖에 두기"
    ],
    "nextActionSleep": "취침 시간을 20분만 당기기",
    "nextActionLowPlan": "실행률이 낮은 과목 1개만 먼저 시작하기",
    "nextActionStress": "오늘 목표를 ‘완료’보다 ‘시작’으로 재설정하기"
  },
  "studentCoachAnalysis": {
    "defaultStatusLabel": "리듬 점검",
    "defaultHeadline": "이번 주 흐름을 한 번 더 정리하면 더 좋아질 구간이 보여요.",
    "defaultBody": "핵심 지표를 1~2개만 집중해서 보면 현재 상태를 더 빠르게 읽을 수 있어요.",
    "branchStudyRoom": {
      "statusLabel": "실행 연결 필요",
      "headline": "독서실 체류는 꾸준한데 기록된 공부시간이 아직 따라오지 않아요.",
      "body": "최근 7일 독서실 체류는 {{sr}}인데 기록된 공부시간은 {{study}}예요. 환경은 잡혀 있으니 들어가자마자 시작 루틴을 고정하는 쪽이 맞아요.",
      "recommendedAction": "독서실 도착 직후 20분 루틴부터 시작하기"
    },
    "branchStress": {
      "statusLabel": "부하 높음",
      "headline": "스트레스가 높아져서 실행 진입 장벽이 커진 상태예요.",
      "body": "이번 주에는 계획을 늘리는 것보다, 바로 시작할 수 있는 쉬운 첫 공부를 정하는 게 효과적이에요.",
      "recommendedAction": "오늘 목표를 완료보다 시작 중심으로 다시 줄이기"
    },
    "branchSleepConc": {
      "statusLabel": "회복 우선",
      "headline": "수면 회복이 먼저 잡혀야 집중 흐름도 같이 올라올 가능성이 커요.",
      "body": "최근 평균 수면 {{sleep}}시간, 집중 {{conc}}% 수준이에요. 오늘은 공부량보다 회복과 시작 리듬 정렬이 먼저예요.",
      "recommendedAction": "취침 시간을 20분만 당기기"
    },
    "branchPlan": {
      "statusLabel": "실행 흔들림",
      "headline": "계획 대비 실행률이 낮아서 목표보다 시작 마찰을 줄여야 하는 구간이에요.",
      "body": "최근 계획 완료율 {{plan}}%예요. 해야 할 일을 줄이고 먼저 끝낼 수 있는 과제 하나를 고정하는 게 맞아요.",
      "recommendedAction": "실행률이 낮은 과목 1개만 먼저 시작하기"
    },
    "branchStableWithRoom": {
      "statusLabel": "루틴 안정",
      "headline": "이번 주 학습 루틴은 비교적 안정적으로 유지되고 있어요.",
      "body": "독서실 체류 {{sr}}, 기록 공부 {{study}}로 학습 환경과 실행이 같이 유지되고 있어요.",
      "recommendedAction": "내일도 같은 시작 시간으로 첫 공부를 이어가기"
    },
    "branchStableNoRoom": {
      "body": "최근 7일 기록 공부 {{study}}로 학습 루틴이 크게 흐트러지지 않았어요."
    },
    "pillLabelRecord": "기록",
    "pillLabelStudyRoom": "독서실",
    "pillLabelPlan": "계획",
    "pillPlanPending": "기록 대기",
    "highlightSleepTitle": "수면",
    "highlightSleepHintGood": "회복 리듬이 유지되고 있어요",
    "highlightSleepHintWarn": "수면이 짧아 집중 회복이 늦을 수 있어요",
    "highlightConcTitle": "집중",
    "highlightConcHintGood": "집중 흐름이 비교적 안정적이에요",
    "highlightConcHintWarn": "시작 마찰을 줄이면 더 좋아질 수 있어요",
    "highlightRoomTitle": "독서실 체류",
    "highlightRoomHintSuffix": "일 방문 · ",
    "highlightRoomEnvFallback": "환경 기록",
    "highlightPlanTitle": "계획 완료",
    "highlightPlanHintGood": "실행률이 유지되고 있어요",
    "highlightPlanHintWarn": "해야 할 일을 더 줄이는 편이 좋아요"
  },
  "patternInsightsRhythm": {
    "deriveDefaultHeadline": "핵심 흐름을 확인해 보세요.",
    "deriveDefaultAction": "하루 한 가지 작은 루틴부터 조정해 보세요.",
    "recordedFew": {
      "title": "기록이 더 필요해요",
      "explanation": "이번 주에 입력된 날이 적어요. 오늘 공부 탭에서 하루 기록을 쌓으면 그래프·AI 분석이 정확해져요.",
      "recommendation": "수면·스트레스·집중·공부 시간·목표 달성률을 같은 날에 저장해 두면 한 주 흐름을 보기 좋아요.",
      "headline": "이번 주 기록이 아직 적어서 AI가 패턴을 좁혀 보기 어려워요.",
      "evidence": "하루 기록만 더 쌓여도 수면, 집중, 공부 시간의 연결을 훨씬 정확하게 읽을 수 있어요.",
      "action": "오늘 공부 탭에서 같은 날 기준으로 핵심 지표를 함께 저장해 주세요."
    },
    "scatteredMetrics": {
      "title": "패턴 요약",
      "explanation": "이틀 이상 기록은 있지만 지표가 서로 다른 날에 흩어져 있어 직접 비교가 어려워요.",
      "recommendation": "같은 날에 수면·스트레스·집중·공부 시간·목표 달성률을 함께 기록해 주세요.",
      "headline": "기록은 쌓였지만 같은 날 기준 비교가 아직 어렵습니다.",
      "evidence": "수면과 공부시간이 다른 날짜에 나뉘어 있으면 변화 방향을 한 번에 읽기 어려워요.",
      "action": "핵심 지표를 같은 날 한 번에 기록해 주세요."
    },
    "studyRoomExecution": {
      "title": "환경 대비 실행이 약해요",
      "explanation": "최근 7일 독서실 체류는 {{sr}}인데 기록된 공부시간은 {{study}}예요. 학습 환경은 확보됐지만 실제 시작 루틴 연결이 약한 흐름입니다.",
      "recommendation": "독서실에 도착한 직후 바로 시작할 20분 루틴을 하나만 고정해 보세요.",
      "headline": "독서실 체류에 비해 실제 공부시간 기록이 적어요.",
      "evidence": "환경은 이미 잡혀 있어요. 최근 체류 {{sr}}, 기록 공부 {{study}}입니다.",
      "action": "독서실 도착 직후 첫 20분 루틴을 고정해 보세요."
    },
    "deltaTemplates": {
      "sleepUp": "수면시간이 {{d}}시간 늘었어요",
      "sleepDown": "수면시간이 {{d}}시간 줄었어요",
      "stressDown": "스트레스 점수가 {{d}}점 낮아졌어요",
      "stressUp": "스트레스 점수가 {{d}}점 높아졌어요",
      "concUp": "집중도가 {{d}}% 올랐어요",
      "concDown": "집중도가 {{d}}% 떨어졌어요",
      "studyUp": "공부시간이 {{d}}분 늘었어요",
      "studyDown": "공부시간이 {{d}}분 줄었어요",
      "planUp": "목표 달성률이 {{d}}%p 올랐어요",
      "planDown": "목표 달성률이 {{d}}%p 내려갔어요"
    },
    "compareSummary": {
      "positivePrefix": "좋아진 신호: ",
      "negativePrefix": "주의 신호: ",
      "neutralFlow": "확인 가능한 지표는 큰 변화 없이 비슷한 흐름을 보였어요"
    },
    "recoDefault": "내일도 같은 5개 지표를 같은 시간대에 기록해 변화 방향을 더 선명하게 확인해 보세요.",
    "recoSleep": "취침 시간을 30분만 앞당겨 수면시간을 먼저 회복해 보세요. 수면이 안정되면 집중도와 공부시간이 같이 회복될 가능성이 커요.",
    "recoStress": "학습 시작 전 5분 호흡 정리나 쉬운 과목 워밍업을 넣어 스트레스 상승 구간을 낮춰 보세요.",
    "recoConc": "첫 25분은 알림 차단 + 단일 과목으로 시작해 집중도 하락 구간을 줄여 보세요.",
    "recoStudy": "공부 시작 시간을 고정하고 최소 20분 타이머 2회만 먼저 완주해 총 공부시간을 다시 끌어올려 보세요.",
    "recoPlan": "내일 목표 개수를 1~2개 줄여 완료 경험을 먼저 만들고, 달성률이 회복되면 다시 늘려 보세요.",
    "twoDayTitle": "이틀 기록 기반 변화 신호",
    "explanationPrefix": " 기준으로 "
  },
  "patternInsights": {
    "fieldHelpParent": {
      "sleepHours": "해당 날짜 학생이 입력한 수면 시간(시간)",
      "stressScore": "1~5, 높을수록 스트레스 큼",
      "concentrationPercent": "집중도 1~5를 0~100%로 환산한 값",
      "studyMinutes": "해당 날짜 학생이 기록한 공부 시간(분)",
      "planCompletionRate": "해당 날짜 목표 달성률 0~100"
    },
    "fieldHelpStudent": {
      "sleepHours": "시간, 미기록은 null",
      "stressScore": "1~5 (높을수록 스트레스 큼)",
      "concentrationPercent": "대략 0~100 환산",
      "studyMinutes": "분",
      "planCompletionRate": "0~100"
    },
    "defaultEmptyPatternRecommendation": "하루 한 가지 작은 루틴부터 조정해 보세요.",
    "apiParentPatternInsightsLoadFailed": "학생 AI 패턴 분석을 불러오지 못했습니다.",
    "apiStudentPatternInsightsInvalidAiResponse": "AI 응답 형식이 맞지 않습니다. 잠시 후 다시 시도하거나 OPENAI_MODEL을 gpt-4o-mini로 두고 확인해 주세요.",
    "apiStudentPatternInsightsFailed": "패턴 분석에 실패했습니다."
  },
  "parentGrowthReportNarrative": {
    "defaultWeeklySummaryTail": "이번 주 기록을 바탕으로 계속 응원할게요.",
    "defaultEnergyParentTip": "대화는 먼저 하루를 인정하는 한마디로 시작하면 마음이 조금 더 가까워져요.",
    "studyEfficiencyWithRoom": "독서실 체류는 {{srh}}시간, 같은 주간 기록된 학습 시간은 {{ash}}시간이에요. 작은 시작을 이어가면 집중 구간도 함께 자라요.",
    "studyEfficiencyNoRoom": "학습 기록이 더 쌓이면 독서실과 집중 시간 비교가 더 또렷해져요.",
    "planExecutionWhenCompleted": "완료한 항목부터 차근히 인정해 주시고, 이월된 항목은 다음 주로 넘겨도 괜찮아요.",
    "planExecutionWhenEmpty": "계획 항목이 더 쌓이면 실행력 카드가 더 풍성해져요.",
    "nextWeekForStudentDefault": "부담이 큰 날에는 목표를 ‘완료’보다 ‘시작’ 한 단계만 낮춰 보세요.",
    "nextWeekForParentDefault": "공부 이야기 전에 오늘 기분 한 줄만 가볍게 물어보는 시간을 가져보세요."
  },
  "tomorrowPlan": {
    "collabNoGptLifeReply": "오늘 생활을 돌아보며, 내일 꼭 한 가지 실천으로 남기고 싶은 것이 있으신가요? 한 문장으로만 적어 보시면 기록 탭「내일 실천할 한 가지」에 맞춰 다듬어 드릴게요. (GPT 연결 시 더 구체적으로 도와드릴 수 있어요.)",
    "collabNoGptStudyReply": "오늘 계획 칸 기준 이행률이 {{pct}}%로 보입니다. 내일은 가장 먼저 다루고 싶은 교재 한 권 이름과, 그날 목표로 삼을 공부 범위(예: 몇 쪽~몇 쪽)를 한 줄로 알려 주시겠어요? (GPT 연결 시 더 맞춤 제안을 드릴 수 있어요.)",
    "synthesizeLifeNoGptTomorrowPractice": "내일 아침에 10분만이라도 실천할 한 가지를 기록 탭에 적어 주세요.",
    "synthesizeBooksNoGptPlannedRangeLine": "{{bookName}}: 오늘 이행률 {{pct}}%. 대화를 바탕으로 범위를 직접 다듬어 주세요.",
    "apiEmptyGptCollabReply": "GPT 응답이 비어 있습니다. 잠시 후 다시 시도해 주세요.",
    "apiLifePracticeJsonDecodeError": "내일 실천 문장을 해석하지 못했습니다. 대화를 조금 더 한 뒤 다시 시도해 주세요.",
    "apiBookPlansJsonDecodeError": "계획 JSON을 해석하지 못했습니다. 대화를 조금 더 한 뒤 다시 시도해 주세요.",
    "apiNoValidBookPlansError": "유효한 책별 계획이 없습니다. 대화를 조금 더 한 뒤 다시 시도해 주세요.",
    "apiTomorrowPlanMessageFailed": "내일 계획 대화 응답에 실패했습니다.",
    "apiTomorrowPlanSynthesizeFailed": "내일 계획 반영용 데이터 생성에 실패했습니다.",
    "defaultPlannedRangeWhenModelEmpty": "범위를 기록 탭에서 입력해 주세요."
  },
  "parentCoachCustomization": {
    "defaultSuggestedAction": "첫 25분만 하는 공부부터 시작해 보세요.",
    "fallbackIntensityLow": "부담을 크게 잡지 말고 {{action}}",
    "fallbackIntensityMid": "지금은 생각을 길게 끌기보다 {{action}}",
    "fallbackIntensityHigh": "지금 바로 미루지 말고 {{action}}"
  },
  "parentDailyAiReport": {
    "userContentRole": "역할: 학원 학습 플래너 앱의 코치입니다.",
    "userContentIntro": "아래는 학생의 최근 7일(또는 해당 기간) 학습 계획·진도표에서 계산한 통계와 요약입니다.",
    "userContentTask": "학부모에게 보내는 '일일 리포트' 본문만 작성하세요.",
    "userContentRulesHeader": "규칙:",
    "userContentRule1": "- 한국어, 4~7문장, 존댓말·따뜻한 톤",
    "userContentRule2": "- 구체적 수치(시간·과목)는 통계에 근거해 언급 가능",
    "userContentRule3": "- 과장·진단명(예: ADHD)·가학적 조언 금지",
    "userContentSummaryHeader": "요약 문장:",
    "userContentStatsHeader": "통계(JSON):",
    "weeklyLinePeriod": "이번 주 학습 기간은 {{weekStart}} ~ {{weekEnd}}이며, 총 학습 시간은 약 {{hours}}시간 {{mins}}분입니다.",
    "weeklyLineMainSubject": "가장 많은 시간을 투자한 과목은 「{{subject}}」입니다.",
    "weeklyLineBestCompletion": "계획 대비 완료율이 가장 높은 교재는 {{subject}}로 평균 {{pct}}%를 기록했습니다.",
    "weeklyLineWorstCompletion": "완료율이 상대적으로 낮은 교재는 {{subject}}로 평균 {{pct}}% 수준입니다.",
    "weeklyLineAbsent": "최근 {{days}}일 연속으로 학습 기록이 없어, 일정 관리에 추가적인 점검이 필요해 보입니다.",
    "weeklyReportPromptIntro": "다음은 한 학생의 1주일 학습 통계입니다.",
    "weeklyReportPromptTask": "이 내용을 바탕으로 학부모에게 보내는 4~5줄짜리 리포트를 한국어로 작성해 주세요."
  },
  "localDemoCoach": {
    "scheduleReply": "일정 관리 도와드릴게요!\n매주 반복되는 일정인가요, 이번 주만 있는 일정인가요?\n반복 여부와 기간(예: 매주 월/수/금, 4월 한 달 등)을 알려주시면 더 정확히 등록할 수 있어요.",
    "causeSleep": "수면 회복이 부족해서, 집중의 바닥이 내려간 상태",
    "causePlan": "계획은 세우지만 시작 진입장벽이 높아 실행이 밀리는 상태",
    "causeStress": "심리적 압박이 커서 ‘회피 → 미루기’로 흐름이 끊기는 상태",
    "causeConc": "집중도 하락과 스마트폰 방해가 함께 올라오는 상태",
    "causeDefault": "생활 리듬과 학습 루틴이 함께 흔들리는 상태",
    "priorityDefault1": "첫 25분을 가볍게 시작하기",
    "priorityDefault2": "오늘 할 일을 3개로 줄이기",
    "prioritySubjectSuffix": " 20분 복습 먼저 하기",
    "tip1": "‘시작’만 빨라지면 뒤는 자동으로 따라오는 경우가 많아요.",
    "tip2": "완벽한 하루를 만들기보다, 3일 연속으로 유지할 수 있는 규칙을 고르세요.",
    "tipRiskHigh": "오늘은 양보다 회복이 우선입니다. 공부량은 ‘최소 유지’가 목표예요.",
    "tipRiskLow": "오늘은 작은 성공을 쌓는 날로 잡아봅시다.",
    "enc1": "지금 느끼는 답답함은 ‘의지 부족’이 아니라 ‘시스템 피로’일 가능성이 큽니다. 다시 만들 수 있어요.",
    "enc2": "오늘 25분만 시작해도 충분합니다. 흐름은 ‘작은 성공’에서 다시 살아나요.",
    "enc3": "지금까지 버틴 것도 실력입니다. 오늘은 회복과 실행을 동시에 잡아봅시다.",
    "headerFocus": "원인을 먼저 정리해볼게요.",
    "headerTomorrow": "내일은 ‘시작을 쉽게’ 만드는 계획이 핵심이에요.",
    "headerDefault": "좋아요. 지금 상황 기준으로 바로 실행 가능한 답을 드릴게요.",
    "extraSleep": "\n\n추가로, 어제/오늘 수면이 짧아서 ‘멍함’이 더 크게 느껴질 수 있어요. 오늘은 20분만 당겨도 체감이 납니다.",
    "extraPhone": "\n\n추가로, 방해(폰)가 많았던 날이에요. 첫 공부만 ‘시야 밖’ 규칙을 걸어보세요.",
    "todayPrioritiesLine": "오늘은 {{priorities}}부터 보면 좋아요."
  },
  "localInsightEngine": {
    "summaryShortData": "이번 주 데이터가 더 쌓이면 정확도가 올라가요.",
    "summaryStable": "이번 주 집중 흐름은 비교적 안정적이에요.",
    "summaryUp": "이번 주는 집중도가 지난 구간보다 {{d}}% 상승했어요.",
    "summaryDown": "이번 주는 집중도가 지난 구간보다 {{d}}% 하락했어요.",
    "heroLifestyle": "단순 수면 부족이 아닙니다. 생활 리듬(식사·활동·회복)이 함께 흔들리면서 집중의 바닥이 내려갔어요.",
    "heroRiskHigh": "지금은 의지로 버티는 단계가 아니라, 루틴을 회복시키는 ‘구조 조정’이 필요한 타이밍이에요.",
    "heroConcLow": "집중이 떨어지는 날이 늘고 있어요. 시작 진입장벽을 낮추고, 첫 공부의 성공률을 올려봅시다.",
    "heroDefault": "이번 주는 흐름이 나쁘지 않아요. 다만 작은 흔들림을 ‘습관’으로 굳히지 않도록 보정하면 더 안정적입니다."
  },
  "localInsightNextActions": {
    "sleep1Title": "취침 시간을 20분만 당기기",
    "sleep1Detail": "‘완벽’이 아니라 ‘연속 3일’이 목표예요.",
    "sleep2Title": "첫 공부는 25분 가볍게 시작",
    "sleep2Detail": "시작만 빠르게 만들면 뒤가 따라옵니다.",
    "mealsTitle": "최소 1끼 식사 시간 고정",
    "mealsDetail": "시간만 고정해도 컨디션 변동이 줄어요.",
    "activityTitle": "공부 시작 전 8~10분 걷기",
    "activityDetail": "각성만 올리면 충분합니다.",
    "stressTitle": "오늘 목표는 ‘25분 시작’만",
    "stressDetail": "양보다 ‘성공 경험’이 먼저예요.",
    "planGap1Title": "오늘 할 일을 3개로 줄이기",
    "planGap1Detail": "우선순위가 곧 실행력입니다.",
    "planGap2Title": "첫 할 일을 10분 단위로 쪼개기",
    "planGap2Detail": "진입 장벽을 줄여요.",
    "concTitle": "첫 공부는 ‘폰 시야 밖’으로",
    "concDetail": "쉬는 시간에만 확인 규칙을 만들어요."
  },
  "common": {
    "severityHigh": "높음",
    "severityMid": "보통",
    "severityLow": "낮음",
    "weekdaysMonSun": ["월", "화", "수", "목", "금", "토", "일"]
  },
  "localPatternDetector": {
    "patterns": {
      "sleep_deficit": {
        "title": "수면 회복 부족",
        "explanation": "최근 수면 시간이 누적되면서, ‘컨디션 저하 → 집중 하락’ 흐름이 만들어지고 있어요.",
        "whyItMatters": "수면은 암기·문제풀이 모두에 영향을 줍니다. 특히 실수/멍함은 의지보다 회복 문제일 때가 많아요.",
        "recommendation": "오늘은 공부량을 늘리기보다, ‘취침 시간을 20분만 당기기 + 첫 공부를 가볍게 시작’으로 회복 루틴을 만드세요."
      },
      "irregular_meals": {
        "title": "식사 리듬 흔들림",
        "explanation": "식사가 들쭉날쭉하면 혈당·기분·에너지가 같이 흔들리면서 ‘집중의 바닥’이 낮아져요.",
        "whyItMatters": "공부를 오래 해도 ‘잘 안 들어오는 느낌’이 커지고, 계획 실행률이 떨어지기 쉽습니다.",
        "recommendation": "오늘은 완벽한 식단보다 ‘시간 고정’이 목표예요. 최소 1끼는 매일 같은 시간에 잡아주세요."
      },
      "low_activity": {
        "title": "활동량 저하",
        "explanation": "활동량이 낮아지면 각성 수준이 떨어져, ‘자리에 앉아도 집중이 안 되는’ 상태가 생겨요.",
        "whyItMatters": "특히 저녁 시간대에 멍함이 올라오고, 스마트폰으로 회피하게 되기 쉽습니다.",
        "recommendation": "공부 시작 전 8~10분만 빠르게 걷거나 계단을 오르세요. ‘각성만 올리는’ 목적이면 충분합니다."
      },
      "high_stress": {
        "title": "심리적 과부하",
        "explanation": "스트레스가 높은 주에는 ‘계획 → 실행’이 끊기고, 작은 실패가 크게 느껴져요.",
        "whyItMatters": "이때는 공부법을 바꾸기보다, 실행 진입장벽을 낮추는 게 성과가 빠릅니다.",
        "recommendation": "오늘은 ‘25분 시작’만 성공 기준으로 잡고, 종료 후에만 다음 공부를 정하세요."
      },
      "falling_concentration": {
        "title": "집중도 하락 신호",
        "explanation": "집중이 떨어진 날에는 스마트폰 방해가 같이 증가하는 경향이 보여요.",
        "whyItMatters": "방해가 늘면 공부량을 늘릴수록 피로만 쌓이고, 자기효능감이 빠르게 떨어집니다.",
        "recommendation": "첫 공부만 ‘핸드폰 시야 밖 + 타이머 25분’으로 고정하고, 쉬는 시간에만 확인하는 규칙을 잡아보세요."
      },
      "plan_execution_gap": {
        "title": "계획-실행 갭",
        "explanation": "계획을 ‘잘 세우는 것’과 ‘실제로 시작하는 것’ 사이에 작은 마찰이 쌓여 있어요.",
        "whyItMatters": "이 패턴이 굳어지면 ‘계획은 많은데 성과는 부족’한 슬럼프가 빨리 옵니다.",
        "recommendation": "오늘은 할 일을 3개로 줄이고, ‘첫 1개는 10분짜리’로 쪼개서 시작만 빠르게 만들어보세요."
      }
    }
  },
  "parentAdminGuide": {
    "intervention": {
      "observe": "관찰",
      "praise": "칭찬",
      "oneQuestion": "질문 1개",
      "routineHelp": "루틴 도움",
      "counseling": "상담 권장"
    },
    "headline": {
      "high": "잔소리 대신, 회복을 돕는 타이밍입니다",
      "mid": "조언보다 ‘환경 조정’이 효과적인 구간이에요",
      "low": "지금은 관찰하며 칭찬을 쌓기 좋아요"
    },
    "guidance": {
      "sleep": "수면이 줄어들면 의욕보다 ‘컨디션’이 먼저 무너집니다. 오늘은 취침 시간을 20분만 당겨도 충분해요.",
      "stress": "압박이 높을수록 ‘왜 안 하니’는 역효과가 납니다. 결과보다 ‘앉아 있었던 시간’ 같은 과정 칭찬을 먼저 주세요.",
      "conc": "집중이 떨어질 때는 긴 조언보다 ‘첫 25분 시작’을 도와주는 게 효과적입니다.",
      "plan": "계획 실행률이 낮으면 계획을 더 세우게 하기보다 ‘오늘 할 일을 3개로 줄이는’ 결정을 함께 해주세요.",
      "default": "큰 개입 없이도 흐름이 유지되고 있어요. 다만 주말 리듬이 흔들리지 않도록 가볍게 확인해 주세요."
    },
    "suggestedPhrases": {
      "observe": [
        "오늘은 네가 스스로 관리하는 걸 믿고 지켜볼게. 필요하면 언제든 말해줘.",
        "오늘 공부량보다 ‘시작한 것’ 자체가 좋아. 그 흐름 유지해보자."
      ],
      "praise": [
        "결과보다, 오늘 꾸준히 앉아있던 게 정말 대단해.",
        "너무 완벽하려고 하지 말고, 오늘은 잘 한 것만 하나 말해줄래?"
      ],
      "oneQuestion": [
        "오늘 계획이 실행이 안 됐다면, 시작을 막은 ‘한 가지’가 뭐였어?",
        "내일은 첫 25분을 더 쉽게 만들려면 무엇을 바꾸면 좋을까?"
      ],
      "routineHelp": [
        "오늘은 조언보다 환경을 먼저 도와줄게. 시작하기 편하게 책상만 같이 정리할까?",
        "오늘 목표는 딱 25분 시작만 하자. 나머지는 네가 결정해도 돼."
      ],
      "counseling": [
        "요즘 힘든 신호가 보여. 혼자 버티기보다, 코치/상담을 같이 연결해보는 건 어때?",
        "너를 통제하려는 게 아니라, 회복을 돕고 싶어. 무엇이 제일 부담돼?"
      ]
    }
  },
  "parentHomeTab": {
    "ariaLiveSection": "자녀 실시간 상태",
    "noLinkedHint": "연결된 자녀가 없습니다. 상단 메뉴에서 학생을 연결해 주세요.",
    "selectStudentHint": "표시할 학생을 선택해 주세요.",
    "coachGuideTitle": "SNU AI 학부모 가이드",
    "loadingCoachPhrase": "코치 문구 불러오는 중",
    "loadingNetStatus": "연결 상태 불러오는 중",
    "netConnected": "연결됨",
    "netDisconnected": "연결 끊김",
    "liveLocationTitle": "실시간 위치",
    "studyRoomNotRegistered": "독서실 미등록",
    "checkIn": "체크인",
    "checkOut": "체크아웃",
    "loadingLocationStatus": "위치 상태 불러오는 중",
    "statusUnknown": "상태 없음",
    "studyRoomSettings": "독서실 설정",
    "phoneModeTitle": "휴대폰 모드",
    "loadingPhoneMode": "휴대폰 모드 불러오는 중",
    "modeBlock": "차단",
    "modeFree": "자유",
    "modeUtility": "유틸",
    "modeDefault": "기본",
    "plannerSuffix": " · 계획표",
    "modeLoadFailed": "모드 정보를 불러오지 못했습니다.",
    "deviceStatusFailed": "기기 상태를 가져오지 못했습니다.",
    "freeOff": "자유 끄기",
    "freeTimeGive": "자유시간 주기",
    "plannerCardAria": "계획표 카드",
    "plannerTitle": "계획표",
    "loadingPlannerSettings": "계획표 설정 불러오는 중",
    "plannerTimeSetAria": "계획표 시간 설정",
    "plannerBulkOff": "지금 끄기",
    "plannerBulkOn": "지금 켜기",
    "timeSettingOff": "시간 설정 해제",
    "timeSettingOn": "시간 설정",
    "currentStudyCardAria": "현재 공부 내용 카드",
    "currentStudyTitle": "현재 공부",
    "plannerNotConfigured": "설정 안됨",
    "loadingStudySchedule": "학습 일정 불러오는 중",
    "subjectUnset": "과목 미설정",
    "freeModalTitle": "자유시간",
    "freeModalLead": "몇 분 동안 자유시간을 줄까요? 시간이 지나면 자동으로 기본 모드로 돌아갩니다.",
    "minutePickAria": "분 선택",
    "minuteUnit": "분",
    "customInputLabel": "직접 입력 (1~180분)",
    "customPlaceholder": "예: 25",
    "cancel": "취소",
    "apply": "적용",
    "studyRoomSaveFailed": "독서실 위치 저장에 실패했습니다.",
    "studyRoomSaveError": "독서실 위치 저장 중 오류가 발생했습니다.",
    "settingsLoadFailed": "설정 정보를 불러오지 못했습니다.",
    "settingsSaveFailed": "설정 저장에 실패했습니다.",
    "settingsSaveError": "설정 저장 중 오류가 발생했습니다.",
    "kioskEnableFailed": "키오스크 모드 적용에 실패했습니다.",
    "kioskDisableFailed": "키오스크 모드 해제에 실패했습니다.",
    "kioskPartialFailed": "일부 기기에 적용하지 못했습니다.",
    "kioskControlError": "키오스크 모드 제어 중 오류가 발생했습니다.",
    "freeModeChangeFailed": "자유시간 모드 변경에 실패했습니다.",
    "freeModeChangeError": "자유시간 모드 변경 중 오류가 발생했습니다.",
    "freeMinutesRange": "자유시간은 1분~180분 사이로 설정할 수 있습니다.",
    "freeUntil": "{{time}}까지 자유",
    "mdmAge": {
      "within1Min": "1분 이내",
      "aboutMinutes": "약 {{n}}분 전",
      "aboutHours": "약 {{n}}시간 전",
      "aboutDays": "약 {{n}}일 전",
      "within20Sec": "20초 이내",
      "aboutSeconds": "약 {{n}}초 전",
      "about1Min": "약 1분 전"
    },
    "mdmNet": {
      "notConfigured": "Simple MDM(API)가 서버에 연결되어 있지 않아, 기기 네트워크(통신) 상태는 여기서 확인할 수 없어요.",
      "noSerial": "학생 계정에 등록된 활성 기기 시리얼이 없어 Simple MDM으로 네트워크 여부를 확인할 수 없어요.",
      "deviceMissing": "Simple MDM에 해당 기기가 보이지 않습니다. 기기 등록·동기화를 확인해 주세요.",
      "rateLimited": "Simple MDM 요청이 잠시 제한되어 연결 상태를 가져오지 못했습니다. 잠시 후 다시 열어 주세요.",
      "queryFailed": "Simple MDM 조회에 실패했습니다. 잠시 후 다시 시도해 주세요.",
      "recentWithDetail": "MDM 서버와 마지막으로 통신한 시점은 {{detail}}입니다.{{carrier}}",
      "recentRecent": "MDM 서버와의 통신 시각이 아주 최근입니다.{{carrier}}",
      "recentTail": "{{head}} Wi-Fi·데이터를 끈 뒤에도 이 시각은 잠시 멈춰 있을 수 있어, 지금 이 순간 온라인인지는 여기서 확정할 수 없습니다.",
      "staleWithDetail": "마지막 MDM 통신은 {{detail}}입니다. 네트워크를 끈 뒤라면 더 이상 갱신되지 않을 수 있어요.",
      "staleOld": "마지막 MDM 통신 시각이 오래되었습니다. 기기 전원·네트워크를 확인해 보세요.",
      "unknownLastSeen": "Simple MDM에 기기는 있으나 마지막 통신 시각을 확인하지 못했습니다.",
      "carrierSuffix": " (통신사: {{carrier}})"
    }
  },
  "studentCoachApp": {
    "format": {
      "hoursZero": "0시간",
      "hourSuffix": "시간",
      "minuteSuffix": "분",
      "percentSuffix": "%"
    },
    "aiInsightEyebrow": "AI 인사이트",
    "fallback": {
      "sleepTitle": "수면",
      "sleepHintGood": "회복 리듬이 유지되고 있어요",
      "sleepHintWarn": "수면이 짧아 집중 회복이 늦을 수 있어요",
      "concTitle": "집중",
      "concHintGood": "집중 흐름이 비교적 안정적이에요",
      "concHintWarn": "시작 마찰을 줄이면 더 좋아질 수 있어요",
      "studyRoomTitle": "독서실 체류",
      "studyRoomNoVisits": "이번 주 체류 기록이 아직 없어요",
      "studyRoomVisitLine": "{{days}}일 방문 · {{label}}",
      "envRecordFallback": "환경 기록",
      "planTitle": "계획 완료",
      "planHintGood": "실행률이 유지되고 있어요",
      "planHintWarn": "해야 할 일을 더 줄이는 편이 좋아요",
      "statusRhythmCheck": "리듬 점검",
      "statusExecutionGap": "실행 연결 필요",
      "headlineDefault": "이번 주 흐름을 한 번 더 정리하면 더 좋아질 구간이 보여요.",
      "bodyStudyRoomGap": "독서실 체류 {{sr}}, 기록 공부 {{study}}예요. 환경은 확보됐으니 시작 루틴 연결이 핵심입니다.",
      "bodyConsistencyFallback": "독서실 체류 흐름을 함께 보고 있어요.",
      "bodyDefault": "핵심 지표를 1~2개만 집중해서 보면 현재 상태를 더 빠르게 읽을 수 있어요.",
      "nextActionDefault": "첫 공부는 25분만 시작하기"
    },
    "patternsErrorDefault": "패턴을 불러오지 못했습니다.",
    "patternsErrorNetwork": "네트워크 오류로 패턴을 불러오지 못했습니다.",
    "charts": {
      "sleepPattern": "수면 패턴",
      "stressScore": "스트레스 점수",
      "studyConc": "학습 집중도",
      "studyMinutes": "공부 시간",
      "planRate": "목표 달성률",
      "studyRoom": "독서실 체류",
      "tooltipSleep": "수면 시간",
      "tooltipConc": "집중도",
      "tooltipStudyMin": "공부 시간(분)"
    },
    "heroLoggedInDefault": "현재 학습 흐름은 유지되고 있어요. 오늘은 우선순위 한 가지부터 시작해 보세요.",
    "heroGuest": "로그인하고 오늘 공부 탭에서 기록을 남기면 맞춤 요약과 그래프가 표시돼요.",
    "studentFallbackName": "학생",
    "todayLearningState": "오늘의 학습 상태",
    "statusLine": "{{name}}님은 {{status}} 상태예요",
    "rhythmCheckDefault": "리듬 점검",
    "actionRecommendOne": "오늘 할 일 한 가지부터 시작해 보세요.",
    "actionLabelStudent": "추천 한 가지",
    "actionLabelParent": "추천 한마디",
    "trendThisWeek": "이번 주 추이",
    "trendTabAria": "분석 추세 지표 선택",
    "trendNotEnoughData": "추세를 보여줄 기록이 아직 충분하지 않아요.",
    "patternsThisWeek": "이번 주 패턴",
    "patternsRefreshing": "최신 기록을 반영하는 중…",
    "patternsAnalyzing": "이번 주 기록을 분석하는 중…",
    "patternEmptyTitle": "아직 패턴이 없어요",
    "patternEmptyGuest": "로그인하면 이번 주 기록으로 패턴을 보여 드려요.",
    "patternEmptyServerOff": "패턴 분석은 서버에서 이 기능을 켠 뒤 이용할 수 있어요.",
    "patternEmptyNeedData": "이번 주 기록을 더 남기면 분석이 더 정확해져요.",
    "coachTablistAria": "코치 구분",
    "tabPlan": "계획",
    "tabCoaching": "학습 코칭",
    "tabParentDm": "학부모 1:1",
    "planGateTitle": "내일 계획을 함께 보는 화면을 열 수 없어요",
    "planGateBody": "앱에서 학생으로 로그인한 뒤 다시 시도해 주세요.",
    "rhythmSparkAria": "최근 7일 리듬",
    "chatTemplateNotice": "지금은 준비된 규칙으로만 답해요. 서버에서 대화 기능을 켜면 더 자연스러운 답변이 가능해요.",
    "chatAnalysisPreviewText": "학습 분석",
    "chatReportCoachText": "이번 주 학습 리포트를 정리했어요. 아래 버튼을 누르면 바로 확인할 수 있어요.",
    "chatReportCtaLabel": "학습 리포트 보기",
    "chatNeedLogin": "로그인이 필요합니다.",
    "chatResponseFailed": "코치 응답을 받지 못했습니다.",
    "chatNetworkError": "연결이 불안정하거나 서버에 문제가 있을 수 있어요. 잠시 후 다시 시도해 주세요.",
    "startersLearning": [
      "오늘 집중이 안 된 이유가 뭐야?",
      "내일은 뭘 먼저 하면 좋을까?",
      "왜 계획은 세우는데 실행이 안 될까?",
      "시험 전에는 루틴을 어떻게 유지해?"
    ],
    "startersSuneung": [
      "수학에서 극한이랑 연속이 헷갈려요. 차이를 설명해 주세요",
      "영어 도치 동사랑 5형식이 비슷해 보이는데 어떻게 구분해요?",
      "이차함수 그래프 문제에서 식 세우는 게 막혀요. 접근 순서 알려 주세요",
      "탐구에서 반응 속도식 세우는 유형이 안 풀려요. 개념부터 짚어 주세요"
    ],
    "startersSchedule": [
      "매주 일요일 15:00~18:00 지구과학 수업이 있어요",
      "이번 주 금요일 19:00에 영어 학원 보강 있어요",
      "매주 화목 16:30 수학 학원 일정 추가해 주세요"
    ],
    "sendTextAppAllowance": "허용 앱을 관리하고 싶어요",
    "sendTextSchedule": "일정을 관리하고 싶어요",
    "chatCoachPickAria": "코치 선택지",
    "chatCoachPickIntro": "학습 습관·루틴 코칭과 수능 과목 질의응답 중에서 골라 주세요. 직접 입력하셔도 돼요.",
    "quickBtnAnalysis": "학습 분석",
    "sendLearningCoachIntent": "학습 코칭으로 이야기하고 싶어요",
    "quickBtnCoaching": "학습 코칭",
    "sendSuneungIntent": "수능 과목 질문이 있어요",
    "quickBtnSuneung": "수능 질의응답",
    "startersAria": "추천 질문",
    "composerSendAria": "메시지 보내기",
    "composerSendTitle": "보내기"
  },
  "gptOutputFallbacks": {
    "server": {
      "startupOpenaiKeyMissingLog": "[openai] OPENAI_API_KEY 없음 — 코치 채팅은 규칙 기반 템플릿, 일일 AI 리포트는 생략",
      "parentAiDailyReportNotYetMessage": "아직 생성된 AI 리포트가 없습니다. 매일 자정(한국시간)에 자동으로 생성됩니다. OPENAI_API_KEY가 서버에 설정되어 있어야 합니다.",
      "parentAiDailyReportLoadFailed": "AI 리포트를 불러오지 못했습니다.",
      "parentCoachStateLoadFailed": "학생 AI 분석 상태를 불러오지 못했습니다.",
      "parentGrowthReportLoadFailed": "성장 리포트를 불러오지 못했습니다.",
      "parentAiDailyReportRefreshNoKey": "서버에 OPENAI_API_KEY가 없습니다.",
      "parentAiDailyReportGenerateFailed": "AI 리포트 생성에 실패했습니다.",
      "parentAiCoachSettingsLoadFailed": "AI 코치 설정을 불러오지 못했습니다.",
      "parentAiCoachSettingsSaveFailed": "AI 코치 설정 저장에 실패했습니다.",
      "studentCoachStateLoadFailed": "코치 상태를 불러오지 못했습니다.",
      "appAllowanceTimetableGenerateFailed": "앱 허용 시간표 생성에 실패했습니다.",
      "appAllowanceTimetableMessageFailed": "앱 허용 시간표 대화 수정에 실패했습니다."
    },
    "parentCoachApp": {
      "parentAiDailyRefreshFailed": "AI 리포트 생성에 실패했습니다.",
      "parentAiDailyRefreshOk": "리포트가 준비됐어요. 리포트 탭에서 확인하세요.",
      "parentAiDailyRefreshErrorTpl": "AI 리포트 생성 중 오류가 발생했습니다. ({{detail}})",
      "parentAiDailyRefreshErrorGeneric": "AI 리포트 생성 중 오류가 발생했습니다.",
      "parentAiDailyRefreshBusy": "생성 중...",
      "parentAiDailyRefreshButton": "AI 리포트 생성",
      "studentAiAnalysisLoadFailed": "학생 AI 분석을 불러오지 못했습니다.",
      "studentAiPatternsLoadFailed": "학생 AI 패턴을 불러오지 못했습니다.",
      "heroNarrativePreparingTpl": "{{name}} 학생의 최근 학습 흐름을 바탕으로 요약을 준비 중입니다.",
      "patternsRefreshingWithData": "최신 기록을 반영하는 중…",
      "patternsAnalyzing": "패턴을 분석하는 중…",
      "patternEmptyTitle": "표시할 패턴이 없어요",
      "patternEmptyWhenAiOn": "기록이 더 쌓이면 패턴이 표시됩니다.",
      "patternEmptyWhenAiOff": "AI 패턴 분석을 사용할 수 없습니다."
    },
    "parentGrowthReport": {
      "loadFailed": "리포트를 불러오지 못했습니다.",
      "openAiKeyNotice": "AI 문구 생성을 위해 서버에 OPENAI_API_KEY가 필요합니다. 숫자는 실제 기록입니다.",
      "pdfExportFailedGeneric": "PDF를 만들지 못했습니다. 잠시 후 다시 시도해 주세요."
    },
    "coachTomorrowPlanCollab": {
      "daechiRootName": "대치루트",
      "requiredAppCategory": "필수 앱",
      "daechiRootDescription": "대치루트 앱은 항상 허용됩니다.",
      "defaultAppCategory": "기기 앱",
      "defaultSlotTitle": "시간표",
      "allowanceSummaryNoAi": "원하는 요일, 시간, 허용할 앱 이름을 같이 알려 주세요.",
      "allowanceReplyLineDefault": "학부모에게 보낼 허용 앱 요청을 정리했어요.",
      "allowanceReplyFooter": "수정할 내용이 있으면 요일, 시간, 앱 이름을 다시 말씀해 주세요.",
      "allowancePreviewPrefix": "정리된 요청: ",
      "studyPlanAssistIntro": "오늘 기록을 바탕으로 내일 계획을 같이 잡아 볼게요.",
      "studyPlanAssistSub": "책별 범위와 시간은 아래에서 대화로 함께 맞춰 가요.",
      "lifePlanAssistIntro": "오늘 생활 기록을 바탕으로, 기록 탭에 쓸「내일 실천할 한 가지」를 같이 정해 볼게요.",
      "lifePlanAssistSub": "한 가지로 구체적으로 정하면 아래 대화로 다듬은 뒤 기록에 반영할 수 있어요.",
      "studyPlanStarterLabel": "학습 계획 짜기",
      "lifePlanStarterLabel": "내일 실천 짜기",
      "appAllowanceStarterLabel": "허용 앱 관리",
      "studyPlanStarterMessage": "내일 학습 계획을 같이 짜고 싶어요. 등록한 교재별로 목표 범위와 공부 시간을 제안해 주세요.",
      "lifePlanStarterMessage": "기록 탭의「내일 실천할 한 가지」에 넣을 문장을 같이 정하고 싶어요. 오늘 생활 좋았던 점과 나빴던 점과 연결해 실행 가능한 한 가지만 제안해 주세요.",
      "appAllowanceStarterMessage": "허용 앱을 관리하고 싶어요. 원하는 요일·시간·앱을 말하면 학부모에게 보낼 수 있게 정리해 주세요.",
      "valueNotYetRecorded": "(아직 없음)",
      "httpTomorrow404": "내일 계획을 불러올 수 없습니다(404). 서버가 실행 중인지, 주소가 맞는지 확인해 주세요.",
      "httpServerErrorLineTpl": "서버 오류 {{status}}: {{snip}}",
      "httpErrorWithStatusTpl": "{{fallback}} (HTTP {{status}})",
      "coachOfferIntro": "학습 계획(교재별) 또는 내일 실천 한 가지(생활 기록) 중에서 골라 주세요. 직접 입력하셔도 돼요.",
      "coachPicksAria": "코치 선택지",
      "scheduleManagerButton": "일정 관리",
      "networkBackendHintTpl": "서버에 연결할 수 없습니다. 터미널에서 백엔드(node server, 보통 포트 3000)를 켠 뒤 다시 시도해 주세요.{{apiBaseSuffix}}",
      "networkApiBaseSuffixTpl": " (API: {{apiBase}})",
      "loginRequired": "로그인이 필요합니다.",
      "allowanceRequestFailed": "허용 앱 요청을 정리하지 못했습니다.",
      "allowanceReplyDefault": "말씀하신 내용을 학부모에게 보낼 형태로 정리했어요.",
      "noParentLinked": "연결된 학부모 계정이 없어 요청을 보낼 수 없습니다.",
      "parentRequestSendFailed": "학부모에게 요청을 보내지 못했습니다.",
      "parentRequestSentBanner": "학부모 앱에 알림으로 허용 앱 요청을 보냈어요.",
      "networkSendFailed": "네트워크 오류로 요청을 보내지 못했습니다.",
      "allowanceDetailHint": "원하는 요일, 시간, 허용 앱을 더 자세히 알려 주세요.",
      "emptyReply": "답변이 비어 있어요.",
      "tomorrowPracticeEmpty": "내일 실천 문장이 비어 있습니다. 대화를 조금 더 나눈 뒤 다시 시도해 주세요.",
      "saveFailedNetwork": "저장에 실패했습니다. 네트워크를 확인해 주세요.",
      "studyPlanEmpty": "책별 계획이 비어 있습니다. 대화를 조금 더 나눈 뒤 다시 시도해 주세요.",
      "saveFailedLockNetwork": "저장에 실패했습니다. 잠금이나 네트워크를 확인해 주세요.",
      "applyFailed": "반영에 실패했습니다.",
      "applyButtonApplying": "반영 중…",
      "applyButtonApplyToTomorrow": "내일 계획에 반영",
      "requestButtonRequesting": "요청 중…",
      "requestButtonSendToParent": "학부모에게 요청하기",
      "composerPlaceholder": "내일 하고 싶은 것, 고민을 적어 주세요…",
      "composerSendAria": "보내기",
      "transferFailed": "전송에 실패했습니다.",
      "httpParseFailed": "응답을 처리하지 못했습니다",
      "planSynthFailed": "계획을 만들지 못했습니다"
    }
  }
}
```

---

## 5. 관련 DB: `coach_response_log`

코치 대화·응답을 적재할 **`coach_response_log`** 테이블은 프롬프트/`ko.json`이 아니라 **PostgreSQL 마이그레이션 SQL**로만 정의되어 있다.

| 항목 | 내용 |
|------|------|
| **파일** | `server/migrations/create_coach_response_log.sql` |
| **컬럼 요약** | `session_id`, `user_type` (`student` \| `parent`), `coach_mode`, `user_message`, `ai_response`, `context_snapshot` (JSONB), `signal` (`positive` \| `negative` \| `neutral`), `signal_reason`, `is_fewshot`, `created_at` |
| **인덱스** | `coach_mode`, `signal`, `is_fewshot` |

**적용:** DB에 연결한 뒤 해당 `.sql` 파일을 실행한다. `server/migrate.js`는 기본적으로 `server/schema.sql`만 적용하므로, 이 마이그레이션은 **별도 실행**이 필요하다(스펙 `cursor-step1-db`: 마이그레이션 파일만 추가, 앱 코드 변경 없음).

**SQL 전문** (`create_coach_response_log.sql`과 동일):

```sql
CREATE TABLE IF NOT EXISTS coach_response_log (
  id               SERIAL PRIMARY KEY,
  session_id       TEXT NOT NULL,
  user_type        TEXT NOT NULL CHECK (user_type IN ('student', 'parent')),
  coach_mode       TEXT NOT NULL,
  user_message     TEXT NOT NULL,
  ai_response      TEXT NOT NULL,
  context_snapshot JSONB,
  signal           TEXT CHECK (signal IN ('positive', 'negative', 'neutral')),
  signal_reason    TEXT,
  is_fewshot       BOOLEAN DEFAULT FALSE,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crl_coach_mode ON coach_response_log (coach_mode);
CREATE INDEX IF NOT EXISTS idx_crl_signal ON coach_response_log (signal);
CREATE INDEX IF NOT EXISTS idx_crl_is_fewshot ON coach_response_log (is_fewshot);
```

---

## 6. 신호 탐지: `signalDetector.js`

**용도:** 코치 대화 **다음 사용자 메시지**에서 `positive` / `negative` / `neutral` 신호를 **키워드 포함 여부**로 휴리스틱 판별한다. `coach_response_log.signal`·`signal_reason` 컬럼과 논리적으로 맞물리도록 설계되었으며, **OpenAI 프롬프트·`ko.json`에는 넣지 않는다** (`server/feedback/signalDetector.js` 단독).

**export:** `detectSignal(nextUserMessage, userType)` — `userType`은 `'student'` \| `'parent'`만 가정.

**구현 비고 (스펙 대비):** `cursor-step2-signal.md` 원문은 `trim().length <= 5`일 때 neutral이지만, 그대로면 `"해봤어요"`(4자)·`"모르겠어요"`(5자)도 짧다고 처리되어 문서 내 검증 예시와 모순된다. 저장소 구현은 **trim 길이가 1 이하**일 때만 `메시지가 너무 짧음`으로 neutral 처리한다.

**검증 예시 (문서용):**

| 입력 | `userType` | 기대 `signal` |
|------|------------|----------------|
| `해봤어요` | `student` | `positive` |
| `모르겠어요` | `student` | `negative` |
| `응` | `student` | `neutral` |
| `맞아요 근데 모르겠어요` | `student` | `neutral` (긍·부정 동시) |

**전문** (`server/feedback/signalDetector.js`와 동일):

```js
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
```

---

## 7. Few-shot 관리·피드백 스케줄러

`coach_response_log`(§5)에 쌓인 **긍정 응답**을 few-shot 후보로 올리고, GPT `system`에 붙일 **예시 블록 문자열**을 만든다. **OpenAI 프롬프트 문구·`ko.json`에는 넣지 않는다** — 전부 `server/feedback/` + DB.

### 7.1 `server/feedback/fewshotManager.js`

| export | 설명 |
|--------|------|
| `refreshFewshotCandidates(coachMode)` | 해당 `coach_mode`에서 `signal='positive'`·`is_fewshot=false`인 행을 최대 **3건**(`MAX_FEWSHOT_PER_MODE`) 후보로 고른 뒤 `is_fewshot=true`로 표시. 이미 true인 행이 3건을 넘기면 **`created_at`이 가장 오래된** true 행부터 `false`로 내려 용량을 맞춘다. |
| `getFewshotBlock(coachMode)` | `is_fewshot=true`인 행을 `created_at DESC`로 읽어, 아래 접두 + 예시 블록을 합친 문자열을 반환. 행이 없으면 `''`. |

**후보 정렬:** `context_snapshot IS NOT NULL`인 행을 우선, 그다음 `created_at DESC`.

**`context_snapshot` 요약 (`summarizeContext`, 비 export):** 객체(또는 JSON 문자열)에서 `sleepHours`, `stressScore`, `concentrationPercent`, `planCompletionRate`가 있으면 `수면 N시간`, `스트레스 N/10` 등으로 한 줄 요약에 붙인다.

**Few-shot 블록 접두 (고정):**

```
[좋은 답변 예시 — 실제 대화 기반]
```

각 예시는 `예시 n)` / (요약 있으면) `학생 상황 요약: …` / `학생 질문: …` / `코치 답변: …` 형태로 이어 붙인다.

**DB:** `require("../db").query` 사용 (`server/db.js`).

### 7.2 `server/feedback/feedbackScheduler.js`

| export | 설명 |
|--------|------|
| `startFeedbackFewshotCron()` | `node-cron`으로 **매일 02:00 KST**(`0 2 * * *`, `timezone: "Asia/Seoul"`)에 `COACH_MODES`를 순회하며 `refreshFewshotCandidates(mode)` 호출. 중복 등록 방지용 `started` 플래그. |
| `COACH_MODES` | `['learning', 'suneung', 'tomorrowPlan', 'patternInsights', 'growthReport']` (스펙 `cursor-step3-fewshot.md`와 동일). |

**스케줄 표기:** 스펙 원문의 `0 17 * * *` + `Asia/Seoul`은 한국 시각 기준으로는 **오후 5시**가 되어, 문서·코드는 **`0 2 * * *` + `Asia/Seoul`**(새벽 2시)로 맞춤.

### 7.3 `server/index.js` 연동

DB 연결 후 기존 크론과 같이 **`startFeedbackFewshotCron()`**을 한 번 호출한다 (`require("./feedback/feedbackScheduler")`). `coach_response_log` 테이블이 없으면 해당 잡에서 쿼리 오류가 나며 모드별로 로그만 남긴다.

---

## 8. 로그·시그널 통합 (`index.js`, step4)

`cursor-step4-integration.md`에 맞춰 **`coach_response_log`**에 응답을 남기고, 다음 사용자 메시지에서 **`signalDetector`**로 직전 행을 갱신하며, 학습·수능 system에 **few-shot**을 붙인다. **문구·프롬프트 본문은 `server/prompts/`·`ko.json`에 추가하지 않는다** — 로직·INSERT만 `server/index.js`·`studentCoachChat.js`·`fewshotManager` 경로.

### 8.1 세션 대용·직전 로그 id

express-session 미사용. **`lastCoachResponseLogIdByUserId`** `Map`(키: `userId`)에 직전 INSERT의 `id`를 저장하고, 다음 대화형 요청에서 `applyCoachSignalFromPreviousTurn`이 `detectSignal`로 `signal`·`signal_reason`을 UPDATE한 뒤 맵에서 제거한다.

### 8.2 `coachResponseLogSessionId(req, extra?)`

`req.body.sessionId`가 있으면 우선, 없으면 `` `user:${req.userId}` `` (+ `extra` 접미사). INSERT `session_id` 컬럼에 사용.

### 8.3 대화형 API에서의 순서

| 엔드포인트 | 시작 시 signal | 응답 후 INSERT | `coach_mode` | `userIdForSignalLink` |
|------------|-----------------|----------------|--------------|------------------------|
| `POST /api/student/coach/chat` | 학생·`message`로 `applyCoachSignal…` | 학습·수능 분기만 (`learning` / `suneung`) | `learning` \| `suneung` | `req.userId` |
| `POST /api/student/coach/tomorrow-plan/message` | 동일 | 협업 GPT 응답 후 | `tomorrowPlan` | `req.userId` |
| `POST /api/student/coach/tomorrow-plan/synthesize` | 없음 | life/books GPT 성공 시 | `tomorrowPlan` | 합성은 `null` |
| `openAiPatternCompletion` (학부모·학생 패턴) | 없음 | 응답 텍스트 확정 후 | `patternInsights` | `null` |
| `buildParentGrowthReportPayload` (OpenAI 성공 시) | 없음 | 부모 id 전달 시 1행 | `growthReport` | `null` |

**컨텍스트 스냅샷:** 학생 코치는 `coachContextSnapshotFromStudentSnapshot(snapshot)`(수면·스트레스·집중·달성률 등), 내일 계획은 `coachContextSnapshotFromTomorrowContext(context)`.

### 8.4 `openAiPatternCompletion(payload, logOptions?)`

두 번째 인자 `{ req, userType: 'parent' \| 'student' }`가 있으면, OpenAI 호출이 끝난 뒤 **user 메시지 = payload JSON**, **assistant = 모델 원문**으로 `coach_response_log`에 한 줄 INSERT한다 (`userIdForSignalLink` 없음 — GET 기반).

### 8.5 성장 리포트

`GET /api/parent/growth-report` → `buildParentGrowthReportPayload(studentId, weekStart, req.userId)` 세 번째 인자로 부모 id를 넘기면, GPT 섹션 합성이 성공했을 때 **`growthReport`** 모드로 요약 JSON을 로그에 남긴다.

### 8.6 `studentCoachChat.js` (few-shot 빌더)

| export | 설명 |
|--------|------|
| `buildLearningCoachSystem()` | `BASE_COACH_SYSTEM` + `[학습 코칭 모드]` + `getFewshotBlock('learning')` (비동기). |
| `buildSuneungCoachSystem()` | `BASE_COACH_SYSTEM` + `[수능 질의응답 모드]` + `getFewshotBlock('suneung')` (비동기). |

`ko.json`에는 추가하지 않으며, few-shot 문구는 전부 DB에서 조립된다(§7).

