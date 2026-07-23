import Link from "next/link";
import ScreenHeader from "@/components/ScreenHeader";
import db from "@/data/drinks.json";

/**
 * 지역 전통주 목록 — 지도 조각을 눌러 들어오는 화면.
 * 술 목록은 DB의 이름만 쓰고 소개·태그는 플레이스홀더.
 */
export default async function RegionPage({ params }: { params: Promise<{ region: string }> }) {
  const { region: raw } = await params;
  const region = decodeURIComponent(raw);
  const drinks = db.drinks.filter((d) => d.region === region);

  return (
    <div style={{ position: "relative", zIndex: 5, minHeight: "100vh" }}>
      <ScreenHeader title={region} backHref="/map" />

      <div style={{ padding: "6px 22px 44px" }}>
        <h1 className="serif" style={{ margin: "0 0 6px", fontWeight: 800, fontSize: 24 }}>
          {region} 전통주
        </h1>
        {/* TODO(내용 연결): 지역 소개 문구 */}
        <p style={{ margin: "0 0 20px", fontSize: 13, lineHeight: 1.55, color: "var(--ink-soft)" }}>
          지역 소개 문구가 들어갈 자리예요. (플레이스홀더)
        </p>

        {drinks.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {drinks.map((d) => (
              <Link
                key={d.id}
                href={`/drink/${d.id}`}
                className="card"
                style={{ display: "flex", gap: 14, alignItems: "stretch", padding: 14, borderRadius: 16, color: "inherit" }}
              >
                <div className="ph-art" style={{ width: 58, flexShrink: 0, borderRadius: 8 }}>
                  <span className="ph-label" style={{ writingMode: "vertical-rl" }}>제품 이미지</span>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="serif" style={{ fontWeight: 700, fontSize: 16 }}>{d.name}</div>
                  {/* TODO(내용 연결): 주종·도수·소개·맛/향 태그 */}
                  <div style={{ fontSize: 11.5, color: "var(--ink-faint)", margin: "2px 0 7px" }}>
                    주종 · 도수 자리
                  </div>
                  <div style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--ink-soft)", marginBottom: 8 }}>
                    한 줄 소개가 들어갈 자리예요. (플레이스홀더)
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                    <span
                      style={{
                        fontSize: 10.5,
                        background: "var(--moss)",
                        color: "var(--pine)",
                        padding: "3px 9px",
                        borderRadius: 99,
                      }}
                    >
                      맛 · 자리
                    </span>
                    <span
                      style={{
                        fontSize: 10.5,
                        background: "#ece2cf",
                        color: "#8a6a4a",
                        padding: "3px 9px",
                        borderRadius: 99,
                      }}
                    >
                      향 · 자리
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div
            style={{
              background: "var(--hanji)",
              border: "1px dashed rgba(63,92,82,.3)",
              borderRadius: 16,
              padding: "26px 18px",
              textAlign: "center",
            }}
          >
            <div className="serif" style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>
              아직 등록된 전통주가 없어요
            </div>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: "var(--ink-faint)" }}>
              이 고장의 전통주는 자료조사 후 순차적으로 추가됩니다.
            </p>
          </div>
        )}

        <div style={{ marginTop: 22, background: "var(--moss)", borderRadius: 16, padding: "15px 16px" }}>
          <div style={{ fontSize: 11, color: "var(--pine)", marginBottom: 6 }}>지역 원료 이야기</div>
          {/* TODO(내용 연결): 지역 원료 스토리 */}
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.7, color: "#33443b" }}>
            지역 원료 이야기가 들어갈 자리예요. (플레이스홀더)
          </p>
        </div>
      </div>
    </div>
  );
}
