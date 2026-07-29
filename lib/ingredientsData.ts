export interface IngredientDef {
  id: string;
  name: string;
  texture: string;
  essential: boolean;
}

export const INGREDIENTS: IngredientDef[] = [
  { id: "rice",   name: "가와지쌀", texture: "/models/rice.png",   essential: true },
  { id: "nuruk",  name: "누룩",     texture: "/models/nuruk.png",  essential: true },
  { id: "water",  name: "물",       texture: "/models/water.png",  essential: true },
  { id: "omija",  name: "오미자",   texture: "/models/berry.png",  essential: false },
  { id: "flower", name: "국화",     texture: "/models/flower.png", essential: false },
  { id: "honey",  name: "벌꿀",     texture: "/models/honey.png",  essential: false },
];