import React, { useEffect, useRef } from "react";

type Props = {
  onComplete: () => void;
};

const SPLASH_SEEN_STORAGE_KEY = "daechi_splash_seen";
/** 첫 실행: 로고 인지 + 충분히 유지 후 페이드아웃 */
const FIRST_SPLASH_MS = 2800;
/** 재방문: 첫만큼 길지는 않지만 충분히 보이게 */
const RETURNING_SPLASH_MS = 2000;

function resolveSplashDurationMs(): number {
  if (typeof window === "undefined") return FIRST_SPLASH_MS;
  try {
    return localStorage.getItem(SPLASH_SEEN_STORAGE_KEY) === "1"
      ? RETURNING_SPLASH_MS
      : FIRST_SPLASH_MS;
  } catch {
    return FIRST_SPLASH_MS;
  }
}

/**
 * 앱 최초 실행 시 브랜드 로고를 보여 주는 런치/스플래시 화면.
 * 페이드 인 → 유지 → 페이드 아웃 후 onComplete.
 */
const SplashScreen: React.FC<Props> = ({ onComplete }) => {
  const finished = useRef(false);
  const durationMsRef = useRef(resolveSplashDurationMs());

  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    onComplete();
  };

  useEffect(() => {
    try {
      localStorage.setItem(SPLASH_SEEN_STORAGE_KEY, "1");
    } catch {
      // ignore
    }
    const t = setTimeout(finish, durationMsRef.current + 240);
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
      style={{ ["--splash-duration-ms" as string]: `${durationMsRef.current}ms` }}
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
