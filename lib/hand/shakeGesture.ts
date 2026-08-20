"use client";

/**
 * 털기 판정 — 손을 위아래로 탁탁 터는 횟수를 센다. (탈수 · 소쿠리 물빼기)
 *
 * 부채질(fanGesture)과 같은 생각인데 축만 세로다.
 *   · 한 방향(위 또는 아래)으로 충분히 멀리, 너무 빠르지도 느리지도 않게 움직이면
 *     그 순간 반 번으로 인정한다.
 *   · 방향이 **번갈아** 두 번 인정되면 한 번 턴 것으로 센다.
 *     내렸다 올리면 = 1회.
 *   · 같은 방향이 이어지면 왕복이 아니므로 그걸 새 출발로 삼는다.
 *
 * 소쿠리를 아래로 탁 내리치는 순간이 물이 튀는 순간이라, 아래로 그은 반 번을
 * 따로 알려 준다(`downBeat`). 물방울은 그때 터뜨린다.
 *
 * 좌표는 HandFrame.landmarks (영상 기준 0~1, y 는 아래로 갈수록 크다)를 쓴다.
 * 이미 EMA 로 다듬어진 값이라 여기서 또 떨림을 걸러낼 필요가 없다.
 */
import { LM, type HandFrame } from "@/lib/hand/types";

export const SHAKE = {
  /** 반 번으로 인정할 최소 세로 이동 (화면 높이 대비) */
  minTravel: 0.075,
  /** 이보다 작은 움직임은 흔들림으로 보고 무시한다 */
  deadZone: 0.014,
  /** 반 번에 걸린 시간이 이 범위를 벗어나면 터는 동작으로 안 본다 */
  minHalfMs: 70,
  maxHalfMs: 700,
  /** 꺾임을 연달아 잡아 두 번 세는 걸 막는 최소 간격 */
  reversalCooldownMs: 90,
  /** 앞 반 번과 이만큼 떨어지면 이어지는 털기로 안 본다 */
  chainBreakMs: 1000,
  /** 이 시간 동안 손이 안 보이면 진행 중이던 동작을 버린다 */
  handLostMs: 300,
} as const;

type Dir = "none" | "up" | "down";

/** 손바닥 중심 y — 손가락 뿌리 네 개의 평균. 손목보다 흔들림이 적다. */
function palmCenterY(frame: HandFrame): number {
  const l = frame.landmarks;
  return (
    (l[LM.INDEX_MCP].y + l[LM.MIDDLE_MCP].y + l[LM.RING_MCP].y + l[LM.PINKY_MCP].y) / 4
  );
}

export class ShakeGesture {
  /** 지금까지 센 털기 횟수 */
  count = 0;
  /** 마지막으로 한 번 셌던 시각 */
  lastShakeAt = -Infinity;
  /**
   * 이번 프레임에 "아래로 탁" 이 잡혔나 — 물이 튀는 연출을 여기에 맞춘다.
   * update() 를 부를 때마다 새로 계산된다.
   */
  downBeat = false;
  /** 0~1. 지금 얼마나 세게 털고 있나 — 물결·물방울 세기에 쓴다 */
  intensity = 0;

  private seen = false;
  private lastSeenAt = -Infinity;
  private palmY = 0;

  /** 지금 방향으로 움직이기 시작한 지점과 시각 */
  private originY = 0;
  private originAt = 0;
  private dir: Dir = "none";

  /** 직전에 인정된 반 번의 방향과 시각 */
  private lastHalfDir: Dir = "none";
  private lastHalfAt = -Infinity;

  /**
   * 한 프레임 갱신.
   * @returns 이번 프레임에 늘어난 털기 횟수 (0 또는 1)
   */
  update(frame: HandFrame, now = performance.now()): number {
    this.downBeat = false;
    this.intensity *= 0.9;

    if (!frame.present || frame.landmarks.length < 21) {
      if (now - this.lastSeenAt > SHAKE.handLostMs) this.forget();
      return 0;
    }
    this.lastSeenAt = now;

    const y = palmCenterY(frame);
    if (!this.seen) {
      this.seen = true;
      this.palmY = y;
      this.originY = y;
      this.originAt = now;
      return 0;
    }
    this.palmY = y;

    const delta = y - this.originY;
    if (Math.abs(delta) < SHAKE.deadZone) return 0;

    const dir: Dir = delta > 0 ? "down" : "up";

    // 방향이 바뀌면 그 지점을 새 출발로 삼는다
    if (dir !== this.dir) {
      this.dir = dir;
      this.originY = y;
      this.originAt = now;
      return 0;
    }

    if (Math.abs(delta) < SHAKE.minTravel) return 0;

    const elapsed = now - this.originAt;
    if (elapsed < SHAKE.minHalfMs || elapsed > SHAKE.maxHalfMs) {
      // 너무 빠르거나 느린 움직임 — 여기서부터 다시 잰다
      this.originY = y;
      this.originAt = now;
      return 0;
    }
    if (now - this.lastHalfAt < SHAKE.reversalCooldownMs) return 0;

    // 반 번 인정
    const prevDir = this.lastHalfDir;
    const chained = now - this.lastHalfAt < SHAKE.chainBreakMs;
    this.lastHalfDir = dir;
    this.lastHalfAt = now;
    this.originY = y;
    this.originAt = now;
    this.intensity = Math.min(1, this.intensity + 0.6);
    if (dir === "down") this.downBeat = true;

    // 방향이 번갈아 두 번이면 한 번 턴 것
    if (chained && prevDir !== "none" && prevDir !== dir) {
      this.count++;
      this.lastShakeAt = now;
      this.lastHalfDir = "none"; // 다음 왕복은 처음부터 다시 짝을 맞춘다
      return 1;
    }
    return 0;
  }

  private forget() {
    this.seen = false;
    this.dir = "none";
    this.lastHalfDir = "none";
    this.lastHalfAt = -Infinity;
  }

  reset() {
    this.forget();
    this.count = 0;
    this.intensity = 0;
    this.downBeat = false;
    this.lastShakeAt = -Infinity;
  }
}
