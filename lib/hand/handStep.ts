import type { BreweryStep } from "@/lib/brewery/state";

const HAND_STEPS = new Set<BreweryStep>([
  "ingredient",
  "godubap",
]);

export function shouldTrackHand(step: BreweryStep) {
  return HAND_STEPS.has(step);
}