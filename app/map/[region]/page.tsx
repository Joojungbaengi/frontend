import Link from "next/link";
import ScreenHeader from "@/components/ScreenHeader";
import db from "@/data/drinks.json";
import type { Drink } from "@/lib/types";

/**
 * 지역 전통주 목록 — 지도 조각을 눌러 들어오는 화면.
 * drinks.json의 지역별 술 데이터를 연결.
 */

const drinks = db.drinks as unknown as Drink[];

export default async function RegionPage({ params }: { params: Promise<{ region: string }> }) {
  const { region: raw } = await params;
  const region = decodeURIComponent(raw);
  const regionDrinks = drinks.filter((d) => d.region === region);

  // 지역 원료 이야기: 해당 지역 술들의 특산물을 모아 구성
  const specialties = [...new Set(regionDrinks.map((d) => d.local_specialty))];

  return (
    <div style={{ position: "relative", zIndex: 5, minHeight: "100dvh" }}>
      <ScreenHeader title={region} backHref="/map" />

      <div style={{ padding: "24px 22px 44px" }}>
        <h1 className="serif" style={{ margin: "0 0 6px", fontWeight: 800, fontSize: 24 }}>
          {region} 전통주
        </h1>
        <p style={{ margin: "0 0 20px", fontSize: 13, lineHeight: 1.55, color: "var(--ink-soft)" }}>
          {regionDrinks.length > 0
            ? `${region}에서 빚는 전통주 ${regionDrinks.length}종이 등록되어 있어요.`
            : `${region}의 전통주 정보는 아직 준비 중이에요.`}
        </p>

        {regionDrinks.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {regionDrinks.map((d) => (
              <Link
                key={d.id}
                href={`/drink/${d.id}`}
                className="card"
                style={{ display: "flex", gap: 14, alignItems: "stretch", padding: 14, borderRadius: 16, color: "inherit" }}
              >
                {d.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={d.image}
                    alt={d.name}
                    style={{
                      width: 64,
                      height: 88,
                      flexShrink: 0,
                      borderRadius: 8,
                      objectFit: "cover",
                      background: "var(--hanji-bright)",
                      border: "1px solid rgba(120,95,50,.08)",
                    }}
                  />
                ) : (
                  <div className="ph-art" style={{ width: 58, flexShrink: 0, borderRadius: 8 }}>
                    <span className="ph-label" style={{ writingMode: "vertical-rl" }}>제품 이미지</span>
                  </div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="serif" style={{ fontWeight: 700, fontSize: 16 }}>{d.name}</div>
                  <div style={{ fontSize: 11.5, color: "var(--ink-faint)", margin: "2px 0 7px" }}>
                    {d.brewery} · {d.type} · {d.abv}도
                  </div>
                  <div style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--ink-soft)", marginBottom: 8 }}>
                    {d.description.length > 60 ? `${d.description.slice(0, 60)}…` : d.description}
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                    {d.taste_notes[0] && (
                      <span
                        style={{
                          fontSize: 10.5,
                          background: "var(--sage)",
                          color: "var(--brown)",
                          padding: "3px 9px",
                          borderRadius: 99,
                        }}
                      >
                        맛 · {d.taste_notes[0]}
                      </span>
                    )}
                    {d.aroma_notes[0] && (
                      <span
                        style={{
                          fontSize: 10.5,
                          background: "#ece2cf",
                          color: "#8a6a4a",
                          padding: "3px 9px",
                          borderRadius: 99,
                        }}
                      >
                        향 · {d.aroma_notes[0]}
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div
            style={{
              background: "var(--hanji)",
              border: "1px dashed rgba(120,95,50,.3)",
              borderRadius: 16,
              padding: "26px 18px",
              textAlign: "center",
            }}
          >
            <div className="serif" style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>
              아직 등록된 전통주가 없어요
            </div>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: "var(--ink-faint)" }}>
              이 고장의 전통주 정보는 아직 준비 중입니다.
            </p>
          </div>
        )}

        {specialties.length > 0 && (
          <div style={{ marginTop: 22, background: "var(--sage)", borderRadius: 16, padding: "15px 16px" }}>
            <div style={{ fontSize: 11, color: "var(--brown)", marginBottom: 6 }}>지역 원료 이야기</div>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.7, color: "#4a3a28" }}>
              {region}의 술은 {specialties.join(", ")}에서 태어납니다.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
