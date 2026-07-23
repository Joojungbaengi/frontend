/**
 * 족자 — 위아래 족자봉 사이로 한지가 펼쳐지는(unfurl) 연출.
 * 술BTI 결과 화면의 신선 유형 카드에 사용.
 */
export default function HangingScroll({
  children,
  seal,
}: {
  children: React.ReactNode;
  /** 우하단 낙관(도장) 텍스트 — 2글자씩 줄바꿈 권장 */
  seal?: React.ReactNode;
}) {
  return (
    <div>
      {/* 매다는 끈 */}
      <div style={{ display: "flex", justifyContent: "center" }}>
        <div style={{ width: 1, height: 20, background: "rgba(34,48,62,.35)" }} />
      </div>
      {/* 윗 족자봉 */}
      <div className="scroll-rod" />
      {/* 한지 (펼쳐지는 애니메이션) */}
      <div className="scroll-paper" style={{ padding: "24px 18px 26px" }}>
        {children}
        {seal && <div className="scroll-seal">{seal}</div>}
      </div>
      {/* 아랫 족자봉 */}
      <div className="scroll-rod bottom" />
    </div>
  );
}
