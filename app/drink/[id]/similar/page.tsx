"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import AppImage from "@/components/AppImage";
import ScreenHeader from "@/components/ScreenHeader";
import db from "@/data/drinks.json";
import type { Drink, SimilarResponse } from "@/lib/types";

/**
 * 비슷한 술 추천 — 상세의 '비슷한 술' 버튼에서 진입.
 * 진입 시 /api/similar 를 호출해 AI가 닮은 술 4종을 고르는 동안 스피너를 보여준다.
 */

const drinks = db.drinks as unknown as Drink[];

/** 이름 뒤 조사 (과/와) */
function particle(name: string): string {
  const last = name.charCodeAt(name.length - 1);
  if (last < 0xac00 || last > 0xd7a3) return "와";
  return (last - 0xac00) % 28 !== 0 ? "과" : "와";
}

export default function SimilarPage() {
  const { id } = useParams<{ id: string }>();
  const target = drinks.find((d) => d.id === id);
  const name = target?.name ?? "이 술";
  const [data, setData] = useState<SimilarResponse | null>(null);

  useEffect(() => {
    let alive = true;
    const cacheKey = `similar:${id}`;

    // 이미 찾아둔 결과가 있으면 다시 AI를 호출하지 않고 그대로 보여준다
    // (상세 → 뒤로가기로 돌아왔을 때 재검색 방지)
    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        setData(JSON.parse(cached) as SimilarResponse);
        return;
      }
    } catch {
      /* 캐시 사용 불가 시 새로 호출 */
    }

    fetch("/api/similar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    })
      .then((r) => r.json())
      .then((d: SimilarResponse) => {
        if (!alive) return;
        try {
          sessionStorage.setItem(cacheKey, JSON.stringify(d));
        } catch {
          /* 저장 실패 무시 */
        }
        setData(d);
      })
      .catch(() => alive && setData({ base: { id, name }, items: [], fallback: true }));
    return () => {
      alive = false;
    };
  }, [id, name]);

  /* ── 로딩 (술BTI 분석 화면과 동일 스타일) ── */
  if (!data) {
    return (
      <div
        style={{
          position: "relative",
          zIndex: 5,
          minHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          textAlign: "center",
          padding: "60px 22px",
        }}
      >
        <div
          style={{
            width: 96,
            height: 96,
            borderRadius: "50%",
            border: "3px solid rgba(166,124,62,.2)",
            borderTopColor: "var(--gold-deep)",
            animation: "spin 1s linear infinite",
            marginBottom: 30,
          }}
        />
        <h1 className="serif" style={{ margin: "0 0 10px", fontWeight: 800, fontSize: 23, color: "var(--ink)" }}>
          비슷한 술을 찾는 중…
        </h1>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: "var(--ink-soft)" }}>
          {name}의 맛과 향을 기준으로
          <br />
          닮은 전통주를 고르고 있어요
        </p>
      </div>
    );
  }

  return (
    <div style={{ position: "relative", zIndex: 5, minHeight: "100dvh" }}>
      {/* backHref 없이 history back → 상세를 새로 쌓지 않아 루프가 생기지 않음 */}
      <ScreenHeader title={`${name}${particle(name)} 비슷한 술 추천`} />

      <div style={{ padding: "18px 22px 44px" }}>
        {data.items.length === 0 ? (
          <div
            style={{
              background: "var(--hanji)",
              border: "1px dashed rgba(120,95,50,.3)",
              borderRadius: 16,
              padding: "30px 20px",
              textAlign: "center",
              marginTop: 12,
            }}
          >
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.7, color: "var(--ink-faint)" }}>
              비슷한 술을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.
            </p>
          </div>
        ) : (
          <>
            <p style={{ margin: "0 0 16px", borderLeft: "3px solid var(--gold)", paddingLeft: 14, fontSize: 13.5, lineHeight: 1.6, color: "var(--ink-soft)" }}>
              AI 소믈리에가 맛·향·주종을 견줘 <b>닮은 술</b>을 골랐어요.
              {data.fallback && <span style={{ display: "block", marginTop: 3, color: "var(--ink-faint)", fontSize: 12 }}>(지금은 규칙 기반 유사도 — AI 연동 시 이유가 더 정교해져요)</span>}
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {data.items.map((it) => (
                <Link
                  key={it.id}
                  href={`/drink/${it.id}`}
                  className="card"
                  style={{ display: "block", padding: 14, borderRadius: 16, color: "inherit" }}
                >
                  <div style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 10 }}>
                    {it.image ? (
                      <AppImage
                        src={it.image}
                        alt={it.name}
                        boxStyle={{ width: 52, height: 72, flexShrink: 0, borderRadius: 8, border: "1px solid rgba(120,95,50,.14)" }}
                      />
                    ) : (
                      <div className="ph-art" style={{ width: 52, height: 72, flexShrink: 0, borderRadius: 8 }} />
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="serif" style={{ fontWeight: 700, fontSize: 16, color: "var(--ink)" }}>{it.name}</div>
                      <div style={{ fontSize: 12, color: "var(--ink-faint)", marginTop: 2 }}>
                        {it.region.replace(/[시군]$/, "")} · {it.type} · {it.abv}도
                      </div>
                    </div>
                  </div>
                  <div
                    style={{
                      background: "rgba(120,95,50,.07)",
                      borderLeft: "3px solid var(--gold)",
                      borderRadius: "0 10px 10px 0",
                      padding: "10px 13px",
                    }}
                  >
                    <div style={{ fontSize: 11, color: "var(--gold-deep)", marginBottom: 4 }}>닮은 점</div>
                    <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: "var(--ink-soft)" }}>{it.reason}</p>
                  </div>
                </Link>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
