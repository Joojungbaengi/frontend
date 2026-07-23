"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { QUESTIONS } from "@/data/questions";
import type { RecommendResponse, SurveyAnswers } from "@/lib/types";

/**
 * 술BTI 진단 플로우: 객관식 질문(Q1~Q10) → 자유 답변 → 분석(API 호출) → 결과.
 * - 선택은 질문별로 저장되어 앞뒤로 이동해도 유지된다.
 * - 좌우 스와이프 / 좌우 화살표 버튼으로 이전·다음 질문 이동.
 * - 헤더 뒤로가기는 홈으로 이탈 (확인 문구 1회).
 * 결과는 sessionStorage("sulbti")에 저장하고 /sulbti/result 에서 읽는다.
 */

type Phase = "quiz" | "free" | "analyzing";
/** 질문별 선택 상태: 단일 = 옵션 인덱스, 복수(Q6) = 인덱스 배열 */
type Pick = number | number[] | null;

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

/** 질문별 선택(picks)을 SurveyAnswers로 병합 */
function buildAnswers(picks: Pick[]): SurveyAnswers {
  let answers: SurveyAnswers = {};
  QUESTIONS.forEach((question, qi) => {
    const pick = picks[qi];
    if (pick === null || pick === undefined) return;
    if (question.multi && Array.isArray(pick)) {
      const aromas = pick
        .map((i) => question.options[i].aroma)
        .filter((a): a is NonNullable<typeof a> => a !== undefined);
      answers = { ...answers, aromaTypes: aromas };
    } else if (typeof pick === "number") {
      answers = { ...answers, ...question.options[pick].patch };
    }
  });
  return answers;
}

