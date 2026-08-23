"use client";

import { LM, type HandFrame } from "@/lib/hand/types";

export const RICE_SPREAD = {
  /** tray 가로/세로 중 interaction 영역으로 쓰는 비율 */
  TARGET_SURFACE_RATIO: 0.95,
  /** 이보다 작은 프레임 간 이동은 landmark jitter로 무시한다 */
  MOVEMENT_DEAD_ZONE: 0.006,
  /**
   * 한 번의 쓸기로 인정할 최소 화면 이동 거리.
   * 또박또박 크게 그어야만 세어 주면 "대충 휘저었는데 안 펴진다"가 된다.
   */
  MIN_STROKE_DISTANCE: 0.042,
  MIN_STROKE_MS: 70,
  MAX_STROKE_MS: 1600,
  /** 채반을 나눠 보는 칸. 칸이 많을수록 구석구석 훑어야 해서 오래 걸린다 */
  ZONE_COLUMNS: 2,
  ZONE_ROWS: 2,
  COVERAGE_PER_ZONE: 1,
  /** 현재 stroke만 취소할 hand-lost 시간 */
  HAND_LOST_TIMEOUT: 350,
  /** rice visual progress EMA 비율 */
  VISUAL_SMOOTHING: 0.16,
  /** 펼치기 전/후 rice 면적 비율과 두께(m) */
  START_SURFACE_RATIO: 0.46,
  FINAL_SURFACE_RATIO: 0.95,
  START_THICKNESS: 0.045,
  FINAL_THICKNESS: 0.014,
} as const;

export type RiceSpreadState = "IDLE" | "ON_RICE" | "SPREADING" | "COMPLETE";

export interface RiceSpreadInput {
  present: boolean;
  onRice: boolean;
  /** 화면 정규화 palm 위치 */
  palm: { x: number; y: number };
  /** rice target 내부 좌표. 좌상단 0,0 / 우하단 1,1 */
  targetPoint: { x: number; y: number };
}

export interface RiceSpreadSnapshot {
  state: RiceSpreadState;
  palm: { x: number; y: number };
  onRice: boolean;
  moveDistance: number;
  currentZone: number | null;
  zoneCoverage: number[];
  totalCoverage: number;
  progress: number;
  justSpread: boolean;
}

