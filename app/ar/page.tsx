import Link from "next/link";
import dynamic from "next/dynamic";
import ScreenHeader from "@/components/ScreenHeader";

// AR 콘텐츠는 브라우저 전용(WebGL/WebXR)이라 SSR 비활성화로 불러온다.
const ArBreweryExperience = dynamic(
  () => import("@/components/ArBreweryExperience"),
  { ssr: false }
);

/**
 * AR 양조 체험 — WebXR / Three.js.
 * 이 페이지는 진입점만 제공하고, AR 콘텐츠는 아래 표시된 영역에 들어간다.
 * 체험 종료 후 흐름: AI 양조 리포트 → 경기술 카드 획득 → 도감 등록 (추후 연결)
 */
export default function ArPage() {
  return (
    <div
      style={{
        position: "relative",
        zIndex: 5,
        minHeight: "100dvh",
        background: "var(--dark)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <ScreenHeader title="AR 양조 체험" dark />

      {/* ▼▼▼ AR 구현 영역 ▼▼▼ */}
      <div
        style={{
          flex: 1,
          position: "relative",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <ArBreweryExperience />
      </div>
      {/* ▲▲▲ AR 구현 영역 끝 ▲▲▲ */}

      <div style={{ padding: "22px 22px 44px" }}>
        <Link href="/dex" className="btn-outline" style={{ display: "block", textAlign: "center", color: "#fff", borderColor: "rgba(255,255,255,.35)", background: "rgba(255,255,255,.08)" }}>
          (임시) 체험 완료 → 도감 보기
        </Link>
      </div>
    </div>
  );
}