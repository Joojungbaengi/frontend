import type { Recipe } from "@/lib/brewery/types";
import {
  commonStageModels,
  finishSteps,
  godubapStageModels,
  godubapSteps,
  mashSteps, BENCH_LIFT } from "@/lib/brewery/stages";

/**
 * 예시/템플릿 레시피 — "다른 술이 오면 이렇게 추가한다"를 보여주는 본보기.
 *
 * 새 술을 붙이는 일은 대부분 **블록을 고르는 것**으로 끝난다.
 * 여기서 냥이탁주와 다른 건 두 가지뿐이다.
 *   · 주원료가 3종 (밀 없음)
 *   · 덧술을 하지 않는 단양주 → mashSteps({ rounds: 0 })
 * 나머지 공정 문구는 lib/brewery/stages.ts 에서 그대로 가져온다.
 *
 * 실제 술을 붙일 때는 이 파일을 복사해 drinkId 와 다른 값만 바꾸고
 * 레지스트리(recipes/index.ts)에 등록하면 된다.
 */

export const sampleDanyangju: Recipe = {
  id: "sample",
  // 실제 술과 이어지지 않은 본보기다. 새 술을 만들 때 이 파일을 복사해
  // drinkId 를 data/drinks.json 의 id 로 바꾸고 레지스트리(index.ts)에 등록하면 된다.
  drinkId: "_template",
  name: "예시 단양주(템플릿)",

  intro:
    "이건 새 술을 붙이는 본보기라네. 쌀·정제수·누룩 세 가지 주원료만 있으면 술이 된다네. 골라 담아보게.",
  ingredientsReady: "이제 고두밥을 지어 한 번에 담가보세.",

  ingredients: [
    { id: "rice",  name: "쌀",     texture: "/ar/images/rice.png",  essential: true },
    { id: "water", name: "정제수", texture: "/ar/images/water.png", essential: true },
    { id: "nuruk", name: "누룩",   texture: "/ar/images/nuruk.png", essential: true },
    { id: "honey", name: "벌꿀",   texture: "/ar/images/honey.png", essential: false, flavorNote: "벌꿀을 더하면 둥근 단맛이 살짝 감돌지." },
  ],

  models: commonStageModels(),
  godubapModels: godubapStageModels(),

  godubapRicePlane: { texture: "/ar/images/godubap.png", width: 0.18, depth: 0.3, y: BENCH_LIFT + 0.027 },

  // ── 공정 — 블록을 골라 조립한다 ──────────────────────────────────────
  godubapSteps: godubapSteps({ soakHours: 2, drainHours: 1 }),
  fermentSteps: mashSteps({ rounds: 0, primaryDays: 7, postDays: 14 }), // 단양주 = 덧술 없음
  pressSteps: finishSteps({ ageC: 2, agePeriod: "보름쯤" }),

  quiz: {
    question: "고두밥이 아직 뜨겁네. 지금 누룩을 섞으면 어떻게 될까?",
    choices: [
      { text: "뜨거우면 누룩 속 효소·미생물이 죽어요", correct: true },
      { text: "더 빨리 발효돼서 좋아요", correct: false },
    ],
  },

  ferment: { optimalC: 24 },

  report: {
    method: "단양주 · 한 번 담금",
    notes: { honey: "둥근 단맛" },
  },

  finish: {
    image: "/drinks/takju_goyang_nyangi9.webp",
    alt: "완성된 술",
    note: "쌀·정제수·누룩으로 한 번에 담가 빚은 예시 단양주가 완성됐어요. 이 템플릿을 복사해 실제 술의 원재료·공정·문구만 바꾸면 새 술 체험이 바로 만들어집니다.",
  },
};