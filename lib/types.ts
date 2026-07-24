/**
 * 전통주 DB(data/drinks.json)와 술BTI 답변의 타입 정의.
 * 질문/선택지 매핑 근거: material/술BTI_질문지.md
 */

/** data/drinks.json 의 drinks[] 항목 */
export interface Drink {
  id: string;
  name: string;
  region: string;
  brewery: string;
  type: string;
  abv: number;
  abv_variants?: number[];
  volume_ml: number;
  sweetness: number; // 0~5
  acidity: number; // 0~5
  body: number; // 0~5
  carbonation: number; // 0~5
  aroma_intensity: number; // 0~5
  finish_length: number; // 0~5
  aroma_notes: string[];
  taste_notes: string[];
  texture: string;
  temperature: string;
  ingredients: string[];
  local_specialty: string;
  brewing: {
    method: string;
    detail: string;
    fermentation_days: string;
  };
  pairing: string[];
  situations: string[];
  beginner_friendly: boolean;
  beginner_note: string;
  awards: string[];
  story: string;
  similar?: string[];
  estimated_attributes?: string[];
  /** 존재하면 추천 풀에서 기본 제외 (예: 판매중지 제품) */
  service_caution?: string;
  description: string;
  /** 제품 이미지 경로 (public/ 기준, 예: /drinks/<id>.png) */
  image?: string;
}

/**
 * 술BTI 객관식 답변 (Q1~Q10).
 * 모든 필드는 선택적 — 답하지 않은 축은 점수 계산에서 제외한다.
 */
export interface SurveyAnswers {
  /** Q1 단맛: 목표값 (A=5, B=3, C=1). "모르겠어요"는 undefined */
  sweetness?: number;
  /** Q2 산미: 목표값 (A=4.5, B=2.5, C=0.5) */
  acidity?: number;
  /** Q3 탄산: A="high"(>=3 필수), B="some", C="none"(0 선호) */
  carbonation?: "high" | "some" | "none";
  /** Q4 바디감: 목표값 (A=4.5, B=3, C=1.5) */
  body?: number;
  /** Q5 향의 강도: 목표값 (A=4.5, B=2.5). "신경 안 써요"는 undefined */
  aromaIntensity?: number;
  /** Q6 향의 결 (복수 선택) */
  aromaTypes?: AromaType[];
  /** Q7 도수: low(<=9) / mid(10~16) / high(>=17) / any */
  abvRange?: "low" | "mid" | "high" | "any";
  /** Q8 안주 카테고리 */
  pairing?: PairingType;
  /** Q9 음용 상황 (선택형) */
  situation?: SituationType;
  /** Q9 음용 상황 직접 입력 (자연어 — AI 해석용) */
  situationText?: string;
  /** Q10 온도·마시는 스타일 (복수 선택) */
  styles?: StyleType[];
  /** Q11 자연어 취향 (Bedrock 의미 매칭용) */
  freeText?: string;
  /** 포도로 만든 술(와인)을 추천에서 완전히 제외 */
  excludeWine?: boolean;
  /** 전통주가 처음인지 (온보딩) — beginner_friendly 가중치 */
  isBeginner?: boolean;
}

export type AromaType = "grain" | "fruit" | "flower" | "nutty";
export type PairingType = "spicy" | "greasy" | "seafood" | "dessert" | "plain";
export type SituationType = "solo" | "party" | "romantic" | "family";
export type StyleType = "cold" | "slow" | "warm" | "cocktail";

/** 점수 계산 결과 (Top 10 후보) */
export interface ScoredDrink {
  drink: Drink;
  score: number;
}

/** 최종 추천 1건 */
export interface Recommendation {
  id: string;
  name: string;
  region: string;
  type: string;
  abv: number;
  description: string;
  image?: string;
  /** 취향 일치율 (%) — 점수 기반 근사치 */
  matchPct: number;
  /** AI가 작성한 추천 이유 */
  reason: string;
}

/** POST /api/recommend 응답 */
export interface RecommendResponse {
  recommendations: Recommendation[];
  /** true면 Bedrock 없이 규칙 기반으로만 생성된 결과 (개발/데모용) */
  fallback: boolean;
}

/** 비슷한 술 1건 */
export interface SimilarItem {
  id: string;
  name: string;
  region: string;
  type: string;
  abv: number;
  image?: string;
  /** 기준 술과 어떤 점이 닮았는지 (AI 작성) */
  reason: string;
}

/** POST /api/similar 응답 */
export interface SimilarResponse {
  base: { id: string; name: string };
  items: SimilarItem[];
  fallback: boolean;
}
