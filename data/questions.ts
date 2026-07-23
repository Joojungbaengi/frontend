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
  /** multi 질문에서 aromaTypes에 추가되는 값 */
  aroma?: NonNullable<SurveyAnswers["aromaTypes"]>[number];
}

export interface Question {
  key: string;
  /** 상단 소제목 (예: 단맛) */
  topic: string;
  q: string;
  options: QuestionOption[];
  /** true면 복수 선택 (Q6) */
  multi?: boolean;
}

export const QUESTIONS: Question[] = [
  {
    key: "sweetness",
    topic: "단맛",
    q: "잘 익은 포도의 진한 달콤함,\n어느 정도가 좋으세요?",
    options: [
      { label: "🍯 꿀처럼 달게 — 디저트 같은 달콤함", patch: { sweetness: 5 } },
      { label: "🍇 은은하게 달게 — 물리지 않을 만큼", patch: { sweetness: 3 } },
      { label: "🌾 드라이하게 — 단맛은 거의 없어도 돼요", patch: { sweetness: 1 } },
      { label: "🤷 잘 모르겠어요", patch: {} },
    ],
  },
  {
    key: "acidity",
    topic: "산미",
    q: "요거트의 부드러운 새콤함부터\n레몬의 톡 쏘는 신맛까지 — 술의 신맛은?",
    options: [
      { label: "🍋 새콤함이 좋아요 — 산미가 술맛을 살려요", patch: { acidity: 4.5 } },
      { label: "🥛 부드러운 산미만 — 요거트 정도로", patch: { acidity: 2.5 } },
      { label: "🚫 신맛은 별로예요", patch: { acidity: 0.5 } },
    ],
  },
  {
    key: "carbonation",
    topic: "탄산감",
    q: "톡톡 터지는 탄산,\n술에서도 필요하세요?",
    options: [
      { label: "🫧 톡 쏘는 청량함 필수", patch: { carbonation: "high" } },
      { label: "🌊 살짝만 — 미세한 탄산감 정도", patch: { carbonation: "some" } },
      { label: "🍶 없는 게 좋아요 — 잔잔하고 매끄럽게", patch: { carbonation: "none" } },
    ],
  },
  {
    key: "body",
    topic: "질감",
    q: "우유처럼 진하고 걸쭉한 술 vs\n물처럼 가볍고 깔끔한 술?",
    options: [
      { label: "🥛 걸쭉하고 진하게 — 씹히는 듯한 묵직함", patch: { body: 4.5 } },
      { label: "⚖️ 적당한 무게감", patch: { body: 3 } },
      { label: "💧 가볍고 깔끔하게 — 산뜻한 목 넘김", patch: { body: 1.5 } },
    ],
  },
  {
    key: "aromaIntensity",
    topic: "향의 강도",
    q: "잔을 들었을 때 확 퍼지는 향이 좋은지,\n은근히 깔리는 향이 좋은지?",
    options: [
      { label: "🌸 향이 풍성한 술 — 향 맡는 게 술의 재미", patch: { aromaIntensity: 4.5 } },
      { label: "🍃 은은한 향 — 배경처럼 깔리는 정도", patch: { aromaIntensity: 2.5 } },
      { label: "😌 향은 신경 안 써요", patch: {} },
    ],
  },
  {
    key: "aromaTypes",
    topic: "향의 결 · 복수 선택",
    q: "어떤 향에 끌리세요?\n좋아하는 향을 모두 골라주세요",
    multi: true,
    options: [
      { label: "🍚 쌀·곡물의 구수함 — 쌀밥, 누룽지, 누룩", patch: {}, aroma: "grain" },
      { label: "🍎 과일의 상큼함 — 사과, 포도, 배", patch: {}, aroma: "fruit" },
      { label: "🌼 꽃·허브의 향긋함 — 국화, 연꽃, 솔잎", patch: {}, aroma: "flower" },
      { label: "🌰 고소한 견과·약재 — 잣, 율무, 오미자", patch: {}, aroma: "nutty" },
    ],
  },
  {
    key: "abvRange",
    topic: "도수와 취기",
    q: "오늘의 페이스,\n주량과 취하고 싶은 정도는?",
    options: [
      { label: "🌙 가볍게 기분만 — 낮은 도수로 오래", patch: { abvRange: "low" } },
      { label: "🌗 적당히 알딸딸하게 — 와인 도수까지", patch: { abvRange: "mid" } },
      { label: "🌚 깊고 진하게 — 독해도 풍미가 깊게", patch: { abvRange: "high" } },
      { label: "💪 도수는 상관없어요", patch: { abvRange: "any" } },
    ],
  },
  {
    key: "pairing",
    topic: "안주 궁합",
    q: "오늘 술상에 오를 음식,\n가장 가까운 건?",
    options: [
      { label: "🌶️ 매콤한 한식 — 떡볶이, 제육, 쭈꾸미", patch: { pairing: "spicy" } },
      { label: "🥓 기름진 음식 — 전, 튀김, 삼겹살", patch: { pairing: "greasy" } },
      { label: "🐟 해산물·회 — 조개, 굴, 초밥", patch: { pairing: "seafood" } },
      { label: "🧀 치즈·디저트 — 과일, 약과, 초콜릿", patch: { pairing: "dessert" } },
    ],
  },
  {
    key: "situation",
    topic: "음용 상황",
    q: "누구와, 어디서\n마시는 장면인가요?",
    options: [
      { label: "🏠 혼술 — 하루 끝의 나만의 한 잔", patch: { situation: "solo" } },
      { label: "👥 친구들과 왁자지껄 — 모임, 파티", patch: { situation: "party" } },
      { label: "🧺 나들이·여행 — 피크닉, 지역 여행", patch: { situation: "picnic" } },
      { label: "🎁 선물·특별한 날 — 명절, 기념일", patch: { situation: "gift" } },
    ],
  },
  {
    key: "style",
    topic: "온도와 속도",
    q: "마시는 스타일은\n어느 쪽이세요?",
    options: [
      { label: "🧊 차갑게, 시원시원하게", patch: { style: "cold" } },
      { label: "🥃 천천히 음미하며 — 향과 여운을", patch: { style: "slow" } },
      { label: "♨️ 따뜻하게 데워서도 궁금해요", patch: { style: "warm" } },
      { label: "🍹 하이볼·칵테일로 섞어서", patch: { style: "cocktail" } },
    ],
  },
];
