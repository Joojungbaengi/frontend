"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import HangingScroll from "@/components/HangingScroll";
import ScreenHeader from "@/components/ScreenHeader";
import type { RecommendResponse, SurveyAnswers } from "@/lib/types";

/**
 * 술BTI 결과 — 족자 + 취향 지도 + AI 추천 3잔.
 * 추천 데이터는 /sulbti 에서 sessionStorage("sulbti")에 저장한 것을 읽는다.
 * TODO(내용 연결): 신선 유형 이름·일러스트·궁합 (유형 일러스트는 후순위 작업)
 */

interface StoredResult {
  answers: SurveyAnswers;
  result: RecommendResponse;
}

const RANK_COLORS = ["#b5482f", "#3f5c52", "#8a7656"];

/** 답변으로 취향 지도 게이지(0~100) 계산 */
function gauges(answers: SurveyAnswers): { label: string; value: number }[] {
  const pct = (v: number | undefined, invert = false) => {
    if (v === undefined) return 50;
    const p = Math.round((v / 5) * 100);
    return invert ? 100 - p : p;
  };
  const abvPct = { low: 20, mid: 55, high: 90, any: 50 }[answers.abvRange ?? "any"];
  const aroma = (t: NonNullable<SurveyAnswers["aromaTypes"]>[number]) =>
    answers.aromaTypes?.includes(t) ? 80 : 30;
  return [
    { label: "산뜻함", value: pct(answers.body, true) },
    { label: "단맛", value: pct(answers.sweetness) },
    { label: "쌀 향", value: aroma("grain") },
    { label: "특산물 향", value: Math.max(aroma("fruit"), aroma("flower"), aroma("nutty")) },
    { label: "질감", value: pct(answers.body) },
    { label: "고도수", value: abvPct },
  ];
}

function Gauge({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 15 }}>
      <div style={{ width: 66, fontSize: 14, color: "var(--ink-faint)" }}>{label}</div>
      <div style={{ flex: 1, height: 9, borderRadius: 99, background: "rgba(63,92,82,.13)" }}>
        <div style={{ width: `${value}%`, height: "100%", background: "var(--pine)", borderRadius: 99 }} />
      </div>
      <div className="serif" style={{ width: 26, textAlign: "right", fontWeight: 700, fontSize: 13 }}>
        {value}
      </div>
    </div>
  );
}

