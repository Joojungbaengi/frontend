import Link from "next/link";
import ScreenHeader from "@/components/ScreenHeader";
import db from "@/data/drinks.json";

/**
 * 전통주 상세 — 스캔·추천·지도 어디서 와도 같은 화면 (기획안 7).
 * 이름·지역만 DB에서 가져오고 나머지 섹션은 전부 플레이스홀더.
 * TODO(내용 연결): drinks.json 필드(맛·향·제조·페어링·스토리)를 각 섹션에 연결.
 */

function SectionTitle({ text, red = false }: { text: string; red?: boolean }) {
  return (
    <div className="section-title" style={{ marginBottom: 12 }}>
      <span className={`bar${red ? " red" : ""}`} style={{ height: 16 }} />
      <h2 style={{ fontSize: 17 }}>{text}</h2>
    </div>
  );
}

export default async function DrinkPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const drink = db.drinks.find((d) => d.id === id);

  // 플레이스홀더 링크(/drink/placeholder 등)도 화면이 뜨도록 기본값 처리
  const name = drink?.name ?? "술 이름 자리";
  const region = drink?.region ?? "지역 자리";

  return (
    <div style={{ position: "relative", zIndex: 5 }}>
      <ScreenHeader title="전통주 상세" />

      <div style={{ padding: "6px 22px 44px" }}>
        {/* ── 제품 헤더 ── */}
        <div style={{ display: "flex", gap: 18, alignItems: "center", marginBottom: 20 }}>
          <div
            className="ph-art"
            style={{ width: 96, height: 132, flexShrink: 0, borderRadius: 12, boxShadow: "0 10px 24px rgba(63,92,82,.16)" }}
          >
            <span className="ph-label" style={{ writingMode: "vertical-rl" }}>제품 이미지</span>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: "var(--seal)", marginBottom: 4 }}>
              {region} · 양조장 이름 자리
            </div>
            <h1 className="serif" style={{ margin: "0 0 8px", fontWeight: 800, fontSize: 23, lineHeight: 1.3 }}>
              {name}
            </h1>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {["주종 자리", "도수 자리", "용량 자리"].map((t) => (
                <span
                  key={t}
                  style={{
                    fontSize: 11,
                    background: "var(--moss)",
                    color: "var(--pine)",
                    padding: "4px 10px",
                    borderRadius: 99,
                  }}
                >
                  {t}
                </span>
              ))}
            </div>
          </div>
        </div>
        <p style={{ margin: "0 0 24px", fontSize: 14, lineHeight: 1.65, color: "var(--ink-soft)" }}>
          술 한 줄 소개가 들어갈 자리예요. (플레이스홀더)
        </p>

        {/* ── 특징 ── */}
        <SectionTitle text="특징" red />
        <div className="card" style={{ padding: 16, marginBottom: 24, display: "flex", flexDirection: "column", gap: 11 }}>
          {[1, 2, 3].map((i) => (
            <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--seal)", marginTop: 8, flexShrink: 0 }} />
              <span style={{ fontSize: 14, lineHeight: 1.6, color: "var(--ink-soft)" }}>특징 {i} 자리 (플레이스홀더)</span>
            </div>
          ))}
        </div>

        {/* ── 기본 정보 ── */}
        <SectionTitle text="기본 정보" />
        <div className="card" style={{ padding: "6px 16px", marginBottom: 24 }}>
          {[
            ["원료", "원료 목록 자리"],
            ["지역 원료", "지역 특산물 자리"],
            ["주종·도수", "주종 · 도수 자리"],
          ].map(([k, v], i, arr) => (
            <div
              key={k}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 16,
                padding: "11px 0",
                borderBottom: i < arr.length - 1 ? "1px solid rgba(32,48,42,.08)" : "none",
                fontSize: 14,
              }}
            >
              <span style={{ color: "var(--ink-faint)", flexShrink: 0 }}>{k}</span>
              <span style={{ textAlign: "right" }}>{v}</span>
            </div>
          ))}
        </div>

        {/* ── 맛 게이지 ── */}
        <SectionTitle text="맛" />
        <div className="card" style={{ padding: 16, marginBottom: 24, display: "flex", flexDirection: "column", gap: 16 }}>
          {["맛 축 1", "맛 축 2", "맛 축 3"].map((label) => (
            <div key={label}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 7 }}>
                <span className="serif" style={{ fontWeight: 700, fontSize: 14 }}>{label}</span>
                <span style={{ fontSize: 12, color: "var(--pine)" }}>0 / 5</span>
              </div>
              <div style={{ height: 8, borderRadius: 99, background: "rgba(63,92,82,.13)", marginBottom: 8 }}>
                <div style={{ height: "100%", background: "var(--pine)", borderRadius: 99, width: "0%" }} />
              </div>
              <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.6, color: "#5c6b58" }}>
                맛 설명이 들어갈 자리예요. (플레이스홀더)
              </p>
            </div>
          ))}
        </div>

        {/* ── 향 ── */}
        <SectionTitle text="향" />
        <div className="card" style={{ padding: 16, marginBottom: 24 }}>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.7, color: "var(--ink-soft)" }}>
            향 설명이 들어갈 자리예요. (플레이스홀더)
          </p>
        </div>

        {/* ── 제조 방식 ── */}
        <SectionTitle text="제조 방식" />
        <div className="card" style={{ padding: 16, marginBottom: 24, display: "flex", flexDirection: "column", gap: 13 }}>
          {[1, 2, 3, 4].map((n) => (
            <div key={n} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <span
                className="serif"
                style={{
                  width: 24,
                  height: 24,
                  flexShrink: 0,
                  borderRadius: "50%",
                  background: "var(--moss)",
                  color: "var(--pine)",
                  fontWeight: 800,
                  fontSize: 12,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {n}
              </span>
              <span style={{ fontSize: 13.5, lineHeight: 1.55, color: "var(--ink-soft)", paddingTop: 2 }}>
                제조 단계 {n} 자리 (플레이스홀더)
              </span>
            </div>
          ))}
        </div>

        {/* ── 어울리는 음식 ── */}
        <SectionTitle text="어울리는 음식" />
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 24 }}>
          {["안주 1", "안주 2", "안주 3", "안주 4"].map((t) => (
            <span key={t} style={{ fontSize: 12.5, background: "#ece2cf", color: "#8a6a4a", padding: "6px 13px", borderRadius: 99 }}>
              {t}
            </span>
          ))}
        </div>

        {/* ── 역사·비하인드 ── */}
        <div style={{ background: "var(--moss)", borderRadius: 16, padding: "15px 16px", marginBottom: 26 }}>
          <div style={{ fontSize: 11, color: "var(--pine)", marginBottom: 6 }}>역사 · 비하인드</div>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.75, color: "#33443b" }}>
            양조장 이야기가 들어갈 자리예요. (플레이스홀더)
          </p>
        </div>

        {/* ── CTA ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
          <Link href={`/ar?drink=${id}`} className="btn-primary" style={{ textAlign: "center", color: "#fff" }}>
            AR 양조 체험 시작
          </Link>
          <div style={{ display: "flex", gap: 11 }}>
            <Link
              href="/map"
              className="btn-outline"
              style={{ flex: 1, textAlign: "center", color: "var(--ink)", fontSize: 14, padding: 14, borderRadius: 14 }}
            >
              지도에서 보기
            </Link>
            <button
              className="btn-outline"
              style={{ flex: 1, fontSize: 14, padding: 14, borderRadius: 14 }}
            >
              비슷한 술
            </button>
          </div>
          <div style={{ textAlign: "center", fontSize: 11, color: "rgba(32,48,42,.5)", marginTop: 2 }}>
            정보 출처: 출처 자리
          </div>
        </div>
      </div>
    </div>
  );
}
