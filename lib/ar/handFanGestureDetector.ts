import type { XRHandLandmarkSample } from "@/lib/ar/webxrHandLandmarkProbe";

export type FanMotion = "LEFT" | "RIGHT" | "NEUTRAL";

export const HAND_FAN_GESTURE_CONFIG = {
  minHorizontalTravel: 0.12,
  deadZone: 0.02,
  minHalfSweepMs: 100,
  maxHalfSweepMs: 900,
  reversalCooldownMs: 120,
  handLostTimeoutMs: 300,
  fanFlashMs: 450,
} as const;

export interface HandFanGestureState {
  handDetected: boolean;
  palmX: number;
  palmY: number;
  motion: FanMotion;
  travel: number;
  halfSweepMs: number | null;
  fanCount: number;
  lastFanAt: number | null;
  fanFlash: boolean;
}

export interface HandFanGestureDetector {
  onLandmarks(sample: XRHandLandmarkSample): HandFanGestureState;
  tick(timestamp: number): HandFanGestureState;
  getState(): HandFanGestureState;
  reset(): HandFanGestureState;
}

function clampNormalized(value: number) {
  return Math.min(1, Math.max(0, value));
}

function motionFromDelta(delta: number): FanMotion {
  return delta < 0 ? "LEFT" : "RIGHT";
}

/**
 * Counts one fan only after two alternating, valid half-sweeps. For example:
 * LEFT (reversal confirmed) -> RIGHT (reversal confirmed) -> LEFT starts = one fan.
 * It deliberately tracks extrema rather than fixed screen zones so a stationary hand
 * and small landmark jitter cannot create a count.
 */
export function createHandFanGestureDetector(): HandFanGestureDetector {
  let handDetected = false;
  let palmX = 0;
  let palmY = 0;
  let motion: FanMotion = "NEUTRAL";
  let travel = 0;
  let halfSweepMs: number | null = null;
  let fanCount = 0;
  let lastFanAt: number | null = null;
  let fanFlashUntil = -Infinity;

  let lastSeenAt = -Infinity;
  let anchorX = 0;
  let anchorAt = 0;
  let activeDirection: FanMotion = "NEUTRAL";
  let peakX = 0;
  let peakAt = 0;
  let firstHalfDirection: FanMotion = "NEUTRAL";
  let lastReversalAt = -Infinity;

  function state(timestamp = performance.now()): HandFanGestureState {
    return {
      handDetected,
      palmX,
      palmY,
      motion,
      travel,
      halfSweepMs,
      fanCount,
      lastFanAt,
      fanFlash: timestamp < fanFlashUntil,
    };
  }

  function resetMotionState() {
    activeDirection = "NEUTRAL";
    firstHalfDirection = "NEUTRAL";
    travel = 0;
    halfSweepMs = null;
    motion = "NEUTRAL";
  }

  function startAtCurrentPalm(timestamp: number) {
    anchorX = palmX;
    anchorAt = timestamp;
    peakX = palmX;
    peakAt = timestamp;
    resetMotionState();
  }

  function markCompletedHalf(direction: FanMotion, duration: number, timestamp: number) {
    halfSweepMs = duration;
    if (firstHalfDirection === "NEUTRAL") {
      firstHalfDirection = direction;
      return;
    }

    if (direction !== firstHalfDirection) {
      fanCount++;
      lastFanAt = timestamp;
      fanFlashUntil = timestamp + HAND_FAN_GESTURE_CONFIG.fanFlashMs;
      firstHalfDirection = "NEUTRAL";
      return;
    }

    // A repeated direction means the previous pair was not a valid round-trip.
    firstHalfDirection = direction;
  }

  function resetForLostHand() {
    handDetected = false;
    palmX = 0;
    palmY = 0;
    resetMotionState();
  }

  return {
    onLandmarks(sample) {
      const landmarks = sample.landmarks;
      if (landmarks.length !== 21) {
        resetForLostHand();
        return state(sample.timestamp);
      }

      const palm = [5, 9, 13, 17].reduce(
        (sum, index) => ({
          x: sum.x + landmarks[index].x / 4,
          y: sum.y + landmarks[index].y / 4,
        }),
        { x: 0, y: 0 },
      );
      const timestamp = sample.timestamp;
      palmX = clampNormalized(palm.x);
      palmY = clampNormalized(palm.y);

      if (!handDetected) {
        handDetected = true;
        lastSeenAt = timestamp;
        startAtCurrentPalm(timestamp);
        return state(timestamp);
      }

      lastSeenAt = timestamp;
      const displacement = palmX - anchorX;
      const magnitude = Math.abs(displacement);
      const elapsed = timestamp - anchorAt;

      if (activeDirection === "NEUTRAL") {
        if (magnitude < HAND_FAN_GESTURE_CONFIG.deadZone) {
          motion = "NEUTRAL";
          return state(timestamp);
        }
        activeDirection = motionFromDelta(displacement);
        peakX = palmX;
        peakAt = timestamp;
        travel = magnitude;
        motion = activeDirection;
        return state(timestamp);
      }

      const directionSign = activeDirection === "RIGHT" ? 1 : -1;
      const signedTravel = (palmX - anchorX) * directionSign;
      if (signedTravel > (peakX - anchorX) * directionSign) {
        peakX = palmX;
        peakAt = timestamp;
        travel = Math.max(0, signedTravel);
      }

      const reversalTravel = (peakX - palmX) * directionSign;
      if (
        reversalTravel >= HAND_FAN_GESTURE_CONFIG.deadZone &&
        timestamp - lastReversalAt >= HAND_FAN_GESTURE_CONFIG.reversalCooldownMs
      ) {
        const completedTravel = Math.abs(peakX - anchorX);
        const completedDuration = peakAt - anchorAt;
        const validHalfSweep =
          completedTravel >= HAND_FAN_GESTURE_CONFIG.minHorizontalTravel &&
          completedDuration >= HAND_FAN_GESTURE_CONFIG.minHalfSweepMs &&
          completedDuration <= HAND_FAN_GESTURE_CONFIG.maxHalfSweepMs;

        if (validHalfSweep) markCompletedHalf(activeDirection, completedDuration, timestamp);
        else if (completedDuration > HAND_FAN_GESTURE_CONFIG.maxHalfSweepMs) {
          firstHalfDirection = "NEUTRAL";
          halfSweepMs = null;
        }

        anchorX = peakX;
        anchorAt = peakAt;
        peakX = palmX;
        peakAt = timestamp;
        activeDirection = motionFromDelta(-directionSign);
        motion = activeDirection;
        travel = reversalTravel;
        lastReversalAt = timestamp;
        return state(timestamp);
      }

      if (elapsed > HAND_FAN_GESTURE_CONFIG.maxHalfSweepMs) {
        startAtCurrentPalm(timestamp);
        return state(timestamp);
      }

      motion = Math.abs(palmX - peakX) < HAND_FAN_GESTURE_CONFIG.deadZone
        ? activeDirection
        : motionFromDelta(palmX - peakX);
      return state(timestamp);
    },

    tick(timestamp) {
      if (
        handDetected &&
        timestamp - lastSeenAt > HAND_FAN_GESTURE_CONFIG.handLostTimeoutMs
      ) {
        resetForLostHand();
      }
      return state(timestamp);
    },

    getState() {
      return state();
    },

    reset() {
      resetForLostHand();
      fanCount = 0;
      lastFanAt = null;
      fanFlashUntil = -Infinity;
      return state();
    },
  };
}
