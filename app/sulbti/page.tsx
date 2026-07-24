"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { QUESTIONS } from "@/data/questions";
import type { AromaType, RecommendResponse, StyleType, SurveyAnswers } from "@/lib/types";

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
function buildAnswers(picks: Pick[], customSituation?: string): SurveyAnswers {
  let answers: SurveyAnswers = {};
  QUESTIONS.forEach((question, qi) => {
    const pick = picks[qi];
    if (pick === null || pick === undefined) return;
    if (question.multi && Array.isArray(pick)) {
      const values = pick
        .map((i) => question.options[i].value)
        .filter((v): v is string => v !== undefined);
      if (question.multiField === "aromaTypes") answers = { ...answers, aromaTypes: values as AromaType[] };
      else if (question.multiField === "styles") answers = { ...answers, styles: values as StyleType[] };
    } else if (typeof pick === "number") {
      const opt = question.options[pick];
      answers = { ...answers, ...opt.patch };
      // 직접 입력 선택지 → 자연어 상황으로 저장 (AI 해석용)
      if (opt.custom && customSituation?.trim()) {
        answers = { ...answers, situationText: customSituation.trim() };
      }
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
  const [customText, setCustomText] = useState(""); // Q9 직접 입력 (확정된 값)
  const [customModalOpen, setCustomModalOpen] = useState(false);
  const [customDraft, setCustomDraft] = useState(""); // 모달 편집 중 값
  const [customIdx, setCustomIdx] = useState<number | null>(null); // 직접 입력 선택지 인덱스
  const [askDiscard, setAskDiscard] = useState(false); // 저장 안 하고 나가기 확인
  const [confirmExit, setConfirmExit] = useState(false);
  const [fading, setFading] = useState(false); // 선택 후 부드러운 전환용
  const [verified, setVerified] = useState<boolean | null>(null); // 연령 확인 통과 여부
  const touchStartX = useRef<number | null>(null);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 연령 확인(age 페이지 버튼)을 거치지 않고 직접 URL 접근하면 age로 돌려보낸다.
  useEffect(() => {
    if (sessionStorage.getItem("age_verified") === "1") {
      setVerified(true);
    } else {
      router.replace("/age");
    }
  }, [router]);

  const total = QUESTIONS.length;
  const totalQ = total + 1; // 선택형 + 마지막 자유서술 = 총 문항 수 (표시용)
  const question = QUESTIONS[Math.min(step, total - 1)];
  const currentPick = picks[step];
  const answered = question.multi
    ? Array.isArray(currentPick) && currentPick.length > 0
    : currentPick !== null && currentPick !== undefined;

  /* ── 이동 ── */
  const goPrev = () => {
    if (advanceTimer.current) { clearTimeout(advanceTimer.current); advanceTimer.current = null; }
    if (fadeTimer.current) { clearTimeout(fadeTimer.current); fadeTimer.current = null; }
    setFading(false);
    if (phase === "free") { setPhase("quiz"); setStep(total - 1); return; }
    if (step > 0) setStep(step - 1);
  };

  const goNext = () => {
    if (advanceTimer.current) { clearTimeout(advanceTimer.current); advanceTimer.current = null; }
    if (fadeTimer.current) { clearTimeout(fadeTimer.current); fadeTimer.current = null; }
    setFading(false);
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
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    if (fadeTimer.current) clearTimeout(fadeTimer.current);
    // 직접 입력 선택지는 자동 진행하지 않고 입력창을 띄운다 (다음 버튼으로 이동)
    if (question.options[idx].custom) {
      setFading(false);
      return;
    }
    // 선택 표시(테두리·체크)를 약 1초간 충분히 보여준 뒤, 페이드아웃하며 다음 질문으로
    fadeTimer.current = setTimeout(() => setFading(true), 850);
    advanceTimer.current = setTimeout(() => {
      advanceTimer.current = null;
      if (step < total - 1) setStep(step + 1);
      else setPhase("free");
      setFading(false);
    }, 1250);
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

  /* ── 직접 입력 모달 ── */
  const openCustomModal = (idx: number) => {
    setCustomIdx(idx);
    setCustomDraft(customText);
    setAskDiscard(false);
    setCustomModalOpen(true);
  };
  const closeCustomModal = () => {
    setCustomModalOpen(false);
    setAskDiscard(false);
  };
  // 저장 안 된 입력이 있으면 확인, 없으면 바로 닫기 (X·바깥·취소 공통)
  const tryCloseCustom = () => {
    if (customDraft.trim() !== customText.trim()) setAskDiscard(true);
    else closeCustomModal();
  };
  // 완료: 입력값을 확정하고 직접 입력 선택지를 선택 상태로
  const completeCustom = () => {
    const v = customDraft.trim();
    if (!v) return;
    setCustomText(v);
    if (customIdx !== null) setPicks((p) => p.map((val, i) => (i === step ? customIdx : val)));
    closeCustomModal();
  };

  /* ── 홈 이탈 확인 ── */
  const exitHome = () => setConfirmExit(true);

  /* ── 자유 답변 제출 → API 호출 → 결과 저장 → 이동 ── */
  const submit = async () => {
    const finalAnswers: SurveyAnswers = { ...buildAnswers(picks, customText), freeText: freeText.trim() || undefined };
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

  // 연령 확인 전이면 아무것도 렌더링하지 않는다 (age로 리다이렉트 중)
  if (verified !== true) return null;

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
            border: "3px solid rgba(166,124,62,.2)",
            borderTopColor: "var(--gold-deep)",
            animation: "spin 1s linear infinite",
            marginBottom: 30,
          }}
        />
        <h1 className="serif" style={{ margin: "0 0 10px", fontWeight: 800, fontSize: 23, color: "var(--ink)" }}>
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
              background: "var(--hanji)",
              border: "1px solid rgba(198,165,104,.4)",
              borderRadius: 16,
              padding: "16px 18px",
              textAlign: "left",
              fontSize: 13,
              lineHeight: 2,
              color: "var(--ink-soft)",
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
      {/* ── 상단: 헤더(홈 이탈 + 제목 + 진행 수) ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 13, marginBottom: 20 }}>
        <button className="btn-back" onClick={exitHome} aria-label="홈으로 나가기">
          <svg width="9" height="16" viewBox="0 0 9 16">
            <path d="M8 1L1 8l7 7" stroke="#3d2f1c" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="serif" style={{ flex: 1, textAlign: "center", fontWeight: 700, fontSize: 19, color: "var(--ink)" }}>
          술BTI
        </div>
        <div className="serif" style={{ minWidth: 44, textAlign: "right", letterSpacing: ".05em" }}>
          <span style={{ fontWeight: 800, fontSize: 17, color: "var(--gold-deep)" }}>
            {isFree ? String(totalQ) : String(step + 1).padStart(2, "0")}
          </span>
          <span style={{ fontSize: 13, color: "var(--ink-mute)" }}> / {totalQ}</span>
        </div>
      </div>

      {/* 진행 바 — 얇은 금선 */}
      <div style={{ height: 2, background: "rgba(120,95,50,.15)", position: "relative", marginBottom: 34 }}>
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            height: 2,
            background: "linear-gradient(90deg,#c6a568,#a67c3e)",
            transition: "width .3s",
            width: isFree ? "100%" : `${Math.round(((step + 1) / totalQ) * 100)}%`,
          }}
        />
      </div>

      {/* ── 본문 ── */}
      {isFree ? (
        <div style={{ margin: "auto 0" }}>
          <h1 className="serif quiz-q" style={{ marginBottom: 6 }}>
            마지막으로, 덧붙이고
            <br />
            싶은 말이 있나요?
          </h1>
          <p style={{ margin: "0 0 22px", fontSize: 13, lineHeight: 1.6, color: "var(--ink-faint)" }}>
            앞에서 못 담은 취향이나 마실 상황을 편하게 적어주세요. 건너뛰어도 괜찮아요.
          </p>
          <textarea
            value={freeText}
            onChange={(e) => setFreeText(e.target.value)}
            placeholder="예: 예전에 마신 텁텁한 막걸리는 별로였어요. 비 오는 날 창가에서 혼자 천천히 마실 거예요."
            style={{
              width: "100%",
              height: 150,
              resize: "none",
              border: "1px solid rgba(198,165,104,.5)",
              background: "var(--hanji)",
              borderRadius: 16,
              padding: 16,
              fontSize: 15,
              lineHeight: 1.7,
              color: "var(--ink-strong)",
              fontFamily: "var(--font-gowun), sans-serif",
              boxShadow: "0 8px 18px rgba(120,95,50,.1)",
            }}
          />
          <p style={{ margin: "12px 2px 0", fontSize: 12, lineHeight: 1.5, color: "var(--gold-deep)" }}>
            AI 소믈리에가 이 이야기를 읽고 세 잔에 반영해요.
          </p>
        </div>
      ) : (
        <div
          style={{
            margin: "auto 0",
            opacity: fading ? 0 : 1,
            transform: fading ? "translateY(8px)" : "none",
            transition: "opacity .28s ease, transform .28s ease",
          }}
        >
          <h1 className="serif quiz-q">{question.q}</h1>
          <p style={{ margin: "0 0 26px", fontSize: 13, color: "var(--ink-faint)" }}>
            {question.multi ? "여러 개 골라도 좋아요" : "가장 가까운 하나를 골라주세요"}
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
            {question.options.map((opt, idx) => {
              const selected = question.multi
                ? Array.isArray(currentPick) && currentPick.includes(idx)
                : currentPick === idx;
              return (
                <button
                  key={opt.label}
                  onClick={() => (opt.custom ? openCustomModal(idx) : question.multi ? toggleMulti(idx) : pickSingle(idx))}
                  className={`opt-btn${selected ? " selected" : ""}`}
                >
                  <span style={{ flex: 1, wordBreak: "keep-all" }}>
                    {opt.custom && customText ? `✍️ ${customText}` : opt.label}
                  </span>
                  {selected && (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path d="M5 12l5 5 9-11" stroke="#a67c3e" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
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
              <div style={{ flex: 1, textAlign: "center", fontSize: 12, color: "var(--ink-mute)", wordBreak: "keep-all" }}>
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

      {/* ── 직접 입력 모달 ── */}
      {customModalOpen && (
        <div
          onClick={tryCloseCustom}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 60,
            background: "rgba(30,22,12,.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 30,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="card"
            style={{ position: "relative", width: "100%", maxWidth: 340, padding: "24px 22px 20px", borderRadius: 22 }}
          >
            {/* X 버튼 */}
            <button
              onClick={tryCloseCustom}
              aria-label="닫기"
              style={{
                position: "absolute",
                top: 12,
                right: 12,
                width: 30,
                height: 30,
                border: "none",
                background: "transparent",
                cursor: "pointer",
                color: "var(--ink-faint)",
                fontSize: 17,
                lineHeight: 1,
              }}
            >
              ✕
            </button>

            {askDiscard ? (
              <div style={{ textAlign: "center", paddingTop: 6 }}>
                <h2 className="serif" style={{ margin: "0 0 8px", fontWeight: 800, fontSize: 17, color: "var(--ink)", wordBreak: "keep-all" }}>
                  입력한 내용이 저장되지 않았어요
                </h2>
                <p style={{ margin: "0 0 18px", fontSize: 13, lineHeight: 1.6, color: "var(--ink-faint)", wordBreak: "keep-all" }}>
                  저장하려면 <b>완료</b>를 눌러주세요. 그냥 나가시겠어요?
                </p>
                <div style={{ display: "flex", gap: 10 }}>
                  <button className="btn-outline" style={{ flex: 1, padding: 13 }} onClick={() => setAskDiscard(false)}>
                    계속 입력
                  </button>
                  <button className="btn-primary" style={{ flex: 1, padding: 13, fontSize: 14 }} onClick={closeCustomModal}>
                    나가기
                  </button>
                </div>
              </div>
            ) : (
              <>
                <h2 className="serif" style={{ margin: "0 0 4px", fontWeight: 800, fontSize: 18, color: "var(--ink)", paddingRight: 24 }}>
                  상황을 직접 적어주세요
                </h2>
                <p style={{ margin: "0 0 14px", fontSize: 12.5, color: "var(--ink-faint)" }}>
                  누구와, 어디서 마실지 자유롭게요
                </p>
                <textarea
                  value={customDraft}
                  onChange={(e) => setCustomDraft(e.target.value)}
                  autoFocus
                  placeholder="예: 회사 동료들과 회식 자리에서"
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    height: 92,
                    resize: "none",
                    border: "1px solid rgba(198,165,104,.55)",
                    background: "var(--hanji-bright)",
                    borderRadius: 14,
                    padding: "12px 14px",
                    fontSize: 15,
                    lineHeight: 1.6,
                    color: "var(--ink-strong)",
                    fontFamily: "var(--font-gowun), sans-serif",
                  }}
                />
                <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                  <button className="btn-outline" style={{ flex: 1, padding: 13 }} onClick={tryCloseCustom}>
                    취소
                  </button>
                  <button
                    className="btn-primary"
                    style={{ flex: 1, padding: 13, fontSize: 14, opacity: customDraft.trim() ? 1 : 0.5 }}
                    disabled={!customDraft.trim()}
                    onClick={completeCustom}
                  >
                    완료
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── 홈 이탈 확인 모달 ── */}
      {confirmExit && (
        <div
          onClick={() => setConfirmExit(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 60,
            background: "rgba(30,22,12,.5)",
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
            <h2 className="serif" style={{ margin: "0 0 8px", fontWeight: 800, fontSize: 18, wordBreak: "keep-all", color: "var(--ink)" }}>
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
