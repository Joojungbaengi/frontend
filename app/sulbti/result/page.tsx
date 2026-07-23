import Link from "next/link";
import HangingScroll from "@/components/HangingScroll";
import ScreenHeader from "@/components/ScreenHeader";

/**
 * 술BTI 결과 — 족자에 신선 유형이 펼쳐지는 화면.
 * TODO(내용 연결): 신선 유형·취향 축 점수·궁합·추천 3잔을 실제 데이터로 교체.
 */

/** 취향 축 게이지 한 줄 */
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

/** 추천 술 카드 (플레이스홀더) */
function RecCard({ rank, color }: { rank: number; color: string }) {
  return (
    <Link
      href="/drink/placeholder"
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
          {rank}
        </div>
        <div className="ph-art" style={{ width: 40, height: 56, flexShrink: 0, borderRadius: 6 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="serif" style={{ fontWeight: 700, fontSize: 16 }}>추천 술 이름 {rank}</div>
          <div style={{ fontSize: 12, color: "var(--ink-faint)" }}>지역 · 주종 · 도수</div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div className="serif" style={{ fontWeight: 800, fontSize: 19, color: "var(--pine)" }}>00%</div>
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
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: "var(--ink-soft)" }}>
          추천 이유가 들어갈 자리예요. AI가 취향과 연결해 작성합니다. (플레이스홀더)
        </p>
      </div>
    </Link>
  );
}

export default function ResultPage() {
  return (
    <div style={{ position: "relative", zIndex: 5 }}>
      <ScreenHeader title="술BTI 결과" backHref="/" />

      {/* ── 신선 유형 족자 ── */}
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
            {/* 세로쓰기 유형 이름 (플레이스홀더) */}
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
        {/* ── 유형 설명 ── */}
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

        {/* ── 취향 지도 (게이지) ── */}
        <section>
          <div className="section-title">
            <span className="bar" />
            <h2>나의 취향 지도</h2>
          </div>
          <div className="card" style={{ padding: "18px 18px 8px" }}>
            {/* TODO(내용 연결): 실제 취향 축 점수 */}
            <Gauge label="산뜻함" value={0} />
            <Gauge label="단맛" value={0} />
            <Gauge label="쌀 향" value={0} />
            <Gauge label="특산물 향" value={0} />
            <Gauge label="질감" value={0} />
            <Gauge label="고도수" value={0} />
          </div>
        </section>

        {/* ── 신선 궁합 ── */}
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
              <div
                className="ph-art"
                style={{ width: 72, height: 72, margin: "0 auto 12px", borderRadius: "50%" }}
              >
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
              <div
                className="ph-art"
                style={{ width: 72, height: 72, margin: "0 auto 12px", borderRadius: "50%" }}
              >
                <span className="ph-label">신선</span>
              </div>
              <div className="serif" style={{ fontWeight: 700, fontSize: 15, marginBottom: 5 }}>궁합 유형 자리</div>
              <div style={{ fontSize: 12, lineHeight: 1.5, color: "#8a6a60" }}>궁합 설명 자리 (플레이스홀더)</div>
            </div>
          </div>
        </section>

        {/* ── 추천 3잔 ── */}
        <section>
          <div className="section-title" style={{ marginBottom: 6 }}>
            <span className="bar red" />
            <h2>이 신선을 위한 3잔</h2>
          </div>
          <p style={{ margin: "0 0 16px", paddingLeft: 14, fontSize: 12.5, lineHeight: 1.55, color: "var(--pine)" }}>
            AI 소믈리에가 <b>취향에 근거해</b> 고른 술 — 탭하면 상세로 이동해요.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <RecCard rank={1} color="#b5482f" />
            <RecCard rank={2} color="#3f5c52" />
            <RecCard rank={3} color="#8a7656" />
          </div>
        </section>

        <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
          <Link href="/ar" className="btn-primary" style={{ textAlign: "center", color: "#fff" }}>
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
