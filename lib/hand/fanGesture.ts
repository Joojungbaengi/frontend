"use client";

/**
 * 부채질 판정 — 손을 좌우로 흔드는 횟수를 센다. (고두밥 냉각 단계)
 *
 * 화면을 좌/우 구역으로 나눠 오가는 걸 세는 방식은 쓰지 않는다. 손이 구역 경계에
 * 가만히 있기만 해도 흔들림 때문에 숫자가 올라가고, 화면 끝까지 크게 휘둘러야만 세어진다.
 *
 * 대신 **한 방향으로 간 거리**를 본다.
 *   · 한 방향으로 충분히 멀리(minTravel), 너무 빠르지도 느리지도 않게 움직이면
 *     그 순간 반 번(half sweep)으로 인정한다.
 *   · 방향이 **번갈아** 두 번 인정되면 한 번 부친 것으로 센다.
 *     왼쪽으로 긋고 오른쪽으로 그으면 = 1회.
 *   · 같은 방향이 이어지면 왕복이 아니므로 그걸 새 출발로 삼는다.
 *
 * 그래서 손을 가만히 두거나 한쪽으로만 밀면 절대 안 올라가고,
 * 실제로 부채질하듯 좌우로 흔들어야만 올라간다.
 *
 * 좌표는 HandFrame.landmarks (영상 기준 0~1)를 쓴다. 이미 EMA 로 다듬어진 값이라
 * 여기서 또 떨림을 걸러낼 필요가 없다.
 */
import { LM, type HandFrame } from "@/lib/hand/types";

export const FAN = {
  /** 반 번으로 인정할 최소 가로 이동 (화면 너비 대비) */
  minTravel: 0.12,
  /** 이보다 작은 움직임은 흔들림으로 보고 무시한다 */
  deadZone: 0.02,
  /** 반 번에 걸린 시간이 이 범위를 벗어나면 부채질로 안 본다 */
  minHalfMs: 100,
  maxHalfMs: 900,
  /** 꺾임을 연달아 잡아 두 번 세는 걸 막는 최소 간격 */
  reversalCooldownMs: 120,
  /** 앞 반 번과 이만큼 떨어지면 이어지는 부채질로 안 본다 (한참 뒤 손짓과 짝지어지지 않게) */
  chainBreakMs: 1200,
  /** 이 시간 동안 손이 안 보이면 진행 중이던 동작을 버린다 */
  handLostMs: 300,
} as const;

type Dir = "none" | "left" | "right";

/** 손바닥 중심 — 손가락 뿌리 네 개의 평균. 손목보다 흔들림이 적다. */
function palmCenterX(frame: HandFrame): number {
  const l = frame.landmarks;
  return (
    (l[LM.INDEX_MCP].x + l[LM.MIDDLE_MCP].x + l[LM.RING_MCP].x + l[LM.PINKY_MCP].x) / 4
  );
}

export class FanGesture {
  /** 지금까지 센 부채질 횟수 */
  count = 0;
  /** 마지막으로 한 번 셌던 시각 — 연출(김이 훅 흩어지는 효과)에 쓴다 */
  lastFanAt = -Infinity;

  private seen = false;
  private lastSeenAt = -Infinity;
  private palmX = 0;

  /** 지금 방향으로 움직이기 시작한 지점과 시각 */
  private anchorX = 0;
  private anchorAt = 0;
  /** 지금 방향으로 가장 멀리 간 지점 — 꺾임을 알아채는 기준 */
  private peakX = 0;
  private peakAt = 0;

  private dir: Dir = "none";
  /** 지금 구간이 이미 반 번으로 인정됐나 (한 번 그을 때 한 번만 센다) */
  private credited = false;
  /** 짝을 기다리는 반 번의 방향. 다음이 반대면 한 번으로 센다. */
  private firstHalf: Dir = "none";
  private lastCreditAt = -Infinity;
  private lastReversalAt = -Infinity;

