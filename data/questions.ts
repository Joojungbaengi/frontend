import type { SurveyAnswers } from "@/lib/types";

/**
 * 술BTI 질문 데이터 — material/술BTI_질문지.md (v1) 기반.
 * 각 선택지는 SurveyAnswers의 일부(patch)로 매핑되어 답을 누적한다.
 * Q6(향의 결)만 복수 선택.
 */

export interface QuestionOption {
  label: string;
  /** 이 선택지를 고르면 답변에 병합되는 값 */
  patch: Partial<SurveyAnswers>;
  /** 복수 선택 질문에서 multiField 배열에 추가되는 값 */
  value?: string;
  /** true면 선택 시 직접 입력창을 띄운다 (자동 진행 안 함) */
  custom?: boolean;
}

export interface Question {
  key: string;
  /** 상단 소제목 (예: 단맛) */
  topic: string;
  q: string;
  options: QuestionOption[];
  /** true면 복수 선택 */
  multi?: boolean;
  /** 복수 선택 질문이 값을 모으는 SurveyAnswers 배열 필드 */
  multiField?: "aromaTypes" | "styles";
}

export const QUESTIONS: Question[] = [
  {
    key: "sweetness",
    topic: "단맛",
    q: "단맛은 어느 정도가\n좋으세요?",
    options: [
      { label: "🍯 사탕처럼 달달한 게 좋아요", patch: { sweetness: 5 } },
      { label: "🍇 은은하게 단 정도가 좋아요", patch: { sweetness: 3 } },
      { label: "🌾 단맛은 거의 없는 게 좋아요", patch: { sweetness: 1 } },
      { label: "🍷 포도로 만든 술(와인)은 안 좋아해요", patch: { excludeWine: true } },
      { label: "🤷 잘 모르겠어요", patch: {} },
    ],
  },
  {
    key: "acidity",
    topic: "산미",
    q: "새콤한 신맛,\n좋아하세요?",
    options: [
      { label: "🍋 네, 새콤한 게 좋아요", patch: { acidity: 4.5 } },
      { label: "🙂 살짝 있는 정도가 좋아요", patch: { acidity: 2.5 } },
      { label: "🚫 술에서 신맛은 별로예요", patch: { acidity: 0.5 } },
    ],
  },
  {
    key: "carbonation",
    topic: "탄산감",
    q: "톡 쏘는 탄산감,\n술에서도 좋아하세요?",
    options: [
      { label: "🫧 톡 쏘는 청량함이 좋아요", patch: { carbonation: "high" } },
      { label: "🌊 살짝만 있으면 좋아요", patch: { carbonation: "some" } },
      { label: "🍶 없는 게 좋아요", patch: { carbonation: "none" } },
    ],
  },
  {
    key: "body",
    topic: "질감",
    q: "어떤 질감이\n좋으세요?",
    options: [
      { label: "🥛 걸쭉하고 진한 게 좋아요", patch: { body: 4.5 } },
      { label: "⚖️ 적당한 무게감이 좋아요", patch: { body: 3 } },
      { label: "💧 가볍고 깔끔한 게 좋아요", patch: { body: 1.5 } },
    ],
  },
  {
    key: "aromaIntensity",
    topic: "향의 강도",
    q: "향은 어느 정도가\n좋으세요?",
    options: [
      { label: "🌸 향이 풍성한 술이 좋아요", patch: { aromaIntensity: 4.5 } },
      { label: "🍃 은은한 향 정도가 좋아요", patch: { aromaIntensity: 2.5 } },
      { label: "😌 향은 별로 신경 안 써요", patch: {} },
    ],
  },
  {
    key: "aromaTypes",
    topic: "향의 결",
    q: "어떤 향에 끌리세요?\n좋아하는 향을 모두 골라주세요",
    multi: true,
    multiField: "aromaTypes",
    options: [
      { label: "🍚 쌀·곡물의 구수한 향 (누룽지, 누룩)", patch: {}, value: "grain" },
      { label: "🍎 과일의 상큼한 향 (사과, 포도, 배)", patch: {}, value: "fruit" },
      { label: "🌼 꽃·허브의 향긋한 향 (국화, 연꽃, 솔잎)", patch: {}, value: "flower" },
      { label: "🌰 고소한 견과·약재 향 (잣, 율무, 오미자)", patch: {}, value: "nutty" },
    ],
  },
  {
    key: "abvRange",
    topic: "도수",
    q: "오늘은 어느 정도로\n마시고 싶으세요?",
    options: [
      { label: "🌙 가볍게 기분만 낼래요", patch: { abvRange: "low" } },
      { label: "🌗 적당히 알딸딸하게요", patch: { abvRange: "mid" } },
      { label: "🌚 깊고 진하게 마실래요", patch: { abvRange: "high" } },
      { label: "💪 도수는 상관없어요", patch: { abvRange: "any" } },
    ],
  },
  {
    key: "pairing",
    topic: "안주 궁합",
    q: "함께 먹을 안주,\n가장 가까운 건요?",
    options: [
      { label: "🌶️ 매콤한 한식 (떡볶이, 제육)", patch: { pairing: "spicy" } },
      { label: "🥓 기름진 음식 (전, 튀김, 삼겹살)", patch: { pairing: "greasy" } },
      { label: "🐟 해산물이나 회 (조개, 굴, 초밥)", patch: { pairing: "seafood" } },
      { label: "🧀 치즈나 디저트 (과일, 약과, 초콜릿)", patch: { pairing: "dessert" } },
    ],
  },
  {
    key: "situation",
    topic: "음용 상황",
    q: "누구와, 어디서\n마실 예정인가요?",
    options: [
      { label: "🏠 혼자 여유롭게", patch: { situation: "solo" } },
      { label: "👥 친구들과 왁자지껄하게", patch: { situation: "party" } },
      { label: "💕 연인과 로맨틱하게", patch: { situation: "romantic" } },
      { label: "👪 부모님과 함께", patch: { situation: "family" } },
      { label: "✍️ 직접 입력할래요", patch: {}, custom: true },
    ],
  },
  {
    key: "style",
    topic: "온도와 속도",
    q: "어떻게 마시는 걸 좋아하세요?\n해당하는 걸 모두 골라주세요",
    multi: true,
    multiField: "styles",
    options: [
      { label: "🧊 차갑게 시원하게요", patch: {}, value: "cold" },
      { label: "🥃 천천히 음미하면서요", patch: {}, value: "slow" },
      { label: "♨️ 따뜻하게 데워서도 좋아요", patch: {}, value: "warm" },
      { label: "🍹 하이볼이나 칵테일로요", patch: {}, value: "cocktail" },
    ],
  },
];
