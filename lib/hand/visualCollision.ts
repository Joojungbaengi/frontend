import * as THREE from "three";

/**
 * 인터랙션 판정과 무관한 시각 전용 충돌체.
 * 손 모델만 표면 밖으로 밀어내며 grab/놓기 좌표는 변경하지 않는다.
 */
export interface VisualHandCollider {
  min: THREE.Vector3;
  max: THREE.Vector3;
  /** 충돌체 로컬 좌표를 stage 로컬 좌표로 옮기는 행렬 */
  matrix: THREE.Matrix4;
  inverseMatrix: THREE.Matrix4;
  padding: number;
  enabled: boolean;
}

export interface VisualHandCollisionSpace {
  root: THREE.Object3D;
  colliders: VisualHandCollider[];
}

export function createVisualHandBox(
  min: THREE.Vector3Tuple,
  max: THREE.Vector3Tuple,
  padding = 0.006,
): VisualHandCollider {
  return {
    min: new THREE.Vector3(...min),
    max: new THREE.Vector3(...max),
    matrix: new THREE.Matrix4(),
    inverseMatrix: new THREE.Matrix4(),
    padding,
    enabled: true,
  };
}

/** 모델 이동/회전이 실제로 바뀐 순간에만 호출한다. */
export function setVisualHandBoxMatrix(collider: VisualHandCollider, matrix: THREE.Matrix4) {
  collider.matrix.copy(matrix);
  collider.inverseMatrix.copy(matrix).invert();
}

// 손목 + 다섯 손가락 끝. 21개 전부 검사하지 않아 모바일 비용을 제한한다.
const HAND_COLLISION_JOINTS = [0, 4, 8, 12, 16, 20] as const;
const stageInverse = new THREE.Matrix4();
const stagePoint = new THREE.Vector3();
const localPoint = new THREE.Vector3();
const correctedLocal = new THREE.Vector3();
const correctedStage = new THREE.Vector3();
const correctedWorld = new THREE.Vector3();
const candidate = new THREE.Vector3();

/**
 * 가장 깊게 관통한 대표점 하나를 기준으로 손 전체에 적용할 최소 이동량을 구한다.
 * O(대표점 6 × 활성 Box 수)이며 geometry/raycast/물리 엔진을 사용하지 않는다.
 */
export function resolveVisualHandPenetration(
  joints: readonly THREE.Vector3[],
  space: VisualHandCollisionSpace | null,
  out: THREE.Vector3,
) {
  out.set(0, 0, 0);
  if (!space || space.colliders.length === 0) return out;

  // renderer가 직전 프레임에 갱신한 matrixWorld를 재사용한다.
  // 여기서 updateMatrixWorld(true)를 호출하지 않아 손 추적 루프의 비용을 늘리지 않는다.
  stageInverse.copy(space.root.matrixWorld).invert();
  let bestLengthSq = 0;

  for (const jointIndex of HAND_COLLISION_JOINTS) {
    const joint = joints[jointIndex];
    if (!joint) continue;
    stagePoint.copy(joint).applyMatrix4(stageInverse);

    for (const collider of space.colliders) {
      if (!collider.enabled) continue;
      localPoint.copy(stagePoint).applyMatrix4(collider.inverseMatrix);

      const minX = collider.min.x - collider.padding;
      const minY = collider.min.y - collider.padding;
      const minZ = collider.min.z - collider.padding;
      const maxX = collider.max.x + collider.padding;
      const maxY = collider.max.y + collider.padding;
      const maxZ = collider.max.z + collider.padding;
      if (
        localPoint.x <= minX || localPoint.x >= maxX ||
        localPoint.y <= minY || localPoint.y >= maxY ||
        localPoint.z <= minZ || localPoint.z >= maxZ
      ) continue;

      const distances = [
        localPoint.x - minX,
        maxX - localPoint.x,
        localPoint.y - minY,
        maxY - localPoint.y,
        localPoint.z - minZ,
        maxZ - localPoint.z,
      ];
      let face = 0;
      for (let i = 1; i < distances.length; i++) {
        if (distances[i] < distances[face]) face = i;
      }

      correctedLocal.copy(localPoint);
      if (face === 0) correctedLocal.x = minX;
      else if (face === 1) correctedLocal.x = maxX;
      else if (face === 2) correctedLocal.y = minY;
      else if (face === 3) correctedLocal.y = maxY;
      else if (face === 4) correctedLocal.z = minZ;
      else correctedLocal.z = maxZ;

      correctedStage.copy(correctedLocal).applyMatrix4(collider.matrix);
      correctedWorld.copy(correctedStage).applyMatrix4(space.root.matrixWorld);
      candidate.copy(correctedWorld).sub(joint);
      const lengthSq = candidate.lengthSq();
      if (lengthSq > bestLengthSq) {
        bestLengthSq = lengthSq;
        out.copy(candidate);
      }
    }
  }
  return out;
}
