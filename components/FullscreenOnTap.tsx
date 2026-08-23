"use client";

import { useEffect } from "react";

/**
 * 화면을 처음 건드릴 때 전체화면으로 바꾼다 — 주소창을 걷어내기 위해서다.
 *
 * 주소창은 페이지가 스스로 지울 수 없다. 홈 화면에 설치해 열면(standalone)
 * 애초에 안 나오지만, 링크를 눌러 브라우저 탭으로 연 사람에게는 그 길이 없다.
 * 전체화면 API 는 사용자가 화면을 건드린 직후에만 받아 주므로, 첫 손짓에 얹는다.
 *
 * 페이지를 옮겨 다녀도 문서는 그대로라 전체화면이 유지된다. 그래서 한 번만 건다.
 * 거절당하면(브라우저가 막았거나 iOS 처럼 지원하지 않으면) 조용히 넘어간다 —
 * 주소창이 있는 것뿐이지 체험에는 아무 지장이 없다.
 */
export default function FullscreenOnTap() {
  useEffect(() => {
    const root = document.documentElement;

    // 이미 설치해서 앱처럼 열었거나, 이미 전체화면이면 할 일이 없다
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      window.matchMedia?.("(display-mode: fullscreen)").matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true;
    if (standalone || document.fullscreenElement) return;
    if (!root.requestFullscreen) return;

    let done = false;
    const enter = () => {
      if (done) return;
      done = true;
      stop();
      // 거절은 흔한 일이다 (권한 정책, 데스크톱 설정 등). 조용히 둔다.
      void root.requestFullscreen({ navigationUI: "hide" }).catch(() => {});
    };
    const stop = () => {
      window.removeEventListener("pointerdown", enter);
      window.removeEventListener("keydown", enter);
    };

    window.addEventListener("pointerdown", enter, { once: true, passive: true });
    window.addEventListener("keydown", enter, { once: true });
    return stop;
  }, []);

  return null;
}
