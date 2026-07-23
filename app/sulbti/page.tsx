"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * 술BTI 진단 플로우: 객관식 질문 → 자유 답변 → 분석 로딩 → 결과.
 *
 * TODO(내용 연결): 질문·선택지를 material/술BTI_질문지.md 기준으로 교체하고,
 * 답변을 SurveyAnswers로 매핑해 /api/recommend 에 POST 한다.
 */
const PLACEHOLDER_QUESTIONS = [
  { q: "질문 1이 들어갈 자리예요.\n(플레이스홀더)", options: ["선택지 A", "선택지 B"] },
  { q: "질문 2가 들어갈 자리예요.\n(플레이스홀더)", options: ["선택지 A", "선택지 B", "선택지 C"] },
  { q: "질문 3이 들어갈 자리예요.\n(플레이스홀더)", options: ["선택지 A", "선택지 B"] },
];

type Phase = "quiz" | "free" | "analyzing";

export default function SulbtiPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("quiz");
  const [step, setStep] = useState(0);
  const [freeText, setFreeText] = useState("");

  const total = PLACEHOLDER_QUESTIONS.length;
  const question = PLACEHOLDER_QUESTIONS[Math.min(step, total - 1)];

  const pick = () => {
    // TODO(내용 연결): 선택한 답을 상태에 저장
    if (step < total - 1) setStep(step + 1);
    else setPhase("free");
  };

  const submit = () => {
    setPhase("analyzing");
    // TODO(내용 연결): /api/recommend 호출 후 결과 페이지로 이동 (지금은 연출만)
    setTimeout(() => router.push("/sulbti/result"), 2200);
  };

  /* ── 분석 로딩 ── */
  if (phase === "analyzing") {
    return (
      <div
        style={{
          position: "relative",
          zIndex: 5,
          padding: "60px 22px",
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          textAlign: "center",
        }}
      >
        <div
          style={{
            width: 96,
            height: 96,
            borderRadius: "50%",
            border: "3px solid rgba(181,72,47,.18)",
            borderTopColor: "var(--seal)",
            animation: "spin 1s linear infinite",
            marginBottom: 30,
          }}
        />
        <h1 className="serif" style={{ margin: "0 0 10px", fontWeight: 800, fontSize: 23 }}>
          AI가 취향을 분석 중…
        </h1>
        <p style={{ margin: "0 0 30px", fontSize: 14, lineHeight: 1.6, color: "var(--ink-soft)" }}>
          답변을 취향 축으로 정리하고
          <br />
          경기도 전통주 DB와 맞춰보고 있어요
        </p>
        <div
          style={{
            width: "100%",
            maxWidth: 280,
            background: "rgba(245,238,222,.7)",
            borderRadius: 16,
            padding: "16px 18px",
            textAlign: "left",
            fontSize: 13,
            lineHeight: 2,
            color: "var(--pine)",
          }}
        >
          {/* TODO(내용 연결): 실제 분석된 취향 축 표시 */}
          <div style={{ animation: "rise .5s .1s both" }}>· 취향 축 플레이스홀더 1</div>
          <div style={{ animation: "rise .5s .4s both" }}>· 취향 축 플레이스홀더 2</div>
          <div style={{ animation: "rise .5s .7s both" }}>· 취향 축 플레이스홀더 3</div>
          <div style={{ animation: "rise .5s 1s both" }}>· 취향 축 플레이스홀더 4</div>
        </div>
      </div>
    );
  }

  /* ── 자유 답변 ── */
  if (phase === "free") {
    return (
      <div
        style={{
          position: "relative",
          zIndex: 5,
          padding: "60px 22px 40px",
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 34 }}>
          <button className="btn-back" onClick={() => setPhase("quiz")} aria-label="뒤로가기">
            <svg width="9" height="16" viewBox="0 0 9 16">
              <path d="M8 1L1 8l7 7" stroke="#20302a" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div style={{ flex: 1, height: 8, borderRadius: 99, background: "rgba(255,255,255,.5)", overflow: "hidden" }}>
            <div style={{ height: "100%", width: "100%", background: "var(--seal)", borderRadius: 99 }} />
          </div>
          <div style={{ fontSize: 12, color: "var(--pine)" }}>마지막</div>
        </div>

        <div style={{ margin: "auto 0" }}>
          <div style={{ fontSize: 13, letterSpacing: ".14em", color: "var(--seal)", marginBottom: 14 }}>
            자유롭게 적어주세요
          </div>
          <h1 className="serif" style={{ margin: "0 0 22px", fontWeight: 800, fontSize: 25, lineHeight: 1.5 }}>
            어떤 술을 좋아하는지
            <br />
            편하게 들려주세요
          </h1>
          <textarea
            value={freeText}
            onChange={(e) => setFreeText(e.target.value)}
            placeholder="예: 너무 달고 걸쭉한 건 싫고, 음식과 편하게 마실 수 있는 술이 좋아요."
            style={{
              width: "100%",
              height: 150,
              resize: "none",
              border: "1px solid rgba(32,48,42,.14)",
              background: "var(--hanji)",
              borderRadius: 18,
              padding: 16,
              fontSize: 15,
              lineHeight: 1.7,
              color: "var(--ink)",
              fontFamily: "var(--font-gowun), sans-serif",
              boxShadow: "0 8px 18px rgba(63,92,82,.1)",
            }}
          />
          <p style={{ margin: "12px 2px 0", fontSize: 12, lineHeight: 1.5, color: "var(--pine)" }}>
            AI가 문장의 의미를 읽어 취향 축으로 정리해요. 건너뛰어도 괜찮아요.
          </p>
        </div>

        <button className="btn-primary" style={{ marginTop: "auto" }} onClick={submit}>
          내 신선 유형 분석하기
        </button>
      </div>
    );
  }

  /* ── 객관식 질문 ── */
  return (
    <div
      style={{
        position: "relative",
        zIndex: 5,
        padding: "60px 22px 40px",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 34 }}>
        <button
          className="btn-back"
          onClick={() => (step > 0 ? setStep(step - 1) : router.push("/age"))}
          aria-label="뒤로가기"
        >
          <svg width="9" height="16" viewBox="0 0 9 16">
            <path d="M8 1L1 8l7 7" stroke="#20302a" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div style={{ flex: 1, height: 8, borderRadius: 99, background: "rgba(255,255,255,.5)", overflow: "hidden" }}>
          <div
            style={{
              height: "100%",
              background: "var(--seal)",
              borderRadius: 99,
              transition: "width .3s",
              width: `${Math.round(((step + 1) / total) * 100)}%`,
            }}
          />
        </div>
        <div style={{ fontSize: 12, color: "var(--pine)" }}>
          {step + 1} / {total}
        </div>
      </div>

      <div style={{ margin: "auto 0" }}>
        <div style={{ fontSize: 13, letterSpacing: ".14em", color: "var(--seal)", marginBottom: 14 }}>
          술BTI 취향 진단
        </div>
        <h1
          className="serif"
          style={{ margin: "0 0 34px", fontWeight: 800, fontSize: 26, lineHeight: 1.5, whiteSpace: "pre-line" }}
        >
          {question.q}
        </h1>
        <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
          {question.options.map((opt) => (
            <button
              key={opt}
              onClick={pick}
              className="serif"
              style={{
                textAlign: "left",
                border: "1px solid rgba(32,48,42,.1)",
                background: "var(--hanji)",
                borderRadius: 18,
                padding: 20,
                cursor: "pointer",
                fontWeight: 700,
                fontSize: 17,
                color: "var(--ink)",
                boxShadow: "0 8px 18px rgba(63,92,82,.1)",
              }}
            >
              {opt}
            </button>
          ))}
        </div>
      </div>

      <div style={{ textAlign: "center", fontSize: 12, color: "rgba(32,48,42,.5)", marginTop: "auto" }}>
        앞선 답변에 따라 다음 질문이 달라져요
      </div>
    </div>
  );
}