export default function SulbtiPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("quiz");
  const [step, setStep] = useState(0);
  const [picks, setPicks] = useState<Pick[]>(() => QUESTIONS.map(() => null));
  const [freeText, setFreeText] = useState("");
  const [confirmExit, setConfirmExit] = useState(false);
  const touchStartX = useRef<number | null>(null);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const total = QUESTIONS.length;
  const question = QUESTIONS[Math.min(step, total - 1)];
  const currentPick = picks[step];
  const answered = question.multi
    ? Array.isArray(currentPick) && currentPick.length > 0
    : currentPick !== null && currentPick !== undefined;

  /* ── 이동 ── */
  const goPrev = () => {
    if (advanceTimer.current) { clearTimeout(advanceTimer.current); advanceTimer.current = null; }
    if (phase === "free") { setPhase("quiz"); setStep(total - 1); return; }
    if (step > 0) setStep(step - 1);
  };

  const goNext = () => {
    if (advanceTimer.current) { clearTimeout(advanceTimer.current); advanceTimer.current = null; }
    if (phase !== "quiz") return;
    if (!answered) return; // 현재 질문에 답해야 다음으로
    if (step < total - 1) setStep(step + 1);
    else setPhase("free");
  };

  const canPrev = phase === "free" || step > 0;
  const canNext = phase === "quiz" && answered;

  /* ── 스와이프 ── */
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (dx <= -52) goNext();
    else if (dx >= 52) goPrev();
  };

  /* ── 선택 ── */
  const pickSingle = (idx: number) => {
    setPicks((p) => p.map((v, i) => (i === step ? idx : v)));
    // 잠깐 눌린 상태를 보여준 뒤 자동으로 다음 질문으로
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    advanceTimer.current = setTimeout(() => {
      advanceTimer.current = null;
      setStep((s) => (s < total - 1 ? s + 1 : s));
      if (step >= total - 1) setPhase("free");
    }, 350);
  };

  const toggleMulti = (idx: number) => {
    setPicks((p) =>
      p.map((v, i) => {
        if (i !== step) return v;
        const arr = Array.isArray(v) ? [...v] : [];
        const at = arr.indexOf(idx);
        if (at >= 0) arr.splice(at, 1);
        else arr.push(idx);
        return arr;
      })
    );
  };

  /* ── 홈 이탈 확인 ── */
  const exitHome = () => setConfirmExit(true);

  /* ── 자유 답변 제출 → API 호출 → 결과 저장 → 이동 ── */
  const submit = async () => {
    const finalAnswers: SurveyAnswers = { ...buildAnswers(picks), freeText: freeText.trim() || undefined };
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
    const lines = summaryLines(buildAnswers(picks));
    return (
      <div
        style={{
          position: "relative",
          zIndex: 5,
          padding: "60px 22px",
          minHeight: "100dvh",
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

  const isFree = phase === "free";

  return (
    <div
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      style={{
        position: "relative",
        zIndex: 5,
        padding: "60px 22px 40px",
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* ── 상단: 홈 이탈 + 진행 바 ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 30 }}>
        <button className="btn-back" onClick={exitHome} aria-label="홈으로 나가기">
          <svg width="9" height="16" viewBox="0 0 9 16">
            <path d="M8 1L1 8l7 7" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div style={{ flex: 1, height: 8, borderRadius: 99, background: "rgba(255,255,255,.5)", overflow: "hidden" }}>
          <div
            style={{
              height: "100%",
              background: "var(--seal)",
              borderRadius: 99,
              transition: "width .3s",
              width: isFree ? "100%" : `${Math.round(((step + 1) / total) * 100)}%`,
            }}
          />
        </div>
        <div style={{ fontSize: 12, color: "var(--pine)", minWidth: 44, textAlign: "right" }}>
          {isFree ? "마지막" : `${step + 1} / ${total}`}
        </div>
      </div>

      {/* ── 본문 ── */}
      {isFree ? (
        <div style={{ margin: "auto 0" }}>
          <div style={{ fontSize: 13, letterSpacing: ".14em", color: "var(--seal)", marginBottom: 14 }}>
            자유롭게 적어주세요
          </div>
          <h1 className="serif" style={{ margin: "0 0 22px", fontWeight: 800, fontSize: 25, lineHeight: 1.5, wordBreak: "keep-all" }}>
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
      ) : (
        <div style={{ margin: "auto 0" }}>
          <div style={{ fontSize: 13, letterSpacing: ".14em", color: "var(--seal)", marginBottom: 14 }}>
            술BTI 취향 진단 · {question.topic}
          </div>
          <h1
            className="serif"
            style={{
              margin: "0 0 30px",
              fontWeight: 800,
              fontSize: 23,
              lineHeight: 1.5,
              whiteSpace: "pre-line",
              wordBreak: "keep-all",
            }}
          >
            {question.q}
          </h1>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {question.options.map((opt, idx) => {
              const selected = question.multi
                ? Array.isArray(currentPick) && currentPick.includes(idx)
                : currentPick === idx;
              return (
                <button
                  key={opt.label}
                  onClick={() => (question.multi ? toggleMulti(idx) : pickSingle(idx))}
                  className={`serif opt-btn${selected ? " selected" : ""}`}
                >
                  <span style={{ flex: 1, wordBreak: "keep-all" }}>{opt.label}</span>
                  {selected && (
                    <span className="opt-check" aria-hidden>
                      ✓
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── 하단: 이전/다음 내비게이션 ── */}
      <div style={{ marginTop: "auto", paddingTop: 22 }}>
        {isFree ? (
          <div style={{ display: "flex", gap: 11 }}>
            <button className="btn-nav" onClick={goPrev} aria-label="이전 질문">
              <svg width="9" height="16" viewBox="0 0 9 16">
                <path d="M8 1L1 8l7 7" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button className="btn-primary" style={{ flex: 1 }} onClick={submit}>
              내 신선 유형 분석하기
            </button>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
              <button className="btn-nav" onClick={goPrev} disabled={!canPrev} aria-label="이전 질문">
                <svg width="9" height="16" viewBox="0 0 9 16">
                  <path d="M8 1L1 8l7 7" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <div style={{ flex: 1, textAlign: "center", fontSize: 12, color: "rgba(32,48,42,.55)", wordBreak: "keep-all" }}>
                {question.multi
                  ? Array.isArray(currentPick) && currentPick.length > 0
                    ? `${currentPick.length}개 선택 — 다음으로 넘어가요`
                    : "여러 개를 골라도 좋아요"
                  : "답을 고르면 다음으로 · 좌우로 넘겨 이동"}
              </div>
              <button className="btn-nav" onClick={goNext} disabled={!canNext} aria-label="다음 질문">
                <svg width="9" height="16" viewBox="0 0 9 16" style={{ transform: "scaleX(-1)" }}>
                  <path d="M8 1L1 8l7 7" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          </>
        )}
      </div>

      {/* ── 홈 이탈 확인 모달 ── */}
      {confirmExit && (
        <div
          onClick={() => setConfirmExit(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 60,
            background: "rgba(20,28,34,.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 30,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="card"
            style={{ width: "100%", maxWidth: 320, padding: "26px 22px 20px", textAlign: "center", borderRadius: 22 }}
          >
            <h2 className="serif" style={{ margin: "0 0 8px", fontWeight: 800, fontSize: 18, wordBreak: "keep-all" }}>
              술BTI를 그만두고 나갈까요?
            </h2>
            <p style={{ margin: "0 0 18px", fontSize: 13, lineHeight: 1.6, color: "var(--ink-faint)", wordBreak: "keep-all" }}>
              지금까지 고른 답변은 저장되지 않아요.
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn-outline" style={{ flex: 1, padding: 13 }} onClick={() => setConfirmExit(false)}>
                계속하기
              </button>
              <button className="btn-primary" style={{ flex: 1, padding: 13, fontSize: 14 }} onClick={() => router.push("/")}>
                나가기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
