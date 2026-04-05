import React from "react";

/** AI 코치 메시지 옆 브랜드 아바타 (public/coach-ai-avatar.png) */
export function CoachAvatar() {
  return (
    <span className="coach-avatar coach-avatar--logo" role="img" aria-label="AI 코치">
      <img src="/coach-ai-avatar.png" alt="" width={30} height={30} decoding="async" />
    </span>
  );
}
