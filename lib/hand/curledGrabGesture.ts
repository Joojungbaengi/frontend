import * as THREE from "three";
import type { HandFrame, Landmark } from "@/lib/hand/types";

export interface CurledGrabSnapshot {
  active: boolean;
  justGrabbed: boolean;
  justReleased: boolean;
  score: number;
}

// 시작은 항아리 근처에서만 허용되므로 다소 관대하게 잡고,
// 놓기는 손을 분명히 편 상태가 이어질 때만 인정한다.
const ENGAGE_SCORE = 0.32;
const RELEASE_SCORE = 0.1;
const ENGAGE_FRAMES = 2;
const RELEASE_FRAMES = 4;
const LOST_TIMEOUT_MS = 650;

const a = new THREE.Vector3();
const b = new THREE.Vector3();

function bendScore(points: readonly Landmark[], mcp: number, pip: number, tip: number) {
  const p0 = points[mcp];
  const p1 = points[pip];
  const p2 = points[tip];
  if (!p0 || !p1 || !p2) return 0;
  a.set(p0.x - p1.x, p0.y - p1.y, p0.z - p1.z).normalize();
  b.set(p2.x - p1.x, p2.y - p1.y, p2.z - p1.z).normalize();
  const angle = Math.acos(THREE.MathUtils.clamp(a.dot(b), -1, 1));
  // 곧게 편 약 180°는 0, 자연스럽게 감싼 약 95~130°는 높은 값이다.
  return THREE.MathUtils.clamp((2.85 - angle) / 1.2, 0, 1);
}

/** 검지·중지·약지·소지가 함께 굽은 정도. 엄지-검지 pinch와 독립적이다. */
export function curledGrabScore(frame: HandFrame) {
  const points = frame.world.length >= 21 ? frame.world : frame.landmarks;
  if (!frame.present || points.length < 21) return 0;
  const scores = [
    bendScore(points, 5, 6, 8),
    bendScore(points, 9, 10, 12),
    bendScore(points, 13, 14, 16),
    bendScore(points, 17, 18, 20),
  ];
  // 새끼손가락까지 항아리를 감싼 자세여야 한다. 나머지 세 손가락은
  // 항아리 뒤에서 하나쯤 가려질 수 있으므로 그중 점수가 높은 두 개를 쓴다.
  const pinky = scores[3];
  const frontFingers = scores.slice(0, 3).sort((x, y) => y - x);
  if (pinky < 0.22 || frontFingers[1] < 0.24) return 0;
  return (pinky + frontFingers[0] + frontFingers[1]) / 3;
}

/** 저온숙성 전용 grab pose 히스테리시스. 두 검출 프레임 연속일 때만 전환한다. */
export class CurledGrabGesture {
  private activeValue = false;
  private engageFrames = 0;
  private releaseFrames = 0;
  private lastSeenAt = -Infinity;

  update(frame: HandFrame, allowed: boolean, now = performance.now()): CurledGrabSnapshot {
    let justGrabbed = false;
    let justReleased = false;
    const score = curledGrabScore(frame);

    if (!frame.present) {
      if (this.activeValue && now - this.lastSeenAt > LOST_TIMEOUT_MS) {
        this.activeValue = false;
        justReleased = true;
      }
      this.engageFrames = 0;
      return { active: this.activeValue, justGrabbed, justReleased, score: 0 };
    }
    this.lastSeenAt = now;

    if (!this.activeValue) {
      this.engageFrames = allowed && score >= ENGAGE_SCORE ? this.engageFrames + 1 : 0;
      if (this.engageFrames >= ENGAGE_FRAMES) {
        this.activeValue = true;
        this.engageFrames = 0;
        this.releaseFrames = 0;
        justGrabbed = true;
      }
    } else {
      this.releaseFrames = score <= RELEASE_SCORE ? this.releaseFrames + 1 : 0;
      if (this.releaseFrames >= RELEASE_FRAMES) {
        this.activeValue = false;
        this.releaseFrames = 0;
        justReleased = true;
      }
    }
    return { active: this.activeValue, justGrabbed, justReleased, score };
  }

  reset() {
    this.activeValue = false;
    this.engageFrames = 0;
    this.releaseFrames = 0;
    this.lastSeenAt = -Infinity;
  }
}
