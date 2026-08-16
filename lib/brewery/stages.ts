import type { ModelDef, ProcessStep } from "@/lib/brewery/types";

/**
 * 공정 블록 — 술마다 겹치는 과정을 한곳에 모아 두고 **조립해서** 쓴다.
 *
 * 우리 술은 어떤 것이든 뼈대가 거의 같다.
 *   쌀 씻어 고두밥 짓고 → 누룩 섞어 밑술 앉히고 → 덧술을 몇 번 하고 → 짜서 거르고 → 숙성한다.
 * 갈리는 지점은 대개 세 가지뿐이다.
 *   · 덧술을 몇 번 하나 — 단양주(0) · 이양주(1) · 삼양주(2) · 오양주(4)
 *   · 증류를 하나 안 하나 — 증류식 소주면 압착 뒤에 증류가 붙는다
 *   · 문구에 들어가는 원료 이름과 날수
 *
 * 그래서 술을 하나 더 붙일 때 이 문구들을 다시 타이핑하지 않는다.
 * 필요한 블록을 부르고 **그 술에서만 다른 값**을 넘기면 된다.
 *
 *   fermentSteps: mashSteps({ rounds: 2 })            // 삼양주
 *   fermentSteps: mashSteps({ rounds: 4 })            // 오양주
 *   pressSteps:   finishSteps({ distill: true })      // 증류식 소주
 *
 * 엔진(ArBreweryExperience)은 배열의 길이를 보고 돌기 때문에, 단계를 늘리거나 줄여도
 * 엔진 코드는 손댈 필요가 없다.
 */

/** 3D 모델이 사는 곳. 술끼리 공유한다. */
export const AR_ASSETS = "/ar/3d-assets";

/** 덧술 횟수로 부르는 이름 — 덧술 2번이면 삼양주 */
export function brewName(rounds: number): string {
  return ["단양주", "이양주", "삼양주", "사양주", "오양주"][rounds] ?? `${rounds + 1}양주`;
}

/* ────────────────────────────────────────────────────────────────────────
 * 무대 모델
 * ──────────────────────────────────────────────────────────────────────*/

/** 어느 술이든 쓰는 무대 모델 — 받침대와 발효 항아리 */
export function commonStageModels(): ModelDef[] {
  return [
    { id: "low_wooden_bench", file: `${AR_ASSETS}/low_wooden_bench.glb`, step: "common", height: 0.14, y: 0.03 },
    { id: "water_jar", file: `${AR_ASSETS}/water_jar.glb`, step: "ferment", height: 0.17, y: 0.03 },
  ];
}

/**
 * 1막 — 원료가 담긴 그릇 넷과, 그것을 부어 넣을 담금 대야.
 *
 * 자리는 buildIngredients 가 직접 잡는다. 집어서 기울이는 물건들이라
 * 어디에 무엇이 있는지가 조작에 걸리기 때문에, 자동 원형 배치를 쓰지 않는다.
 */
export function ingredientModels(): ModelDef[] {
  return [
    { id: "mix_basin", file: `${AR_ASSETS}/large-basin.glb`, step: "ingredient", height: 0.095, y: 0.03 },
    { id: "bowl_rice", file: `${AR_ASSETS}/rice_bowl.glb`, step: "ingredient", height: 0.07, y: 0.03 },
    { id: "bowl_water", file: `${AR_ASSETS}/water_jar.glb`, step: "ingredient", height: 0.095, y: 0.03 },
    { id: "bowl_nuruk", file: `${AR_ASSETS}/basin.glb`, step: "ingredient", height: 0.05, y: 0.03 },
    { id: "bowl_mil", file: `${AR_ASSETS}/wheat_bowl.glb`, step: "ingredient", height: 0.07, y: 0.03 },
    { id: "nuruk_lump", file: `${AR_ASSETS}/nuruk_lump.glb`, step: "ingredient", height: 0.055, y: 0.03 },
  ];
}

/**
 * 고두밥 단계에서 갈아 끼우는 모델.
 *   세미·침수 → 이남박 / 탈수 → 소쿠리 / 증자 → 솥과 뚜껑 / 냉각 → 채반
 */
export function godubapStageModels(): ModelDef[] {
  return [
    { id: "rice_bowl", file: `${AR_ASSETS}/rice_bowl.glb`, step: "godubap", height: 0.16, y: 0.03 },
    { id: "bamboo_basket", file: `${AR_ASSETS}/bamboo_basket.glb`, step: "godubap", height: 0.12, y: 0.03 },
    { id: "steamer_pot", file: `${AR_ASSETS}/steamer_pot.glb`, step: "godubap", height: 0.22, y: 0.03 },
    { id: "steamer_lid", file: `${AR_ASSETS}/steamer_lid.glb`, step: "godubap", height: 0.07, y: 0.03 },
    { id: "metal_food_tray", file: `${AR_ASSETS}/metal_food_tray.glb`, step: "godubap", height: 0.05, y: 0.03 },
  ];
}

/* ────────────────────────────────────────────────────────────────────────
 * ① 고두밥 준비 — 세미 → 침수 → 탈수 → 증자 → 냉각
 * ──────────────────────────────────────────────────────────────────────*/

export interface GodubapOptions {
  /** 문구에 넣을 쌀 이름 (예: "가와지쌀"). 없으면 그냥 "쌀" */
  rice?: string;
  /** 물에 불리는 시간 */
  soakHours?: number;
  /** 물을 빼는 시간 */
  drainHours?: number;
  /** 단계별 문구를 통째로 갈아끼우고 싶을 때 (id → caption) */
  captions?: Partial<Record<"semi" | "chimsu" | "talsu" | "jeungja" | "naenggak", string>>;
}

