import type { Recipe } from "@/lib/brewery/types";
import {
  AR_ASSETS,
  commonStageModels,
  finishSteps,
  godubapStageModels,
  godubapSteps,
  ingredientBasinModel,
  mashSteps, BENCH_LIFT } from "@/lib/brewery/stages";

/**
 * 냥이탁주 9 — 고양 가와지쌀로 세 번 담가 빚는 삼양주 (행주산성주가).
 * 이 파일 하나가 '냥이탁주'의 바뀌는 데이터 전부다. 다른 술은 이걸 복사해 값만 바꾸면 된다.
 */

export const nyangiTakju: Recipe = {
  id: "nyangi",
  drinkId: "takju_goyang_nyangi9",
  name: "냥이탁주 9",

  intro:
    "이 술은 고양 가와지쌀로 세 번 담가 빚는 삼양주, 냥이탁주라네. 주재료 4가지를 손으로 집어 가운데 그릇에 부어보게.",
  ingredientsReady: "이제 고두밥부터 지어 세 번 담글 준비를 하세.",

  // 주원료 4종. 개수가 달라져도 엔진이 essential 개수를 세어 맞춘다.
  //
  // 넷 모두 무대에 실제 그릇으로 놓인다 — 손으로 집어 가운데 큰 그릇에 부으면
  // 안에 내용물이 쌓인다. 누룩만은 덩어리라 붓지 않고 통째로 넣는다.
  ingredients: [
    {
      id: "rice", name: "가와지쌀", texture: "/ar/images/rice.png", essential: true,
      prop: {
        file: `${AR_ASSETS}/rice_wood.glb`, height: 0.115, label: "가와지쌀",
        pour: true, flow: "grain", flowColor: 0xf4ece0, fillColor: 0xefe6d6, fillAmount: 0.34,
      },
    },
    {
      id: "water", name: "정제수", texture: "/ar/images/water.png", essential: true,
      prop: {
        file: `${AR_ASSETS}/water_bottle.glb`, height: 0.19, label: "물",
        pour: true, flow: "liquid", flowColor: 0x9fd8ef, fillColor: 0xbcd9e4, fillAmount: 0.3,
        // 속이 비치는 통이라 안에 담긴 물이 줄어드는 게 그대로 보인다
        liquid: { color: 0x8ccfe8 },
      },
    },
    {
      id: "nuruk", name: "누룩", texture: "/ar/images/nuruk.png", essential: true,
      prop: {
        // 그릇 없이 덩어리 하나. 붓는 게 아니라 그릇에 넣기만 하면 된다.
        file: `${AR_ASSETS}/nuruk_lump.glb`, height: 0.095, label: "누룩",
        pour: false, flow: "grain", flowColor: 0xd8bd86, fillColor: 0xd2b881, fillAmount: 0.18,
      },
    },
    {
      id: "mil", name: "밀함유", texture: "/ar/images/mil.png", essential: true,
      prop: {
        file: `${AR_ASSETS}/wheat_sack.glb`, height: 0.135, label: "밀",
        pour: true, flow: "grain", flowColor: 0xdcc38a, fillColor: 0xd6bd85, fillAmount: 0.18,
      },
    },
  ],

  // 가운데 놓이는 큰 담금 항아리 — 입이 넓어 안에 부어진 게 잘 보인다.
  ingredientBasin: ingredientBasinModel(),

  // 무대 모델은 술끼리 공유한다 (받침대·항아리·그릇, 그리고 고두밥 단계의 솥·채반)
  models: [
    ...commonStageModels(),
    {
      id: "wooden_spatula",
      file: `${AR_ASSETS}/wooden_spatula.glb`,
      step: "ferment",
      processSteps: ["mash1", "mash2"],
      // 이 모델은 루트 노드에 자체 배율이 걸려 있어 높이 자동 정규화가 통하지 않는다
      // (0.24 로 맞추려다 4m 가 나왔다). 원본이 이미 미터 단위라 배율 1이 실측 24cm 다.
      height: 0.24,
      y: BENCH_LIFT,
      scaleFactor: 1,
    },
    {
      id: "mash_tray_rack",
      file: `${AR_ASSETS}/Tiered_MetalTray_Rack.glb`,
      step: "ferment",
      processSteps: ["mash1", "mash2"],
      height: 0.3,
      y: BENCH_LIFT,
    },
    {
      id: "mash_metal_tray",
      // 냉각에서 고두밥을 펼치던 그 채반을 덧술에서도 그대로 쓴다
      file: `${AR_ASSETS}/metal_tray.glb`,
      step: "ferment",
      processSteps: ["mash1", "mash2"],
      height: 0.05,
      y: BENCH_LIFT,
    },
    {
      id: "mash_water_spout_jar",
      file: `${AR_ASSETS}/jar_with_a_spout.glb`,
      step: "ferment",
      processSteps: ["mash1", "mash2"],
      height: 0.14,
      y: BENCH_LIFT,
    },
    {
      id: "mash_jar_body",
      file: `${AR_ASSETS}/jar_body.glb`,
      step: "ferment",
      processSteps: ["mash1", "mash2"],
      height: 0.24,
      y: BENCH_LIFT,
    },
    {
      id: "closed_jar",
      file: `${AR_ASSETS}/Closed_jar.glb`,
      step: "ferment",
      processSteps: ["post"],
      height: 0.25,
      y: BENCH_LIFT,
    },
    {
      id: "press_jar",
      file: `${AR_ASSETS}/jar_body.glb`,
      step: "done",
      processSteps: ["press"],
      height: 0.3,
      y: BENCH_LIFT,
    },
    {
      id: "cold_storage_chamber",
      file: `${AR_ASSETS}/cold_storage_chamber.glb`,
      step: "done",
      processSteps: ["aging"],
      height: 0.3,
      y: BENCH_LIFT,
    },
  ],
  godubapModels: godubapStageModels(),

  // 냉각/혼합 때 채반 위에 까는 고두밥 평면. 채반 크기에 맞춰 자동으로 덮되,
  // 채반이 없을 때 쓸 기본 크기는 3:5(직사각). texture 에 '고두밥' 이미지를 넣는다.
  godubapRicePlane: { texture: "/ar/images/godubap.png", width: 0.18, depth: 0.30, y: BENCH_LIFT + 0.027 },

  // 완성 공정 '출고' 단계에서 나타나는 완성 제품 병 (Nyangi_Takju.glb 를 아래 경로에 넣어야 보인다)
  finishModel: { id: "nyangi", file: `${AR_ASSETS}/Nyangi_Takju.glb`, step: "done", height: 0.28476, y: BENCH_LIFT },

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
    notes: {},
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
