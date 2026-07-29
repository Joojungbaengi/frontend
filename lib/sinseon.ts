import type { AromaType, StyleType, SurveyAnswers } from "@/lib/types";

/**
 * 술BTI 결과 유형(신선) 8종 — 정의와 판정 로직.
 * 이름·설명·궁합 원문: material/신선.md
 * 일러스트: public/sinseon/<id>.webp (3:4)
 */

export type SinseonId = "chilly" | "sweet" | "sour" | "rice" | "flower" | "moon" | "thick" | "herb";

export interface Sinseon {
  id: SinseonId;
  /** 유형 번호 (1~8) — 결과 화면 배지에 표시 */
  no: number;
  name: string;
  /** 배지에 붙는 짧은 취향 축 라벨 */
  axis: string;
  /** 족자 아래 한 줄 소개 */
  tagline: string;
  /** "이런 신선입니다" 본문 */
  description: string;
  image: string;
  /** 잘 맞는 신선 */
  match: { id: SinseonId; note: string };
  /** 안 맞는 신선 */
  clash: { id: SinseonId; note: string };
}

export const SINSEON: Record<SinseonId, Sinseon> = {
  chilly: {
    id: "chilly",
    no: 1,
    name: "앗 차가! 신선",
    axis: "청량 · 가벼운 바디",
    tagline: "미지근한 술은 사양합니다",
    description:
      "당신은 '앗 차가!' 신선이군요! 미지근한 술은 쳐다도 안 보고, 톡 쏘며 넘어가야 그제야 \"캬\" 소리가 나오시죠. 걸쭉하고 묵직한 술은 두 모금째부터 슬슬 부담스러우실 겁니다. 냉장고 문 여는 순간 이미 술자리가 시작인 분이네요.",
    image: "/sinseon/chilly.webp",
    match: { id: "sour", note: "시원한 거, 상큼한 거. 잔 비우는 속도까지 비슷합니다." },
    clash: { id: "thick", note: "사발째 걸쭉한 걸 권할 겁니다. 정중히 사양하세요." },
  },
  sweet: {
    id: "sweet",
    no: 2,
    name: "달디달고 달디단 신선",
    axis: "단맛 · 저도수",
    tagline: "쓴맛 참는 건 취미가 아니라서",
    description:
      "당신은 달디달고 달디단 신선이군요! 쓴맛 참아가며 마시는 건 취미가 아니시죠, 인상 쓸 거면 뭐하러 마십니까. 도수 낮아도 전혀 아쉽지 않고, 오히려 오래 기분 좋게 가실 분입니다. 옆에서 \"그건 술이 아니라 음료수인데\" 해도 별로 안 찔리시죠?",
    image: "/sinseon/sweet.webp",
    match: { id: "flower", note: "달면 달아서 좋고 향 좋으면 더 좋고. 취향이 사이좋게 겹칩니다." },
    clash: { id: "moon", note: "\"한 잔만 마셔봐\"라며 독주를 밀어 넣는 사람입니다." },
  },
  sour: {
    id: "sour",
    no: 3,
    name: "눈 번쩍 뜨이는 신선",
    axis: "산미 · 부드러운 질감",
    tagline: "새콤해야 잔이 빨리 빕니다",
    description:
      "당신은 눈 번쩍 뜨이는 신선이군요! 밋밋한 술 앞에서 제일 시무룩해지는 쪽입니다. 혀끝을 탁 치는 새콤함이 있어야 \"이제 좀 마실 만하네\" 소리가 나오는데, 그렇다고 아무거나 시큼하면 되는 것도 아니죠. 부드럽게 감기면서 상큼한 그 선을 귀신같이 아시더라고요.",
    image: "/sinseon/sour.webp",
    match: { id: "chilly", note: "산뜻한 쪽으로 취향이 나란해서 술 고르는 데 5초면 끝납니다." },
    clash: { id: "rice", note: "새콤한 게 대체 왜 좋냐고 진심으로 궁금해합니다." },
  },
  rice: {
    id: "rice",
    no: 4,
    name: "한국인은 역시 밥심!",
    axis: "구수한 곡물향",
    tagline: "결국 쌀로 돌아왔습니다",
    description:
      "당신은… 신선이 아니라 밥이군요! 화려한 술도 여럿 거쳐왔지만 결국 쌀로 돌아오셨습니다. 유행하는 술은 궁금해서 한 번 마셔보고 두 번은 잘 안 가시죠. 분명 술상인데 이상하게 밥상 받은 것처럼 마음이 놓이실 겁니다.",
    image: "/sinseon/rice.webp",
    match: { id: "thick", note: "구수하고 든든한 쪽으로 통합니다. 안주 고를 때도 안 싸워요." },
    clash: { id: "sour", note: "자꾸 시큼한 걸 권해서 애꿎은 밥맛만 떨어집니다." },
  },
  flower: {
    id: "flower",
    no: 5,
    name: "꽃보다 신선",
    axis: "꽃 · 허브향",
    tagline: "마시기 전에 향부터",
    description:
      "당신은 꽃보다 신선이군요! 잔 받고 바로 안 마시고 코부터 대는 바람에 \"안 마셔?\" 소리 좀 들으셨겠어요. 향이 좋으면 대화가 잠깐 끊겨도 어쩔 수 없죠. 맛은 삼키면 끝이지만 향은 그날 밤까지 따라오니까요.",
    image: "/sinseon/flower.webp",
    match: { id: "sweet", note: "향과 단맛에 진심인 둘. 술상이 제일 화사해집니다." },
    clash: { id: "herb", note: "똑같이 향 얘기를 하는데 한쪽은 꽃, 한쪽은 한약입니다." },
  },
  moon: {
    id: "moon",
    no: 6,
    name: "곤드레 만드레 신선",
    axis: "고도수 · 긴 여운",
    tagline: "한 잔을 오래 붙듭니다",
    description:
      "당신은 곤드레 만드레 신선이군요! 여러 잔보다 한 잔을 오래 붙드는 쪽이고, 도수 높다는 말에 물러서기는커녕 눈이 반짝이시죠. 삼킨 뒤 길게 올라오는 여운 때문에 다음 잔이 자꾸 늦어집니다. 그러다 정신 차려보면 달이 꽤 높이 떠 있고요.",
    image: "/sinseon/moon.webp",
    match: { id: "herb", note: "진하고 깊은 술로 밤을 새울 수 있는 몇 안 되는 상대." },
    clash: { id: "sweet", note: "달다고 홀짝이다 먼저 뻗을까 봐 자꾸 신경 쓰입니다." },
  },
  thick: {
    id: "thick",
    no: 7,
    name: "찐~하게 한잔하는 신선",
    axis: "묵직한 바디 · 감칠맛",
    tagline: "잔보다 사발이 편합니다",
    description:
      "당신은 찐~하게 한 잔 하는 신선이군요! 물처럼 가벼운 술을 마시면 어쩐지 손해 본 기분이 드시죠. 걸쭉하게 목을 채우고 내려가야 \"한 잔 했다\"는 말이 나오고, 감칠맛만 진하면 안주는 없어도 그만입니다. 잔보다 사발이 편하신 데는 다 이유가 있었네요.",
    image: "/sinseon/thick.webp",
    match: { id: "rice", note: "묵직하고 구수한 한 상. 말 안 해도 잔이 맞습니다." },
    clash: { id: "chilly", note: "차갑고 가벼운 것만 찾아서 같이 마시면 영 심심합니다." },
  },
  herb: {
    id: "herb",
    no: 8,
    name: "산삼 캐다 말고 한잔하는 신선",
    axis: "약재 · 견과향",
    tagline: "이게 술이야 보약이야",
    description:
      "당신은 산삼 캐다 말고 한잔하는 신선이군요! 술에서 한약방 냄새가 나면 눈이 커지시죠. 잣이니 오미자니 약초니 하는 말만 붙으면 일단 한 잔 받고 보시고요. 남들은 \"이게 술이야 보약이야\" 하지만, 당신한테는 그게 칭찬입니다.",
    image: "/sinseon/herb.webp",
    match: { id: "moon", note: "향 진하고 도수 높은 술 앞에서 말이 제일 잘 통합니다." },
    clash: { id: "flower", note: "향을 논하다가 취향이 정반대로 갈라집니다." },
  },
};

