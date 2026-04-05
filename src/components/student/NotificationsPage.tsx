import React from "react";
import { ArrowLeft } from "lucide-react";

export function NotificationsPage(props: {
  hapticSelection?: () => void;
}) {
  const goBack = () => {
    props.hapticSelection?.();
    window.location.hash = "#/today";
  };

  return (
    <section className="section notifications-page">
      <div className="notifications-page__bar">
        <div className="notifications-page__bar-inner">
          <button
            type="button"
            className="notifications-back-btn"
            onClick={goBack}
            aria-label="이전 화면"
          >
            <ArrowLeft size={22} strokeWidth={2} aria-hidden />
          </button>
          <h1 className="notifications-page__title">알림</h1>
        </div>
      </div>
      <p className="notifications-page__empty">새 알림이 없습니다.</p>
    </section>
  );
}
