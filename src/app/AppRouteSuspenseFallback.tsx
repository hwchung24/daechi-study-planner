import React from "react";

/** lazy 라우트 청크 로딩 시 큰 텍스트 플래시 대신 얇은 스켈레톤만 표시 */
export function AppRouteSuspenseFallback() {
  return (
    <div className="app-route-suspense-fallback" aria-hidden>
      <div className="app-route-suspense-fallback__pulse" />
    </div>
  );
}
