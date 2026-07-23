/**
 * 동양풍 구름 문양(운문) 장식 — 배경이 많이 보이는 화면에 은은하게 깔린다.
 * 청화백자 구름 그림처럼 소용돌이 머리 + 흘러가는 꼬리 형태의 SVG를 직접 그림.
 * 색은 currentColor(쪽빛)를 쓰고 opacity로 농도만 조절한다.
 */

/** 소용돌이 머리가 있는 뭉게구름 */
function CloudSwirl({ style, opacity = 0.12 }: { style?: React.CSSProperties; opacity?: number }) {
  return (
    <svg className="cloud-deco" viewBox="0 0 260 130" style={style} aria-hidden>
      {/* 구름 몸통 */}
      <path
        d="M28 96 C10 96 2 76 14 64 C6 48 22 32 40 37 C44 18 70 10 87 20 C98 4 128 2 141 16 C160 6 184 15 186 34 C206 31 222 45 217 63 C233 68 236 88 222 96 Z"
        fill="currentColor"
        opacity={opacity}
      />
      {/* 안쪽 소용돌이 결 */}
      <g stroke="currentColor" strokeWidth="5" strokeLinecap="round" fill="none" opacity={opacity * 0.9}>
        <path d="M63 66 c-4 -16 14 -27 27 -18 c10 7 6 24 -8 25" />
        <path d="M128 58 c-1 -14 15 -21 25 -12 c8 8 3 21 -9 21" />
        <path d="M176 66 c1 -10 12 -14 19 -8" />
      </g>
      {/* 흘러가는 꼬리 */}
      <path
        d="M220 84 c16 3 30 -1 40 -12"
        stroke="currentColor"
        strokeWidth="9"
        strokeLinecap="round"
        fill="none"
        opacity={opacity}
      />
    </svg>
  );
}

/** 가늘게 흘러가는 구름 띠 */
function CloudStream({ style, opacity = 0.12 }: { style?: React.CSSProperties; opacity?: number }) {
  return (
    <svg className="cloud-deco" viewBox="0 0 300 70" style={style} aria-hidden>
      <g stroke="currentColor" strokeLinecap="round" fill="none" opacity={opacity}>
        <path d="M8 42 c30 -20 62 -22 92 -10 c26 10 58 10 84 -2 c34 -15 74 -12 108 6" strokeWidth="11" />
        <path d="M36 56 c22 -10 44 -12 66 -6" strokeWidth="7" />
        <path d="M196 56 c24 -8 48 -8 70 0" strokeWidth="7" />
      </g>
      {/* 작은 소용돌이 머리 */}
      <path
        d="M120 34 c-2 -12 12 -19 21 -11 c7 7 3 18 -7 18"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
        fill="none"
        opacity={opacity * 0.9}
      />
    </svg>
  );
}

/** 화면 배경에 까는 구름 세트 (콘텐츠 뒤, zIndex 1) */
export default function CloudDeco() {
  return (
    <>
      <CloudSwirl style={{ right: -46, top: 84, width: 220, animation: "mistdrift 16s ease-in-out infinite" }} />
      <CloudStream
        style={{ left: -30, top: 320, width: 250, animation: "mistdrift 20s ease-in-out infinite reverse" }}
      />
      <CloudSwirl
        style={{ left: -58, bottom: 130, width: 240, transform: "scaleX(-1)", animation: "mistdrift 18s ease-in-out infinite" }}
        opacity={0.1}
      />
      <CloudStream style={{ right: -36, bottom: 48, width: 230, animation: "mistdrift 22s ease-in-out infinite reverse" }} opacity={0.1} />
    </>
  );
}
