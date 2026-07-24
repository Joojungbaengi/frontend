import Link from "next/link";

/**
 * 홈 — 확정 디자인.
 * 배경사진(public/home-bg.png) 위에 한지 그라데이션으로 하단을 덮고,
 * 옻칠 주버튼(취향 찾기) + 한지 보조카드(스캔·지도) + 도감 링크를 배치.
 */

function Chevron({ color }: { color: string }) {
  return (
    <svg width="8" height="14" viewBox="0 0 8 14">
      <path d="M1 1l6 6-6 6" stroke={color} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function HomePage() {
  return (
    <div
      style={{
        position: "relative",
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* 배경 사진 */}
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

      {/* 상단 한자 라벨 */}
      <div
        style={{
          position: "absolute",
          top: 64,
          left: 0,
          right: 0,
          textAlign: "center",
          zIndex: 20,
          textShadow: "0 2px 6px rgba(60,50,30,.35)",
        }}
      >
        <div style={{ font: "600 12px var(--font-gowun), sans-serif", letterSpacing: ".42em", color: "#5b4a2e" }}>
          京 畿 술 都 家
        </div>
      </div>

      {/* 하단 한지 페이드 */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: "62%",
          background:
            "linear-gradient(180deg,rgba(243,237,225,0) 0%,rgba(243,237,225,.55) 18%,#f3ede1 42%)",
          zIndex: 15,
        }}
      />

      {/* 하단 콘텐츠 */}
      <div style={{ position: "relative", zIndex: 20, marginTop: "auto", padding: "0 20px 30px" }}>
        <div style={{ textAlign: "center", marginBottom: 18 }}>
          <h1
            className="serif"
            style={{ margin: 0, fontWeight: 800, fontSize: "clamp(22px, 6.4vw, 25px)", lineHeight: 1.36, color: "#3d2f1c" }}
          >
            경기도 전통주,
            <br />
            신선처럼 즐기다
          </h1>
          <p style={{ margin: "9px 0 0", fontSize: 12.5, lineHeight: 1.6, color: "#6b5a3f" }}>
            취향에 맞는 술을 찾고, 빚어지는 과정을
            <br />
            AR 양조장에서 체험하세요
          </p>
        </div>

        {/* 옻칠 주버튼 — 나의 전통술 취향 찾기 */}
        <Link
          href="/age"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            background: "linear-gradient(150deg,#4a3826 0%,#382a1b 100%)",
            borderRadius: 20,
            padding: 18,
            marginBottom: 11,
            boxShadow: "0 16px 36px -16px rgba(56,42,27,.7), inset 0 1px 0 rgba(232,201,138,.35)",
            color: "#f3e6cc",
          }}
        >
          <div
            style={{
              width: 46,
              height: 46,
              flexShrink: 0,
              borderRadius: 13,
              background: "rgba(232,201,138,.16)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path
                d="M8 3h8l-1 6a3 3 0 01-6 0L8 3zM12 12v6M8 21h8"
                stroke="#e8c98a"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div style={{ flex: 1 }}>
            <div className="serif" style={{ fontWeight: 700, fontSize: 18, color: "#f6ecd6" }}>
              나의 전통술 취향 찾기
            </div>
            <div style={{ fontSize: 12, color: "#cdb98f", marginTop: 3 }}>술BTI · AI가 취향에 맞는 3잔 추천</div>
          </div>
          <Chevron color="#e8c98a" />
        </Link>

        {/* 보조 카드 2개 — 스캔 / 지도 */}
        <div style={{ display: "flex", gap: 11, marginBottom: 16 }}>
          <Link
            href="/scan"
            style={{
              flex: 1,
              background: "#f6efe0",
              borderRadius: 18,
              padding: "16px 14px",
              boxShadow: "0 10px 22px rgba(120,95,50,.14)",
              color: "#3d2f1c",
            }}
          >
            <div
              style={{
                width: 42,
                height: 42,
                borderRadius: 12,
                background: "var(--sage)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 11,
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <rect x="3" y="6" width="18" height="12" rx="2" stroke="#4a3a22" strokeWidth="1.8" />
                <path d="M6 9v6M9 9v6M12 9v6M15 9v6M18 9v6" stroke="#4a3a22" strokeWidth="1.3" />
              </svg>
            </div>
            <div className="serif" style={{ fontWeight: 700, fontSize: 15 }}>전통주 스캔</div>
            <div style={{ fontSize: 11, lineHeight: 1.4, color: "#8a7757", marginTop: 3 }}>바코드로 제품 확인</div>
          </Link>

          <Link
            href="/map"
            style={{
              flex: 1,
              background: "#f6efe0",
              borderRadius: 18,
              padding: "16px 14px",
              boxShadow: "0 10px 22px rgba(120,95,50,.14)",
              color: "#3d2f1c",
            }}
          >
            <div
              style={{
                width: 42,
                height: 42,
                borderRadius: 12,
                background: "var(--sage)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 11,
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M12 21s7-6.5 7-12a7 7 0 10-14 0c0 5.5 7 12 7 12z" stroke="#4a3a22" strokeWidth="1.8" />
                <circle cx="12" cy="9" r="2.5" stroke="#4a3a22" strokeWidth="1.8" />
              </svg>
            </div>
            <div className="serif" style={{ fontWeight: 700, fontSize: 15 }}>경기술 지도</div>
            <div style={{ fontSize: 11, lineHeight: 1.4, color: "#8a7757", marginTop: 3 }}>시군별 양조장 탐색</div>
          </Link>
        </div>

        {/* 도감 링크 */}
        <Link
          href="/dex"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 7,
            fontSize: 13,
            color: "#8f3a20",
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
            <rect x="4" y="3" width="16" height="18" rx="2" stroke="#b5482f" strokeWidth="1.8" />
            <path d="M8 3v18" stroke="#b5482f" strokeWidth="1.8" />
          </svg>
          내 경기술 도감 <b style={{ color: "#b5482f" }}>0장</b>
        </Link>
      </div>
    </div>
  );
}
