import React, { useCallback, useLayoutEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  Bot,
  Calendar,
  ClipboardList,
  LayoutGrid,
  Settings,
  User
} from "lucide-react";

function NavIcon({ children }: { children: React.ReactNode }) {
  return (
    <span className="nav-icon" aria-hidden="true">
      {children}
    </span>
  );
}

type TabKey = "today" | "records" | "store" | "profile";
type CoachStudentTabKey = "home" | "coach" | "analysis";
type ParentTabKey = "report" | "profile";
type CoachParentTabKey = "manage" | "records" | "studentSettings" | "analysis";

type PillMetrics = {
  left: number;
  top: number;
  width: number;
  height: number;
  visible: boolean;
};

function useBottomNavSlidingPill(
  navRef: React.RefObject<HTMLElement | null>,
  enabled: boolean,
  measureKey: string
) {
  const [pill, setPill] = useState<PillMetrics>({
    left: 0,
    top: 0,
    width: 0,
    height: 0,
    visible: false
  });

  const measure = useCallback(() => {
    const nav = navRef.current;
    if (!nav || !enabled) {
      setPill({ left: 0, top: 0, width: 0, height: 0, visible: false });
      return;
    }
    const active = nav.querySelector(".nav-item-active");
    if (!active || !(active instanceof HTMLElement)) {
      setPill({ left: 0, top: 0, width: 0, height: 0, visible: false });
      return;
    }
    const navR = nav.getBoundingClientRect();
    const aR = active.getBoundingClientRect();
    setPill({
      left: aR.left - navR.left,
      top: aR.top - navR.top,
      width: aR.width,
      height: aR.height,
      visible: true
    });
  }, [enabled, navRef]);

  useLayoutEffect(() => {
    if (!enabled) {
      setPill({ left: 0, top: 0, width: 0, height: 0, visible: false });
      return;
    }
    measure();
    const nav = navRef.current;
    if (!nav) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(nav);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [enabled, measureKey, measure, navRef]);

  return pill;
}

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
    onCoachParentNavClick
  } = props;

  const coachStudentMode = Boolean(coachStudentTab);
  const coachParentMode = Boolean(coachParentTab);
  const reduceMotion = useReducedMotion();

  const studentNavRef = useRef<HTMLElement | null>(null);
  const parentNavRef = useRef<HTMLElement | null>(null);

  const studentMeasureKey = coachStudentMode
    ? `c:${coachStudentTab}`
    : `p:${tab}`;
  const parentMeasureKey = coachParentMode
    ? `cp:${coachParentTab}`
    : `pp:${parentTab}`;

  const studentPill = useBottomNavSlidingPill(
    studentNavRef,
    showStudentShell,
    studentMeasureKey
  );
  const parentPill = useBottomNavSlidingPill(
    parentNavRef,
    !roleLoading && parentView && meRole === "parent",
    parentMeasureKey
  );

  const pillTransition = reduceMotion
    ? { duration: 0.08, ease: "easeOut" as const }
    : { type: "spring" as const, stiffness: 560, damping: 38, mass: 0.76 };

  return (
    <>
      {showStudentShell && (
        <nav
          ref={studentNavRef}
          className="bottom-nav bottom-nav--sliding-pill"
          aria-label="메인 탭"
        >
          <motion.div
            className="bottom-nav__pill"
            aria-hidden
            initial={false}
            animate={{
              left: studentPill.left,
              top: studentPill.top,
              width: studentPill.visible ? studentPill.width : 0,
              height: studentPill.visible ? studentPill.height : 0,
              opacity: studentPill.visible ? 1 : 0
            }}
            transition={pillTransition}
          />
          <button
            className={
              "nav-item" +
              (!coachStudentMode && tab === "today" ? " nav-item-active" : "")
            }
            onClick={() => onStudentNavClick("today")}
          >
            <NavIcon>
              <Calendar size={20} strokeWidth={2} />
            </NavIcon>
            <span className="nav-label">오늘</span>
          </button>
          <button
            className={
              "nav-item" +
              (!coachStudentMode && tab === "records" ? " nav-item-active" : "")
            }
            onClick={() => onStudentNavClick("records")}
          >
            <NavIcon>
              <ClipboardList size={20} strokeWidth={2} />
            </NavIcon>
            <span className="nav-label">기록</span>
          </button>
          <button
            type="button"
            className={
              "nav-item" +
              (coachStudentMode ? " nav-item-active" : "")
            }
            onClick={() => onCoachStudentNavClick("coach")}
          >
            <NavIcon>
              <Bot size={20} strokeWidth={2} />
            </NavIcon>
            <span className="nav-label">코치</span>
          </button>
          <button
            className={
              "nav-item" +
              (!coachStudentMode && tab === "store" ? " nav-item-active" : "")
            }
            onClick={() => onStudentNavClick("store")}
          >
            <NavIcon>
              <LayoutGrid size={20} strokeWidth={2} />
            </NavIcon>
            <span className="nav-label">앱</span>
          </button>
          <button
            type="button"
            className={
              "nav-item" +
              (!coachStudentMode && tab === "profile" ? " nav-item-active" : "")
            }
            onClick={() => onStudentNavClick("profile")}
          >
            <NavIcon>
              <User size={20} strokeWidth={2} />
            </NavIcon>
            <span className="nav-label">내 정보</span>
          </button>
        </nav>
      )}

      {!roleLoading && parentView && meRole === "parent" && (
        <nav
          ref={parentNavRef}
          className="bottom-nav bottom-nav--sliding-pill"
          aria-label="메인 탭"
        >
          <motion.div
            className="bottom-nav__pill"
            aria-hidden
            initial={false}
            animate={{
              left: parentPill.left,
              top: parentPill.top,
              width: parentPill.visible ? parentPill.width : 0,
              height: parentPill.visible ? parentPill.height : 0,
              opacity: parentPill.visible ? 1 : 0
            }}
            transition={pillTransition}
          />
          <button
            type="button"
            className={
              "nav-item" + (coachParentTab === "manage" ? " nav-item-active" : "")
            }
            onClick={() => onCoachParentNavClick("manage")}
          >
            <NavIcon>
              <User size={20} strokeWidth={2} />
            </NavIcon>
            <span className="nav-label">자녀</span>
          </button>
          <button
            type="button"
            className={
              "nav-item" + (coachParentTab === "records" ? " nav-item-active" : "")
            }
            onClick={() => onCoachParentNavClick("records")}
          >
            <NavIcon>
              <ClipboardList size={20} strokeWidth={2} />
            </NavIcon>
            <span className="nav-label">기록</span>
          </button>
          <button
            type="button"
            className={
              "nav-item" + (coachParentTab === "studentSettings" ? " nav-item-active" : "")
            }
            onClick={() => onCoachParentNavClick("studentSettings")}
          >
            <NavIcon>
              <Settings size={20} strokeWidth={2} />
            </NavIcon>
            <span className="nav-label">자녀 설정</span>
          </button>
          <button
            type="button"
            className={
              "nav-item" + (!coachParentMode && parentTab === "profile" ? " nav-item-active" : "")
            }
            onClick={() => onParentNavClick("profile")}
          >
            <NavIcon>
              <User size={20} strokeWidth={2} />
            </NavIcon>
            <span className="nav-label">내 정보</span>
          </button>
        </nav>
      )}
    </>
  );
}
