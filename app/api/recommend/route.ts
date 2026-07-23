/**
 * POST /api/recommend — 술BTI 답변을 받아 전통주 3종을 추천한다.
 *
 * 파이프라인 (기획/AI.md):
 *   답변 → 1차 필터/점수 계산 (scoring.ts) → Top 10 → Bedrock Claude (bedrock.ts) → 3종 + 이유
 *
 * AWS 자격 증명이 없으면 규칙 기반 상위 3개로 fallback (개발/영상 데모용).
 *
 * 요청 바디 예시:
 * {
 *   "sweetness": 3, "acidity": 4.5, "carbonation": "none", "body": 3,
 *   "aromaTypes": ["fruit"], "abvRange": "low", "pairing": "spicy",
 *   "situation": "party", "style": "cold", "isBeginner": true,
 *   "freeText": "너무 달고 걸쭉한 건 싫고, 음식이랑 편하게 마실 수 있는 술이 좋아요."
 * }
 */
import db from "@/data/drinks.json";
import { isBedrockConfigured, pickTop3 } from "@/lib/bedrock";
import { selectCandidates } from "@/lib/scoring";
import type { Drink, Recommendation, RecommendResponse, ScoredDrink, SurveyAnswers } from "@/lib/types";

const drinks = db.drinks as unknown as Drink[];

function toRecommendation(scored: ScoredDrink, reason: string): Recommendation {
  const d = scored.drink;
  return {
    id: d.id,
    name: d.name,
    region: d.region,
    type: d.type,
    abv: d.abv,
    description: d.description,
    reason,
  };
}

/** Bedrock 없이 쓰는 규칙 기반 추천 이유 (데모/개발용) */
function fallbackReason(scored: ScoredDrink): string {
  const d = scored.drink;
  return `${d.region}의 ${d.type} '${d.name}'. ${d.description}`;
}

export async function POST(request: Request) {
  let answers: SurveyAnswers;
  try {
    answers = (await request.json()) as SurveyAnswers;
  } catch {
    return Response.json({ error: "잘못된 요청 바디 (JSON 필요)" }, { status: 400 });
  }

  // 1차 필터 + 점수 계산 → Top 10
  const candidates = selectCandidates(drinks, answers, 10);

  // Bedrock 미설정 시 규칙 기반 fallback
  if (!isBedrockConfigured()) {
    const top3 = candidates.slice(0, 3);
    const body: RecommendResponse = {
      recommendations: top3.map((c) => toRecommendation(c, fallbackReason(c))),
      fallback: true,
    };
    return Response.json(body);
  }

  try {
    const picks = await pickTop3(answers, candidates);
    const byId = new Map(candidates.map((c) => [c.drink.id, c]));
    const body: RecommendResponse = {
      recommendations: picks.map((p) => toRecommendation(byId.get(p.id)!, p.reason)),
      fallback: false,
    };
    return Response.json(body);
  } catch (error) {
    // Bedrock 호출 실패 시에도 서비스가 죽지 않도록 규칙 기반으로 응답
    console.error("[recommend] Bedrock 호출 실패, fallback 사용:", error);
    const top3 = candidates.slice(0, 3);
    const body: RecommendResponse = {
      recommendations: top3.map((c) => toRecommendation(c, fallbackReason(c))),
      fallback: true,
    };
    return Response.json(body);
  }
}
