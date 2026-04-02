import React from "react";
import {
  Activity,
  BarChart3,
  CheckSquare,
  Home,
  MessageCircle,
  User,
  NotebookPen,
  BookOpen,
  Sparkles,
  ListChecks
} from "lucide-react";

export const CoachIcons = {
  Home,
  Insights: BarChart3,
  Actions: CheckSquare,
  Coach: MessageCircle,
  Profile: User,
  Log: NotebookPen,
  Timeline: ListChecks,
  Book: BookOpen,
  Sparkles,
  Activity
} as const;

export function IconCircle(props: { children: React.ReactNode; tone?: "indigo" | "violet" }) {
  return (
    <span className={"coach-icon-circle" + (props.tone ? ` ${props.tone}` : "")}>
      {props.children}
    </span>
  );
}

