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
/**
 * 주먹 판정 — 네 손가락 끝이 손바닥 중심에 얼마나 붙었나 (손 크기로 나눈 비율).
 * 활짝 편 손은 2.0 언저리, 주먹은 0.8 언저리가 나온다.
 */
const GRIP_CLOSE = 1.25;
const GRIP_OPEN = 1.6;
/** 쥠(핀치 or 주먹)으로 넘어가는 문턱과 되돌아오는 문턱 — 0(폄)~1(쥠) 기준 */
const GRASP_ON = 0.6;
const GRASP_OFF = 0.32;
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

/** 손가락 뿌리 네 개의 평균 — 손바닥 한가운데 */
function palmCenter3(w: Landmark[]): Landmark {
  return {
    x: (w[LM.INDEX_MCP].x + w[LM.MIDDLE_MCP].x + w[LM.RING_MCP].x + w[LM.PINKY_MCP].x) / 4,
    y: (w[LM.INDEX_MCP].y + w[LM.MIDDLE_MCP].y + w[LM.RING_MCP].y + w[LM.PINKY_MCP].y) / 4,
    z: (w[LM.INDEX_MCP].z + w[LM.MIDDLE_MCP].z + w[LM.RING_MCP].z + w[LM.PINKY_MCP].z) / 4,
  };
}

/**
 * 주먹 정도를 비율로 환산한다 — 네 손가락 끝에서 손바닥 중심까지의 평균 거리를
 * 손 크기(손목~중지 뿌리)로 나눈다. 핀치와 마찬가지로 카메라 거리와 무관해진다.
 */
export function gripRatio(worldLandmarks: Landmark[]): number {
  const palm = palmCenter3(worldLandmarks);
  const span = dist3(worldLandmarks[LM.WRIST], worldLandmarks[LM.MIDDLE_MCP]);
  if (span <= 1e-6) return GRIP_OPEN;
  const tips = [LM.INDEX_TIP, LM.MIDDLE_TIP, LM.RING_TIP, LM.PINKY_TIP];
  let sum = 0;
  for (const t of tips) sum += dist3(worldLandmarks[t], palm);
  return sum / tips.length / span;
}

/** 주먹 비율을 0(폄)~1(주먹) 로 뒤집어 정규화한다 */
export function gripAmount(ratio: number): number {
  const t = (GRIP_OPEN - ratio) / (GRIP_OPEN - GRIP_CLOSE);
  return Math.max(0, Math.min(1, t));
}

/**
 * "쥐었다"는 하나로 합친 값 — 핀치와 주먹 중 더 확실한 쪽을 쓴다.
 * 엄지·검지를 정확히 맞대지 않아도 손만 오므리면 잡히게 하려는 것이다.
 */
export function graspAmount(pinch: number, grip: number): number {
  return Math.max(pinch, grip);
}

/** 프레임 사이에 상태를 이어가는 판정기. 손 하나당 하나씩 만든다. */
export class GestureState {
  private smoothed: Landmark[] | null = null;
  private pinching = false;
  /** 지금 후보로 세고 있는 상태와, 그게 몇 프레임 이어졌는지 */
  private candidate = false;
  private streak = 0;
  /** 움켜쥐기(핀치 or 주먹) 쪽 판정 — 핀치와 같은 방식으로 따로 굴린다 */
  private grasping = false;
  private graspCandidate = false;
  private graspStreak = 0;

  /** 손을 놓쳤을 때 — 다음에 다시 잡히면 처음부터 세도록 되돌린다 */
  reset() {
    this.smoothed = null;
    this.pinching = false;
    this.candidate = false;
    this.streak = 0;
    this.grasping = false;
    this.graspCandidate = false;
    this.graspStreak = 0;
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

  /**
   * 움켜쥠 상태. 0(폄)~1(쥠) 로 정규화된 값을 넣는다.
   * 핀치와 같은 히스테리시스 + 연속 프레임 확인을 거쳐 깜빡임을 없앤다.
   */
  updateGrasp(amount: number): { grasping: boolean; justGrasped: boolean; justLetGo: boolean } {
    const want = amount > GRASP_ON ? true : amount < GRASP_OFF ? false : this.grasping;

    if (want === this.graspCandidate) this.graspStreak++;
    else {
      this.graspCandidate = want;
      this.graspStreak = 1;
    }

    let justGrasped = false;
    let justLetGo = false;
    if (want !== this.grasping && this.graspStreak >= STABLE_FRAMES) {
      this.grasping = want;
      justGrasped = want;
      justLetGo = !want;
    }
    return { grasping: this.grasping, justGrasped, justLetGo };
  }

  get isPinching() {
    return this.pinching;
  }
}

/** 손목~중지 뿌리 거리(화면 정규화) — 카메라와의 거리 추정에 쓴다 */
export function screenSpan(landmarks: Landmark[]): number {
  return dist2(landmarks[LM.WRIST], landmarks[LM.MIDDLE_MCP]);
}
