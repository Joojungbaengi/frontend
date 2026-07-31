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
