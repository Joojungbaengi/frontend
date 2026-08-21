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
  /** public/ 기준 절대경로 (예: "/ar/3d-assets/water_jar.glb") */
  file: string;
  /** 어느 단계에 놓을지. "common"은 모든 단계 공통(받침대 등) */
  step: ArStep;
  /** 발효·완성 타임라인 중 이 모델을 보여줄 세부 공정 id 목록 */
  processSteps?: string[];
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
  /**
   * 모델에 미리 담겨 있는 내용물을 걷어내고 빈 그릇으로 쓴다.
   *
   * 쌀이 수북이 담긴 채로 만들어진 그릇을 그대로 쓰면, 우리가 코드로 그리는 물과
   * 쌀알이 그 속에 파묻혀 아무것도 안 보인다. 씻고 불리고 터는 과정을 보여주려면
   * 그릇은 비어 있어야 한다.
   *
   * 걷어내는 기준은 두 가지다 — GPU 인스턴싱으로 흩뿌려 둔 알갱이,
   * 그리고 그릇 위쪽 절반에만 떠 있는(=담긴 것일 수밖에 없는) 메시.
   */
  hollow?: boolean;
}

/**
 * 원료 고르기 무대에 실제로 놓이는 재료 그릇/통.
 *
 * 엄지와 검지로 집어 큰 담금 그릇으로 가져가면, 안에 든 것이 그릇으로 옮겨간다.
 * 이 정보가 없는 원료(부재료 등)는 예전처럼 텍스처 원판으로 떠 있는다.
 */
export interface IngredientProp {
  /** 3D 모델 파일 (public/ 기준 경로) */
  file: string;
  /** 무대에 놓았을 때의 실제 높이(m) */
  height: number;
  /** 원본 크기 대비 배율. 지정하면 height 자동정규화 대신 이 값을 쓴다 */
  scaleFactor?: number;
  /** 무대에 놓을 때 돌려 세울 각도(rad) */
  yaw?: number;
  /**
   * 기울여 "붓는" 재료인가.
   * false 면 누룩처럼 통째로 항아리에 넣기만 하면 된다 (붓는 연출이 없다).
   */
  pour: boolean;
  /** 쏟아지는 모양 — 알갱이(쌀·밀)인가 물줄기인가 */
  flow?: "grain" | "liquid";
  /** 쏟아지는 내용물의 색 */
  flowColor?: number;
  /** 항아리 안에 쌓였을 때의 색 (없으면 flowColor) */
  fillColor?: number;
  /** 담금 그릇을 채우는 정도 0~1 — 네 재료의 합이 대략 1이 되게 나눠 준다 */
  fillAmount?: number;
  /** 재료 위에 띄우는 이름표. 없으면 원료 이름을 그대로 쓴다 */
  label?: string;
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
  /** 원료 고르기 무대에 놓을 3D 그릇. 없으면 텍스처 원판으로 뜬다 */
  prop?: IngredientProp;
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
  /**
   * data/drinks.json 의 술 id.
   * 상세 화면의 AR 버튼이 어디로 갈지, 체험을 마쳤을 때 도감에 무엇이 담길지가 이 값으로 정해진다.
   */
  drinkId: string;
  /** 완성 제품명 (예: "냥이탁주 9") */
  name: string;

  /** 원료 선택 단계 장인 인트로 */
  intro: string;
  /** 주원료가 다 모였을 때 이어질 안내(행동) 문구 — 예: "이제 고두밥부터 지어…" */
  ingredientsReady: string;

  ingredients: Ingredient[];
  /**
   * 원료 고르기 한가운데 놓이는 큰 담금 항아리.
   * 재료를 여기에 부으면 안에 내용물이 쌓인다.
   */
  ingredientBasin?: ModelDef;
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
