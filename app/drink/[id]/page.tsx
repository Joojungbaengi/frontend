import Link from "next/link";
import { notFound } from "next/navigation";
import ScreenHeader from "@/components/ScreenHeader";
import db from "@/data/drinks.json";
import type { Drink } from "@/lib/types";

/**
 * 전통주 상세 — 스캔·추천·지도 어디서 와도 같은 화면 (기획안 7).
 * drinks.json의 전체 필드를 연결.
 */

const drinks = db.drinks as unknown as Drink[];

export function generateStaticParams() {
  return drinks.map((d) => ({ id: d.id }));
}

function SectionTitle({ text, red = false }: { text: string; red?: boolean }) {
  return (
    <div className="section-title" style={{ marginBottom: 12 }}>
      <span className={`bar${red ? " red" : ""}`} style={{ height: 16 }} />
      <h2 style={{ fontSize: 17 }}>{text}</h2>
    </div>
  );
}

/** 스탯 스트립용 짧은 음용온도 — 첫 온도 표기(예: 8~12℃)만 뽑는다 */
function shortTemp(t: string): string {
  const m = t.match(/\d+\s*[~\-]\s*\d+\s*℃|\d+\s*℃/);
  if (m) return m[0].replace(/\s+/g, "");
  return t.split(/[,(（·]/)[0].trim().slice(0, 6);
}

/** 맛 척도 한 줄 — 0~5를 5개 점으로 표시 (확정 디자인) */
function TasteDots({ label, value }: { label: string; value: number }) {
  const filled = Math.round(value);
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <span className="serif" style={{ fontSize: 14, color: "var(--ink-strong)" }}>{label}</span>
      <span style={{ display: "flex", gap: 5 }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <i
            key={i}
            style={{
              width: 9,
              height: 9,
              borderRadius: "50%",
              display: "inline-block",
              background: i < filled ? "var(--brown)" : "rgba(120,95,50,.16)",
            }}
          />
        ))}
      </span>
    </div>
  );
}

