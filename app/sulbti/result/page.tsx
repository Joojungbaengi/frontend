"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import AppImage from "@/components/AppImage";
import HangingScroll from "@/components/HangingScroll";
import ScreenHeader from "@/components/ScreenHeader";
import { pickSinseon, SINSEON, type Sinseon } from "@/lib/sinseon";
import type { RecommendResponse, SurveyAnswers } from "@/lib/types";

/**
 * 술BTI 결과 — 족자 + 취향 지도 + AI 추천 3잔.
 * 추천 데이터는 /sulbti 에서 sessionStorage("sulbti")에 저장한 것을 읽는다.
 * 신선 유형은 객관식 답변으로 lib/sinseon.ts 에서 판정한다.
 */

interface StoredResult {
  answers: SurveyAnswers;
  result: RecommendResponse;
}

const RANK_COLORS = ["#b5482f", "#4a3826", "#8a7656"];

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
      <div style={{ flex: 1, height: 9, borderRadius: 99, background: "rgba(120,95,50,.13)" }}>
        <div style={{ width: `${value}%`, height: "100%", background: "var(--brown)", borderRadius: 99 }} />
      </div>
      <div className="serif" style={{ width: 26, textAlign: "right", fontWeight: 700, fontSize: 13 }}>
        {value}
      </div>
    </div>
  );
}

/** 신선 궁합 카드 (잘 맞는 / 안 맞는) */
function MatchCard({
  caption,
  other,
  note,
  background,
  captionColor,
  noteColor,
}: {
  caption: string;
  other: Sinseon;
  note: string;
  background: string;
  captionColor: string;
  noteColor: string;
}) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        background,
        borderRadius: 18,
        padding: "16px 14px",
        textAlign: "center",
        boxShadow: "0 8px 20px rgba(120,95,50,.1)",
      }}
    >
      <div style={{ fontSize: 11, color: captionColor, marginBottom: 12 }}>{caption}</div>
      <AppImage
        src={other.image}
        alt={other.name}
        objectPosition="top"
        boxStyle={{
          width: 72,
          height: 72,
          margin: "0 auto 12px",
          borderRadius: "50%",
          border: "1px solid rgba(120,95,50,.15)",
        }}
      />
      <div className="serif" style={{ fontWeight: 700, fontSize: 15, lineHeight: 1.35, marginBottom: 5 }}>
        {other.name}
      </div>
      <div style={{ fontSize: 12, lineHeight: 1.5, color: noteColor }}>{note}</div>
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
          minHeight: "100dvh",
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
        <Link href="/age" className="btn-primary" style={{ textAlign: "center", maxWidth: 280 }}>
          술BTI 시작하기
        </Link>
      </div>
    );
  }

  const recs = data?.result.recommendations ?? [];
  const axes = data ? gauges(data.answers) : [];
  const sinseon = data ? pickSinseon(data.answers) : null;

  return (
    <div style={{ position: "relative", zIndex: 5, minHeight: "100dvh" }}>
      <ScreenHeader title="술BTI 결과" backHref="/" />

      {/* ── 신선 유형 족자 ── */}
      {sinseon && (
        <div style={{ padding: "2px 22px 20px", textAlign: "center" }}>
          <div style={{ fontSize: 12, letterSpacing: ".3em", color: "#a67c3e", marginBottom: 14 }}>
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
              {/* 이름이 길면 세로쓰기가 자동으로 여러 줄로 흐른다 */}
              <div
                className="serif"
                style={{
                  writingMode: "vertical-rl",
                  maxHeight: 290,
                  flexShrink: 0,
                  fontWeight: 800,
                  fontSize: 22,
                  lineHeight: 1.5,
                  letterSpacing: ".04em",
                }}
              >
                {sinseon.name}
              </div>
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 12 }}>
                <AppImage
                  src={sinseon.image}
                  alt={sinseon.name}
                  eager
                  boxStyle={{
                    width: "100%",
                    aspectRatio: "3/4",
                    borderRadius: 10,
                    border: "1px solid rgba(120,95,50,.12)",
                  }}
                />
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
                  유형 {String(sinseon.no).padStart(2, "0")} · {sinseon.axis}
                </span>
                <p style={{ margin: 0, paddingRight: 52, fontSize: 13, lineHeight: 1.6, color: "#4a4940" }}>
                  {sinseon.tagline}
                </p>
              </div>
            </div>
          </HangingScroll>
        </div>
      )}

      <div style={{ padding: "4px 22px 44px", display: "flex", flexDirection: "column", gap: 30 }}>
        {/* ── 유형 설명 ── */}
        {sinseon && (
          <section>
            <div className="section-title">
              <span className="bar" />
              <h2>이런 신선입니다</h2>
            </div>
            <div className="card" style={{ padding: 18 }}>
              <p style={{ margin: 0, fontSize: 15, lineHeight: 1.75, color: "var(--ink-soft)" }}>
                {sinseon.description}
              </p>
            </div>
          </section>
        )}

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

        {/* ── 신선 궁합 ── */}
        {sinseon && (
          <section>
            <div className="section-title">
              <span className="bar" />
              <h2>신선 궁합</h2>
            </div>
            <div style={{ display: "flex", gap: 12 }}>
              <MatchCard
                caption="잘 맞는 신선"
                other={SINSEON[sinseon.match.id]}
                note={sinseon.match.note}
                background="var(--sage)"
                captionColor="var(--brown)"
                noteColor="#6b5a3f"
              />
              <MatchCard
                caption="안 맞는 신선"
                other={SINSEON[sinseon.clash.id]}
                note={sinseon.clash.note}
                background="#efe0d8"
                captionColor="var(--seal)"
                noteColor="#8a6a4a"
              />
            </div>
          </section>
        )}

        {/* ── AI 추천 3잔 ── */}
        <section>
          <div className="section-title" style={{ marginBottom: 6 }}>
            <span className="bar red" />
            <h2>이 신선을 위한 3잔</h2>
          </div>
          <p style={{ margin: "0 0 16px", paddingLeft: 14, fontSize: 12.5, lineHeight: 1.55, color: "var(--brown)" }}>
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
                      <AppImage
                        src={rec.image}
                        alt={rec.name}
                        boxStyle={{ width: 40, height: 56, flexShrink: 0, borderRadius: 6, border: "1px solid rgba(120,95,50,.08)" }}
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
                      <div className="serif" style={{ fontWeight: 800, fontSize: 19, color: "var(--brown)" }}>
                        {rec.matchPct}%
                      </div>
                      <div style={{ fontSize: 10, color: "#a99a7f" }}>취향 일치</div>
                    </div>
                  </div>
                  <div
                    style={{
                      background: "rgba(120,95,50,.07)",
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
