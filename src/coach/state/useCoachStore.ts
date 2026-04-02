import { create } from "zustand";
import type { CoachMessage } from "../types";

type CoachState = {
  activeStudentId: string;
  setActiveStudentId: (id: string) => void;

  // Next actions completion state
  completedActionIds: Record<string, boolean>;
  toggleActionDone: (id: string) => void;

  // Chat
  messages: CoachMessage[];
  addMessage: (m: CoachMessage) => void;
  resetChat: () => void;
};

export const useCoachStore = create<CoachState>(set => ({
  activeStudentId: "stu_hyeon",
  setActiveStudentId: id => set({ activeStudentId: id }),

  completedActionIds: {},
  toggleActionDone: id =>
    set(s => ({
      completedActionIds: { ...s.completedActionIds, [id]: !s.completedActionIds[id] }
    })),

  messages: [
    {
      id: "seed_1",
      role: "coach",
      createdAt: Date.now() - 1000 * 60 * 10,
      text:
        "안녕하세요. 저는 학습 코치입니다.\n\n오늘은 ‘의지’보다 ‘루틴’에서 답을 찾는 쪽이 빠를 거예요.\n지금 어떤 점이 제일 답답해요?"
    }
  ],
  addMessage: m => set(s => ({ messages: [...s.messages, m] })),
  resetChat: () =>
    set({
      messages: [
        {
          id: "seed_1",
          role: "coach",
          createdAt: Date.now(),
          text:
            "다시 시작해볼까요?\n\n오늘은 ‘다음 행동 1개’만 정해도 충분합니다. 지금 제일 막히는 지점을 한 문장으로 말해줘요."
        }
      ]
    })
}));

