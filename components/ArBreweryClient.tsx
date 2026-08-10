"use client";

import dynamic from "next/dynamic";
import type { Recipe } from "@/lib/brewery/types";

const ArBreweryExperience = dynamic(
  () => import("@/components/ArBreweryExperience"),
  {
    ssr: false,
  }
);

/**
 * 어떤 술을 체험할지는 AR 페이지가 이미 정해서 넘겨준다.
 * (WebGL·WebXR 은 브라우저 전용이라 이 경계에서 클라이언트 전용으로 갈아탄다)
 */
export default function ArBreweryClient({ recipe }: { recipe: Recipe }) {
  return <ArBreweryExperience recipe={recipe} />;
}
