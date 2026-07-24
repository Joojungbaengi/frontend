import Link from "next/link";
import { notFound } from "next/navigation";
import AppImage from "@/components/AppImage";
import ScreenHeader from "@/components/ScreenHeader";
import db from "@/data/drinks.json";
import type { Drink } from "@/lib/types";

/**
 * 전통주 상세 — material/전통주 상세 리디자인.html 기준.
 * 정보 순서: 제품 → 한 줄 요약 → 스탯 → 맛 → 향(감각 먼저) → 수상·인증 → 기본정보 → 제조(타임라인) → 음식 → 이야기 → CTA.
 */

const drinks = db.drinks as unknown as Drink[];

export function generateStaticParams() {
  return drinks.map((d) => ({ id: d.id }));
}

/** 스탯 스트립용 짧은 음용온도 — 첫 온도 표기(예: 8~12℃)만 뽑는다 */
function shortTemp(t: string): string {
  const m = t.match(/\d+\s*[~\-]\s*\d+\s*℃|\d+\s*℃/);
  if (m) return m[0].replace(/\s+/g, "");
  return t.split(/[,(（·]/)[0].trim().slice(0, 6);
}

/** 수상 이력 텍스트 → 아이콘 종류 선정 */
function awardKind(a: string): "trophy" | "medal" | "ribbon" {
  if (a.includes("명인") || a.includes("문화재") || a.includes("인증")) return "medal"; // 인증·훈장
  if (a.includes("만찬") || a.includes("정상") || a.includes("건배")) return "ribbon"; // 의전·만찬
  return "trophy"; // 표창·대상·금상·품평 등 수상
}

/** 수상·인증 아이콘 (트로피 / 훈장 메달 / 리본) */
function AwardIcon({ kind }: { kind: "trophy" | "medal" | "ribbon" }) {
  const stroke = "var(--seal)";
  if (kind === "medal") {
    // 훈장 — 리본 + 원형 메달
    return (
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M9 2l3 4 3-4" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="12" cy="15" r="6" stroke={stroke} strokeWidth="1.6" />
        <path d="M12 12.2l1 2 2.1.3-1.5 1.5.4 2.1-1.9-1-1.9 1 .4-2.1L9 14.5l2.1-.3 1-2z" fill={stroke} />
      </svg>
    );
  }
  if (kind === "ribbon") {
    // 리본 훈장
    return (
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle cx="12" cy="8" r="5.2" stroke={stroke} strokeWidth="1.6" />
        <path d="M9 12.5L7 21l5-2.6L17 21l-2-8.5" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  // 트로피
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M7 4h10v4a5 5 0 01-10 0V4z" stroke={stroke} strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M7 5H4.5v1.5A2.5 2.5 0 007 9M17 5h2.5v1.5A2.5 2.5 0 0117 9" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" />
      <path d="M12 13v3M9 20h6M10 20l.5-4h3l.5 4" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SectionHead({ text, red = false }: { text: string; red?: boolean }) {
  return (
    <div className="section-title" style={{ marginBottom: 13 }}>
      <span className={`bar${red ? " red" : ""}`} />
      <h2>{text}</h2>
    </div>
  );
}

/** 0~5 점 표시 (채워진 점 + 빈 점) */
function Pips({ value }: { value: number }) {
  const filled = Math.round(value);
  return (
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
  );
}

function TasteRow({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <span className="serif" style={{ fontSize: 14, color: "var(--ink-strong)" }}>{label}</span>
      <Pips value={value} />
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontSize: 12.5, background: "var(--sage)", color: "#3f4a35", padding: "6px 12px", borderRadius: 99 }}>
      {children}
    </span>
  );
}

export default async function DrinkPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const drink = drinks.find((d) => d.id === id);
  if (!drink) notFound();

  const abvText = drink.abv_variants ? drink.abv_variants.map((v) => `${v}도`).join(" · ") : `${drink.abv}도`;

  // 제조 타임라인 3단계 (있는 것만)
  const steps = [
    { title: "담금 방식", body: drink.brewing.method },
    { title: "빚는 과정", body: drink.brewing.detail },
    { title: "발효 · 숙성", body: drink.brewing.fermentation_days },
  ].filter((s) => s.body);

  return (
    <div style={{ position: "relative", zIndex: 5, minHeight: "100dvh" }}>
      <ScreenHeader title="전통주 상세" />

      <div style={{ padding: "22px 22px 34px", display: "flex", flexDirection: "column", gap: 26 }}>
        {/* ── 히어로 (술이름+뱃지를 사진 높이의 세로 중앙에 정렬) ── */}
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          {drink.image ? (
            <AppImage
              src={drink.image}
              alt={drink.name}
              eager
              boxStyle={{
                width: 96,
                height: 132,
                flexShrink: 0,
                borderRadius: 11,
                border: "1px solid rgba(198,165,104,.5)",
                boxShadow: "0 14px 28px -10px rgba(120,95,50,.45)",
              }}
            />
          ) : (
            <div
              className="ph-art"
              style={{ width: 96, height: 132, flexShrink: 0, borderRadius: 11, boxShadow: "0 14px 28px -10px rgba(120,95,50,.45)" }}
            >
              <span className="ph-label" style={{ writingMode: "vertical-rl" }}>제품 이미지</span>
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: "#8a6a2f", marginBottom: 6 }}>
              {drink.region} · {drink.brewery}
            </div>
            <h1 className="serif" style={{ margin: "0 0 10px", fontWeight: 800, fontSize: 26, lineHeight: 1.15, color: "var(--ink)" }}>
              {drink.name}
            </h1>
            {/* 뱃지 자리 — 없어도 높이를 유지해 이름 위치를 고정 */}
            <div style={{ minHeight: 29 }}>
              {drink.awards[0] && (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 7,
                    fontSize: 12,
                    color: "#8f3a20",
                    background: "rgba(181,72,47,.1)",
                    border: "1px solid rgba(181,72,47,.28)",
                    padding: "6px 12px",
                    borderRadius: 99,
                  }}
                >
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--seal)", flexShrink: 0 }} />
                  {drink.awards[0]}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* ── 한 줄 요약 ── */}
        <div style={{ borderLeft: "3px solid var(--gold)", padding: "2px 0 2px 14px", marginTop: -6 }}>
          <p style={{ margin: 0, font: "15px/1.65 var(--font-myeongjo), serif", color: "var(--ink-strong)" }}>
            {drink.description}
          </p>
        </div>

        {/* ── 스탯 스트립 (4등분 고정) ── */}
        <div
          className="card"
          style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", overflow: "hidden", padding: 0 }}
        >
          {[
            ["주종", drink.type],
            ["도수", `${drink.abv}도`],
            ["용량", `${drink.volume_ml}㎖`],
            ["음용", shortTemp(drink.temperature)],
          ].map(([k, v], i) => (
            <div key={k} style={{ textAlign: "center", padding: "14px 6px", borderLeft: i > 0 ? "1px solid rgba(120,95,50,.16)" : "none" }}>
              <div style={{ fontSize: 10.5, color: "var(--ink-faint)", marginBottom: 4 }}>{k}</div>
              <div className="serif" style={{ fontWeight: 700, fontSize: 15, color: "var(--ink)", lineHeight: 1.3, wordBreak: "keep-all" }}>
                {v}
              </div>
            </div>
          ))}
        </div>

        {/* ── 맛 프로필 ── */}
        <div>
          <SectionHead text="맛 프로필" />
          <div className="card" style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 13 }}>
            <TasteRow label="단맛" value={drink.sweetness} />
            <TasteRow label="산미" value={drink.acidity} />
            <TasteRow label="바디감" value={drink.body} />
            <TasteRow label="탄산" value={drink.carbonation} />
            <TasteRow label="여운" value={drink.finish_length} />
            {drink.taste_notes.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 2, paddingTop: 14, borderTop: "1px solid rgba(120,95,50,.14)" }}>
                {drink.taste_notes.map((n) => (
                  <Chip key={n}>{n}</Chip>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── 향 ── */}
        <div>
          <SectionHead text="향" />
          <div className="card" style={{ padding: "16px 18px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <span style={{ fontSize: 13, color: "var(--ink-faint)" }}>향의 강도</span>
              <span style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <Pips value={drink.aroma_intensity} />
                <span className="serif" style={{ fontWeight: 700, fontSize: 13, color: "var(--ink)" }}>
                  {drink.aroma_intensity} / 5
                </span>
              </span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
              {drink.aroma_notes.map((n) => (
                <Chip key={n}>{n}</Chip>
              ))}
            </div>
          </div>
        </div>

        {/* ── 수상 · 인증 ── */}
        {drink.awards.length > 0 && (
          <div>
            <SectionHead text="수상 · 인증" red />
            <div className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 11 }}>
              {drink.awards.map((a, i) => (
                <div key={a}>
                  {i > 0 && <div style={{ height: 1, background: "rgba(120,95,50,.12)", margin: "0 0 11px" }} />}
                  <div style={{ display: "flex", gap: 11, alignItems: "center" }}>
                    <div
                      style={{
                        width: 34,
                        height: 34,
                        flexShrink: 0,
                        borderRadius: 8,
                        border: "1.5px solid rgba(181,72,47,.5)",
                        background: "rgba(181,72,47,.06)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <AwardIcon kind={awardKind(a)} />
                    </div>
                    <div className="serif" style={{ fontSize: 14, color: "var(--ink)", lineHeight: 1.4 }}>{a}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── 기본 정보 ── */}
        <div>
          <SectionHead text="기본 정보" />
          <div className="card" style={{ padding: "4px 16px" }}>
            {[
              ["원료", drink.ingredients.join(", ")],
              ["지역 원료", drink.local_specialty],
              ["주종·도수", `${drink.type} · ${abvText}`],
              ["음용 방법", drink.temperature],
            ].map(([k, v], i, arr) => (
              <div
                key={k}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 16,
                  padding: "12px 0",
                  borderBottom: i < arr.length - 1 ? "1px solid rgba(120,95,50,.12)" : "none",
                  fontSize: 14,
                }}
              >
                <span style={{ color: "var(--ink-faint)", flexShrink: 0 }}>{k}</span>
                <span style={{ textAlign: "right", color: "var(--ink)" }}>{v}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── 제조 방식 · 세로 타임라인 ── */}
        {steps.length > 0 && (
          <div>
            <SectionHead text="제조 방식" />
            <div style={{ position: "relative", paddingLeft: 6 }}>
              {/* 연결선 */}
              <div style={{ position: "absolute", left: 20, top: 14, bottom: 14, width: 2, background: "rgba(198,165,104,.5)" }} />
              {steps.map((s, i) => (
                <div
                  key={s.title}
                  style={{ position: "relative", display: "flex", gap: 16, marginBottom: i < steps.length - 1 ? 16 : 0 }}
                >
                  <div
                    className="serif"
                    style={{
                      width: 30,
                      height: 30,
                      flexShrink: 0,
                      borderRadius: "50%",
                      background: "var(--brown)",
                      color: "var(--gold-bright)",
                      fontWeight: 800,
                      fontSize: 13,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      zIndex: 1,
                    }}
                  >
                    {i + 1}
                  </div>
                  <div style={{ paddingTop: 3 }}>
                    <div className="serif" style={{ fontWeight: 700, fontSize: 15, color: "var(--ink)", marginBottom: 3 }}>{s.title}</div>
                    <div style={{ fontSize: 13, lineHeight: 1.55, color: "var(--ink-soft)" }}>{s.body}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── 어울리는 음식 ── */}
        {drink.pairing.length > 0 && (
          <div>
            <SectionHead text="어울리는 음식" />
            <div className="card" style={{ padding: "16px 18px", display: "flex", flexWrap: "wrap", gap: 8 }}>
              {drink.pairing.map((t) => (
                <span key={t} style={{ fontSize: 13, background: "#ece2cd", color: "#8a6a4a", padding: "7px 14px", borderRadius: 99 }}>
                  {t}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* ── 역사 · 이야기 ── */}
        {drink.story && (
          <div>
            <SectionHead text="역사 · 이야기" red />
            <div
              style={{
                background: "#efe6d3",
                borderLeft: "5px solid var(--gold)",
                borderRadius: "3px 16px 16px 3px",
                padding: "18px 18px",
                boxShadow: "0 8px 20px rgba(120,95,50,.1)",
              }}
            >
              <p style={{ margin: 0, font: "14px/1.8 var(--font-myeongjo), serif", color: "var(--ink-soft)" }}>{drink.story}</p>
            </div>
          </div>
        )}

        {/* ── CTA ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 11, marginTop: 4 }}>
          <Link href={`/ar?drink=${drink.id}`} className="btn-seal" style={{ textAlign: "center", padding: 16, fontSize: 16 }}>
            AR 양조 체험 시작
          </Link>
          <div style={{ display: "flex", gap: 11 }}>
            <Link
              href={`/map/${encodeURIComponent(drink.region)}`}
              className="btn-outline"
              style={{ flex: 1, textAlign: "center" }}
            >
              지도에서 보기
            </Link>
            <Link href="/map" className="btn-outline" style={{ flex: 1, textAlign: "center" }}>
              비슷한 술
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
