import Link from "next/link";
import ScreenHeader from "@/components/ScreenHeader";

/**
 * AR 양조 체험 — 팀원이 구현할 자리 (A-Frame WebXR / MindAR).
 * 이 페이지는 진입점만 제공하고, AR 콘텐츠는 아래 표시된 영역에 들어간다.
 * 체험 종료 후 흐름: AI 양조 리포트 → 경기술 카드 획득 → 도감 등록 (추후 연결)
 */
export default function ArPage() {
  return (
    <div
      style={{
        position: "relative",
        zIndex: 5,
        minHeight: "100vh",
        background: "var(--dark)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <ScreenHeader title="AR 양조 체험" dark />

      {/* ▼▼▼ AR 구현 영역 (팀원 담당) ▼▼▼ */}
      <div
        style={{
          flex: 1,
          position: "relative",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 18,
          background: "repeating-linear-gradient(45deg,#222a35,#222a35 16px,#1e2530 16px,#1e2530 32px)",
        }}
      >
        <div
          style={{
            width: 200,
            height: 120,
            border: "2px dashed rgba(219,232,213,.6)",
            borderRadius: 14,
            transform: "perspective(300px) rotateX(52deg)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span className="ph-label" style={{ color: "rgba(255,255,255,.5)", fontSize: 10 }}>AR 영역</span>
        </div>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.7, color: "rgba(255,255,255,.6)", textAlign: "center" }}>
          여기에 AR 양조장이 들어갈 자리예요.
          <br />
          (A-Frame WebXR · MindAR — 팀원 구현 예정)
        </p>
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
