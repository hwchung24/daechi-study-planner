import React from "react";
import {
  Bot,
  CalendarDays,
  FileText,
  Home,
  Lightbulb,
  Link2,
  ShoppingBag,
  Timer,
  Undo2,
  User
} from "lucide-react";

type TabKey = "today" | "week" | "store" | "settings";
type CoachStudentTabKey = "home" | "coach";
type ParentTabKey = "link" | "report";
type CoachParentTabKey = "home" | "timeline" | "guide" | "profile";

export function AppBottomNav(props: {
  showStudentShell: boolean;
  roleLoading: boolean;
  parentView: boolean;
  meRole: string | null;
  tab: TabKey;
  parentTab: ParentTabKey;
  coachStudentTab: CoachStudentTabKey | null;
  coachParentTab: CoachParentTabKey | null;
  onStudentNavClick: (tab: TabKey) => void;
  onCoachStudentNavClick: (tab: CoachStudentTabKey) => void;
  onParentNavClick: (tab: ParentTabKey) => void;
  onCoachParentNavClick: (tab: CoachParentTabKey) => void;
  onParentCoachExit: () => void;
}) {
  const {
    showStudentShell,
    roleLoading,
    parentView,
    meRole,
    tab,
    parentTab,
    coachStudentTab,
    coachParentTab,
    onStudentNavClick,
    onCoachStudentNavClick,
    onParentNavClick,
    onCoachParentNavClick,
    onParentCoachExit
  } = props;

  const coachStudentMode = Boolean(coachStudentTab);
  const coachParentMode = Boolean(coachParentTab);

  return (
    <>
      {showStudentShell && (
        <nav className="bottom-nav" aria-label="하단 내비게이션">
          <button
            className={
              "nav-item" +
              (!coachStudentMode && tab === "today" ? " nav-item-active" : "")
            }
            onClick={() => onStudentNavClick("today")}
          >
            <span className="nav-icon" aria-hidden="true">
              <Timer size={14} />
            </span>
            <span className="nav-label">오늘</span>
          </button>
          <button
            className={
              "nav-item" +
              (!coachStudentMode && tab === "week" ? " nav-item-active" : "")
            }
            onClick={() => onStudentNavClick("week")}
          >
            <span className="nav-icon" aria-hidden="true">
              <CalendarDays size={14} />
            </span>
            <span className="nav-label">주간</span>
          </button>
          <button
            className={
              "nav-item" +
              (!coachStudentMode && tab === "store" ? " nav-item-active" : "")
            }
            onClick={() => onStudentNavClick("store")}
          >
            <span className="nav-icon" aria-hidden="true">
              <ShoppingBag size={14} />
            </span>
            <span className="nav-label">앱스토어</span>
          </button>
          <button
            type="button"
            className={
              "nav-item" +
              (coachStudentMode && coachStudentTab === "home"
                ? " nav-item-active"
                : "")
            }
            onClick={() => onCoachStudentNavClick("home")}
          >
            <span className="nav-icon" aria-hidden="true">
              <Home size={14} />
            </span>
            <span className="nav-label">학생홈</span>
          </button>
          <button
            type="button"
            className={
              "nav-item" +
              (coachStudentMode && coachStudentTab === "coach"
                ? " nav-item-active"
                : "")
            }
            onClick={() => onCoachStudentNavClick("coach")}
          >
            <span className="nav-icon" aria-hidden="true">
              <Bot size={14} />
            </span>
            <span className="nav-label">코치</span>
          </button>
        </nav>
      )}

      {!roleLoading && parentView && meRole === "parent" && (
        <nav className="bottom-nav" aria-label="하단 내비게이션">
          {coachParentMode ? (
            <>
              <button
                type="button"
                className={
                  "nav-item" + (coachParentTab === "home" ? " nav-item-active" : "")
                }
                onClick={() => onCoachParentNavClick("home")}
              >
                <span className="nav-icon" aria-hidden="true">
                  <Home size={14} />
                </span>
                <span className="nav-label">홈</span>
              </button>
              <button
                type="button"
                className={
                  "nav-item" +
                  (coachParentTab === "timeline" ? " nav-item-active" : "")
                }
                onClick={() => onCoachParentNavClick("timeline")}
              >
                <span className="nav-icon" aria-hidden="true">
                  <Timer size={14} />
                </span>
                <span className="nav-label">타임라인</span>
              </button>
              <button
                type="button"
                className={
                  "nav-item" + (coachParentTab === "guide" ? " nav-item-active" : "")
                }
                onClick={() => onCoachParentNavClick("guide")}
              >
                <span className="nav-icon" aria-hidden="true">
                  <Lightbulb size={14} />
                </span>
                <span className="nav-label">가이드</span>
              </button>
              <button
                type="button"
                className={
                  "nav-item" +
                  (coachParentTab === "profile" ? " nav-item-active" : "")
                }
                onClick={() => onCoachParentNavClick("profile")}
              >
                <span className="nav-icon" aria-hidden="true">
                  <User size={14} />
                </span>
                <span className="nav-label">프로필</span>
              </button>
              <button type="button" className="nav-item" onClick={onParentCoachExit}>
                <span className="nav-icon" aria-hidden="true">
                  <Undo2 size={14} />
                </span>
                <span className="nav-label">기본</span>
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className={
                  "nav-item" + (parentTab === "link" ? " nav-item-active" : "")
                }
                onClick={() => onParentNavClick("link")}
              >
                <span className="nav-icon" aria-hidden="true">
                  <Link2 size={14} />
                </span>
                <span className="nav-label">연결</span>
              </button>
              <button
                type="button"
                className="nav-item"
                onClick={() => onCoachParentNavClick("home")}
              >
                <span className="nav-icon" aria-hidden="true">
                  <Bot size={14} />
                </span>
                <span className="nav-label">코치</span>
              </button>
              <button
                type="button"
                className={
                  "nav-item" + (parentTab === "report" ? " nav-item-active" : "")
                }
                onClick={() => onParentNavClick("report")}
              >
                <span className="nav-icon" aria-hidden="true">
                  <FileText size={14} />
                </span>
                <span className="nav-label">리포트</span>
              </button>
            </>
          )}
        </nav>
      )}
    </>
  );
}
