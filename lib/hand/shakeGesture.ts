/**
 * 털기 — 소쿠리를 위아래로 흔들어 물을 빼는 동작.
 *
 * 손이 위로 갔다 아래로 내려오는 것을 한 번으로 센다. 방향이 바뀔 때마다
 * 세면 손떨림까지 세어 버리므로, **최소 폭**을 넘겨 움직였을 때만 방향
 * 전환으로 인정한다. 부채질(fanGesture)이 좌우로 세는 것과 같은 방식이다.
 */

/** 방향이 바뀌었다고 보려면 이만큼(화면 비율)은 움직여야 한다 */
export const MIN_TRAVEL = 0.05;
/** 이보다 작은 움직임은 손떨림으로 본다 */
export const DEADZONE = 0.006;

export interface ShakeState {
  /** 위아래 한 번 왕복을 1회로 센 횟수 */
  count: number;
  /** 이 프레임에 한 번 셌다 */
  justCounted: boolean;
  /** 지금 흔들고 있는가 (마지막 움직임이 최근인가) */
  moving: boolean;
}

export class ShakeGesture {
  private last = 0;
  private dir: 1 | -1 | 0 = 0;
  private turn = 0;
  private count = 0;
  private idle = 0;
  private started = false;

  /**
   * @param y 손의 화면 세로 위치 (0~1)
   * @param dt 지난 프레임에서 흐른 시간(초)
   */
  update(y: number, dt: number): ShakeState {
    if (!this.started) {
      this.started = true;
      this.last = y;
      this.turn = y;
      return { count: this.count, justCounted: false, moving: false };
    }

    const move = y - this.last;
    let justCounted = false;

    if (Math.abs(move) > DEADZONE) {
      this.last = y;
      this.idle = 0;
      const d: 1 | -1 = move > 0 ? 1 : -1;
      if (this.dir === 0) {
        this.dir = d;
        this.turn = y;
      } else if (d !== this.dir && Math.abs(y - this.turn) >= MIN_TRAVEL) {
        // 방향이 바뀌었고 충분히 멀리 왔다 — 아래로 꺾일 때만 한 번으로 센다
        if (this.dir === -1) {
          this.count++;
          justCounted = true;
        }
        this.dir = d;
        this.turn = y;
      }
    } else {
      this.idle += dt;
    }

    return { count: this.count, justCounted, moving: this.idle < 0.4 };
  }

  reset() {
    this.dir = 0;
    this.count = 0;
    this.idle = 0;
    this.started = false;
  }
}
