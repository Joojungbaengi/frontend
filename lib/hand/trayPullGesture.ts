import type { HandFrame } from "@/lib/hand/types";

export const TRAY_PULL_DEFAULTS = {
  GRAB_RADIUS: 0.12,
  PULL_START_RATIO: 1.12,
  PULL_COMPLETE_RATIO: 1.28,
  HAND_LOST_TIMEOUT: 420,
  PULL_SMOOTHING: 0.18,
  TRAY_PULL_DISTANCE: 0.22,
} as const;

export type TrayPullState = "IDLE" | "HOVER" | "GRABBED" | "PULLING" | "COMPLETE";

export interface TrayPullInput {
  frame: HandFrame | null;
  targetScreen: { x: number; y: number };
  now: number;
}

export interface TrayPullResult {
  state: TrayPullState;
  hover: boolean;
  grab: boolean;
  startSpan: number;
  currentSpan: number;
  spanRatio: number;
  progress: number;
  handLost: boolean;
  pinchClosed: boolean;
  targetNear: boolean;
}

export class TrayPullGesture {
  private state: TrayPullState = "IDLE";
  private startSpan = 0.18;
  private currentSpan = 0.18;
  private lastSeenAt = 0;
  private hover = false;
  private progress = 0;
  private targetNear = false;
  private pinchClosed = false;

  reset() {
    this.state = "IDLE";
    this.startSpan = 0.18;
    this.currentSpan = 0.18;
    this.hover = false;
    this.progress = 0;
    this.targetNear = false;
    this.pinchClosed = false;
  }

  update(input: TrayPullInput): TrayPullResult {
    const { frame, targetScreen, now } = input;
    const near = Math.hypot(targetScreen.x - (frame?.pinchPoint?.x ?? 0.5), targetScreen.y - (frame?.pinchPoint?.y ?? 0.5)) <= TRAY_PULL_DEFAULTS.GRAB_RADIUS;

    if (!frame || !frame.present) {
      if (this.state === "GRABBED" || this.state === "PULLING" || this.state === "COMPLETE") {
        if (now - this.lastSeenAt >= TRAY_PULL_DEFAULTS.HAND_LOST_TIMEOUT) {
          this.reset();
        }
      } else {
        this.state = "IDLE";
      }
      this.targetNear = false;
      this.hover = false;
      this.pinchClosed = false;
      return this.snapshot();
    }

    this.lastSeenAt = now;
    this.pinchClosed = frame.pinching;
    this.targetNear = near;
    this.hover = near;

    if (this.state === "IDLE") {
      this.progress = 0;
      if (near) this.state = "HOVER";
      else this.state = "IDLE";
    }

    if (this.state === "HOVER") {
      if (!near) {
        this.state = "IDLE";
        this.progress = 0;
      } else if (frame.justPinched) {
        this.state = "GRABBED";
        this.startSpan = Math.max(0.12, frame.screenSpan || this.startSpan);
        this.currentSpan = this.startSpan;
        this.progress = 0;
      }
    }

    if (this.state === "GRABBED" || this.state === "PULLING") {
      if (frame.justReleased) {
        if (this.state === "COMPLETE") {
          return this.snapshot();
        }
        this.reset();
        return this.snapshot();
      }

      this.currentSpan = Math.max(frame.screenSpan || this.currentSpan, 0.01);
      const ratio = this.startSpan > 0 ? this.currentSpan / this.startSpan : 1;
      const start = TRAY_PULL_DEFAULTS.PULL_START_RATIO;
      const complete = TRAY_PULL_DEFAULTS.PULL_COMPLETE_RATIO;

      if (ratio >= start && this.state === "GRABBED") {
        this.state = "PULLING";
      }

      if (ratio >= complete) {
        this.state = "COMPLETE";
      }

      const rawProgress = ratio <= start ? 0 : Math.min(1, (ratio - start) / (complete - start));
      this.progress = this.progress > 0
        ? this.progress * (1 - TRAY_PULL_DEFAULTS.PULL_SMOOTHING) + rawProgress * TRAY_PULL_DEFAULTS.PULL_SMOOTHING
        : rawProgress;

      if (this.state === "COMPLETE") {
        this.progress = 1;
      }
    }

    if (this.state === "COMPLETE" && frame.justReleased) {
      this.state = "COMPLETE";
    }

    return this.snapshot();
  }

  private snapshot(): TrayPullResult {
    const grab = this.state === "GRABBED" || this.state === "PULLING" || this.state === "COMPLETE";
    const handLost = this.state === "GRABBED" || this.state === "PULLING" ? false : false;
    const ratio = this.startSpan > 0 ? this.currentSpan / this.startSpan : 1;
    return {
      state: this.state,
      hover: this.hover,
      grab,
      startSpan: this.startSpan,
      currentSpan: this.currentSpan,
      spanRatio: Number.isFinite(ratio) ? ratio : 1,
      progress: this.progress,
      handLost,
      pinchClosed: this.pinchClosed,
      targetNear: this.targetNear,
    };
  }
}
