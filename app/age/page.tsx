import Link from "next/link";

/** 연령 간단 확인 — 본인인증 없이 만 19세 이상 확인만 (기획안 5.2) */
export default function AgePage() {
  return (
    <div
      style={{
        position: "relative",
        zIndex: 5,
        padding: "60px 22px 40px",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Link
        href="/"
        className="btn-back"
        style={{ width: 40, height: 40, marginBottom: "auto" }}
        aria-label="처음으로"
      >
        <svg width="9" height="16" viewBox="0 0 9 16">
          <path d="M8 1L1 8l7 7" stroke="#20302a" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Link>

      <div style={{ textAlign: "center", margin: "auto 0" }}>
        <div
          style={{
            width: 80,
            height: 80,
            margin: "0 auto 22px",
            borderRadius: 20,
            background: "var(--seal)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 14px 30px rgba(181,72,47,.3)",
          }}
        >
          <span className="serif" style={{ fontWeight: 800, fontSize: 30, color: "#fff" }}>19</span>
        </div>
        <h1 className="serif" style={{ margin: "0 0 12px", fontWeight: 800, fontSize: 24, lineHeight: 1.4 }}>
          잠깐, 확인할게요
        </h1>
        <p style={{ margin: "0 auto", maxWidth: 300, fontSize: 14, lineHeight: 1.7, color: "var(--ink-soft)" }}>
          취향 진단·전통주 추천은 <b>만 19세 이상</b> 이용자를 위한 콘텐츠예요. 본인·실명 인증 없이
          간단히 확인만 합니다.
        </p>
      </div>

      <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 11 }}>
        <Link href="/sulbti" className="btn-primary" style={{ textAlign: "center", color: "#fff" }}>
          만 19세 이상입니다
        </Link>
        <Link href="/map" className="btn-outline" style={{ textAlign: "center", color: "var(--ink)" }}>
          아직 아니에요 · 지도 둘러보기
        </Link>
      </div>
    </div>
  );
}