export default async function DrinkPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const drink = drinks.find((d) => d.id === id);
  if (!drink) notFound();

  const abvText = drink.abv_variants ? drink.abv_variants.map((v) => `${v}도`).join(" · ") : `${drink.abv}도`;
  // 특징: 수상 이력 + 질감 + 입문자 참고를 모아 리스트로
  const features = [
    ...drink.awards,
    drink.texture,
    drink.beginner_friendly ? `입문자 추천 — ${drink.beginner_note}` : `입문자 참고 — ${drink.beginner_note}`,
  ].filter(Boolean);

  return (
    <div style={{ position: "relative", zIndex: 5, minHeight: "100dvh" }}>
      <ScreenHeader title="전통주 상세" />

      <div style={{ padding: "24px 22px 44px" }}>
        {/* ── 제품 헤더 ── */}
        <div style={{ display: "flex", gap: 18, alignItems: "center", marginBottom: 20 }}>
          {drink.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={drink.image}
              alt={drink.name}
              style={{
                width: 96,
                height: 132,
                flexShrink: 0,
                borderRadius: 12,
                objectFit: "cover",
                background: "var(--hanji-bright)",
                border: "1px solid rgba(120,95,50,.1)",
                boxShadow: "0 10px 24px rgba(120,95,50,.16)",
              }}
            />
          ) : (
            <div
              className="ph-art"
              style={{ width: 96, height: 132, flexShrink: 0, borderRadius: 12, boxShadow: "0 10px 24px rgba(120,95,50,.16)" }}
            >
              <span className="ph-label" style={{ writingMode: "vertical-rl" }}>제품 이미지</span>
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: "var(--pine)", marginBottom: 4 }}>
              {drink.region} · {drink.brewery}
            </div>
            <h1 className="serif" style={{ margin: "0 0 8px", fontWeight: 800, fontSize: 23, lineHeight: 1.3 }}>
              {drink.name}
            </h1>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {[drink.type, abvText, `${drink.volume_ml}ml`].map((t) => (
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
        {/* 금선 인용 — 한 줄 소개 */}
        <div style={{ borderLeft: "3px solid var(--gold)", padding: "2px 0 2px 14px", margin: "0 0 18px" }}>
          <p style={{ margin: 0, font: "15px/1.6 var(--font-myeongjo), serif", color: "var(--ink-strong)" }}>
            {drink.description}
          </p>
        </div>

        {/* ── 주종·도수·용량·온도 스탯 스트립 (4등분 고정) ── */}
        <div
          className="card"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            overflow: "hidden",
            marginBottom: 24,
            padding: 0,
          }}
        >
          {[
            ["주종", drink.type],
            ["도수", `${drink.abv}도`],
            ["용량", `${drink.volume_ml}㎖`],
            ["온도", shortTemp(drink.temperature)],
          ].map(([k, v], i) => (
            <div
              key={k}
              style={{
                textAlign: "center",
                padding: "13px 6px",
                borderLeft: i > 0 ? "1px solid rgba(120,95,50,.16)" : "none",
              }}
            >
              <div style={{ fontSize: 10.5, color: "var(--ink-faint)", marginBottom: 5 }}>{k}</div>
              <div
                className="serif"
                style={{ fontWeight: 700, fontSize: 14.5, color: "var(--ink-strong)", lineHeight: 1.3, wordBreak: "keep-all" }}
              >
                {v}
              </div>
            </div>
          ))}
        </div>

        {/* ── 특징 ── */}
        <SectionTitle text="특징" red />
        <div className="card" style={{ padding: 16, marginBottom: 24, display: "flex", flexDirection: "column", gap: 11 }}>
          {features.map((f) => (
            <div key={f} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--seal)", marginTop: 8, flexShrink: 0 }} />
              <span style={{ fontSize: 14, lineHeight: 1.6, color: "var(--ink-soft)" }}>{f}</span>
            </div>
          ))}
        </div>

        {/* ── 기본 정보 (스탯 스트립과 중복되지 않는 항목만) ── */}
        <SectionTitle text="기본 정보" />
        <div className="card" style={{ padding: "6px 16px", marginBottom: 24 }}>
          {[
            ["원료", drink.ingredients.join(", ")],
            ["지역 원료", drink.local_specialty],
            ["양조장", drink.brewery],
            ["음용 방법", drink.temperature],
          ].map(([k, v], i, arr) => (
            <div
              key={k}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 16,
                padding: "11px 0",
                borderBottom: i < arr.length - 1 ? "1px solid rgba(120,95,50,.08)" : "none",
                fontSize: 14,
              }}
            >
              <span style={{ color: "var(--ink-faint)", flexShrink: 0 }}>{k}</span>
              <span style={{ textAlign: "right" }}>{v}</span>
            </div>
          ))}
        </div>

        {/* ── 맛 프로필 (점 척도 + 맛 노트) ── */}
        <SectionTitle text="맛 프로필" />
        <div className="card" style={{ padding: 16, marginBottom: 24, display: "flex", flexDirection: "column", gap: 13 }}>
          <TasteDots label="단맛" value={drink.sweetness} />
          <TasteDots label="산미" value={drink.acidity} />
          <TasteDots label="바디감" value={drink.body} />
          <TasteDots label="탄산" value={drink.carbonation} />
          <TasteDots label="여운" value={drink.finish_length} />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6, paddingTop: 14, borderTop: "1px solid rgba(120,95,50,.14)" }}>
            {drink.taste_notes.map((n) => (
              <span
                key={n}
                style={{
                  fontSize: 12,
                  background: "var(--sage)",
                  color: "#4a3a22",
                  padding: "5px 11px",
                  borderRadius: 99,
                }}
              >
                {n}
              </span>
            ))}
          </div>
        </div>

        {/* ── 향 ── */}
        <SectionTitle text="향" />
        <div className="card" style={{ padding: 16, marginBottom: 24 }}>
          <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--pine)" }}>
            향의 강도 {drink.aroma_intensity} / 5
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {drink.aroma_notes.map((n) => (
              <span
                key={n}
                style={{
                  fontSize: 12.5,
                  background: "var(--moss)",
                  color: "var(--pine)",
                  padding: "6px 12px",
                  borderRadius: 99,
                }}
              >
                {n}
              </span>
            ))}
          </div>
        </div>

        {/* ── 제조 방식 ── */}
        <SectionTitle text="제조 방식" />
        <div className="card" style={{ padding: 16, marginBottom: 24, display: "flex", flexDirection: "column", gap: 13 }}>
          {[
            `담금 방식 — ${drink.brewing.method}`,
            drink.brewing.detail,
            `발효·숙성 기간 — ${drink.brewing.fermentation_days}`,
          ].map((t, i) => (
            <div key={t} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
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
                {i + 1}
              </span>
              <span style={{ fontSize: 13.5, lineHeight: 1.55, color: "var(--ink-soft)", paddingTop: 2 }}>{t}</span>
            </div>
          ))}
        </div>

        {/* ── 어울리는 음식 ── */}
        {drink.pairing.length > 0 && (
          <>
            <SectionTitle text="어울리는 음식" />
            <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 24 }}>
              {drink.pairing.map((t) => (
                <span key={t} style={{ fontSize: 12.5, background: "#ece2cf", color: "#8a6a4a", padding: "6px 13px", borderRadius: 99 }}>
                  {t}
                </span>
              ))}
            </div>
          </>
        )}

        {/* ── 역사·비하인드 ── */}
        <div style={{ background: "var(--moss)", borderRadius: 16, padding: "15px 16px", marginBottom: 26 }}>
          <div style={{ fontSize: 11, color: "var(--pine)", marginBottom: 6 }}>역사 · 비하인드</div>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.75, color: "#4a3a28" }}>{drink.story}</p>
        </div>

        {/* ── CTA ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
          <Link href={`/ar?drink=${drink.id}`} className="btn-primary" style={{ textAlign: "center" }}>
            AR 양조 체험 시작
          </Link>
          <div style={{ display: "flex", gap: 11 }}>
            <Link
              href={`/map/${encodeURIComponent(drink.region)}`}
              className="btn-outline"
              style={{ flex: 1, textAlign: "center", color: "var(--ink)", fontSize: 14, padding: 14, borderRadius: 14 }}
            >
              지도에서 보기
            </Link>
            <button className="btn-outline" style={{ flex: 1, fontSize: 14, padding: 14, borderRadius: 14 }}>
              비슷한 술
            </button>
          </div>
          <div style={{ textAlign: "center", fontSize: 11, color: "rgba(120,95,50,.5)", marginTop: 2 }}>
            정보 출처: {drink.brewery} · 자료조사 기반
          </div>
        </div>
      </div>
    </div>
  );
}
