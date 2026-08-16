/**
 * 에셋 가공 도구 — 받아 온 모델을 폰에서 돌 수 있는 크기로 줄인다.
 *
 * 스캔/AI 로 만든 모델은 삼각형이 수백만 개, 텍스처가 4K 씩이라 그대로는 못 쓴다.
 * 정밀한 기계 부품이 아니라 누룩 덩어리·바구니 같은 **거친 물건**이라, 격자에 붙여
 * 뭉치는 방식으로 줄여도 실루엣이 거의 그대로 남는다. 느린 정식 감쇄기 대신 이걸 쓴다.
 */
import * as THREE from "three";

/** 삼각형 수 */
export function triCount(o: THREE.Object3D): number {
  let n = 0;
  o.traverse((x) => {
    const g = (x as THREE.Mesh).geometry;
    if (!g) return;
    n += g.index ? g.index.count / 3 : (g.attributes.position?.count ?? 0) / 3;
  });
  return Math.round(n);
}

/** 인덱스가 없으면 만들어 준다 (아래 처리들이 인덱스를 전제로 한다) */
function indexed(g: THREE.BufferGeometry): THREE.BufferGeometry {
  if (g.index) return g;
  const n = g.attributes.position.count;
  g.setIndex(Array.from({ length: n }, (_, i) => i));
  return g;
}

function build(px: number[], py: number[], pz: number[], ni: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const arr = new Float32Array(px.length * 3);
  for (let i = 0; i < px.length; i++) {
    arr[i * 3] = px[i];
    arr[i * 3 + 1] = py[i];
    arr[i * 3 + 2] = pz[i];
  }
  g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
  g.setIndex(ni);
  g.computeVertexNormals();
  return g;
}

/**
 * 격자에 붙여 정점을 뭉친다. 한 칸 안에 든 정점들은 하나로 합쳐지고,
 * 세 꼭짓점이 같은 칸에 든 삼각형은 사라진다.
 * @param target 목표 삼각형 수 — 닿을 때까지 격자를 키워 가며 되풀이한다
 */
export function decimate(g0: THREE.BufferGeometry, target: number): THREE.BufferGeometry {
  const g = indexed(g0.clone());
  const pos = g.attributes.position;
  const idx = g.index!;
  const size = new THREE.Box3()
    .setFromBufferAttribute(pos as THREE.BufferAttribute)
    .getSize(new THREE.Vector3());
  let cell = (size.length() || 1) / 140;

  for (let pass = 0; pass < 16; pass++) {
    const map = new Map<string, number>();
    const remap = new Int32Array(pos.count);
    const px: number[] = [], py: number[] = [], pz: number[] = [];
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const key = `${Math.round(x / cell)},${Math.round(y / cell)},${Math.round(z / cell)}`;
      let at = map.get(key);
      if (at === undefined) {
        at = px.length;
        map.set(key, at);
        px.push(x); py.push(y); pz.push(z);
      }
      remap[i] = at;
    }
    const ni: number[] = [];
    for (let i = 0; i < idx.count; i += 3) {
      const a = remap[idx.getX(i)], b = remap[idx.getX(i + 1)], c = remap[idx.getX(i + 2)];
      if (a !== b && b !== c && a !== c) ni.push(a, b, c);
    }
    if (ni.length / 3 <= target || pass === 15) return build(px, py, pz, ni);
    cell *= 1.45;
  }
  return g;
}

/**
 * 서로 떨어져 있는 덩어리들을 갈라 낸다.
 * 에셋 리스트의 "모델끼리의 분리 필요" 가 이것 — 여러 덩어리가 메시 하나에 뭉쳐 있다.
 */
export function split(g0: THREE.BufferGeometry): THREE.BufferGeometry[] {
  const g = indexed(g0.clone());
  const pos = g.attributes.position, idx = g.index!;
  // 같은 자리의 정점부터 하나로 본다 — 스캔 모델은 면마다 정점이 쪼개져 있다
  const parent = new Int32Array(pos.count);
  const at = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    const k = `${pos.getX(i).toFixed(5)},${pos.getY(i).toFixed(5)},${pos.getZ(i).toFixed(5)}`;
    const f = at.get(k);
    if (f === undefined) { at.set(k, i); parent[i] = i; } else parent[i] = f;
  }
  const root = (i: number): number => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  };
  const join = (a: number, b: number) => {
    const ra = root(a), rb = root(b);
    if (ra !== rb) parent[ra] = rb;
  };
  for (let i = 0; i < idx.count; i += 3) {
    join(idx.getX(i), idx.getX(i + 1));
    join(idx.getX(i + 1), idx.getX(i + 2));
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < idx.count; i += 3) {
    const r = root(idx.getX(i));
    let list = groups.get(r);
    if (!list) groups.set(r, (list = []));
    list.push(idx.getX(i), idx.getX(i + 1), idx.getX(i + 2));
  }
  const out: THREE.BufferGeometry[] = [];
  for (const tri of groups.values()) {
    if (tri.length < 60) continue; // 부스러기는 버린다
    const used = new Map<number, number>();
    const px: number[] = [], py: number[] = [], pz: number[] = [], ni: number[] = [];
    for (const v of tri) {
      let n = used.get(v);
      if (n === undefined) {
        n = px.length;
        used.set(v, n);
        px.push(pos.getX(v)); py.push(pos.getY(v)); pz.push(pos.getZ(v));
      }
      ni.push(n);
    }
    out.push(build(px, py, pz, ni));
  }
  out.sort((a, b) => (b.index?.count ?? 0) - (a.index?.count ?? 0)); // 큰 덩어리부터
  return out;
}

/** 원점을 바닥 한가운데로 옮긴다 */
export function ground(obj: THREE.Object3D): THREE.Vector3 {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  const c = box.getCenter(new THREE.Vector3());
  obj.position.x -= c.x;
  obj.position.z -= c.z;
  obj.position.y -= box.min.y;
  obj.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3());
}
