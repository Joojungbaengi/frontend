import type { Recipe } from "@/lib/brewery/types";
import { nyangiTakju } from "@/lib/brewery/recipes/nyangi";

/**
 * AR 양조 체험 레시피 레지스트리 — 술 하나가 파일 하나다.
 *
 * 새 술을 붙이는 순서
 *   1. recipes/ 아래에 Recipe 파일을 하나 만든다 (sampleDanyangju.ts 를 본으로 삼으면 된다)
 *   2. drinkId 에 data/drinks.json 의 술 id 를 적는다
 *   3. 아래 READY 배열에 한 줄 추가한다
 * 공통 엔진(components/ArBreweryExperience.tsx)은 손댈 필요가 없다.
 *
 * AR 체험을 붙이기로 한 술 네 가지
 *   ✓ 냥이탁주 9            takju_goyang_nyangi9
 *   · 포리버 레드 스위트 와인   wine_hwaseong_foriver         (준비 중)
 *   · 남한산성 소주          soju_gwangju_namhansanseong   (준비 중)
 *   · 동림청주              cheongju_yongin_dongnim       (준비 중)
 *
 * READY 에 없는 술은 상세 화면에서 "준비 중" 안내를 띄운다.
 * (components/ArEntryButton.tsx)
 */
const READY: Recipe[] = [nyangiTakju];

/** 이 술의 AR 체험이 준비돼 있으면 레시피를, 아니면 null */
export function getRecipeForDrink(drinkId?: string | null): Recipe | null {
  if (!drinkId) return null;
  return READY.find((r) => r.drinkId === drinkId) ?? null;
}

/** AR 체험이 준비된 술인가 — 버튼이 이동할지 안내를 띄울지 여기서 갈린다 */
export function hasArExperience(drinkId?: string | null): boolean {
  return getRecipeForDrink(drinkId) !== null;
}

/** AR 체험이 준비된 술 id 목록 */
export function arReadyDrinkIds(): string[] {
  return READY.map((r) => r.drinkId);
}
