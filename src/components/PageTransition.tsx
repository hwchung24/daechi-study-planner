import React from "react";

type PageTransitionProps = {
  pageKey: string;
  children: React.ReactNode;
  className?: string;
};

/** 탭·라우트 전환 래퍼. 하단 네비게이션 이동 시 즉시 전환합니다. */
export function PageTransition({
  pageKey,
  children,
  className
}: PageTransitionProps) {
  return <div key={pageKey} className={className}>{children}</div>;
}

type TabPanelProps = {
  tabKey: string;
  children: React.ReactNode;
  className?: string;
};

/** 동일 셸 안에서 탭만 바뀔 때도 애니메이션 없이 즉시 교체합니다. */
export function TabTransitionPanel({
  tabKey,
  children,
  className
}: TabPanelProps) {
  return <div key={tabKey} className={className}>{children}</div>;
}
