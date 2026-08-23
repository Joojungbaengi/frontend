"use client";

import { useEffect } from "react";

/**
 * 화면을 건드릴 때 전체화면으로 바꾼다 — 주소창을 걷어내기 위해서다.
 *
 * 주소창은 페이지가 스스로 지울 수 없다. 어느 사이트를 보고 있는지 감추지
 * 못하게 막아 둔 것이라, 웹 표준으로 없애는 길은 둘뿐이다 —
 * 홈 화면에 설치해 앱처럼 열거나(app/manifest.ts), 전체화면 API 를 쓰거나.
 *
 * 보통 모바일 브라우저는 아래로 스크롤할 때 주소창을 접어 주는데,
 * 이 앱은 body 가 스크롤되지 않아(.phone 안에서만 스크롤) 그 일이 영영 없다.
 * 그래서 손짓에 얹어 직접 전체화면으로 들어간다.
 *
 * 첫 손짓이 거절당하는 경우가 있어(정책·타이밍) 될 때까지 다시 시도한다.
 * 다만 사용자가 스스로 빠져나오면 그 뜻을 존중하고 더 붙잡지 않는다.
 */
export default function FullscreenOnTap() {
  useEffect(() => {
    const root = document.documentElement;
    if (!root.requestFullscreen) return;

    const isImmersive = () =>
      Boolean(document.fullscreenElement) ||
      window.matchMedia?.("(display-mode: standalone)").matches ||
      window.matchMedia?.("(display-mode: fullscreen)").matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true;

    // 홈 화면에서 앱으로 열었다면 애초에 주소창이 없다
    if (isImmersive()) return;

    let settled = false;
    const stop = () => {
      settled = true;
      window.removeEventListener("pointerdown", tryEnter);
      window.removeEventListener("keydown", tryEnter);
      document.removeEventListener("fullscreenchange", onChange);
    };

    function tryEnter() {
      if (settled || isImmersive()) return;
      // 거절은 흔한 일이다. 조용히 두고 다음 손짓에 다시 해 본다.
      void root.requestFullscreen({ navigationUI: "hide" }).catch(() => {});
    }

    function onChange() {
      if (document.fullscreenElement) {
        // 한 번 들어갔으면 더 붙잡지 않는다 — 나가는 것도 사용자 뜻이다
        stop();
      }
    }

    window.addEventListener("pointerdown", tryEnter, { passive: true });
    window.addEventListener("keydown", tryEnter);
    document.addEventListener("fullscreenchange", onChange);
    return stop;
  }, []);

  return null;
}
