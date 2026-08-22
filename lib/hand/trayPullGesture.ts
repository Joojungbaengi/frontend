"use client";

import type { HandFrame } from "@/lib/hand/types";

export const TRAY_PULL = {
  GRAB_RADIUS: 0.12,
  PULL_START_RATIO: 1.06,
  PULL_COMPLETE_RATIO: 1.18,
  HAND_LOST_TIMEOUT: 350,
  PULL_SMOOTHING: 0.28,
  COMPLETE_STABLE_FRAMES: 2,
  TRAY_PULL_DISTANCE: 0.32,
} as const;

export type TrayPullState = "IDLE" | "HOVER" | "GRABBED" | "PULLING" | "COMPLETE";

export interface TrayPullSnapshot {
  state: TrayPullState;
  grabbed: boolean;
  startSpan: number | null;
  currentSpan: number;
  spanRatio: number;
  progress: number;
}

const MIN_VALID_SPAN = 1e-4;

/** 손을 카메라 쪽으로 당길 때 커지는 screenSpan으로 채반 당기기를 판정한다. */
export class TrayPullGesture {
  private stateValue: TrayPullState = "IDLE";
  private startSpanValue: number | null = null;
  private currentSpanValue = 0;
  private spanRatioValue = 1;
  private progressValue = 0;
  private lastSeenAt = -Infinity;
  private completeStreak = 0;

  update(frame: HandFrame, hovering: boolean, now = performance.now()): TrayPullSnapshot {
    if (this.stateValue === "COMPLETE") return this.snapshot();

    if (!frame.present || frame.landmarks.length < 21) {
      if (this.grabbed && now - this.lastSeenAt > TRAY_PULL.HAND_LOST_TIMEOUT) this.reset();
      else if (!this.grabbed) this.stateValue = "IDLE";
      return this.snapshot();
    }

    this.lastSeenAt = now;
    this.currentSpanValue = frame.screenSpan;

    if (!this.grabbed) {
      this.stateValue = hovering ? "HOVER" : "IDLE";
      // 원 밖에서 먼저 손가락을 붙여도, 붙인 상태로 원 안에 들어오면 잡힌다.
      // 모바일에서는 justPinched 한 프레임을 놓치기 쉬워 현재 pinching도 허용한다.
      if (hovering && (frame.justPinched || frame.pinching) && frame.screenSpan > MIN_VALID_SPAN) {
        this.stateValue = "GRABBED";
        this.startSpanValue = frame.screenSpan;
        this.spanRatioValue = 1;
        this.progressValue = 0;
      }
      return this.snapshot();
    }

    if (frame.justReleased) {
      this.reset();
      return this.snapshot();
    }

    const start = this.startSpanValue ?? frame.screenSpan;
    this.spanRatioValue = start > MIN_VALID_SPAN ? frame.screenSpan / start : 1;
    const rawProgress = Math.min(
      1,
      Math.max(
        0,
        (this.spanRatioValue - TRAY_PULL.PULL_START_RATIO) /
          (TRAY_PULL.PULL_COMPLETE_RATIO - TRAY_PULL.PULL_START_RATIO)
      )
    );
    this.progressValue += (rawProgress - this.progressValue) * TRAY_PULL.PULL_SMOOTHING;

    if (this.spanRatioValue >= TRAY_PULL.PULL_COMPLETE_RATIO) this.completeStreak++;
    else this.completeStreak = 0;

    if (this.completeStreak >= TRAY_PULL.COMPLETE_STABLE_FRAMES) {
      this.progressValue = 1;
      this.stateValue = "COMPLETE";
    } else {
      this.stateValue = rawProgress > 0 ? "PULLING" : "GRABBED";
    }
    return this.snapshot();
  }

  reset() {
    this.stateValue = "IDLE";
    this.startSpanValue = null;
    this.currentSpanValue = 0;
    this.spanRatioValue = 1;
    this.progressValue = 0;
    this.lastSeenAt = -Infinity;
    this.completeStreak = 0;
  }

  get grabbed() {
    return this.stateValue === "GRABBED" || this.stateValue === "PULLING";
  }

  private snapshot(): TrayPullSnapshot {
    return {
      state: this.stateValue,
      grabbed: this.grabbed,
      startSpan: this.startSpanValue,
      currentSpan: this.currentSpanValue,
      spanRatio: this.spanRatioValue,
      progress: this.progressValue,
    };
  }
}
