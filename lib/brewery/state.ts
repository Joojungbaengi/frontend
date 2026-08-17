import type { ArStep } from "@/lib/brewery/types";

export type BreweryStep = "place" | ArStep;

export type BreweryState = {
  step: BreweryStep;
  surface: "floor" | "table";
  placed: boolean;
  selected: Set<string>;

  godubap: number;
  rinseTurns: number;
  rinsePartial: number;
  soakAt: number;

  coolFans: number;
  coolDone: boolean;
  quizDone: boolean;

  temp: number;
  ferment: number;
  fstage: number;
  press: number;
  tempLog: number[];

  xr: boolean;
  hand: boolean;
  isInitializing: boolean;
};

export function rinseActive(
  hand: boolean,
  godubap: number,
  rinseTurns: number,
  requiredRinseTurns: number,
) {
  return hand && godubap === 0 && rinseTurns < requiredRinseTurns;
}

export function soakActive(
  hand: boolean,
  godubap: number,
) {
  return hand && godubap === 1;
}

export function coolingActive(
  hand: boolean,
  godubap: number,
  lastGodubapStep: number,
  quizDone: boolean,
  coolDone: boolean,
) {
  return (
    hand &&
    godubap === lastGodubapStep &&
    quizDone &&
    !coolDone
  );
}

export function createBreweryState(): BreweryState {
  return {
    step: "place",
    surface: "floor", //실제 크기
    placed: false,
    selected: new Set<string>(),

    godubap: 0,
    rinseTurns: 0, //세미 단계에서 지금까지 헹군 바퀴 수
    rinsePartial: 0, //지금 돌고 있는 바퀴의 진행분(0~1) — 막대가 뚝뚝 끊기지 않게
    soakAt: 0, //침수를 시작한 시각 (0이면 아직 안 담갔다)

    coolFans: 0, //냉각 단계에서 지금까지 부친 횟수
    coolDone: false, //다 식혔나 — 이게 참이 돼야 장인 퀴즈가 열린다
    quizDone: false,

    temp: 27,
    ferment: 0,
    fstage: 0,
    press: 0,
    tempLog: [],

    xr: false,
    hand: false, //손 인식이 돌고 있는가 (AR·카메라 모드 공통)
    isInitializing: true,
  };
}

export function arStepForDocument(step: BreweryStep) {
  return step === "done" ? "ferment" : step;
}

export function resetSelectedIngredients(
  selected: Set<string>,
) {
  selected.clear();
}

export function getIngredientSelectionState<
  T extends { id: string; essential: boolean }
>(
  ingredients: T[],
  selected: Set<string>,
) {
  const needed = ingredients.filter(
    (i) => i.essential && !selected.has(i.id)
  );

  const extras = ingredients.filter(
    (i) => !i.essential && selected.has(i.id)
  );

  return { needed, extras };
}

export function getIngredientButtonText(
  essentialCount: number,
  neededCount: number,
  extrasCount: number,
) {
  if (neededCount > 0) {
    return `주원료 ${essentialCount - neededCount}/${essentialCount} 선택`;
  }

  if (extrasCount > 0) {
    return `주원료 ${essentialCount}종 · 부재료 ${extrasCount}종`;
  }

  return `주원료 ${essentialCount}개 선택 완료`;
}

export function isIngredientSelectionComplete(
  neededCount: number,
) {
  return neededCount === 0;
}

export function getIngredientCoachText<T extends {
  name: string;
  essential: boolean;
  flavorNote?: string;
}>(
  justAdded: T | undefined,
  needed: T[],
  extrasCount: number,
  essentialNames: string,
  ingredientsReady: string,
) {
  if (justAdded && !justAdded.essential) {
    return justAdded.flavorNote ?? "부재료를 더하면 향이 한결 깊어진다네.";
  }

  if (needed.length > 0) {
    return `${essentialNames}이 주원료라네. ${needed
      .map((i) => i.name)
      .join("·")}을(를) 마저 담아보게.`;
  }

  return (
    (extrasCount > 0
      ? "좋아, 주원료에 부재료까지 갖췄네. "
      : "좋아, 주원료가 다 모였네. ") + ingredientsReady
  );
}