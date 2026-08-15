import type { Recipe } from "@/lib/brewery/types";
import {
  AR_ASSETS,
  commonStageModels,
  finishSteps,
  godubapStageModels,
  godubapSteps,
  mashSteps,
} from "@/lib/brewery/stages";

/**
 * 냥이탁주 9 — 고양 가와지쌀로 세 번 담가 빚는 삼양주 (행주산성주가).
 * 이 파일 하나가 '냥이탁주'의 바뀌는 데이터 전부다. 다른 술은 이걸 복사해 값만 바꾸면 된다.
 */

export const nyangiTakju: Recipe = {
  id: "nyangi",
  drinkId: "takju_goyang_nyangi9",
  name: "냥이탁주 9",

  intro:
    "이 술은 고양 가와지쌀로 세 번 담가 빚는 삼양주, 냥이탁주라네. 가와지쌀·정제수·누룩·밀, 이 네 가지 주원료를 골라 담아보게.",
  ingredientsReady: "이제 고두밥부터 지어 세 번 담글 준비를 하세.",

  // 주원료 4종(essential) + 부재료(선택). 개수가 달라져도 엔진이 essential 개수를 세어 맞춘다.
  ingredients: [
    { id: "rice",   name: "가와지쌀", texture: "/ar/images/rice.png",   essential: true },
    { id: "water",  name: "정제수",   texture: "/ar/images/water.png",  essential: true },
    { id: "nuruk",  name: "누룩",     texture: "/ar/images/nuruk.png",  essential: true },
    { id: "mil",    name: "밀함유",   texture: "/ar/images/mil.png",    essential: true },
    { id: "flower", name: "국화",     texture: "/ar/images/flower.png", essential: false, flavorNote: "국화를 넣으면 은은한 국화 향이 감돈다네." },
    { id: "honey",  name: "벌꿀",     texture: "/ar/images/honey.png",  essential: false, flavorNote: "벌꿀 한 술이면 둥글고 부드러운 단맛이 더해지지." },
  ],

  // 무대 모델은 술끼리 공유한다 (받침대·항아리·그릇, 그리고 고두밥 단계의 솥·채반)
  models: commonStageModels(),
  godubapModels: godubapStageModels(),

  // 냉각/혼합 때 채반 위에 까는 고두밥 평면. 채반 크기에 맞춰 자동으로 덮되,
  // 채반이 없을 때 쓸 기본 크기는 3:5(직사각). texture 에 '고두밥' 이미지를 넣는다.
  godubapRicePlane: { texture: "/ar/images/godubap.png", width: 0.18, depth: 0.30, y: 0.055 },

  // 완성 공정 '출고' 단계에서 나타나는 완성 제품 병 (Nyangi_Takju.glb 를 아래 경로에 넣어야 보인다)
  finishModel: { id: "nyangi", file: `${AR_ASSETS}/Nyangi_Takju.glb`, step: "done", height: 0.28, y: 0.03 },

  // ── 공정 ────────────────────────────────────────────────────────────
  // 겹치는 과정은 lib/brewery/stages.ts 에서 가져와 조립한다.
  // 다른 술을 붙일 때 이 문구들을 다시 쓸 필요가 없다.

  godubapSteps: godubapSteps({ rice: "가와지쌀", soakHours: 3, drainHours: 1 }),

  // 덧술 2회 = 삼양주. 냥이탁주의 핵심이라 실제로 두 번 담근다.
  fermentSteps: mashSteps({ rounds: 2, primaryDays: 3, postDays: 30 }),

  pressSteps: finishSteps({ ageC: 1, agePeriod: "한 달 넘게" }),

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