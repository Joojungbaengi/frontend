/**
 * AR 양조 체험 — 술 종류별 "바뀌는 데이터"의 타입 정의.
 *
 * 공통 엔진(components/ArBreweryExperience.tsx)은 아래 Recipe 하나만 받아 동작한다.
 * 새로운 술을 추가하려면 lib/brewery/recipes/ 아래에 Recipe 객체 파일 하나만 만들고
 * lib/brewery/recipes/index.ts 레지스트리에 등록하면 된다.
 * (원재료 종류·개수, 공정 단계 수, 문구, 3D 모델이 모두 달라져도 엔진은 그대로 쓴다.)
 */

export type ArStep = "ingredient" | "godubap" | "ferment" | "done" | "common";

export interface ModelDef {
  id: string;
  /** public/ 기준 절대경로 (예: "/models/xxx/water_jar.glb") */
  file: string;
  /** 어느 단계에 놓을지. "common"은 모든 단계 공통(받침대 등) */
  step: ArStep;
  /** 실제 높이(m). 코드가 자동으로 크기를 보정한다 */
  height: number;
  /** 받침 위로 띄우는 높이(보통 0.03) */
  y: number;
  /** >0 이면 이 개수만큼 받침 위에 흩뿌린다 (고두밥 뿌리기용) */
  scatter?: number;
  /** true면 위에서 내려앉는 모션으로 등장 (보자기 덮기용) */
  drop?: boolean;
  /** 원본(native) 크기 대비 배율. 지정하면 height 자동정규화 대신 이 값으로 크기를 정한다.
   *  (예: 0.05 = 원래 크기의 5%. 납작한 보자기·채반처럼 height 정규화가 안 맞는 모델에 쓴다) */
  scaleFactor?: number;
}

export interface Ingredient {
  id: string;
  name: string;
  /** 카드/3D 링에 쓰는 투명 PNG 텍스처 (public/ 기준 경로) */
  texture: string;
  /** 주원료(필수)면 true, 부재료(선택)면 false */
  essential: boolean;
  /** 부재료일 때, 담으면 장인이 들려주는 향 설명 */
  flavorNote?: string;
}

export interface ProcessStep {
  id: string;
  /** 탭에 보이는 짧은 이름 (한자 없이) */
  name: string;
  /** 그 단계 설명 문구 */
  caption: string;
  /** 고두밥 단계 중 '증자(찌기)'처럼 김이 피어오르는 단계면 true */
  steam?: boolean;
  /** 고두밥 단계 그릇에 담긴 물 높이 0(없음)~1(가득). 침수=1, 탈수=0 처럼 쓴다 */
  water?: number;
  /** 이 단계에서 보여줄 무대 모델 id 목록(recipe.godubapModels 의 id) */
  models?: string[];
  /** 이 단계에서 화면 가장자리를 살짝 어둡게(비네트) 처리 */
  dark?: boolean;
}

export interface Quiz {
  question: string;
  choices: { text: string; correct: boolean }[];
}

export interface Recipe {
  id: string;
  /** 완성 제품명 (예: "냥이탁주 9") */
  name: string;

  /** 원료 선택 단계 장인 인트로 */
  intro: string;
  /** 주원료가 다 모였을 때 이어질 안내(행동) 문구 — 예: "이제 고두밥부터 지어…" */
  ingredientsReady: string;

  ingredients: Ingredient[];
  models: ModelDef[];
  /** 고두밥 단계에서 하위 단계별로 갈아 끼우는 무대 모델들(그릇·솥·채반·보자기·쌀 등) */
  godubapModels?: ModelDef[];
  /** 냉각/혼합 단계에 채반 위에 얹는, 고두밥(쌀) 텍스처를 입힌 직사각 평면.
   *  step.models 목록에 "rice_plane" 을 넣으면 표시된다. width×depth (예: 3:5).
   *  채반(metal_food_tray)이 있으면 그 크기에 맞춰 자동으로 덮고, 없으면 이 값을 쓴다. */
  godubapRicePlane?: { texture: string; width: number; depth: number; y: number };
  /** 완성 공정 '출고' 단계에서 나타나는 완성 제품 모델 (예: Nyangi.glb) */
  finishModel?: ModelDef;

  /** 고두밥 만들기 탭 (세미~냉각 등) */
  godubapSteps: ProcessStep[];
  /** 담금·발효 탭 (혼합~후발효 등). 마지막 항목이 '자동 발효'가 도는 단계 */
  fermentSteps: ProcessStep[];
  /** 완성 공정 탭 (압착~출고 등) */
  pressSteps: ProcessStep[];

  /** 고두밥 마지막 단계에서 뜨는 장인 퀴즈 */
  quiz: Quiz;

  ferment: {
    /** 최적 발효 온도(℃) — 온도 게임과 양조 점수의 기준 */
    optimalC: number;
  };

  report: {
    /** 제조 방식 한 줄 (예: "삼양주 · 세 번 담금 · 수작업 100%") */
    method: string;
    /** 부재료 id -> 맛 프로파일 한 줄 */
    notes: Record<string, string>;
    /** 리포트에 덧붙일 술별 상세 행 (완전발효·저온숙성·총 기간 등) */
    extraRows?: { label: string; value: string }[];
  };

  finish: {
    image: string;
    alt: string;
    /** 완성 화면 설명 문단 */
    note: string;
  };
}