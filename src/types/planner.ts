export type StudyBlock = {
  id: number;
  subject: string;
  start: string;
  end: string;
  done: boolean;
  /** study_books.id — 책 관리에서 등록한 책 */
  bookId?: number;
  /** 계획 구간 (예: 10~20쪽) */
  plannedRange?: string;
};

export type ProgressBook = {
  id: number;
  name: string;
};

export type ProgressPlanValue = {
  text: string;
  start?: string;
  end?: string;
};

export type ProgressPlan = {
  [bookId: number]: ProgressPlanValue;
};
