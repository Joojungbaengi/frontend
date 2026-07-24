"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import GyeonggiMap from "@/components/GyeonggiMap";
import ScreenHeader from "@/components/ScreenHeader";
import db from "@/data/drinks.json";
import { readObtained, SEED_OBTAINED } from "@/lib/dex";
import type { Drink } from "@/lib/types";

/**
 * 경기술 지도 — 시군 조각을 눌러 해당 지역의 전통주를 지도 아래에서 바로 확인.
 * 등록 지역(붉은색)은 전통주 DB에서 자동 산출.
 */

const drinks = db.drinks as unknown as Drink[];

/** 지역별 등록 술 목록 */
function drinksByRegion(): Map<string, Drink[]> {
  const map = new Map<string, Drink[]>();
  for (const d of drinks) {
    const arr = map.get(d.region) ?? [];
    arr.push(d);
    map.set(d.region, arr);
  }
  return map;
}

const byRegion = drinksByRegion();
const activeRegions = [...byRegion.keys()];

/** 체험 완료(획득) 술 id 집합 → 지역 목록 */
function regionsOf(ids: string[]): string[] {
  const set = new Set(ids);
  return [...new Set(drinks.filter((d) => set.has(d.id)).map((d) => d.region))];
}

export default function MapPage() {
  const [selected, setSelected] = useState<string | null>(null);
  const [stamped, setStamped] = useState<string[]>(() => regionsOf(SEED_OBTAINED));
  const selectedDrinks = selected ? byRegion.get(selected) ?? [] : [];

  // 체험 완료한 술의 지역 → 지도에 스탬프 (localStorage 반영)
  useEffect(() => {
    setStamped(regionsOf(readObtained()));
  }, []);

  return (
    <div style={{ position: "relative", zIndex: 5, minHeight: "100dvh" }}>
      <ScreenHeader
        title="경기도 술 지도"
        backHref="/"
        right={
          <Link href="/dex" className="btn-back" aria-label="도감">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
              <rect x="4" y="3" width="16" height="18" rx="2" stroke="#3d2f1c" strokeWidth="1.8" />
              <path d="M8 3v18" stroke="#3d2f1c" strokeWidth="1.8" />
            </svg>
          </Link>
        }
      />

      <div style={{ padding: "22px 22px 44px" }}>
        <p
          style={{
            margin: "0 0 16px",
            borderLeft: "3px solid var(--gold)",
            paddingLeft: 14,
            fontSize: 14,
            lineHeight: 1.7,
            color: "var(--ink-soft)",
          }}
        >
          지도에서 지역을 눌러 그 고장의 전통주·특산주를 만나보세요. 체험을 마친 지역엔 스탬프가 찍혀요.
        </p>

        {/* 지도 (조각 클릭 → 아래에 지역 술 표시) */}
        <div
          style={{
            position: "relative",
            width: "100%",
            borderRadius: 20,
            overflow: "hidden",
            background: "linear-gradient(160deg,#efe6d3,#e2d5bd)",
            border: "1px solid rgba(198,165,104,.4)",
            boxShadow: "0 10px 26px rgba(120,95,50,.14)",
            marginBottom: 16,
            padding: "14px 12px",
          }}
        >
          <GyeonggiMap activeRegions={activeRegions} selected={selected} onSelect={setSelected} stamped={stamped} />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 20, flexWrap: "wrap" }}>
          <span style={{ width: 11, height: 11, borderRadius: 3, background: "var(--seal)" }} />
          <span style={{ fontSize: 11.5, color: "#8a6a2f" }}>전통주 등록</span>
          <span style={{ width: 11, height: 11, borderRadius: 3, background: "#d8ccb4", marginLeft: 8 }} />
          <span style={{ fontSize: 11.5, color: "#8a6a2f" }}>준비 중</span>
          <span
            className="serif"
            style={{
              marginLeft: 8,
              width: 15,
              height: 15,
              borderRadius: 4,
              background: "var(--seal)",
              color: "#fbeee5",
              fontSize: 9,
              fontWeight: 800,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              transform: "rotate(-12deg)",
            }}
          >
            印
          </span>
          <span style={{ fontSize: 11.5, color: "#8a6a2f" }}>체험 완료</span>
        </div>

        {/* 선택 지역 전통주 목록 */}
        {selected ? (
          <>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 12 }}>
              <span className="serif" style={{ fontWeight: 700, fontSize: 17, color: "var(--ink)" }}>
                {selected}
              </span>
              <span style={{ fontSize: 12.5, color: "var(--ink-faint)" }}>
                {selectedDrinks.length > 0 ? `전통주 ${selectedDrinks.length}종` : "정보 준비 중"}
              </span>
            </div>

            {selectedDrinks.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {selectedDrinks.map((d) => (
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
                          border: "1px solid rgba(120,95,50,.14)",
                        }}
                      />
                    ) : (
                      <div className="ph-art" style={{ width: 64, flexShrink: 0, borderRadius: 8 }}>
                        <span className="ph-label" style={{ writingMode: "vertical-rl" }}>제품 이미지</span>
                      </div>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="serif" style={{ fontWeight: 700, fontSize: 16, color: "var(--ink)" }}>{d.name}</div>
                      <div style={{ fontSize: 11.5, color: "var(--ink-faint)", margin: "2px 0 8px" }}>
                        {d.brewery} · {d.type} · {d.abv}도
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                        {d.taste_notes[0] && (
                          <span style={{ fontSize: 10.5, background: "var(--sage)", color: "#3f4a35", padding: "3px 9px", borderRadius: 99 }}>
                            맛 · {d.taste_notes[0]}
                          </span>
                        )}
                        {d.aroma_notes[0] && (
                          <span style={{ fontSize: 10.5, background: "#ece2cd", color: "#8a6a4a", padding: "3px 9px", borderRadius: 99 }}>
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
                  padding: "24px 18px",
                  textAlign: "center",
                }}
              >
                <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: "var(--ink-faint)" }}>
                  이 고장의 전통주 정보는 아직 준비 중입니다.
                </p>
              </div>
            )}
          </>
        ) : (
          <div
            style={{
              background: "var(--hanji)",
              border: "1px dashed rgba(198,165,104,.5)",
              borderRadius: 16,
              padding: "26px 18px",
              textAlign: "center",
            }}
          >
            <div className="serif" style={{ fontWeight: 700, fontSize: 15, color: "var(--ink)", marginBottom: 6 }}>
              지역을 눌러보세요
            </div>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: "var(--ink-faint)" }}>
              지도에서 붉은 지역을 누르면 그 고장의 전통주가 여기에 나타나요.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
