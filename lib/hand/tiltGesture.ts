/**
 * 기울이기 — 그릇을 잡고 손목을 돌려 내용물을 쏟는 동작.
 *
 * 손이 얼마나 돌았는지는 **화면에서의 손목→중지너클 방향**으로 잰다.
 * 깊이 값은 거칠어서 손등이 보일 때 크게 튀는데, 화면 안에서의 각도는
 * 그런 흔들림을 타지 않는다. 사용자가 화면에서 보는 것과도 그대로 맞는다.
 *
 * 쏟기 시작하는 각과 멈추는 각을 벌려 둔다(히스테리시스). 손이 경계에
 * 걸쳐 있을 때 쏟다 말다 하며 깜빡이는 걸 막는다.
 */

/** 이 각(도)을 넘게 기울이면 쏟기 시작한다 */
export const POUR_ON = 42;
/** 이 각 아래로 돌아오면 멈춘다 */
export const POUR_OFF = 28;
/** 다 쏟는 데 걸리는 시간(초) — 기울인 채로 이만큼 있으면 그릇이 빈다 */
export const POUR_SECONDS = 1.4;

export interface TiltState {
  /** 지금 기울어진 각(도). 0 이 똑바로 선 상태 */
  angle: number;
  /** 지금 쏟고 있는가 */
  pouring: boolean;
  /** 얼마나 쏟았나 0~1. 1 이면 다 비었다 */
  poured: number;
  /** 이 프레임에 다 비웠다 */
  justEmptied: boolean;
}

export class TiltGesture {
  private on = false;
  private amount = 0;
  private done = false;

  /**
   * @param wrist  손목 (화면 정규화 좌표)
   * @param knuckle 중지 너클
   * @param dt 지난 프레임에서 흐른 시간(초)
   */
  update(
    wrist: { x: number; y: number },
    knuckle: { x: number; y: number },
    dt: number
  ): TiltState {
    // 화면에서 손가락이 위를 향하면 0도. 좌우 어느 쪽으로 눕든 같게 본다.
    const dx = knuckle.x - wrist.x;
    const dy = wrist.y - knuckle.y; // 화면 y 는 아래로 커진다
    const angle = Math.abs((Math.atan2(dx, Math.max(dy, 1e-6)) * 180) / Math.PI);

    if (this.on) {
      if (angle < POUR_OFF) this.on = false;
    } else if (angle > POUR_ON) {
      this.on = true;
    }

    let justEmptied = false;
    if (this.on && !this.done) {
      this.amount = Math.min(1, this.amount + dt / POUR_SECONDS);
      if (this.amount >= 1) {
        this.done = true;
        justEmptied = true;
      }
    }
    return { angle, pouring: this.on && !this.done, poured: this.amount, justEmptied };
  }

  reset() {
    this.on = false;
    this.amount = 0;
    this.done = false;
  }
}
