/**
 * 도감 획득 상태 — AR 양조 체험을 완료한 술 id 목록.
 * 실제로는 localStorage("dex_obtained")에 쌓이지만, AR 미완성 단계에서는
 * '이미 체험한 것처럼' 보이도록 아래 시드 목록을 기본값으로 사용한다.
 * (용인 동림청주 · 평택 천비향 약주는 AR 인식 대상이라 반드시 포함)
 */
export const SEED_OBTAINED = [
  "cheongju_yongin_dongnim", // 용인시 · 동림청주
  "yakju_pyeongtaek_cheonbihyang", // 평택시 · 천비향 약주
  "yakju_gapyeong_jatjinju", // 가평군 · 잣진주
  "soju_gimpo_munbaesul", // 김포시 · 문배술
  "takju_pocheon_gujeolcho", // 포천시 · 구절초 꽃 막걸리
];

/** 획득한 술 id 목록 — 저장된 값이 있으면 그걸, 없으면 시드를 사용 */
export function readObtained(): string[] {
  if (typeof window !== "undefined") {
    try {
      const raw = localStorage.getItem("dex_obtained");
      if (raw) {
        const arr = JSON.parse(raw) as unknown;
        if (Array.isArray(arr) && arr.length > 0) return arr as string[];
      }
    } catch {
      /* 파싱 실패 시 시드 사용 */
    }
  }
  return SEED_OBTAINED;
}
