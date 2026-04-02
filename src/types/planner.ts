export type StudyBlock = {
  id: number;
  subject: string;
  start: string;
  end: string;
  done: boolean;
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
