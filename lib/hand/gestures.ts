/**
 * 제스처 판정 — 랜드마크를 "쥐었다/폈다"로 바꾼다.
 *
 * 원시 좌표를 그대로 쓰면 손이 미세하게 떨리고 핀치 판정이 한두 프레임씩 튄다.
 * 물건을 집는 조작에서 그 튐은 곧 "잡았는데 놓쳤다"로 이어지므로 두 겹으로 막는다.
 *   1) 좌표 EMA 스무딩 — 떨림 제거
 *   2) 히스테리시스 + 연속 프레임 확인 — 경계에서 깜빡이는 것 제거
 *     (LabelScanner 의 STABLE_HITS 와 같은 생각)
 */
import { LM, type Landmark } from "@/lib/hand/types";

/** 이 값보다 좁아지면 쥔 것으로 본다 (손 크기로 나눈 비율) */
const PINCH_CLOSE = 0.35;
/** 이 값보다 벌어져야 편 것으로 본다. CLOSE 와 벌어진 만큼이 히스테리시스 폭 */
const PINCH_OPEN = 0.55;
/** 상태가 바뀌려면 이만큼 연속으로 같은 판정이 나와야 한다 */
const STABLE_FRAMES = 2;
/** 좌표 스무딩 세기 — 낮을수록 부드럽지만 손을 따라오는 게 늦다 */
const SMOOTH_ALPHA = 0.45;

function dist3(a: Landmark, b: Landmark) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.hypot(dx, dy, dz);
}

function dist2(a: Landmark, b: Landmark) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * 핀치 정도를 0~1 로 환산한다.
 * 엄지-검지 거리를 그대로 쓰면 손이 카메라에서 멀어질수록 값이 작아져 "항상 쥔 상태"가 된다.
 * 손 자체의 크기(손목~중지 뿌리)로 나눠 거리와 무관하게 만든다.
 */
export function pinchRatio(worldLandmarks: Landmark[]): number {
  const gap = dist3(worldLandmarks[LM.THUMB_TIP], worldLandmarks[LM.INDEX_TIP]);
  const span = dist3(worldLandmarks[LM.WRIST], worldLandmarks[LM.MIDDLE_MCP]);
  if (span <= 1e-6) return 0;
  return gap / span;
}

/** 비율(작을수록 쥔 것)을 0(폄)~1(쥠) 로 뒤집어 정규화한다 */
export function pinchAmount(ratio: number): number {
  const t = (PINCH_OPEN - ratio) / (PINCH_OPEN - PINCH_CLOSE);
  return Math.max(0, Math.min(1, t));
}


/** 프레임 사이에 상태를 이어가는 판정기. 손 하나당 하나씩 만든다. */
export class GestureState {
  private smoothed: Landmark[] | null = null;
  private pinching = false;
  /** 지금 후보로 세고 있는 상태와, 그게 몇 프레임 이어졌는지 */
  private candidate = false;
  private streak = 0;

  /** 손을 놓쳤을 때 — 다음에 다시 잡히면 처음부터 세도록 되돌린다 */
  reset() {
    this.smoothed = null;
    this.pinching = false;
    this.candidate = false;
    this.streak = 0;
  }

  /** 화면 정규화 랜드마크를 EMA 로 부드럽게 만든다 */
  smooth(raw: Landmark[]): Landmark[] {
    if (!this.smoothed || this.smoothed.length !== raw.length) {
      this.smoothed = raw.map((p) => ({ ...p }));
      return this.smoothed;
    }
    const a = SMOOTH_ALPHA;
    for (let i = 0; i < raw.length; i++) {
      const s = this.smoothed[i];
      s.x += (raw[i].x - s.x) * a;
      s.y += (raw[i].y - s.y) * a;
      s.z += (raw[i].z - s.z) * a;
    }
    return this.smoothed;
  }

  /**
   * 핀치 비율을 넣어 이번 프레임의 쥠 상태를 얻는다.
   * 경계(CLOSE~OPEN 사이)에서는 직전 상태를 그대로 유지해 깜빡임을 없앤다.
   */
  updatePinch(ratio: number): { pinching: boolean; justPinched: boolean; justReleased: boolean } {
    const want = ratio < PINCH_CLOSE ? true : ratio > PINCH_OPEN ? false : this.pinching;

    if (want === this.candidate) this.streak++;
    else {
      this.candidate = want;
      this.streak = 1;
    }

    let justPinched = false;
    let justReleased = false;
    if (want !== this.pinching && this.streak >= STABLE_FRAMES) {
      this.pinching = want;
      justPinched = want;
      justReleased = !want;
    }
    return { pinching: this.pinching, justPinched, justReleased };
  }

  get isPinching() {
    return this.pinching;
  }
}

/** 손목~중지 뿌리 거리(화면 정규화) — 카메라와의 거리 추정에 쓴다 */
export function screenSpan(landmarks: Landmark[]): number {
  return dist2(landmarks[LM.WRIST], landmarks[LM.MIDDLE_MCP]);
}
