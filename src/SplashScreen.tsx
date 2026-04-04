import React, { useEffect, useRef } from "react";

type Props = {
  onComplete: () => void;
};

const SPLASH_FALLBACK_MS = 2400;

/**
 * 앱 최초 실행 시 브랜드 로고를 보여 주는 런치/스플래시 화면.
 * 페이드 인 → 유지 → 페이드 아웃 후 onComplete.
 */
const SplashScreen: React.FC<Props> = ({ onComplete }) => {
  const finished = useRef(false);

  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    onComplete();
  };

  useEffect(() => {
    const t = setTimeout(finish, SPLASH_FALLBACK_MS);
    return () => clearTimeout(t);
  }, []);

  const handleAnimationEnd = (e: React.AnimationEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const name = e.animationName || "";
    if (!name.includes("splash-screen-fade")) return;
    finish();
  };

  return (
    <div
      className="splash-screen"
      role="presentation"
      aria-hidden="true"
      onAnimationEnd={handleAnimationEnd}
    >
      <div className="splash-screen__inner">
        <img
          className="splash-screen__logo"
          src="/splash-logo.png"
          alt="대치루트"
          draggable={false}
        />
      </div>
    </div>
  );
};

export default SplashScreen;
