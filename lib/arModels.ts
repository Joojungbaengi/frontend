/**
 * ★ 내 3D 모델 목록
 * ---------------------------------------------------------------------
 *  file   : public/ 기준 절대경로. 파일은 public/models/Dongrim_Cheongju/ 안에 둔다.
 *  step   : 어느 단계에 놓을지 (ingredient / godubap / ferment / done)
 *           "common" 은 모든 단계에 공통으로 뜨는 모델 (bamboo_basket).
 *  height : 실제 높이(m). 예: 34cm 항아리면 0.34 → 코드가 자동 크기 보정
 *  y      : 받침 위 높이(보통 0.03). 공중에 띄우려면 키운다
 *
 *  ※ low_wooden_bench 는 받침대(addPlatform)로 직접 쓰이므로 이 목록에 없어도 된다.
 *    (컴포넌트가 LOADED["low_wooden_bench"] 로 직접 찾음)
 */
export type ArStep = "ingredient" | "godubap" | "ferment" | "done" | "common";

export interface ModelDef {
  id: string;
  file: string;
  step: ArStep;
  height: number;
  y: number;
}

const BASE = "/models/Dongrim_Cheongju";

export const MY_MODELS: ModelDef[] = [
  // 받침대로 쓰이는 모델 (addPlatform이 직접 로드하지만, 프리로드 되도록 목록에 둠)
  { id: "low_wooden_bench", file: `${BASE}/low_wooden_bench.glb`, step: "common", height: 0.14, y: 0.03 },

  // 모든 단계 공통 — 받침대 위에 항상 놓인다
  { id: "bamboo_basket", file: `${BASE}/bamboo_basket.glb`, step: "common", height: 0.12, y: 0.03 },

  // 쌀 씻기(godubap) 단계 — 가상의 아이코사헤드론 대신 실제 모델을 그릇째로 놓는다.
  // "항아리에 담기" 클릭 전까지(쌀 씻기/불리기/찌기/식히기 내내) 계속 보인다.
  { id: "rice_bowl", file: `${BASE}/rice_bowl.glb`, step: "godubap", height: 0.12, y: 0.03 },

  // 발효(ferment) 단계 — "누룩 섞고 항아리에 담기" 클릭 순간 rice_bowl 은 사라지고 이 모델이 나타난다.
  { id: "water_jar", file: `${BASE}/water_jar.glb`, step: "ferment", height: 0.12, y: 0.03 },

  // ── 아래는 지금 화면에 띄우지 않는 모델들.
  //    특정 단계에 다시 띄우려면 step 을 ingredient/godubap/ferment/done 으로 바꾸면 된다.
  // { id: "bag_rise",      file: `${BASE}/bag_rise.glb`,      step: "ingredient", height: 0.10, y: 0.03 },
  // { id: "basket",        file: `${BASE}/basket.glb`,        step: "ingredient", height: 0.10, y: 0.03 },
  // { id: "rice_grains",   file: `${BASE}/rice_grains.glb`,   step: "ferment",    height: 0.34, y: 0.03 },
];
