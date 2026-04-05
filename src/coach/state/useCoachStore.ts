import { create } from "zustand";
import type { CoachMessage } from "../types";

export type CoachChatGreetingMode = "learning" | "suneung";

type CoachState = {
  activeStudentId: string;
  setActiveStudentId: (id: string) => void;

  // Next actions completion state
  completedActionIds: Record<string, boolean>;
  toggleActionDone: (id: string) => void;

  // Chat — 첫 화면은 코치 선택 말풍선(계획 탭과 동일 UX), 대화 시작 후 메시지 쌓임
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

  messages: [],
  addMessage: m => set(s => ({ messages: [...s.messages, m] })),
  resetChat: () => set({ messages: [] })
}));
