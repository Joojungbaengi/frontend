"use client";

/**
 * 경기술 도감 획득 상태 — **AR 양조 체험을 끝까지 마친 술만** 담긴다.
 *
 * 예전에는 AR 이 없던 시절이라 몇 개를 미리 채워 둔 시드 목록을 기본값으로 썼는데,
 * 이제 체험이 실제로 돌아가므로 그건 없앴다. 도감은 처음에 비어 있고,
 * 양조를 마칠 때마다 한 칸씩 채워진다.
 */

const KEY = "dex_obtained";

/** 저장된 목록을 읽는다. 아직 아무것도 못 마쳤으면 빈 배열. */
export function readObtained(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? (arr as string[]).filter((x) => typeof x === "string") : [];
  } catch {
    return []; // 저장값이 깨졌으면 없는 셈 친다
  }
}

/**
 * 체험을 마친 술을 도감에 담는다.
 * @returns 이번에 새로 담겼으면 true (이미 있던 술이면 false)
 */
export function markObtained(drinkId?: string | null): boolean {
  if (typeof window === "undefined" || !drinkId) return false;
  const list = readObtained();
  if (list.includes(drinkId)) return false;
  try {
    localStorage.setItem(KEY, JSON.stringify([...list, drinkId]));
    return true;
  } catch {
    return false; // 저장 공간이 막혀 있어도 체험 자체는 계속된다
  }
}

/** 이 술을 이미 도감에 담았나 */
export function hasObtained(drinkId: string): boolean {
  return readObtained().includes(drinkId);
}
