"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { QUESTIONS } from "@/data/questions";
import type { RecommendResponse, SurveyAnswers } from "@/lib/types";

/**
 * 술BTI 진단 플로우: 객관식 질문(Q1~Q10) → 자유 답변 → 분석(API 호출) → 결과.
 * 질문 데이터: data/questions.ts (material/술BTI_질문지.md 기반)
 * 결과는 sessionStorage("sulbti")에 저장하고 /sulbti/result 에서 읽는다.
 */

type Phase = "quiz" | "free" | "analyzing";

/** 로딩 화면에 보여줄 취향 축 요약 */
function summaryLines(answers: SurveyAnswers): string[] {
  const lines: string[] = [];
  if (answers.sweetness !== undefined)
    lines.push(`· 단맛 선호: ${answers.sweetness >= 4 ? "높음" : answers.sweetness >= 2 ? "보통" : "낮음"}`);
  if (answers.body !== undefined)
    lines.push(`· 질감 선호: ${answers.body >= 4 ? "묵직함" : answers.body >= 2.5 ? "중간" : "가벼움"}`);
  if (answers.carbonation)
    lines.push(`· 탄산감: ${{ high: "필수", some: "약하게", none: "없이" }[answers.carbonation]}`);
  if (answers.abvRange && answers.abvRange !== "any")
    lines.push(`· 도수: ${{ low: "저도수", mid: "중간", high: "고도수" }[answers.abvRange]}`);
  if (answers.pairing) lines.push("· 음식 궁합 중요도: 높음");
  return lines.slice(0, 4);
}

export default function SulbtiPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("quiz");
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<SurveyAnswers>({});
  const [multiPicks, setMultiPicks] = useState<Set<number>>(new Set());
  const [freeText, setFreeText] = useState("");

  const total = QUESTIONS.length;
  const question = QUESTIONS[Math.min(step, total - 1)];

  const next = () => {
    if (step < total - 1) {
      setStep(step + 1);
      setMultiPicks(new Set());
    } else {
      setPhase("free");
    }
  };

  /** 단일 선택: patch 병합 후 다음 질문 */
  const pickSingle = (patch: Partial<SurveyAnswers>) => {
    setAnswers((a) => ({ ...a, ...patch }));
    next();
  };

  /** 복수 선택(Q6): 토글 */
  const toggleMulti = (idx: number) => {
    setMultiPicks((prev) => {
      const s = new Set(prev);
      if (s.has(idx)) s.delete(idx);
      else s.add(idx);
      return s;
    });
  };

  const confirmMulti = () => {
    const aromas = [...multiPicks]
      .map((i) => question.options[i].aroma)
      .filter((a): a is NonNullable<typeof a> => a !== undefined);
    setAnswers((a) => ({ ...a, aromaTypes: aromas }));
    next();
  };

  /** 자유 답변 제출 → API 호출 → 결과 저장 → 이동 */
  const submit = async () => {
    const finalAnswers: SurveyAnswers = { ...answers, freeText: freeText.trim() || undefined };
    setAnswers(finalAnswers);
    setPhase("analyzing");

    try {
      const res = await fetch("/api/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(finalAnswers),
      });
      const data: RecommendResponse = await res.json();
      sessionStorage.setItem("sulbti", JSON.stringify({ answers: finalAnswers, result: data }));
    } catch {
      sessionStorage.removeItem("sulbti");
    }
    // 로딩 연출을 최소 2초 보여준 뒤 이동
    setTimeout(() => router.push("/sulbti/result"), 2000);
  };

  /* ── 분석 로딩 ── */
  if (phase === "analyzing") {
    const lines = summaryLines(answers);
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
        {lines.length > 0 && (
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
            {lines.map((line, i) => (
              <div key={line} style={{ animation: `rise .5s ${0.1 + i * 0.3}s both` }}>
                {line}
              </div>
            ))}
          </div>
        )}
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
          술BTI 취향 진단 · {question.topic}
        </div>
        <h1
          className="serif"
          style={{ margin: "0 0 34px", fontWeight: 800, fontSize: 24, lineHeight: 1.5, whiteSpace: "pre-line" }}
        >
          {question.q}
        </h1>
        <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
          {question.options.map((opt, idx) => {
            const selected = question.multi && multiPicks.has(idx);
            return (
              <button
                key={opt.label}
                onClick={() => (question.multi ? toggleMulti(idx) : pickSingle(opt.patch))}
                className="serif"
                style={{
                  textAlign: "left",
                  border: selected ? "2px solid var(--seal)" : "1px solid rgba(32,48,42,.1)",
                  background: selected ? "var(--hanji-bright)" : "var(--hanji)",
                  borderRadius: 18,
                  padding: "17px 20px",
                  cursor: "pointer",
                  fontWeight: 700,
                  fontSize: 16,
                  color: "var(--ink)",
                  boxShadow: "0 8px 18px rgba(63,92,82,.1)",
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
        {question.multi && (
          <button
            className="btn-primary"
            style={{ marginTop: 20, opacity: multiPicks.size === 0 ? 0.5 : 1 }}
            disabled={multiPicks.size === 0}
            onClick={confirmMulti}
          >
            {multiPicks.size > 0 ? `${multiPicks.size}개 선택 완료` : "향을 골라주세요"}
          </button>
        )}
      </div>

      <div style={{ textAlign: "center", fontSize: 12, color: "rgba(32,48,42,.5)", marginTop: "auto" }}>
        {question.multi ? "여러 개를 골라도 좋아요" : "답을 고르면 다음 질문으로 넘어가요"}
      </div>
    </div>
  );
}
