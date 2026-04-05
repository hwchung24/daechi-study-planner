import React from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

const easeStandard = [0.22, 1, 0.36, 1] as const;

type PageTransitionProps = {
  pageKey: string;
  children: React.ReactNode;
  className?: string;
};

/** 탭·라우트 전환 시 메인 영역 페이드 + 살짝 이동 */
export function PageTransition({
  pageKey,
  children,
  className
}: PageTransitionProps) {
  const reduce = useReducedMotion();
  const transition = reduce
    ? { duration: 0.12, ease: "easeOut" as const }
    : { duration: 0.3, ease: easeStandard };

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={pageKey}
        className={className}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={transition}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

type TabPanelProps = {
  tabKey: string;
  children: React.ReactNode;
  className?: string;
};

/** 동일 셸 안에서 탭만 바뀔 때 (컴포넌트 루트 유지) */
export function TabTransitionPanel({
  tabKey,
  children,
  className
}: TabPanelProps) {
  const reduce = useReducedMotion();
  const transition = reduce
    ? { duration: 0.1, ease: "easeOut" as const }
    : { duration: 0.26, ease: easeStandard };

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={tabKey}
        className={className}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={transition}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