/** wrist와 네 손가락 MCP의 평균 — 손가락 끝보다 표면 쓸기에서 안정적이다. */
export function palmCenter(frame: HandFrame): { x: number; y: number } | null {
  if (!frame.present || frame.landmarks.length < 21) return null;
  const indices = [LM.WRIST, LM.INDEX_MCP, LM.MIDDLE_MCP, LM.RING_MCP, LM.PINKY_MCP];
  let x = 0;
  let y = 0;
  for (const index of indices) {
    x += frame.landmarks[index].x;
    y += frame.landmarks[index].y;
  }
  return { x: x / indices.length, y: y / indices.length };
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function zoneAt(p: { x: number; y: number }): number {
  const col = Math.min(RICE_SPREAD.ZONE_COLUMNS - 1, Math.max(0, Math.floor(p.x * RICE_SPREAD.ZONE_COLUMNS)));
  const row = Math.min(RICE_SPREAD.ZONE_ROWS - 1, Math.max(0, Math.floor(p.y * RICE_SPREAD.ZONE_ROWS)));
  return row * RICE_SPREAD.ZONE_COLUMNS + col;
}

export class RiceSpreadGesture {
  private stateValue: RiceSpreadState = "IDLE";
  private coverage = Array.from(
    { length: RICE_SPREAD.ZONE_COLUMNS * RICE_SPREAD.ZONE_ROWS },
    () => 0
  );
  /** 현재 continuous stroke가 지나간 zone */
  private strokeZones = new Set<number>();
  /** 현재 continuous stroke에서 이미 +1을 받은 zone — rice 밖으로 나갈 때만 비운다 */
  private creditedThisStroke = new Set<number>();
  private anchor: { x: number; y: number } | null = null;
  private previous: { x: number; y: number } | null = null;
  private strokeStartedAt = 0;
  private moveDistanceValue = 0;
  private lastSeenAt = -Infinity;
  private palmValue = { x: 0.5, y: 0.5 };
  private currentZoneValue: number | null = null;
  private spreadUntil = -Infinity;

  update(input: RiceSpreadInput, now = performance.now()): RiceSpreadSnapshot {
    if (this.stateValue === "COMPLETE") return this.snapshot(false);

    if (!input.present) {
      if (now - this.lastSeenAt > RICE_SPREAD.HAND_LOST_TIMEOUT) this.cancelStroke();
      this.stateValue = "IDLE";
      return this.snapshot(false);
    }

    this.lastSeenAt = now;
    this.palmValue = { ...input.palm };

    if (!input.onRice) {
      this.cancelStroke();
      this.stateValue = "IDLE";
      return this.snapshot(false);
    }

    const zone = zoneAt(input.targetPoint);
    this.currentZoneValue = zone;

    if (!this.anchor || !this.previous) {
      this.beginStroke(input.palm, zone, now);
      this.stateValue = "ON_RICE";
      return this.snapshot(false);
    }

    const step = distance(this.previous, input.palm);
    if (step >= RICE_SPREAD.MOVEMENT_DEAD_ZONE) {
      this.moveDistanceValue += step;
      this.previous = { ...input.palm };
      this.strokeZones.add(zone);
    }

    const elapsed = now - this.strokeStartedAt;
    if (elapsed > RICE_SPREAD.MAX_STROKE_MS) {
      // 시간 초과된 미인정 경로는 버리되, 이미 이 continuous stroke에서
      // 가산된 zone은 중복 방지를 위해 계속 기억한다.
      this.strokeZones.clear();
      for (const creditedZone of this.creditedThisStroke) this.strokeZones.add(creditedZone);
      this.restartSegment(input.palm, zone, now);
      this.stateValue = "ON_RICE";
      return this.snapshot(false);
    }

    const displacement = distance(this.anchor, input.palm);
    const valid =
      elapsed >= RICE_SPREAD.MIN_STROKE_MS &&
      displacement >= RICE_SPREAD.MIN_STROKE_DISTANCE &&
      this.moveDistanceValue >= RICE_SPREAD.MIN_STROKE_DISTANCE;

    if (!valid) {
      this.stateValue = now < this.spreadUntil ? "SPREADING" : "ON_RICE";
      return this.snapshot(false);
    }

    let added = false;
    for (const strokeZone of this.strokeZones) {
      if (this.creditedThisStroke.has(strokeZone)) continue;
      this.creditedThisStroke.add(strokeZone);
      if (this.coverage[strokeZone] < RICE_SPREAD.COVERAGE_PER_ZONE) {
        this.coverage[strokeZone]++;
        added = true;
      }
    }
    // 다음 유효 구간을 재되, continuous stroke의 중복 방지 Set은 유지한다.
    this.restartSegment(input.palm, zone, now);

    const totalCoverage = this.coverage.reduce((sum, value) => sum + value, 0);
    const requiredCoverage = this.coverage.length * RICE_SPREAD.COVERAGE_PER_ZONE;
    if (totalCoverage >= requiredCoverage) {
      this.stateValue = "COMPLETE";
    } else if (added) {
      this.stateValue = "SPREADING";
      this.spreadUntil = now + 320;
    } else {
      this.stateValue = "ON_RICE";
    }
    return this.snapshot(added);
  }

  reset() {
    this.stateValue = "IDLE";
    this.coverage.fill(0);
    this.cancelStroke();
    this.lastSeenAt = -Infinity;
    this.palmValue = { x: 0.5, y: 0.5 };
    this.spreadUntil = -Infinity;
  }

  private beginStroke(palm: { x: number; y: number }, zone: number, now: number) {
    this.strokeZones.clear();
    this.creditedThisStroke.clear();
    this.restartSegment(palm, zone, now);
  }

  private restartSegment(palm: { x: number; y: number }, zone: number, now: number) {
    this.anchor = { ...palm };
    this.previous = { ...palm };
    this.strokeStartedAt = now;
    this.moveDistanceValue = 0;
    this.strokeZones.add(zone);
  }

  private cancelStroke() {
    this.anchor = null;
    this.previous = null;
    this.strokeStartedAt = 0;
    this.moveDistanceValue = 0;
    this.strokeZones.clear();
    this.creditedThisStroke.clear();
    this.currentZoneValue = null;
  }

  private snapshot(justSpread: boolean): RiceSpreadSnapshot {
    const totalCoverage = this.coverage.reduce((sum, value) => sum + value, 0);
    const requiredCoverage = this.coverage.length * RICE_SPREAD.COVERAGE_PER_ZONE;
    return {
      state: this.stateValue,
      palm: { ...this.palmValue },
      onRice: this.stateValue !== "IDLE" && this.currentZoneValue !== null,
      moveDistance: this.moveDistanceValue,
      currentZone: this.currentZoneValue,
      zoneCoverage: [...this.coverage],
      totalCoverage,
      progress: totalCoverage / requiredCoverage,
      justSpread,
    };
  }
}
