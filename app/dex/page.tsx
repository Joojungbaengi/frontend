"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import ScreenHeader from "@/components/ScreenHeader";
import db from "@/data/drinks.json";
import { readObtained, SEED_OBTAINED } from "@/lib/dex";
import type { Drink } from "@/lib/types";

/**
 * 경기술 도감 — AR 양조 체험을 마친 술의 소장 카드가 모이는 화면 (확정 디자인).
 * 획득 목록은 localStorage("dex_obtained")에서 읽는다 (AR 완료 시 추가 예정).
 */

const drinks = db.drinks as unknown as Drink[];

/** 소장(획득) 카드 — 금선 이중 프레임 + 병 아트 */
function SoulCard({ drink }: { drink: Drink }) {
  return (
    <Link href={`/drink/${drink.id}`} style={{ color: "inherit" }}>
      <div
        style={{
          background: "linear-gradient(180deg,#fdf9ef,#f3e8d3)",
          borderRadius: 13,
          padding: 8,
          boxShadow: "0 12px 24px -10px rgba(120,95,50,.42)",
        }}
      >
        <div
          style={{
            borderRadius: 8,
            padding: 7,
            background: "#fdf9ef",
            boxShadow:
              "inset 0 0 0 1px rgba(198,165,104,.55), inset 0 0 0 3px #fdf9ef, inset 0 0 0 4px rgba(198,165,104,.28)",
          }}
        >
          {drink.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={drink.image}
              alt={drink.name}
              style={{ width: "100%", aspectRatio: "3/4", objectFit: "cover", borderRadius: 5, display: "block" }}
            />
          ) : (
            <div
              style={{
                width: "100%",
                aspectRatio: "3/4",
                borderRadius: 5,
                background: "repeating-linear-gradient(20deg,#eae1ce,#eae1ce 8px,#ded3ba 8px,#ded3ba 16px)",
              }}
            />
          )}
          <div className="serif" style={{ fontWeight: 700, fontSize: 12, color: "var(--ink)", textAlign: "center", marginTop: 8 }}>
            {drink.name}
          </div>
          <div style={{ fontSize: 9, color: "var(--ink-faint)", textAlign: "center", marginTop: 1 }}>{drink.region}</div>
        </div>
      </div>
    </Link>
  );
}

export default function DexPage() {
  const total = drinks.length;
  const [obtainedIds, setObtainedIds] = useState<string[]>(SEED_OBTAINED);

  useEffect(() => {
    setObtainedIds(readObtained());
  }, []);

  const obtained = drinks.filter((d) => obtainedIds.includes(d.id));
  const count = obtained.length;
  const pct = total > 0 ? (count / total) * 100 : 0;

  return (
    <div style={{ position: "relative", zIndex: 5, minHeight: "100dvh" }}>
      <ScreenHeader title="경기술 도감" backHref="/" />

      <div style={{ padding: "22px 22px 44px" }}>
        <p
          style={{
            margin: "0 0 16px",
            borderLeft: "3px solid var(--gold)",
            paddingLeft: 14,
            fontSize: 13,
            lineHeight: 1.6,
            color: "#6b5a3f",
          }}
        >
          AR 양조 체험을 마친 술의 카드가 모여요.
        </p>

        {/* 수집 진행도 — 얇은 금선 바 */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 22 }}>
          <div style={{ flex: 1, height: 4, borderRadius: 9, background: "rgba(120,95,50,.16)", overflow: "hidden" }}>
            <div style={{ height: "100%", borderRadius: 9, background: "linear-gradient(90deg,#c6a568,#a67c3e)", width: `${pct}%` }} />
          </div>
          <div className="serif" style={{ fontWeight: 700, fontSize: 14, color: "#8a6a2f" }}>
            {count} <span style={{ color: "var(--ink-mute)" }}>/ {total}</span>
          </div>
        </div>

        {/* 획득한 소장 카드만 표시 */}
        {count > 0 ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14 }}>
            {obtained.map((d) => (
              <SoulCard key={d.id} drink={d} />
            ))}
          </div>
        ) : (
          <div
            style={{
              background: "var(--hanji)",
              border: "1px dashed rgba(198,165,104,.5)",
              borderRadius: 16,
              padding: "30px 20px",
              textAlign: "center",
            }}
          >
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.7, color: "var(--ink-faint)" }}>
              아직 모은 카드가 없어요.
              <br />
              전통주 상세에서 <b>AR 양조 체험</b>을 완료하면 첫 소장 카드가 생겨요.
            </p>
          </div>
        )}

        {count > 0 && (
          <p style={{ margin: "22px 2px 0", fontSize: 12, lineHeight: 1.6, color: "rgba(120,95,50,.55)" }}>
            새로운 술의 <b>AR 양조 체험</b>을 완료하면 소장 카드가 더해져요.
          </p>
        )}
      </div>
    </div>
  );
}