  /**
   * 한 프레임 갱신.
   * @returns 이번 프레임에 새로 세어진 부채질 횟수 (0 또는 1)
   */
  update(frame: HandFrame, now = performance.now()): number {
    if (!frame.present || frame.landmarks.length < 21) {
      // 잠깐 놓친 정도로는 진행 중이던 동작을 버리지 않는다
      if (this.seen && now - this.lastSeenAt > FAN.handLostMs) this.forgetHand();
      return 0;
    }

    this.palmX = Math.min(1, Math.max(0, palmCenterX(frame)));
    this.lastSeenAt = now;

    if (!this.seen) {
      this.seen = true;
      this.restart(now);
      return 0;
    }

    // 아직 방향이 안 정해졌으면, 데드존을 벗어나는 순간 그 방향으로 시작한다
    if (this.dir === "none") {
      const drift = this.palmX - this.anchorX;
      if (Math.abs(drift) < FAN.deadZone) {
        // 제자리에서 아주 느리게 밀리는 것이 쌓여 한 번으로 인정되지 않게 한다
        if (now - this.anchorAt > FAN.maxHalfMs) this.restart(now);
        return 0;
      }
      this.dir = drift < 0 ? "left" : "right";
      this.peakX = this.palmX;
      this.peakAt = now;
      this.credited = false;
      return 0;
    }

    const sign = this.dir === "right" ? 1 : -1;

    // 가던 방향으로 더 갔으면 꼭짓점을 갱신한다
    if ((this.palmX - this.anchorX) * sign > (this.peakX - this.anchorX) * sign) {
      this.peakX = this.palmX;
      this.peakAt = now;
    }

    // 이 구간이 조건을 채우는 **즉시** 반 번으로 인정한다.
    // 되돌아설 때까지 기다리면 왼쪽·오른쪽을 긋고도 한 번 더 꺾어야 세어져
    // "좌우로 한 번 흔들었는데 왜 안 세지" 가 된다.
    let counted = 0;
    if (!this.credited) {
      const travel = Math.abs(this.peakX - this.anchorX);
      const elapsed = this.peakAt - this.anchorAt;
      if (travel >= FAN.minTravel && elapsed >= FAN.minHalfMs && elapsed <= FAN.maxHalfMs) {
        this.credited = true;
        counted = this.creditHalf(this.dir, now);
      } else if (now - this.anchorAt > FAN.maxHalfMs) {
        // 부채질로 보기엔 너무 느린 구간 — 흐름을 끊고 다시 시작한다
        this.firstHalf = "none";
        this.restart(now);
        return 0;
      }
    }

    // 꺾이면 그 지점이 다음 반 번의 출발점이 된다
    const reversal = (this.peakX - this.palmX) * sign;
    if (reversal >= FAN.deadZone && now - this.lastReversalAt >= FAN.reversalCooldownMs) {
      this.anchorX = this.peakX;
      this.anchorAt = this.peakAt;
      this.peakX = this.palmX;
      this.peakAt = now;
      this.dir = this.dir === "right" ? "left" : "right";
      this.credited = false;
      this.lastReversalAt = now;
    }

    return counted;
  }

  /** 반 번이 인정됐을 때 — 방향이 번갈아 두 번이면 한 번으로 센다 */
  private creditHalf(dir: Dir, now: number): number {
    // 앞 반 번과 한참 떨어져 있으면 이어지는 부채질이 아니다
    if (this.firstHalf !== "none" && now - this.lastCreditAt > FAN.chainBreakMs) {
      this.firstHalf = "none";
    }
    this.lastCreditAt = now;

    if (this.firstHalf === "none") {
      this.firstHalf = dir;
      return 0;
    }
    if (dir !== this.firstHalf) {
      this.count++;
      this.lastFanAt = now;
      this.firstHalf = "none";
      return 1;
    }
    // 같은 방향이 두 번 — 왕복이 아니므로 이걸 새 출발로 삼는다
    this.firstHalf = dir;
    return 0;
  }

  private restart(now: number) {
    this.anchorX = this.palmX;
    this.anchorAt = now;
    this.peakX = this.palmX;
    this.peakAt = now;
    this.dir = "none";
    this.credited = false;
  }

  /** 손을 놓쳤다 — 진행 중이던 동작만 버리고 횟수는 유지한다 */
  private forgetHand() {
    this.seen = false;
    this.dir = "none";
    this.credited = false;
    this.firstHalf = "none";
  }

  /** 단계를 다시 시작할 때 — 횟수까지 전부 초기화 */
  reset() {
    this.forgetHand();
    this.count = 0;
    this.lastFanAt = -Infinity;
    this.lastCreditAt = -Infinity;
    this.lastReversalAt = -Infinity;
  }
}
