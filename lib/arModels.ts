/**
 * ★ 내 3D 모델 목록 — 여기만 채우면 된다
 * ---------------------------------------------------------------------
 *  file   : public/ 기준 절대경로. 파일은 public/models/Dongrim_Cheongju/ 안에 둔다.
 *           (Next.js는 public 폴더가 웹 루트라 경로에서 'public'은 생략된다)
 *  step   : 어느 단계에 놓을지 (ingredient / godubap / ferment / done)
 *  height : 실제 높이(m). 예: 34cm 항아리면 0.34 → 코드가 자동 크기 보정
 *  y      : 받침 위 높이(보통 0.03). 공중에 띄우려면 키운다
 */
export type ArStep = "ingredient" | "godubap" | "ferment" | "done";

export interface ModelDef {
  id: string;
  file: string;
  step: ArStep;
  height: number;
  y: number;
}

const BASE = "/models/Dongrim_Cheongju";

export const MY_MODELS: ModelDef[] = [
  { id: "m1", file: `${BASE}/bag_rise.glb`,         step: "ingredient", height: 0.10, y: 0.03 },
  { id: "m2", file: `${BASE}/bamboo_basket.glb`,    step: "ingredient", height: 0.10, y: 0.03 },
  { id: "m3", file: `${BASE}/basket.glb`,           step: "ingredient", height: 0.10, y: 0.03 },
  { id: "m4", file: `${BASE}/low_wooden_bench.glb`, step: "godubap",    height: 0.14, y: 0.03 },
  { id: "m5", file: `${BASE}/rice_bowl.glb`,        step: "godubap",    height: 0.12, y: 0.03 },
  { id: "m6", file: `${BASE}/rice_grains.glb`,      step: "ferment",    height: 0.34, y: 0.03 },
  { id: "m7", file: `${BASE}/water_jar.glb`,        step: "ferment",    height: 0.12, y: 0.03 },
];