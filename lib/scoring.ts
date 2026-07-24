/**
 * 술BTI 1차 필터 + 점수 계산 (기획/AI.md 파이프라인의 "코드로 후보 필터링/점수" 단계).
 * 규칙 근거: material/술BTI_질문지.md 의 "점수 계산 가이드"
 */
import type { AromaType, Drink, PairingType, ScoredDrink, SituationType, StyleType, SurveyAnswers } from "./types";

/** Q6 향의 결 → aroma_notes 키워드 매칭 */
const AROMA_KEYWORDS: Record<AromaType, string[]> = {
  grain: ["곡물", "쌀", "누룩", "구수", "누룽지"],
  fruit: ["과실", "과일", "사과", "포도", "배", "시트러스", "레몬", "참외", "상큼"],
  flower: ["꽃", "국화", "연꽃", "솔", "허브", "플로럴", "함박꽃"],
  nutty: ["견과", "잣", "율무", "약재", "스파이스", "고소", "오미자"],
};

/** Q8 안주 → pairing 키워드 매칭 */
const PAIRING_KEYWORDS: Record<PairingType, string[]> = {
  spicy: ["매운", "매콤", "제육", "떡볶이", "쭈꾸미", "닭발", "닭요리", "얼큰"],
  greasy: ["전", "기름진", "삼겹살", "수육", "보쌈", "치킨", "튀김", "갈비", "불고기", "고기"],
  seafood: ["해산물", "회", "조개", "굴", "생선", "초밥", "봉골레", "참치", "홍어"],
  dessert: ["치즈", "디저트", "과일", "약과", "견과", "초콜릿", "아이스크림", "비스킷", "웨하스", "과자"],
  plain: ["한식", "담백", "반주", "나물", "두부", "국물"],
};

/** Q9 상황 → situations 키워드 매칭 */
const SITUATION_KEYWORDS: Record<SituationType, string[]> = {
  solo: ["혼술", "홈술", "반주"],
  party: ["모임", "파티", "잔치", "친구"],
  romantic: ["연인", "데이트", "로맨틱", "분위기", "기념일"],
  family: ["부모", "가족", "명절", "선물", "만찬", "고급", "프리미엄", "어른"],
};

/** Q10 스타일 → temperature 키워드 매칭 */
const STYLE_KEYWORDS: Record<StyleType, string[]> = {
  cold: ["냉장", "차갑게", "칠링", "시원"],
  slow: ["상온", "스트레이트", "음미", "여운"],
  warm: ["따뜻", "데워"],
  cocktail: ["칵테일", "하이볼", "온더락", "희석"],
};

/** 목표값과 속성값의 거리 기반 감점 (거리 1당 -1점, 최대 가중 +2점에서 시작) */
function proximityScore(target: number | undefined, actual: number): number {
  if (target === undefined) return 0;
  return 2 - Math.abs(target - actual);
}

function keywordScore(texts: string[], keywords: string[]): number {
  const joined = texts.join(" ");
  return keywords.some((k) => joined.includes(k)) ? 1 : 0;
}

/** 1차 필터: 도수 범위 / 탄산 필수·기피 / service_caution 제외 */
export function filterDrinks(drinks: Drink[], answers: SurveyAnswers): Drink[] {
  return drinks.filter((d) => {
    if (d.service_caution) return false;

    // Q1 "포도로 만든 술은 안 좋아해요" → 와인 완전 제외
    if (answers.excludeWine && d.type.includes("와인")) return false;

    // Q7 도수 필터 — abv_variants 중 하나라도 범위에 들면 통과
    const abvs = d.abv_variants ?? [d.abv];
    if (answers.abvRange === "low" && !abvs.some((a) => a <= 9)) return false;
    if (answers.abvRange === "mid" && !abvs.some((a) => a >= 10 && a <= 16)) return false;
    if (answers.abvRange === "high" && !abvs.some((a) => a >= 17)) return false;

    // Q3 탄산 하드 컷
    if (answers.carbonation === "high" && d.carbonation === 0) return false;
    if (answers.carbonation === "none" && d.carbonation >= 3) return false;

    return true;
  });
}

/** 점수 계산 → 내림차순 정렬 */
export function scoreDrinks(drinks: Drink[], answers: SurveyAnswers): ScoredDrink[] {
  const scored = drinks.map((drink) => {
    let score = 0;

    // 맛 축 (Q1, Q2, Q4, Q5): 목표값과의 거리
    score += proximityScore(answers.sweetness, drink.sweetness);
    score += proximityScore(answers.acidity, drink.acidity);
    score += proximityScore(answers.body, drink.body);
    score += proximityScore(answers.aromaIntensity, drink.aroma_intensity);

    // Q3 탄산 소프트 가중 (하드 컷을 통과한 것 중에서)
    if (answers.carbonation === "high") score += drink.carbonation >= 3 ? 2 : 0;
    if (answers.carbonation === "some") score += drink.carbonation >= 1 && drink.carbonation <= 2 ? 1 : 0;
    if (answers.carbonation === "none") score += drink.carbonation === 0 ? 1 : 0;

    // 키워드 축 (Q6, Q8, Q9, Q10): 매칭 1개당 +1
    for (const t of answers.aromaTypes ?? []) {
      score += keywordScore(drink.aroma_notes, AROMA_KEYWORDS[t]);
    }
    if (answers.pairing) score += keywordScore(drink.pairing, PAIRING_KEYWORDS[answers.pairing]);
    if (answers.situation) {
      score += keywordScore([...drink.situations, drink.description], SITUATION_KEYWORDS[answers.situation]);
      // 부모님·특별한 날은 수상 이력 가중
      if (answers.situation === "family" && drink.awards.length > 0) score += 1;
    }
    // Q10 스타일 (복수) — 매칭 1개당 +1
    for (const s of answers.styles ?? []) {
      score += keywordScore([drink.temperature], STYLE_KEYWORDS[s]);
    }

    // 입문자 가중
    if (answers.isBeginner && drink.beginner_friendly) score += 1;

    return { drink, score };
  });

  return scored.sort((a, b) => b.score - a.score);
}

/** 필터 → 점수 → 상위 N개. 필터 결과가 N 미만이면 도수 필터를 풀고 보충한다. */
export function selectCandidates(drinks: Drink[], answers: SurveyAnswers, topN = 10): ScoredDrink[] {
  let filtered = filterDrinks(drinks, answers);
  if (filtered.length < topN) {
    // 필터가 과하면 도수 조건만 완화해 후보를 확보
    const relaxed = filterDrinks(drinks, { ...answers, abvRange: "any" });
    const ids = new Set(filtered.map((d) => d.id));
    filtered = [...filtered, ...relaxed.filter((d) => !ids.has(d.id))];
  }
  return scoreDrinks(filtered, answers).slice(0, topN);
}
