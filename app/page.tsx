import Link from "next/link";

/** 메인 메뉴 버튼 스타일 */
const menuCard: React.CSSProperties = {
  textAlign: "left",
  border: "1px solid rgba(34,48,62,.08)",
  background: "var(--hanji)",
  borderRadius: 20,
  padding: "20px 20px",
  boxShadow: "0 10px 24px rgba(53,89,126,.14)",
  display: "flex",
  alignItems: "center",
  gap: 16,
};

const iconBox: React.CSSProperties = {
  width: 52,
  height: 52,
  flexShrink: 0,
  borderRadius: 14,
  background: "var(--moss)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

function Chevron({ color = "#35597e" }: { color?: string }) {
  return (
    <svg width="8" height="14" viewBox="0 0 8 14">
      <path d="M1 1l6 6-6 6" stroke={color} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function MainPage() {
  return (
    <div
      style={{
        position: "relative",
        zIndex: 5,
        padding: "60px 22px 44px",
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ textAlign: "center", marginBottom: 8 }}>
        <div style={{ fontSize: 12, letterSpacing: ".4em", color: "var(--pine)", marginBottom: 14 }}>
          京 畿 술 都 家
        </div>
        <h1 className="serif" style={{ margin: 0, fontWeight: 800, fontSize: "clamp(26px, 7.5vw, 32px)", lineHeight: 1.34 }}>
          경기도 전통주,
          <br />
          신선처럼 즐기다
        </h1>
        <p style={{ margin: "14px 0 0", fontSize: 14, lineHeight: 1.6, color: "var(--ink-soft)" }}>
          취향에 맞는 술을 찾고, 그 술이 빚어지는
          <br />
          과정을 우리 집 AR 양조장에서 체험하세요.
        </p>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 14, margin: "30px 0" }}>
        {/* 전통주 스캔하기 */}
        <Link href="/scan" style={{ ...menuCard, color: "inherit" }}>
          <div style={iconBox}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <rect x="3" y="6" width="18" height="12" rx="2" stroke="#35597e" strokeWidth="1.8" />
              <path d="M6 9v6M9 9v6M12 9v6M15 9v6M18 9v6" stroke="#35597e" strokeWidth="1.4" />
            </svg>
          </div>
          <div style={{ flex: 1 }}>
            <div className="serif" style={{ fontWeight: 700, fontSize: 18 }}>전통주 스캔하기</div>
            <div style={{ fontSize: 12.5, color: "var(--ink-faint)", marginTop: 3 }}>
              바코드를 찍어 제품·지역·양조법 확인
            </div>
          </div>
          <Chevron />
        </Link>

        {/* 나의 전통술 취향 찾기 (주 메뉴) */}
        <Link
          href="/age"
          style={{
            ...menuCard,
            border: "1px solid rgba(53,89,126,.22)",
            background: "linear-gradient(160deg,#40679a 0%,#35597e 55%,#2e5178 100%)",
            padding: "22px 20px",
            boxShadow: "0 12px 28px rgba(46,81,120,.32)",
            color: "#fff",
          }}
        >
          <div style={{ ...iconBox, background: "rgba(255,255,255,.18)" }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path
                d="M8 3h8l-1 6a3 3 0 01-6 0L8 3zM12 12v6M8 21h8"
                stroke="#fff"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div style={{ flex: 1 }}>
            <div className="serif" style={{ fontWeight: 700, fontSize: 19 }}>나의 전통술 취향 찾기</div>
            <div style={{ fontSize: 12.5, color: "rgba(255,255,255,.82)", marginTop: 3 }}>
              술BTI · AI가 취향에 맞는 3잔 추천
            </div>
          </div>
          <Chevron color="#fff" />
        </Link>

        {/* 경기술 지도 */}
        <Link href="/map" style={{ ...menuCard, color: "inherit" }}>
          <div style={iconBox}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path d="M12 21s7-6.5 7-12a7 7 0 10-14 0c0 5.5 7 12 7 12z" stroke="#35597e" strokeWidth="1.8" />
              <circle cx="12" cy="9" r="2.5" stroke="#35597e" strokeWidth="1.8" />
            </svg>
          </div>
          <div style={{ flex: 1 }}>
            <div className="serif" style={{ fontWeight: 700, fontSize: 18 }}>경기술 지도</div>
            <div style={{ fontSize: 12.5, color: "var(--ink-faint)", marginTop: 3 }}>
              시군별 전통주·양조장·지역 원료 탐색
            </div>
          </div>
          <Chevron />
        </Link>
      </div>

      <Link
        href="/dex"
        style={{
          margin: "0 auto 14px",
          display: "flex",
          alignItems: "center",
          gap: 7,
          fontSize: 13,
          color: "var(--pine)",
        }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
          <rect x="4" y="3" width="16" height="18" rx="2" stroke="#35597e" strokeWidth="1.8" />
          <path d="M8 3v18" stroke="#35597e" strokeWidth="1.8" />
        </svg>
        내 경기술 도감 <span style={{ color: "var(--seal)", fontWeight: 700 }}>0장</span>
      </Link>
      <div style={{ textAlign: "center", fontSize: 11, color: "rgba(34,48,62,.5)" }}>
        경기도 전통주 문화·발효과학 체험 콘텐츠
      </div>
    </div>
  );
}
