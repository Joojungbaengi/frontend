import type { Recipe } from "@/lib/brewery/types";

/**
 * ⚙️ 예시/템플릿 레시피 — "다른 술이 오면 이렇게 추가한다"를 보여주는 스캐폴드.
 *
 * 냥이탁주와 달리 ▸ 주원료가 3종(밀 없음) ▸ 단양주라 '덧술'이 없고 발효 단계가 3개 ▸ 완성 공정 2개.
 * 즉 "원재료 종류·개수도 달라지고 선택 개수도 달라진다"는 요구를 그대로 검증한다.
 * 텍스처/3D 모델은 냥이탁주 것을 그대로 재사용하므로 에셋 없이도 바로 돌아간다.
 * 실제 브랜드가 정해지면 값만 바꾸면 된다.
 */

const MODEL_BASE = "/models/Dongrim_Cheongju";

export const sampleDanyangju: Recipe = {
  id: "sample",
  name: "예시 단양주(템플릿)",

  intro:
    "이건 새 술을 붙이는 본보기라네. 쌀·정제수·누룩 세 가지 주원료만 있으면 술이 된다네. 골라 담아보게.",
  ingredientsReady: "이제 고두밥을 지어 한 번에 담가보세.",

  ingredients: [
    { id: "rice",  name: "쌀",     texture: "/models/rice.png",  essential: true },
    { id: "water", name: "정제수", texture: "/models/water.png", essential: true },
    { id: "nuruk", name: "누룩",   texture: "/models/nuruk.png", essential: true },
    { id: "honey", name: "벌꿀",   texture: "/models/honey.png", essential: false, flavorNote: "벌꿀을 더하면 둥근 단맛이 살짝 감돌지." },
  ],

  models: [
    { id: "low_wooden_bench", file: `${MODEL_BASE}/low_wooden_bench.glb`, step: "common",     height: 0.14, y: 0.03 },
    { id: "water_jar",        file: `${MODEL_BASE}/water_jar.glb`,        step: "ferment",    height: 0.17, y: 0.03 },
    { id: "bamboo_basket",    file: `${MODEL_BASE}/bamboo_basket.glb`,    step: "ingredient", height: 0.12, y: 0.03 },
  ],

  // 예시는 있는 에셋(그릇)만 써서 항상 동작하게 둔다.
  godubapModels: [
    { id: "rice_bowl", file: `${MODEL_BASE}/rice_bowl.glb`, step: "godubap", height: 0.16, y: 0.03 },
  ],

  godubapSteps: [
    { id: "wash",  name: "세척", caption: "쌀을 맑은 물이 나올 때까지 씻어요", models: ["rice_bowl"] },
    { id: "soak",  name: "불리기", caption: "물에 넉넉히 불려요", models: ["rice_bowl"], water: 1 },
    { id: "steam", name: "증자", caption: "증기로 쪄 고두밥을 지어요", models: ["rice_bowl"], steam: true },
    { id: "cool",  name: "냉각", caption: "채반에 펼쳐 차게 식혀요", models: ["rice_bowl"], dark: true },
  ],

  fermentSteps: [
    { id: "mix",  name: "혼합",   caption: "식힌 고두밥에 누룩과 물을 섞어 항아리에 담았어요" },
    { id: "prim", name: "발효",   caption: "발효실에서 술이 부글부글 끓어올라요" },
    { id: "post", name: "후발효", caption: "천천히 맑은 술이 익어가요" },
  ],

  pressSteps: [
    { id: "press", name: "압착·여과", caption: "보자기에 짜 맑게 걸러요" },
    { id: "ship",  name: "출고",     caption: "병입해 세상에 내보내요" },
  ],

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