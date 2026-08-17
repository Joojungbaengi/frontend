export const REQUIRED_FANS = 5; // 고두밥을 다 식히는 데 필요한 부채질 횟수
export const REQUIRED_RINSE_TURNS = 3; // 쌀을 다 헹구는 데 필요한 휘젓기 바퀴 수
export const SOAK_MS = 4500; // 침수 — 이만큼 가만히 두면 다 불었다고 본다
export const CONTENT_LIFT = 0.03;
// 손 추적이 필요한 단계 판정은 shouldTrackHand()(lib/hand/handStep.ts)로 이동했다.

export function platformContentY(platformTop: number) {
  return platformTop + CONTENT_LIFT;
}