/** 오늘 기록 저장 후 학생 코치 홈이 coach/state를 다시 불러올 때 사용 */
export const DAECHI_COACH_LOG_SAVED_EVENT = "daechi-coach-log-saved";

/** 다른 탭에서 저장했을 때 storage 이벤트로 동기화 (같은 탭은 CustomEvent) */
export const DAECHI_COACH_LOG_SAVED_STORAGE_KEY = "daechi_coach_log_saved";

/** 기록 등에서 코치 특정 탭(분석/계획/학습 코칭)으로 진입할 때 1회 사용 후 제거 */
export const DAECHI_COACH_INITIAL_PANEL_KEY = "daechi_coach_initial_panel";

/** 기록 페이지「AI 코치와 함께 계획 짜기」— 학습(study) / 생활(life) 스타터 자동 전송, CoachTomorrowPlanCollab에서 1회 소비 */
export const DAECHI_COACH_TOMORROW_STARTER_KEY = "daechi_coach_tomorrow_starter";