export default function ResultPage() {
  const [data, setData] = useState<StoredResult | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("sulbti");
      if (raw) setData(JSON.parse(raw) as StoredResult);
    } catch {
      /* 저장된 결과 없음 */
    }
    setLoaded(true);
  }, []);

  // 진단 없이 직접 들어온 경우
  if (loaded && !data) {
    return (
      <div
        style={{
          position: "relative",
          zIndex: 5,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 22px",
          textAlign: "center",
        }}
      >
        <h1 className="serif" style={{ margin: "0 0 12px", fontWeight: 800, fontSize: 22 }}>
          아직 진단 결과가 없어요
        </h1>
        <p style={{ margin: "0 0 24px", fontSize: 14, color: "var(--ink-soft)" }}>
          술BTI 취향 진단을 먼저 진행해 주세요.
        </p>
        <Link href="/age" className="btn-primary" style={{ textAlign: "center", color: "#fff", maxWidth: 280 }}>
          술BTI 시작하기
        </Link>
      </div>
    );
  }

  const recs = data?.result.recommendations ?? [];
  const axes = data ? gauges(data.answers) : [];

  return (
    <div style={{ position: "relative", zIndex: 5 }}>
      <ScreenHeader title="술BTI 결과" backHref="/" />

      {/* ── 신선 유형 족자 (유형 이름·일러스트는 후순위 TODO) ── */}
      <div style={{ padding: "2px 22px 20px", textAlign: "center" }}>
        <div style={{ fontSize: 12, letterSpacing: ".3em", color: "var(--pine)", marginBottom: 14 }}>
          京畿 神仙 · 나의 술 취향
        </div>
        <HangingScroll
          seal={
            <>
              신선
              <br />
              유형
            </>
          }
        >
          <div style={{ display: "flex", gap: 14, textAlign: "left" }}>
            <div
              className="serif"
              style={{
                writingMode: "vertical-rl",
                fontWeight: 800,
                fontSize: 27,
                lineHeight: 1.55,
                letterSpacing: ".06em",
              }}
            >
              신선 유형 이름
              <br />
              들어갈 자리
            </div>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12 }}>
              <div className="ph-art" style={{ width: "100%", aspectRatio: "1/1.18", borderRadius: 10 }}>
                <span className="ph-label" style={{ textAlign: "center" }}>
                  수묵 신선
                  <br />
                  일러스트
                </span>
              </div>
              <span
                style={{
                  alignSelf: "flex-start",
                  fontSize: 12,
                  color: "#fff",
                  background: "var(--seal)",
                  padding: "5px 12px",
                  borderRadius: 99,
                }}
              >
                유형 00 · 플레이스홀더
              </span>
              <p style={{ margin: 0, paddingRight: 52, fontSize: 13, lineHeight: 1.6, color: "#4a4940" }}>
                유형 한 줄 소개가 들어갈 자리예요. (플레이스홀더)
              </p>
            </div>
          </div>
        </HangingScroll>
      </div>

      <div style={{ padding: "4px 20px 44px", display: "flex", flexDirection: "column", gap: 30 }}>
        {/* ── 유형 설명 (플레이스홀더 유지) ── */}
        <section>
          <div className="section-title">
            <span className="bar" />
            <h2>이런 신선입니다</h2>
          </div>
          <div className="card" style={{ padding: 18 }}>
            <p style={{ margin: 0, fontSize: 15, lineHeight: 1.75, color: "var(--ink-soft)" }}>
              유형 상세 설명이 들어갈 자리예요. 취향의 특징을 재미있게 풀어줍니다. (플레이스홀더)
            </p>
          </div>
        </section>

        {/* ── 취향 지도 (답변 기반 계산) ── */}
        <section>
          <div className="section-title">
            <span className="bar" />
            <h2>나의 취향 지도</h2>
          </div>
          <div className="card" style={{ padding: "18px 18px 8px" }}>
            {axes.map((a) => (
              <Gauge key={a.label} label={a.label} value={a.value} />
            ))}
          </div>
        </section>

        {/* ── 신선 궁합 (플레이스홀더 유지) ── */}
        <section>
          <div className="section-title">
            <span className="bar" />
            <h2>신선 궁합</h2>
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <div
              style={{
                flex: 1,
                background: "var(--moss)",
                borderRadius: 18,
                padding: "16px 14px",
                textAlign: "center",
                boxShadow: "0 8px 20px rgba(63,92,82,.1)",
              }}
            >
              <div style={{ fontSize: 11, color: "var(--pine)", marginBottom: 12 }}>잘 맞는 신선</div>
              <div className="ph-art" style={{ width: 72, height: 72, margin: "0 auto 12px", borderRadius: "50%" }}>
                <span className="ph-label">신선</span>
              </div>
              <div className="serif" style={{ fontWeight: 700, fontSize: 15, marginBottom: 5 }}>궁합 유형 자리</div>
              <div style={{ fontSize: 12, lineHeight: 1.5, color: "#5c6b58" }}>궁합 설명 자리 (플레이스홀더)</div>
            </div>
            <div
              style={{
                flex: 1,
                background: "#eee1dc",
                borderRadius: 18,
                padding: "16px 14px",
                textAlign: "center",
                boxShadow: "0 8px 20px rgba(63,92,82,.1)",
              }}
            >
              <div style={{ fontSize: 11, color: "var(--seal)", marginBottom: 12 }}>안 맞는 신선</div>
              <div className="ph-art" style={{ width: 72, height: 72, margin: "0 auto 12px", borderRadius: "50%" }}>
                <span className="ph-label">신선</span>
              </div>
              <div className="serif" style={{ fontWeight: 700, fontSize: 15, marginBottom: 5 }}>궁합 유형 자리</div>
              <div style={{ fontSize: 12, lineHeight: 1.5, color: "#8a6a60" }}>궁합 설명 자리 (플레이스홀더)</div>
            </div>
          </div>
        </section>

        {/* ── AI 추천 3잔 ── */}
        <section>
          <div className="section-title" style={{ marginBottom: 6 }}>
            <span className="bar red" />
            <h2>이 신선을 위한 3잔</h2>
          </div>
          <p style={{ margin: "0 0 16px", paddingLeft: 14, fontSize: 12.5, lineHeight: 1.55, color: "var(--pine)" }}>
            AI 소믈리에가 <b>취향에 근거해</b> 고른 술 — 탭하면 상세로 이동해요.
            {data?.result.fallback && (
              <span style={{ display: "block", marginTop: 4, color: "var(--ink-faint)" }}>
                (지금은 규칙 기반 추천 — AI 연동 시 이유가 더 정교해져요)
              </span>
            )}
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {recs.map((rec, i) => {
              const color = RANK_COLORS[i] ?? RANK_COLORS[0];
              return (
                <Link
                  key={rec.id}
                  href={`/drink/${rec.id}`}
                  className="card"
                  style={{ display: "block", padding: 16, borderRadius: 18, color: "inherit" }}
                >
                  <div style={{ display: "flex", gap: 13, alignItems: "center", marginBottom: 12 }}>
                    <div
                      className="serif"
                      style={{
                        width: 34,
                        height: 34,
                        flexShrink: 0,
                        borderRadius: 8,
                        background: color,
                        color: "#fff",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontWeight: 800,
                        fontSize: 16,
                      }}
                    >
                      {i + 1}
                    </div>
                    {rec.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={rec.image}
                        alt={rec.name}
                        style={{
                          width: 40,
                          height: 56,
                          flexShrink: 0,
                          borderRadius: 6,
                          objectFit: "cover",
                          background: "var(--hanji-bright)",
                          border: "1px solid rgba(32,48,42,.08)",
                        }}
                      />
                    ) : (
                      <div className="ph-art" style={{ width: 40, height: 56, flexShrink: 0, borderRadius: 6 }} />
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="serif" style={{ fontWeight: 700, fontSize: 16 }}>{rec.name}</div>
                      <div style={{ fontSize: 12, color: "var(--ink-faint)" }}>
                        {rec.region.replace(/[시군]$/, "")} · {rec.type} · {rec.abv}도
                      </div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div className="serif" style={{ fontWeight: 800, fontSize: 19, color: "var(--pine)" }}>
                        {rec.matchPct}%
                      </div>
                      <div style={{ fontSize: 10, color: "#8a9089" }}>취향 일치</div>
                    </div>
                  </div>
                  <div
                    style={{
                      background: "rgba(63,92,82,.07)",
                      borderLeft: `3px solid ${color}`,
                      borderRadius: "0 10px 10px 0",
                      padding: "11px 13px",
                    }}
                  >
                    <div style={{ fontSize: 11, color, marginBottom: 4 }}>AI 추천 이유</div>
                    <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: "var(--ink-soft)" }}>{rec.reason}</p>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>

        <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
          <Link
            href={recs[0] ? `/ar?drink=${recs[0].id}` : "/ar"}
            className="btn-primary"
            style={{ textAlign: "center", color: "#fff" }}
          >
            1위 술로 AR 양조 체험하기
          </Link>
          <Link href="/sulbti" className="btn-outline" style={{ textAlign: "center", color: "var(--ink)" }}>
            술BTI 다시 하기
          </Link>
        </div>
      </div>
    </div>
  );
}
