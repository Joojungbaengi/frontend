import type { MetadataRoute } from "next";

/**
 * 홈 화면에 설치했을 때 주소창 없이 열리게 하는 설정.
 *
 * 브라우저 주소창은 페이지가 마음대로 지울 수 없다 — 어느 사이트를 보고 있는지
 * 감추지 못하게 막아 둔 것이라, 웹 표준으로 없애는 길은 두 가지뿐이다.
 *   1) 홈 화면에 설치해서 앱처럼 여는 것 (이 파일)
 *   2) 사용자가 화면을 한 번 건드렸을 때 전체화면으로 바꾸는 것
 *      (components/FullscreenOnTap.tsx)
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "경기술도가 — 경기도 전통주, 신선처럼 즐기다",
    short_name: "경기술도가",
    description:
      "취향에 맞는 경기도 전통주를 AI가 추천하고, 그 술이 빚어지는 과정을 AR 양조장에서 체험하는 콘텐츠",
    lang: "ko",
    start_url: "/",
    scope: "/",
    display: "standalone",
    // 설치를 못 하는 환경에서도 최대한 넓게 쓴다
    display_override: ["fullscreen", "standalone", "minimal-ui"],
    orientation: "portrait",
    background_color: "#2a1b11",
    theme_color: "#2a1b11",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
