"use client";

import { palmCenter } from "@/lib/hand/riceSpreadGesture";
import { LM, type HandFrame } from "@/lib/hand/types";

/** Galaxy 실기기 측정값을 보고 한곳에서 조절할 knead 판정값. */
export const KNEAD = {
  /**
   * 편 손은 handRatio 가 크고 오므린 손은 작다.
   * 실기기 기준값(폄 0.90 · 주먹 0.72)을 그대로 쓰면 어중간한 손 모양이 전부
   * TRANSITION 으로 빠져 아무리 치대도 안 세어진다. 두 문턱을 서로 당겨
   * 살짝만 펴도 폄, 살짝만 오므려도 오므린 것으로 본다.
   */
  OPEN_THRESHOLD: 0.86,
  CLOSED_THRESHOLD: 0.78,
  POSE_HOLD_MS: 70,
  MIN_CYCLE_MS: 140,
  MAX_CYCLE_MS: 3500,
  COUNT_COOLDOWN_MS: 160,
  HAND_LOST_TIMEOUT: 350,
  /** 술덧 위로 인정하는 범위 — 손이 조금 비켜도 치대는 것으로 본다 */
  TARGET_PADDING: 1.6,
  TARGET_KNEAD_COUNT: 3,
} as const;

export type KneadPose = "OPEN" | "CLOSED" | "TRANSITION";
export type KneadState = "WAIT_OPEN" | "OPEN_READY" | "CLOSED" | "COOLDOWN" | "COMPLETE";

export interface KneadSnapshot {
  state: KneadState;
  pose: KneadPose;
  onMash: boolean;
  handRatio: number;
  fingertipMeanDistance: number;
  palmScale: number;
  count: number;
  progress: number;
  justKneaded: boolean;
}

type StablePose = Exclude<KneadPose, "TRANSITION">;
const FINGERTIPS = [LM.INDEX_TIP, LM.MIDDLE_TIP, LM.RING_TIP, LM.PINKY_TIP] as const;
const MIN_PALM_SCALE = 1e-4;

/**
 * 손가락 끝과 palm center의 평균 화면 거리를 손목~중지 MCP 크기로 나눈다.
 * 카메라와 손 사이 거리가 변해도 OPEN/CLOSED 값이 크게 달라지지 않는다.
 */
export function kneadHandMetric(frame: HandFrame) {
  const palm = palmCenter(frame);
  if (!palm || frame.landmarks.length < 21) {
    return { handRatio: 0, fingertipMeanDistance: 0, palmScale: 0 };
  }

  let distanceSum = 0;
  for (const index of FINGERTIPS) {
    const tip = frame.landmarks[index];
    distanceSum += Math.hypot(tip.x - palm.x, tip.y - palm.y);
  }
  const fingertipMeanDistance = distanceSum / FINGERTIPS.length;
  const palmScale = Math.max(frame.screenSpan, MIN_PALM_SCALE);
  return {
    handRatio: fingertipMeanDistance / palmScale,
    fingertipMeanDistance,
    palmScale,
  };
}

/** OPEN → CLOSED → OPEN 한 주기만 count하는 독립 상태 머신. */
export class KneadGesture {
  private stateValue: KneadState = "WAIT_OPEN";
  private stablePose: StablePose | null = null;
  private candidatePose: StablePose | null = null;
  private candidateSince = 0;
  private cycleStartedAt = 0;
  private cooldownUntil = -Infinity;
  private lastSeenAt = -Infinity;
  private onMashValue = false;
  private countValue = 0;
  private handRatioValue = 0;
  private fingertipMeanDistanceValue = 0;
  private palmScaleValue = 0;

