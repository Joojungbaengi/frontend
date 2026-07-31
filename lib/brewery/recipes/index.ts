import type { Recipe } from "@/lib/brewery/types";
import { nyangiTakju } from "@/lib/brewery/recipes/nyangi";
import { sampleDanyangju } from "@/lib/brewery/recipes/sampleDanyangju";

/**
 * 술 레시피 레지스트리.
 * 새 술을 추가하려면 recipes/ 아래에 Recipe 파일을 만들고 여기 한 줄만 등록하면 된다.
 * AR 페이지는 /ar?type=<id> 로 어떤 술을 체험할지 고른다. (없으면 기본값)
 */
export const RECIPES: Record<string, Recipe> = {
  [nyangiTakju.id]: nyangiTakju,
  [sampleDanyangju.id]: sampleDanyangju,
};

export const DEFAULT_RECIPE_ID = nyangiTakju.id;

export function getRecipe(id?: string | null): Recipe {
  return (id && RECIPES[id]) || RECIPES[DEFAULT_RECIPE_ID];
}
