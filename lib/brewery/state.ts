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