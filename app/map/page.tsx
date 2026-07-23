import Link from "next/link";
import GyeonggiMap from "@/components/GyeonggiMap";
import ScreenHeader from "@/components/ScreenHeader";
import db from "@/data/drinks.json";

/**
 * 경기술 지도 — 시군 조각을 눌러 지역별 전통주 탐색.
 * 등록 지역(붉은색)은 전통주 DB에서 자동 산출. 목록 카드 내용은 플레이스홀더.
 */

/** DB에서 지역별 등록 술 개수·대표 술 이름 산출 */
function regionCounts(): Map<string, { count: number; first: string }> {
  const counts = new Map<string, { count: number; first: string }>();
  for (const d of db.drinks) {
    const entry = counts.get(d.region);
    if (entry) entry.count += 1;
    else counts.set(d.region, { count: 1, first: d.name });
  }
  return counts;
}

export default function MapPage() {
  const counts = regionCounts();
  const activeRegions = [...counts.keys()];

  return (
    <div style={{ position: "relative", zIndex: 5, minHeight: "100vh" }}>
      <ScreenHeader
        title="경기술 지도"
        backHref="/"
        right={
          <Link href="/dex" className="btn-back" aria-label="도감">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
              <rect x="4" y="3" width="16" height="18" rx="2" stroke="#20302a" strokeWidth="1.8" />
              <path d="M8 3v18" stroke="#20302a" strokeWidth="1.8" />
            </svg>
          </Link>
        }
      />

      <div style={{ padding: "6px 22px 44px" }}>
        <h1 className="serif" style={{ margin: "0 0 6px", fontWeight: 800, fontSize: 24 }}>
          경기도 술 지도
        </h1>
        <p style={{ margin: "0 0 16px", fontSize: 13, lineHeight: 1.6, color: "var(--ink-soft)" }}>
          지도에서 지역을 눌러 그 고장의 전통주·특산주를 만나보세요. 체험을 마친 지역엔 스탬프가 찍혀요.
        </p>

        {/* 지도 (조각 클릭 → 지역 목록) */}
        <div
          style={{
            position: "relative",
            width: "100%",
            borderRadius: 20,
            overflow: "hidden",
            background: "linear-gradient(160deg,#eaf1ec,#dbe7df)",
            border: "1px solid rgba(63,92,82,.16)",
            boxShadow: "0 10px 26px rgba(63,92,82,.14)",
            marginBottom: 16,
            padding: "14px 12px",
          }}
        >
          <GyeonggiMap activeRegions={activeRegions} />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 16 }}>
          <span style={{ width: 11, height: 11, borderRadius: 3, background: "var(--seal)" }} />
          <span style={{ fontSize: 11.5, color: "var(--pine)" }}>전통주 등록 지역</span>
          <span style={{ width: 11, height: 11, borderRadius: 3, background: "#d5e1d8", marginLeft: 10 }} />
          <span style={{ fontSize: 11.5, color: "var(--pine)" }}>준비 중 (자료조사)</span>
        </div>

        <div className="serif" style={{ fontWeight: 700, fontSize: 15, marginBottom: 11 }}>
          전통주가 등록된 고장
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 11 }}>
          {[...counts.entries()].map(([region, { count, first }]) => (
            <Link
              key={region}
              href={`/map/${encodeURIComponent(region)}`}
              className="card"
              style={{ display: "block", padding: 14, borderRadius: 16, color: "inherit" }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span className="serif" style={{ fontWeight: 700, fontSize: 16 }}>{region}</span>
                <span
                  style={{
                    fontSize: 10,
                    color: "#fff",
                    background: "var(--seal)",
                    padding: "2px 8px",
                    borderRadius: 99,
                  }}
                >
                  {count}종
                </span>
              </div>
              <div style={{ fontSize: 12, color: "var(--ink-faint)", marginTop: 5 }}>{first}</div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