/** 곡주라면 거의 그대로 쓰는 고두밥 다섯 단계 */
export function godubapSteps(o: GodubapOptions = {}): ProcessStep[] {
  const rice = o.rice ?? "쌀";
  const soak = o.soakHours ?? 3;
  const drain = o.drainHours ?? 1;
  const c = o.captions ?? {};

  return [
    // 세미부터 물을 받아 둔다 — 손으로 휘저어 쌀을 헹구는 단계라서.
    {
      id: "semi",
      name: "세미",
      caption: c.semi ?? `물을 받아 ${rice}을 손으로 헹궈요`,
      models: ["rice_bowl", "bowl_rice"],
      water: 1,
    },
    {
      id: "chimsu",
      name: "침수",
      caption: c.chimsu ?? `${soak}시간 동안 물에 충분히 불려요`,
      models: ["rice_bowl", "bowl_rice"],
      water: 1,
    },
    {
      id: "talsu",
      name: "탈수",
      caption: c.talsu ?? `${drain}시간 동안 물을 빼줘요`,
      models: ["bamboo_basket"],
    },
    {
      id: "jeungja",
      name: "증자",
      caption: c.jeungja ?? "강한 증기로 쪄 고두밥을 지어요",
      models: ["steamer_pot", "steamer_lid"],
      steam: true,
    },
    {
      id: "naenggak",
      name: "냉각",
      caption: c.naenggak ?? "다단식 채반에 펼쳐 차게 식혀요",
      models: ["metal_food_tray", "rice_plane"],
      dark: true,
    },
  ];
}

/* ────────────────────────────────────────────────────────────────────────
 * ② 담금 — 밑술 → 덧술 ×N → 후발효
 * ──────────────────────────────────────────────────────────────────────*/

export interface MashOptions {
  /**
   * 덧술 횟수. 이 숫자 하나로 몇 양주인지가 정해진다.
   *   0 = 단양주 · 1 = 이양주 · 2 = 삼양주 · 4 = 오양주
   */
  rounds: number;
  /** 누룩을 부르는 말 (예: "전통누룩") */
  nuruk?: string;
  /** 밑술을 앉혀 두는 날수 */
  primaryDays?: number;
  /** 후발효 날수 */
  postDays?: number;
}

/**
 * 담금·발효 단계. 마지막 항목이 '자동 발효(온도 맞추기)'가 도는 자리다 —
 * 엔진이 배열의 끝을 그렇게 쓰므로 후발효는 항상 마지막에 온다.
 */
export function mashSteps(o: MashOptions): ProcessStep[] {
  const rounds = Math.max(0, o.rounds);
  const nuruk = o.nuruk ?? "전통누룩";
  const primary = o.primaryDays ?? 3;
  const post = o.postDays ?? 30;
  const name = brewName(rounds);

  const steps: ProcessStep[] = [
    {
      id: "mix",
      name: "혼합",
      caption: `식힌 고두밥에 불린 ${nuruk}과 물을 섞어 항아리에 담아요`,
    },
    {
      id: "primary",
      name: "밑술",
      caption: `발효실에서 ${primary}일, 첫 술이 부글부글 끓어올라 밑술이 돼요`,
    },
  ];

  // 덧술 — 할 때마다 고두밥을 새로 지어 더한다. 이 반복이 곧 몇 양주인지를 정한다.
  for (let i = 1; i <= rounds; i++) {
    const last = i === rounds;
    steps.push({
      id: `mash${i}`,
      name: rounds > 1 ? `덧술${i}` : "덧술",
      caption: last
        ? `한 번 더 고두밥을 안쳐 ${name}로 빚어요`
        : "새로 지은 고두밥과 물을 더해 고루 저어요",
    });
  }

  steps.push({
    id: "post",
    name: "후발효",
    caption: `${post}일 남짓, 맑은 술이 천천히 익어가요`,
  });

  return steps;
}

/* ────────────────────────────────────────────────────────────────────────
 * ③ 완성 — 압착·여과 → (증류) → 숙성 → 출고
 * ──────────────────────────────────────────────────────────────────────*/

export interface FinishOptions {
  /** 증류식 소주처럼 짜낸 뒤 내리는 술이면 true — 압착과 숙성 사이에 증류가 들어간다 */
  distill?: boolean;
  /** 숙성 온도 (℃) */
  ageC?: number;
  /** 숙성 기간 문구 (예: "한 달 넘게") */
  agePeriod?: string;
}

export function finishSteps(o: FinishOptions = {}): ProcessStep[] {
  const ageC = o.ageC ?? 1;
  const period = o.agePeriod ?? "한 달 넘게";

  const steps: ProcessStep[] = [
    { id: "press", name: "압착·여과", caption: "보자기에 술덧을 붓고 손으로 정성껏 짜 맑게 걸러요" },
  ];

  if (o.distill) {
    steps.push({
      id: "distill",
      name: "증류",
      caption: "소줏고리에 올려 은근한 불로 내려요",
    });
  }

  steps.push(
    { id: "aging", name: "저온숙성", caption: `${ageC}℃ 냉장창고에서 ${period} 저온으로 숙성해요` },
    { id: "ship", name: "출고", caption: "손으로 병입하고 라벨을 붙여 세상에 내보내요" }
  );

  return steps;
}
