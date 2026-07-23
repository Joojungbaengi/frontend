/**
 * Bedrock Claude에 보낼 프롬프트 템플릿 (기획/AI.md의 프롬프트 예시 기반).
 * 핵심 원칙: AI의 사전 지식이 아니라 우리가 구축한 술 속성 데이터에만 근거해 추천한다.
 */
import type { ScoredDrink, SurveyAnswers } from "./types";

export const SYSTEM_PROMPT = `너는 경기도 전통주 전문 소믈리에다. 유저의 취향과 술 목록을 보고 가장 잘 맞는 술 3개를 골라 추천 이유를 작성한다.

규칙:
- 아래 술 목록에 있는 술만 추천한다. 목록에 없는 술을 지어내지 않는다.
- 추천 이유는 반드시 각 술의 제공된 속성(맛, 향, 페어링, 지역성)에 근거해서만 작성한다. 사전 지식으로 술을 설명하지 않는다.
- 추천 이유는 유저의 답변 내용과 연결해서, 왜 이 술이 이 유저에게 맞는지 한국어 2~3문장으로 친근하게 작성한다.
- 정확히 3개를 고른다.`;

/** 객관식 답변을 자연어 요약으로 변환 (프롬프트 가독성용) */
function summarizeAnswers(answers: SurveyAnswers): string {
  const lines: string[] = [];
  const scale = (v: number | undefined, high: string, low: string) =>
    v === undefined ? null : v >= 3.5 ? high : v <= 1.5 ? low : "보통";

  const sweet = scale(answers.sweetness, "달콤한 술 선호", "드라이한 술 선호");
  if (sweet) lines.push(`- 단맛: ${sweet}`);
  const acid = scale(answers.acidity, "새콤한 산미 선호", "신맛 기피");
  if (acid) lines.push(`- 산미: ${acid}`);
  if (answers.carbonation) {
    const map = { high: "톡 쏘는 탄산 필수", some: "약한 탄산 선호", none: "탄산 없는 잔잔한 술 선호" };
    lines.push(`- 탄산: ${map[answers.carbonation]}`);
  }
  const body = scale(answers.body, "걸쭉하고 진한 질감 선호", "가볍고 깔끔한 질감 선호");
  if (body) lines.push(`- 질감: ${body}`);
  const aroma = scale(answers.aromaIntensity, "향이 풍성한 술 선호", "향은 은은하게");
  if (aroma) lines.push(`- 향의 강도: ${aroma}`);
  if (answers.aromaTypes?.length) {
    const map = { grain: "쌀·곡물의 구수함", fruit: "과일의 상큼함", flower: "꽃·허브의 향긋함", nutty: "고소한 견과·약재" };
    lines.push(`- 좋아하는 향: ${answers.aromaTypes.map((t) => map[t]).join(", ")}`);
  }
  if (answers.abvRange && answers.abvRange !== "any") {
    const map = { low: "저도수(9도 이하)로 가볍게", mid: "와인 정도 도수(10~16도)까지", high: "고도수(17도 이상)도 좋음" };
    lines.push(`- 도수: ${map[answers.abvRange]}`);
  }
  if (answers.pairing) {
    const map = { spicy: "매콤한 한식", greasy: "기름진 음식(전, 고기)", seafood: "해산물·회", dessert: "치즈·디저트", plain: "담백한 한식 또는 안주 없이" };
    lines.push(`- 함께할 음식: ${map[answers.pairing]}`);
  }
  if (answers.situation) {
    const map = { solo: "혼술", party: "친구들과 모임", picnic: "나들이·여행", gift: "선물·특별한 날" };
    lines.push(`- 마시는 상황: ${map[answers.situation]}`);
  }
  if (answers.style) {
    const map = { cold: "차갑게 시원시원하게", slow: "천천히 음미하며", warm: "따뜻하게 데워서도", cocktail: "하이볼·칵테일로" };
    lines.push(`- 마시는 스타일: ${map[answers.style]}`);
  }
  if (answers.isBeginner) lines.push("- 전통주 입문자임 (접근성 좋은 술 우선)");
  return lines.join("\n");
}

/** 후보 술을 프롬프트용으로 축약 (토큰 절약: 추천 이유 작성에 필요한 필드만) */
function serializeCandidates(candidates: ScoredDrink[]): string {
  return JSON.stringify(
    candidates.map(({ drink }) => ({
      id: drink.id,
      name: drink.name,
      region: drink.region,
      type: drink.type,
      abv: drink.abv,
      sweetness: drink.sweetness,
      acidity: drink.acidity,
      body: drink.body,
      carbonation: drink.carbonation,
      aroma_intensity: drink.aroma_intensity,
      aroma_notes: drink.aroma_notes,
      taste_notes: drink.taste_notes,
      texture: drink.texture,
      pairing: drink.pairing,
      local_specialty: drink.local_specialty,
      beginner_friendly: drink.beginner_friendly,
      description: drink.description,
    })),
    null,
    0,
  );
}

export function buildUserPrompt(answers: SurveyAnswers, candidates: ScoredDrink[]): string {
  return `# 유저 취향
${summarizeAnswers(answers)}
- 맛 선호(자연어): "${answers.freeText?.trim() || "(작성 안 함)"}"

# 술 목록 (이 중에서만 3개 선택)
${serializeCandidates(candidates)}`;
}

/** 구조화 출력 스키마: [{id, reason}] x3 */
export const RECOMMEND_SCHEMA = {
  type: "object",
  properties: {
    recommendations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string", description: "술 목록에 있는 id 그대로" },
          reason: { type: "string", description: "유저 취향과 연결한 추천 이유 (한국어 2~3문장)" },
        },
        required: ["id", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["recommendations"],
  additionalProperties: false,
} as const;
