import type { ArStep } from "@/lib/brewery/types";

type BreweryStep = "place" | ArStep;

const HAND_STEPS = new Set<BreweryStep>([
  "ingredient",
  "godubap",
]);

export function shouldTrackHand(step: BreweryStep) {
  return HAND_STEPS.has(step);
}
