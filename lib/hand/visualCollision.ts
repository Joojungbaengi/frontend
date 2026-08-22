import * as THREE from "three";

/**
 * 인터랙션 판정과 무관한 시각 전용 충돌체.
 * 손 모델만 표면 밖으로 밀어내며 grab/놓기 좌표는 변경하지 않는다.
 */
export interface VisualHandCollider {
  kind: "box" | "ellipsoid";
  min: THREE.Vector3;
  max: THREE.Vector3;
  center: THREE.Vector3;
  radii: THREE.Vector3;
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
    kind: "box",
    min: new THREE.Vector3(...min),
    max: new THREE.Vector3(...max),
    center: new THREE.Vector3(),
    radii: new THREE.Vector3(1, 1, 1),
    matrix: new THREE.Matrix4(),
    inverseMatrix: new THREE.Matrix4(),
    padding,
    enabled: true,
  };
}

export function createVisualHandEllipsoid(
  center: THREE.Vector3Tuple,
  radii: THREE.Vector3Tuple,
  padding = 0.006,
): VisualHandCollider {
  return {
    kind: "ellipsoid",
    min: new THREE.Vector3(),
    max: new THREE.Vector3(),
    center: new THREE.Vector3(...center),
    radii: new THREE.Vector3(...radii),
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

interface HandCollisionProbe {
  joints: readonly number[];
  /** 뼈대 점 주위의 실제 손 메시 두께를 근사한 반지름(m) */
  radius: number;
}

// 단순 관절점만 검사하면 뼈는 밖에 있어도 손바닥 면과 마디 사이의 살이
// 물체를 관통한다. 손바닥 중심과 손가락 중간점을 함께 검사하되 총 12개로
// 제한해 모바일에서도 삼각형 충돌보다 훨씬 저렴하게 유지한다.
const HAND_COLLISION_PROBES: readonly HandCollisionProbe[] = [
  { joints: [0], radius: 0.022 },
  { joints: [0, 5, 9, 13, 17], radius: 0.028 },
  { joints: [2, 4], radius: 0.013 },
  { joints: [4], radius: 0.012 },
  { joints: [5, 8], radius: 0.014 },
  { joints: [8], radius: 0.012 },
  { joints: [9, 12], radius: 0.014 },
  { joints: [12], radius: 0.012 },
  { joints: [13, 16], radius: 0.014 },
  { joints: [16], radius: 0.012 },
  { joints: [17, 20], radius: 0.013 },
  { joints: [20], radius: 0.011 },
] as const;
const stageInverse = new THREE.Matrix4();
const probeWorld = new THREE.Vector3();
const stagePoint = new THREE.Vector3();
const localPoint = new THREE.Vector3();
const correctedLocal = new THREE.Vector3();
const correctedStage = new THREE.Vector3();
const correctedWorld = new THREE.Vector3();
const candidate = new THREE.Vector3();
const ellipsoidDirection = new THREE.Vector3();

/**
 * 가장 깊게 관통한 대표 영역 하나를 기준으로 손 전체에 적용할 최소 이동량을 구한다.
 * O(대표 영역 12 × 활성 Collider 수)이며 geometry/raycast/물리 엔진을 사용하지 않는다.
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

  for (const probe of HAND_COLLISION_PROBES) {
    probeWorld.set(0, 0, 0);
    let validJointCount = 0;
    for (const jointIndex of probe.joints) {
      const joint = joints[jointIndex];
      if (!joint) continue;
      probeWorld.add(joint);
      validJointCount += 1;
    }
    if (validJointCount === 0) continue;
    probeWorld.multiplyScalar(1 / validJointCount);
    stagePoint.copy(probeWorld).applyMatrix4(stageInverse);

    for (const collider of space.colliders) {
      if (!collider.enabled) continue;
      localPoint.copy(stagePoint).applyMatrix4(collider.inverseMatrix);

      if (collider.kind === "ellipsoid") {
        const surfacePadding = collider.padding + probe.radius;
        const radiusX = collider.radii.x + surfacePadding;
        const radiusY = collider.radii.y + surfacePadding;
        const radiusZ = collider.radii.z + surfacePadding;
        ellipsoidDirection.set(
          (localPoint.x - collider.center.x) / radiusX,
          (localPoint.y - collider.center.y) / radiusY,
          (localPoint.z - collider.center.z) / radiusZ,
        );
        const normalizedLengthSq = ellipsoidDirection.lengthSq();
        if (normalizedLengthSq >= 1) continue;

        // 중심에 정확히 들어온 경우에도 안정적인 앞쪽 방향으로 밀어낸다.
        if (normalizedLengthSq < 1e-8) ellipsoidDirection.set(0, 0, 1);
        else ellipsoidDirection.multiplyScalar(1 / Math.sqrt(normalizedLengthSq));
        correctedLocal.set(
          collider.center.x + ellipsoidDirection.x * radiusX,
          collider.center.y + ellipsoidDirection.y * radiusY,
          collider.center.z + ellipsoidDirection.z * radiusZ,
        );
        correctedStage.copy(correctedLocal).applyMatrix4(collider.matrix);
        correctedWorld.copy(correctedStage).applyMatrix4(space.root.matrixWorld);
        candidate.copy(correctedWorld).sub(probeWorld);
        const lengthSq = candidate.lengthSq();
        if (lengthSq > bestLengthSq) {
          bestLengthSq = lengthSq;
          out.copy(candidate);
        }
        continue;
      }

      const surfacePadding = collider.padding + probe.radius;
      const minX = collider.min.x - surfacePadding;
      const minY = collider.min.y - surfacePadding;
      const minZ = collider.min.z - surfacePadding;
      const maxX = collider.max.x + surfacePadding;
      const maxY = collider.max.y + surfacePadding;
      const maxZ = collider.max.z + surfacePadding;
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
      candidate.copy(correctedWorld).sub(probeWorld);
      const lengthSq = candidate.lengthSq();
      if (lengthSq > bestLengthSq) {
        bestLengthSq = lengthSq;
        out.copy(candidate);
      }
    }
  }
  return out;
}
