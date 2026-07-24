"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import ScreenHeader from "@/components/ScreenHeader";
import db from "@/data/drinks.json";
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

/** 미획득(잠김) 카드 — 酒 인장 자리 */
function LockedCard() {
  return (
    <div style={{ background: "#ece2ce", borderRadius: 13, padding: 8, boxShadow: "0 4px 10px rgba(120,95,50,.1)" }}>
      <div style={{ borderRadius: 8, padding: 8, background: "#e6dcc6", boxShadow: "inset 0 0 0 1px rgba(198,165,104,.28)" }}>
        <div style={{ width: "100%", aspectRatio: "3/4", borderRadius: 5, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div
            className="serif"
            style={{
              width: 34,
              height: 34,
              borderRadius: "50%",
              border: "1.5px solid rgba(181,72,47,.3)",
              color: "rgba(181,72,47,.45)",
              fontWeight: 800,
              fontSize: 15,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            酒
          </div>
        </div>
        <div style={{ fontSize: 10, color: "var(--ink-mute)", textAlign: "center", marginTop: 6 }}>미획득</div>
      </div>
    </div>
  );
}

export default function DexPage() {
  const total = drinks.length;
  const [obtained, setObtained] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      const raw = localStorage.getItem("dex_obtained");
      if (raw) setObtained(new Set(JSON.parse(raw) as string[]));
    } catch {
      /* 저장된 획득 목록 없음 */
    }
  }, []);

  const count = obtained.size;
  const pct = total > 0 ? (count / total) * 100 : 0;

  return (
    <div style={{ position: "relative", zIndex: 5, minHeight: "100dvh" }}>
      <ScreenHeader title="경기술 도감" backHref="/" />

      <div style={{ padding: "22px 22px 44px" }}>
        <p style={{ margin: "0 0 16px", fontSize: 13, lineHeight: 1.6, color: "#6b5a3f" }}>
          AR 양조 체험을 마친 술의 카드가 모여요.
        </p>

        {/* 수집 진행도 — 얇은 금선 바 */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <div style={{ flex: 1, height: 4, borderRadius: 9, background: "rgba(120,95,50,.16)", overflow: "hidden" }}>
            <div style={{ height: "100%", borderRadius: 9, background: "linear-gradient(90deg,#c6a568,#a67c3e)", width: `${pct}%` }} />
          </div>
          <div className="serif" style={{ fontWeight: 700, fontSize: 14, color: "#8a6a2f" }}>
            {count} <span style={{ color: "var(--ink-mute)" }}>/ {total}</span>
          </div>
        </div>

        {/* 카드 그리드 */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14 }}>
          {drinks.map((d) => (obtained.has(d.id) ? <SoulCard key={d.id} drink={d} /> : <LockedCard key={d.id} />))}
        </div>

        <p style={{ margin: "22px 2px 0", fontSize: 12, lineHeight: 1.6, color: "rgba(120,95,50,.55)" }}>
          잠긴 카드는 해당 술의 상세에서 <b>AR 양조 체험</b>을 완료하면 열려요.
        </p>
      </div>
    </div>
  );
}
