/**
 * 비슷한 술 후보 선별 — 속성 유사도 기반.
 * 주종 일치 + 맛 축 근접 + 향 노트 겹침 + 지역 일치로 점수를 매겨 상위 N개를 뽑는다.
 * (AI가 이 후보 중에서 최종 4개를 고르므로, 여기선 넉넉히 추린다)
 */
import type { Drink } from "./types";

function similarityScore(a: Drink, b: Drink): number {
  let s = 0;
  if (a.type === b.type) s += 3; // 같은 주종
  const axes: (keyof Drink)[] = ["sweetness", "acidity", "body", "carbonation", "aroma_intensity", "finish_length"];
  for (const k of axes) s += 1 - Math.abs((a[k] as number) - (b[k] as number)) / 5; // 축마다 0~1
  const overlap = a.aroma_notes.filter((n) => b.aroma_notes.includes(n)).length;
  s += overlap * 0.5; // 향 노트 겹침
  if (a.region === b.region) s += 0.5; // 같은 고장
  return s;
}

/** 기준 술과 비슷한 후보 상위 N개 (자기 자신·판매중지 제외) */
export function similarCandidates(all: Drink[], target: Drink, topN = 8): Drink[] {
  return all
    .filter((d) => d.id !== target.id && !d.service_caution)
    .map((d) => ({ d, s: similarityScore(target, d) }))
    .sort((x, y) => y.s - x.s)
    .slice(0, topN)
    .map((x) => x.d);
}