/** 동점일 때의 우선순위 (유형 번호 순) */
const ORDER: SinseonId[] = ["chilly", "sweet", "sour", "rice", "flower", "moon", "thick", "herb"];

/**
 * 답변별 유형 점수.
 * 유형의 핵심 축에 +3, 거들어 주는 축에 +1~2, 정면으로 어긋나는 답에 -1.
 */
function scores(a: SurveyAnswers): Record<SinseonId, number> {
  const aroma = (t: AromaType) => a.aromaTypes?.includes(t) ?? false;
  const style = (s: StyleType) => a.styles?.includes(s) ?? false;
  const light = a.body !== undefined && a.body <= 2;
  const heavy = a.body !== undefined && a.body >= 4;
  const strongAroma = a.aromaIntensity !== undefined && a.aromaIntensity >= 4;

  return {
    chilly:
      (a.carbonation === "high" ? 3 : a.carbonation === "some" ? 1 : -1) +
      (light ? 2 : 0) +
      (style("cold") ? 1 : 0) +
      (style("cocktail") ? 1 : 0),
    sweet:
      (a.sweetness === undefined ? 0 : a.sweetness >= 4 ? 3 : a.sweetness >= 3 ? 1 : -1) +
      (a.abvRange === "low" ? 2 : 0) +
      (a.pairing === "dessert" ? 1 : 0),
    sour:
      (a.acidity === undefined ? 0 : a.acidity >= 4 ? 3 : a.acidity >= 2 ? 1 : -1) +
      (light ? 1 : 0) +
      (a.pairing === "seafood" ? 1 : 0),
    rice:
      (aroma("grain") ? 3 : 0) +
      (a.body === 3 ? 1 : 0) +
      (a.pairing === "spicy" ? 1 : 0) +
      (a.sweetness !== undefined && a.sweetness <= 2 ? 1 : 0),
    flower:
      (aroma("flower") ? 3 : 0) +
      (strongAroma ? 2 : 0) +
      (a.situation === "romantic" ? 1 : 0),
    moon:
      (a.abvRange === "high" ? 3 : a.abvRange === "mid" ? 1 : a.abvRange === "low" ? -1 : 0) +
      (style("slow") ? 2 : 0) +
      (a.carbonation === "none" ? 1 : 0),
    thick:
      (heavy ? 3 : 0) +
      (a.carbonation === "none" ? 1 : 0) +
      (a.pairing === "greasy" ? 1 : 0) +
      (style("warm") ? 1 : 0),
    herb:
      (aroma("nutty") ? 3 : 0) +
      (strongAroma ? 1 : 0) +
      (style("warm") ? 1 : 0) +
      (a.situation === "family" ? 1 : 0),
  };
}

/** 술BTI 객관식 답변으로 신선 유형 1종을 결정한다. */
export function pickSinseon(answers: SurveyAnswers): Sinseon {
  const s = scores(answers);
  const best = ORDER.reduce((a, b) => (s[b] > s[a] ? b : a), ORDER[0]);
  return SINSEON[best];
}
