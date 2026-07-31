"use client";

import dynamic from "next/dynamic";
import { getRecipe } from "@/lib/brewery/recipes";

const ArBreweryExperience = dynamic(
  () => import("@/components/ArBreweryExperience"),
  {
    ssr: false,
  }
);

/**
 * recipeId 로 어떤 술을 체험할지 고른다. 없으면 기본 레시피(냥이탁주).
 * (AR 페이지가 /ar?type=<id> 쿼리로 넘겨준다.)
 */
export default function ArBreweryClient({ recipeId }: { recipeId?: string }) {
  return <ArBreweryExperience recipe={getRecipe(recipeId)} />;
}