/**
 * POST /api/similar — 기준 술과 비슷한 전통주를 찾아 리스트로 반환한다.
 *
 * 파이프라인: 기준 술 → 속성 유사도로 후보 8종(similar.ts) → Bedrock Claude가 비슷한 4종 + 이유
 * AWS 키가 없으면 규칙 기반 상위 4개로 fallback.
 *
 * 요청 바디: { "id": "soju_gimpo_munbaesul" }
 */
import db from "@/data/drinks.json";
import { isBedrockConfigured, pickSimilar } from "@/lib/bedrock";
import { similarCandidates } from "@/lib/similar";
import type { Drink, SimilarItem, SimilarResponse } from "@/lib/types";

const drinks = db.drinks as unknown as Drink[];

function toItem(d: Drink, reason: string): SimilarItem {
  return { id: d.id, name: d.name, region: d.region, type: d.type, abv: d.abv, image: d.image, reason };
}

function fallbackReason(target: Drink, d: Drink): string {
  const bits: string[] = [];
  if (d.type === target.type) bits.push(`같은 ${d.type}`);
  const shared = d.aroma_notes.filter((n) => target.aroma_notes.includes(n));
  if (shared.length) bits.push(`${shared.slice(0, 2).join("·")} 향이 닮음`);
  return `${bits.join(", ") || "맛 프로필이 비슷"} — ${d.description.slice(0, 40)}`;
}

export async function POST(request: Request) {
  let id: string;
  try {
    ({ id } = (await request.json()) as { id: string });
  } catch {
    return Response.json({ error: "잘못된 요청 바디 (JSON 필요)" }, { status: 400 });
  }

  const target = drinks.find((d) => d.id === id);
  if (!target) return Response.json({ error: "존재하지 않는 술 id" }, { status: 404 });

  const candidates = similarCandidates(drinks, target, 8);
  const base = { id: target.id, name: target.name };

  if (!isBedrockConfigured()) {
    const body: SimilarResponse = {
      base,
      items: candidates.slice(0, 4).map((d) => toItem(d, fallbackReason(target, d))),
      fallback: true,
    };
    return Response.json(body);
  }

  try {
    const scored = candidates.map((d) => ({ drink: d, score: 0 }));
    const picks = await pickSimilar(target, scored);
    const byId = new Map(candidates.map((d) => [d.id, d]));
    const body: SimilarResponse = {
      base,
      items: picks.map((p) => toItem(byId.get(p.id)!, p.reason)),
      fallback: false,
    };
    return Response.json(body);
  } catch (error) {
    console.error("[similar] Bedrock 호출 실패, fallback 사용:", error);
    const body: SimilarResponse = {
      base,
      items: candidates.slice(0, 4).map((d) => toItem(d, fallbackReason(target, d))),
      fallback: true,
    };
    return Response.json(body);
  }
}
