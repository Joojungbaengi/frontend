"use client";

/**
 * 휘젓기 판정 — 손이 둥글게 도는 것을 센다. (쌀 헹구기 · 술덧 젓기)
 *
 * 부채질(fanGesture)은 좌우 왕복이라 한 축만 보면 되지만, 휘젓기는 방향이 계속 바뀐다.
 * 그래서 **손이 중심점 둘레를 얼마나 돌았는지 각도를 쌓아** 한 바퀴씩 센다.
 *
 *   · 최근 한동안의 손 위치를 모아 그 평균을 원의 중심으로 삼는다.
 *     (그릇 한가운데를 미리 정해 두면 손을 조금만 비켜 저어도 안 돌아간다)
 *   · 매 프레임 중심에 대한 각도를 재고, 직전 각도와의 차이를 더해 나간다.
 *   · 중심에서 너무 가까우면(반지름이 작으면) 각도가 미친 듯이 튀므로 그 프레임은 버린다.
 *   · 한 바퀴(2π)마다 한 번 저은 것으로 센다.
 *
 * 방향은 가리지 않는다 — 시계든 반시계든 젓는 건 젓는 거다. 다만 왔다 갔다 하면
 * 각도가 서로 상쇄돼 안 쌓이므로, 실제로 한 방향으로 돌려야 진행된다.
 *
 * 참고: 중심을 잡을 만큼 손이 돌기 전까지는 각도를 잴 수 없어서, 첫 바퀴에만
 * 5분의 1바퀴쯤이 더 든다(1.2바퀴를 돌아야 1바퀴로 잡힌다). 그 뒤로는 정확히 따라간다.
 * 처음부터 정확히 재려면 그릇 중심을 미리 알아야 하는데, 그러면 손을 조금만
 * 비켜 저어도 안 돌아가서 조작이 훨씬 까다로워진다.
 */
import { LM, type HandFrame } from "@/lib/hand/types";

export const STIR = {
  /** 중심을 잡을 때 쓰는 최근 위치 개수 */
  historySize: 18,
  /** 중심에서 이보다 가까우면 각도가 튄다 — 그 프레임은 버린다 (화면 너비 대비) */
  minRadius: 0.035,
  /** 한 프레임에 이보다 많이 돈 것으로 나오면 인식이 튄 것이다 (라디안) */
  maxStepRad: 1.1,
  /** 이 시간 동안 손이 안 보이면 진행 중이던 회전을 버린다 */
  handLostMs: 400,
  /** 이 시간 동안 각도가 거의 안 쌓이면 젓기를 멈춘 것으로 보고 흐름을 끊는다 */
  idleMs: 1200,
} as const;

/** 손바닥 중심 — 손가락 뿌리 네 개의 평균 */
function palmCenter(frame: HandFrame) {
  const l = frame.landmarks;
  return {
    x: (l[LM.INDEX_MCP].x + l[LM.MIDDLE_MCP].x + l[LM.RING_MCP].x + l[LM.PINKY_MCP].x) / 4,
    y: (l[LM.INDEX_MCP].y + l[LM.MIDDLE_MCP].y + l[LM.RING_MCP].y + l[LM.PINKY_MCP].y) / 4,
  };
}

/** -π~π 로 접어 넣는다 (한 바퀴 넘어갈 때 부호가 뒤집히는 걸 막는다) */
function wrapPi(a: number) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export class StirGesture {
  /** 지금까지 돈 바퀴 수 (소수점 포함) */
  turns = 0;
  /** 마지막으로 각도가 쌓인 시각 — 연출(물결 세기)에 쓴다 */
  lastMoveAt = -Infinity;

  private history: { x: number; y: number }[] = [];
  private lastAngle: number | null = null;
  private lastSeenAt = -Infinity;
  private accum = 0;

  /** 방금 프레임에 돈 각도(라디안) — 물결을 얼마나 세게 흔들지에 쓴다 */
  speed = 0;

  /**
   * 한 프레임 갱신.
   * @returns 이번 프레임에 늘어난 바퀴 수 (0 이상)
   */
  update(frame: HandFrame, now = performance.now()): number {
    this.speed *= 0.85; // 손을 멈추면 물결도 잦아든다

    if (!frame.present || frame.landmarks.length < 21) {
      if (now - this.lastSeenAt > STIR.handLostMs) this.forget();
      return 0;
    }
    this.lastSeenAt = now;

    const p = palmCenter(frame);
    this.history.push(p);
    if (this.history.length > STIR.historySize) this.history.shift();

    // 중심을 잡을 만큼 모이기 전에는 각도를 재지 않는다
    if (this.history.length < 6) return 0;

    let cx = 0;
    let cy = 0;
    for (const h of this.history) {
      cx += h.x;
      cy += h.y;
    }
    cx /= this.history.length;
    cy /= this.history.length;

    const dx = p.x - cx;
    const dy = p.y - cy;
    const radius = Math.hypot(dx, dy);
    if (radius < STIR.minRadius) {
      // 중심 근처에서는 각도가 의미 없다. 직전 각도도 버려 이어 붙지 않게 한다.
      this.lastAngle = null;
      return 0;
    }

    const angle = Math.atan2(dy, dx);
    if (this.lastAngle === null) {
      this.lastAngle = angle;
      return 0;
    }

    const step = wrapPi(angle - this.lastAngle);
    this.lastAngle = angle;

    // 인식이 튀어 한 프레임에 크게 도는 것으로 나오면 버린다
    if (Math.abs(step) > STIR.maxStepRad) return 0;

    // 한참 멈췄다가 다시 저으면 쌓아 둔 각도를 버리고 새로 시작한다
    if (now - this.lastMoveAt > STIR.idleMs) this.accum = 0;
    this.lastMoveAt = now;
    this.speed = Math.min(1, this.speed + Math.abs(step) * 1.4);

    // 방향은 가리지 않되, 왔다 갔다 하면 서로 상쇄돼 안 쌓인다
    this.accum += step;

    const gained = Math.abs(this.accum) / (Math.PI * 2);
    if (gained >= 1) {
      const whole = Math.floor(gained);
      this.accum -= Math.sign(this.accum) * whole * Math.PI * 2;
      this.turns += whole;
      return whole;
    }
    return 0;
  }

  /** 한 바퀴 중 어디까지 왔나 (0~1) — 진행 막대에 쓴다 */
  get partial() {
    return Math.min(1, Math.abs(this.accum) / (Math.PI * 2));
  }

  private forget() {
    this.history.length = 0;
    this.lastAngle = null;
    this.accum = 0;
  }

  reset() {
    this.forget();
    this.turns = 0;
    this.speed = 0;
    this.lastMoveAt = -Infinity;
  }
}
