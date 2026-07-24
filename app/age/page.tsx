import Link from "next/link";

/**
 * 연령 확인 — 확정 디자인.
 * 배경사진 + 어두운 오버레이 위에, 하단에 한지 카드(19 인장 + 확인 버튼).
 * 본인·실명 인증 없이 만 19세 이상 확인만 (기획안 5.2).
 */
export default function AgePage() {
  return (
    <div style={{ position: "relative", minHeight: "100dvh", overflow: "hidden" }}>
      {/* 배경 사진 + 어두운 오버레이 */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: "url(/home-bg.png)",
          backgroundSize: "cover",
          backgroundPosition: "center top",
          zIndex: 0,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "linear-gradient(180deg,rgba(30,22,12,.35) 0%,rgba(30,22,12,.55) 100%)",
          zIndex: 1,
        }}
      />

      {/* 헤더 */}
      <div style={{ position: "relative", zIndex: 30, display: "flex", alignItems: "center", gap: 13, padding: "52px 18px 0" }}>
        <Link href="/" className="btn-back on-dark" aria-label="처음으로">
          <svg width="9" height="16" viewBox="0 0 9 16">
            <path d="M8 1L1 8l7 7" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
        <div
          className="serif"
          style={{ flex: 1, textAlign: "center", fontWeight: 700, fontSize: 19, color: "#fff", textShadow: "0 1px 4px rgba(0,0,0,.4)" }}
        >
          연령 확인
        </div>
        <div style={{ width: 40 }} />
      </div>

      {/* 하단 한지 카드 */}
      <div style={{ position: "absolute", left: 24, right: 24, bottom: 40, zIndex: 20 }}>
        <div
          style={{
            background: "rgba(243,237,225,.94)",
            backdropFilter: "blur(6px)",
            border: "1px solid rgba(198,165,104,.6)",
            borderRadius: 24,
            padding: "28px 24px",
            boxShadow: "0 24px 50px -16px rgba(20,14,6,.6)",
            textAlign: "center",
          }}
        >
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: "50%",
              border: "2px solid #b5482f",
              background: "rgba(181,72,47,.06)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 18px",
              color: "#b5482f",
            }}
          >
            <span className="serif" style={{ fontWeight: 800, fontSize: 26 }}>19</span>
          </div>
          <h1 className="serif" style={{ margin: "0 0 24px", fontWeight: 800, fontSize: 24, color: "#3d2f1c" }}>
            만 19세 이상이신가요?
          </h1>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Link href="/sulbti" className="btn-primary" style={{ textAlign: "center" }}>
              만 19세 이상입니다
            </Link>
            <Link href="/map" className="btn-outline" style={{ textAlign: "center" }}>
              아직 아니에요 · 지도 둘러보기
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
