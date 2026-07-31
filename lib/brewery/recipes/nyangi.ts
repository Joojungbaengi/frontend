import type { Recipe } from "@/lib/brewery/types";

/**
 * 냥이탁주 9 — 고양 가와지쌀로 세 번 담가 빚는 삼양주 (행주산성주가).
 * 이 파일 하나가 '냥이탁주'의 바뀌는 데이터 전부다. 다른 술은 이걸 복사해 값만 바꾸면 된다.
 */

const MODEL_BASE = "/models/Dongrim_Cheongju";

export const nyangiTakju: Recipe = {
  id: "nyangi",
  name: "냥이탁주 9",

  intro:
    "이 술은 고양 가와지쌀로 세 번 담가 빚는 삼양주, 냥이탁주라네. 가와지쌀·정제수·누룩·밀, 이 네 가지 주원료를 골라 담아보게.",
  ingredientsReady: "이제 고두밥부터 지어 세 번 담글 준비를 하세.",

  // 주원료 4종(essential) + 부재료(선택). 개수가 달라져도 엔진이 essential 개수를 세어 맞춘다.
  ingredients: [
    { id: "rice",   name: "가와지쌀", texture: "/models/rice.png",   essential: true },
    { id: "water",  name: "정제수",   texture: "/models/water.png",  essential: true },
    { id: "nuruk",  name: "누룩",     texture: "/models/nuruk.png",  essential: true },
    { id: "mil",    name: "밀",   texture: "/models/mil.png",    essential: true },
    { id: "flower", name: "국화",     texture: "/models/flower.png", essential: false, flavorNote: "국화를 넣으면 은은한 국화 향이 감돈다네." },
    { id: "honey",  name: "벌꿀",     texture: "/models/honey.png",  essential: false, flavorNote: "벌꿀 한 술이면 둥글고 부드러운 단맛이 더해지지." },
  ],

  // 3D 모델 — low_wooden_bench(받침), 단계별로 rice_bowl / water_jar / bamboo_basket.
  models: [
    { id: "low_wooden_bench", file: `${MODEL_BASE}/low_wooden_bench.glb`, step: "common",     height: 0.14, y: 0.03 },
    { id: "rice_bowl",        file: `${MODEL_BASE}/rice_bowl.glb`,        step: "godubap",    height: 0.16, y: 0.03 },
    { id: "water_jar",        file: `${MODEL_BASE}/water_jar.glb`,        step: "ferment",    height: 0.17, y: 0.03 },
    { id: "bamboo_basket",    file: `${MODEL_BASE}/bamboo_basket.glb`,    step: "ingredient", height: 0.12, y: 0.03 },
  ],

  // 고두밥 만들기 (세미 → 냉각). 마지막 단계에서 장인 퀴즈가 뜬다.
  godubapSteps: [
    { id: "semi",     name: "세미", caption: "가와지쌀을 열 번 넘게 깨끗이 씻고 헹궈요" },
    { id: "chimsu",   name: "침수", caption: "세 시간 동안 물에 충분히 불려요" },
    { id: "talsu",    name: "탈수", caption: "한 시간 동안 물을 빼줘요" },
    { id: "jeungja",  name: "증자", caption: "강한 증기로 쪄 고두밥을 지어요", steam: true },
    { id: "naenggak", name: "냉각", caption: "다단식 채반에 펼쳐 차게 식혀요" },
  ],

  // 담금·발효 (혼합 → 후발효). 마지막 '후발효'에서 항아리가 등장하고 시간(온도)으로 자동 발효.
  fermentSteps: [
    { id: "mix",  name: "혼합",   caption: "식힌 고두밥에 불린 전통누룩을 섞어 항아리에 담았어요" },
    { id: "prim", name: "1차발효", caption: "발효실에서 사흘, 첫 술이 부글부글 끓어올라요" },
    { id: "deot", name: "덧술",   caption: "고두밥을 두 번 더 안쳐 삼양주로 빚어요" },
    { id: "post", name: "후발효", caption: "서른 날 남짓, 맑은 술이 천천히 익어가요" },
  ],

  // 완성 공정 (압착·여과 → 출고). 탭을 눌러 진행.
  pressSteps: [
    { id: "press", name: "압착·여과", caption: "보자기에 술덧을 붓고 손으로 정성껏 짜 맑게 걸러요" },
    { id: "aging", name: "저온숙성", caption: "1℃ 냉장창고에서 한 달 넘게 저온으로 숙성해요" },
    { id: "ship",  name: "출고",     caption: "손으로 병입하고 라벨을 붙여 세상에 내보내요" },
  ],

  quiz: {
    question: "고두밥이 아직 뜨겁네. 지금 누룩을 섞으면 발효에 어떤 영향을 줄까?",
    choices: [
      { text: "뜨거우면 누룩 속 효소·미생물이 죽어요", correct: true },
      { text: "더 빨리 발효돼서 좋아요", correct: false },
    ],
  },

  ferment: { optimalC: 25 },

  report: {
    method: "삼양주 · 세 번 담금 · 수작업 100%",
    notes: { flower: "은은한 국화 향", honey: "둥근 단맛" },
    extraRows: [
      { label: "완전발효", value: "30여 일 (가속 체험)" },
      { label: "저온 숙성", value: "1℃ 냉장창고 · 30일 이상" },
      { label: "총 제조 기간", value: "60일 이상" },
    ],
  },

  finish: {
    image: "/drinks/takju_goyang_nyangi9.webp",
    alt: "냥이탁주9",
    note: "고양 가와지쌀로 빚은 냥이탁주 9가 완성됐어요. 쌀을 열 번 넘게 헹궈 고두밥을 짓고, 누룩을 섞어 세 번 담그는 삼양주로 서른 날을 발효한 뒤, 보자기에 손으로 짜 1℃ 냉장창고에서 다시 한 달 넘게 저온 숙성합니다. 씻기부터 병입까지 예순 날 넘게, 행주산성주가가 손으로 빚는 과정을 그대로 따라와 보셨어요.",
  },
};