  update(frame: HandFrame, onMash: boolean, now = performance.now()): KneadSnapshot {
    if (!frame.present || frame.landmarks.length < 21) {
      this.onMashValue = false;
      if (now - this.lastSeenAt >= KNEAD.HAND_LOST_TIMEOUT) this.cancelCycle(true);
      return this.snapshot(false);
    }

    this.lastSeenAt = now;
    const metric = kneadHandMetric(frame);
    this.handRatioValue = metric.handRatio;
    this.fingertipMeanDistanceValue = metric.fingertipMeanDistance;
    this.palmScaleValue = metric.palmScale;
    this.onMashValue = onMash;

    if (this.stateValue === "COMPLETE") return this.snapshot(false);
    // 손이 술덧 위를 잠깐 벗어났다고 진행 중인 주기를 버리지 않는다.
    // 치대다 보면 손이 조금씩 비켜나기 마련이라, 그때마다 처음부터 다시 하면
    // 아무리 오므렸다 펴도 숫자가 안 올라간다. 주기를 **시작**할 때만 따진다.
    if (!onMash && this.stateValue === "WAIT_OPEN") {
      return this.snapshot(false);
    }

    this.updateStablePose(now);
    let justKneaded = false;

    if (this.stateValue === "WAIT_OPEN") {
      if (this.stablePose === "OPEN" && now >= this.cooldownUntil) {
        this.stateValue = "OPEN_READY";
        this.cycleStartedAt = now;
      }
    } else if (this.stateValue === "OPEN_READY") {
      if (now - this.cycleStartedAt > KNEAD.MAX_CYCLE_MS) {
        this.cycleStartedAt = this.stablePose === "OPEN" ? now : 0;
        this.stateValue = this.stablePose === "OPEN" ? "OPEN_READY" : "WAIT_OPEN";
      } else if (this.stablePose === "CLOSED") {
        this.stateValue = "CLOSED";
      }
    } else if (this.stateValue === "CLOSED") {
      const elapsed = now - this.cycleStartedAt;
      if (elapsed > KNEAD.MAX_CYCLE_MS) {
        this.cancelCycle(false);
      } else if (this.stablePose === "OPEN") {
        if (elapsed >= KNEAD.MIN_CYCLE_MS) {
          this.countValue = Math.min(KNEAD.TARGET_KNEAD_COUNT, this.countValue + 1);
          justKneaded = true;
          this.cooldownUntil = now + KNEAD.COUNT_COOLDOWN_MS;
          this.stateValue = this.countValue >= KNEAD.TARGET_KNEAD_COUNT ? "COMPLETE" : "COOLDOWN";
        } else {
          // 너무 빨랐을 뿐이다. 버리지 말고 편 자세에서 다시 세기 시작한다.
          this.stateValue = "OPEN_READY";
          this.cycleStartedAt = now;
        }
      }
    } else if (this.stateValue === "COOLDOWN" && now >= this.cooldownUntil) {
      if (this.stablePose === "OPEN") {
        this.stateValue = "OPEN_READY";
        this.cycleStartedAt = now;
      } else {
        this.stateValue = "WAIT_OPEN";
        this.cycleStartedAt = 0;
      }
    }

    return this.snapshot(justKneaded);
  }

  reset() {
    this.stateValue = "WAIT_OPEN";
    this.stablePose = null;
    this.candidatePose = null;
    this.candidateSince = 0;
    this.cycleStartedAt = 0;
    this.cooldownUntil = -Infinity;
    this.lastSeenAt = -Infinity;
    this.onMashValue = false;
    this.countValue = 0;
    this.handRatioValue = 0;
    this.fingertipMeanDistanceValue = 0;
    this.palmScaleValue = 0;
  }

  private updateStablePose(now: number) {
    const next = this.handRatioValue >= KNEAD.OPEN_THRESHOLD
      ? "OPEN"
      : this.handRatioValue <= KNEAD.CLOSED_THRESHOLD
        ? "CLOSED"
        : null;

    // 두 threshold 사이에서는 직전 안정 pose를 그대로 유지한다(hysteresis).
    if (!next || next === this.stablePose) {
      this.candidatePose = null;
      this.candidateSince = 0;
      return;
    }
    if (next !== this.candidatePose) {
      this.candidatePose = next;
      this.candidateSince = now;
      return;
    }
    if (now - this.candidateSince >= KNEAD.POSE_HOLD_MS) {
      this.stablePose = next;
      this.candidatePose = null;
      this.candidateSince = 0;
    }
  }

  private cancelCycle(resetPose: boolean) {
    if (this.stateValue !== "COMPLETE") this.stateValue = "WAIT_OPEN";
    this.cycleStartedAt = 0;
    this.candidatePose = null;
    this.candidateSince = 0;
    if (resetPose) this.stablePose = null;
  }

  private snapshot(justKneaded: boolean): KneadSnapshot {
    // hold 시간이 채워지기 전 candidate는 debug에서도 안정 pose로 표시하지 않는다.
    const pose: KneadPose = this.stablePose ?? "TRANSITION";
    return {
      state: this.stateValue,
      pose,
      onMash: this.onMashValue,
      handRatio: this.handRatioValue,
      fingertipMeanDistance: this.fingertipMeanDistanceValue,
      palmScale: this.palmScaleValue,
      count: this.countValue,
      progress: this.countValue / KNEAD.TARGET_KNEAD_COUNT,
      justKneaded,
    };
  }
}
