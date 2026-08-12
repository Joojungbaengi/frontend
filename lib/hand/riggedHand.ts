"use client";

/**
 * 리그드 손 — 뼈대가 들어 있는 3D 손 모델을 인식한 관절에 맞춰 움직인다.
 *
 * 직접 관을 뽑아 만들던 손(gloveHand.ts)을 대신한다. 모델의 뼈 구조가 우리가 인식하는
 * 관절 21개와 그대로 맞아떨어져서, 뼈 이름만 보고 짝을 지을 수 있다.
 *
 *   radius_ulna(손목) ─┬─ index_meta → index_prox → index_midd → index_dist
 *                      ├─ midd_·  ring_·  pinky_· (같은 구조)
 *                      └─ thumb_trapez → thumb_meta → thumb_prox → thumb_dist
 *
 * MediaPipe 는 관절의 **위치**만 주고 뼈의 **각도**는 주지 않는다. 그래서 뼈마다
 * "이 관절에서 다음 관절로 향하는 방향"을 구해 그쪽을 보도록 돌린다.
 * 부모부터 자식 순서로 돌려야 한다 — 부모가 움직이면 자식의 기준도 같이 움직이기 때문이다.
 *
 * 손 전체의 위치·크기·기울기는 뼈가 아니라 바깥 그룹이 맡는다. 뼈는 손가락 관절만 담당한다.
 * 그래야 손목을 돌렸을 때 손바닥이 엉뚱한 쪽을 보는 일이 없다.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { LM } from "@/lib/hand/types";

const MODEL_URL = "/ar/3d-assets/hand_detailed.glb";

/**
 * 뼈 하나가 어느 관절에서 어느 관절로 향하는지.
 * 각 손가락은 [손목 → 뿌리 → 마디 → 마디 → 끝] 네 구간이고, 뼈도 네 개다.
 */
const CHAINS: { bones: string[]; joints: number[] }[] = [
  {
    bones: ["thumb_trapez", "thumb_meta", "thumb_prox", "thumb_dist"],
    joints: [LM.WRIST, 1, 2, 3, 4],
  },
  {
    bones: ["index_meta", "index_prox", "index_midd", "index_dist"],
    joints: [LM.WRIST, 5, 6, 7, 8],
  },
  {
    bones: ["midd_meta", "midd_prox", "midd_midd", "midd_dist"],
    joints: [LM.WRIST, 9, 10, 11, 12],
  },
  {
    bones: ["ring_meta", "ring_prox", "ring_midd", "ring_dist"],
    joints: [LM.WRIST, 13, 14, 15, 16],
  },
  {
    bones: ["pinky_meta", "pinky_prox", "pinky_midd", "pinky_dist"],
    joints: [LM.WRIST, 17, 18, 19, 20],
  },
];

export class RiggedHand {
  /** 손 전체. 위치·기울기·크기는 이 그룹이 갖는다. */
  readonly group = new THREE.Group();

  private bones = new Map<string, THREE.Bone>();
  /** 뼈마다 "쉬는 자세에서 어느 쪽을 보고 있었나" (뼈 자기 좌표계) */
  private restAxis = new Map<string, THREE.Vector3>();
  /** 모델 기준 손목~중지너클 길이 — 실제 손 크기에 맞춰 줄이고 늘리는 기준 */
  private restSpan = 1;
  /** 쉬는 자세에서 손목뼈가 그룹 원점으로부터 떨어져 있는 만큼 */
  private wristOffset = new THREE.Vector3();
  private ready = false;

  private tmpDir = new THREE.Vector3();
  private tmpQ = new THREE.Quaternion();
  private parentQ = new THREE.Quaternion();
  private fwd = new THREE.Vector3();
  private side = new THREE.Vector3();
  private up = new THREE.Vector3();
  private basis = new THREE.Matrix4();

  get loaded() {
    return this.ready;
  }

  /** 모델을 올린다. 손을 실제로 쓰기 시작할 때 한 번만 부른다. */
  async load() {
    const gltf = await new GLTFLoader().loadAsync(MODEL_URL);
    const root = gltf.scene;

    root.traverse((o) => {
      if ((o as THREE.Bone).isBone) this.bones.set(o.name, o as THREE.Bone);
      const m = o as THREE.SkinnedMesh;
      if (m.isSkinnedMesh) {
        // 뼈를 크게 움직이므로 화면 밖 판정을 끈다 (안 그러면 손이 통째로 사라진다)
        m.frustumCulled = false;
        const mat = m.material as THREE.MeshStandardMaterial;
        if (mat) mat.side = THREE.DoubleSide;
      }
    });

    // 쉬는 자세에서 각 뼈가 보던 방향을 기억해 둔다.
    // 자식 뼈의 상대 위치가 곧 "이 뼈가 뻗은 쪽"이다.
    for (const { bones } of CHAINS) {
      let lastAxis: THREE.Vector3 | null = null;
      bones.forEach((name, i) => {
        const bone = this.bones.get(name);
        if (!bone) return;
        const child = this.bones.get(bones[i + 1]);
        if (child) {
          const axis = child.position.clone().normalize();
          this.restAxis.set(name, axis);
          lastAxis = axis;
        } else if (lastAxis) {
          // 손끝 뼈는 자식이 없다. 같은 손가락이 쓰던 기준을 그대로 쓴다.
          this.restAxis.set(name, lastAxis.clone());
        }
      });
    }

    this.group.add(root);
    this.group.position.set(0, 0, 0);
    this.group.quaternion.identity();
    this.group.scale.setScalar(1);
    this.group.updateMatrixWorld(true);

    // 크기 기준 — 손목뼈에서 중지 너클까지. 이 길이가 인식된 손의 0→9 에 대응한다.
    //
    // 주의: 뼈의 local position 은 "부모로부터 떨어진 거리"라서 midd_meta.position 은
    // 손등뼈 길이가 아니라 손목에서 손등뼈가 시작하는 지점까지의 거리다.
    // 그걸 손 크기로 쓰면 손이 서너 배로 부푼다. 월드 좌표로 직접 잰다.
    const wrist = this.bones.get("radius_ulna");
    const knuckle = this.bones.get("midd_prox");
    if (wrist && knuckle) {
      const a = wrist.getWorldPosition(new THREE.Vector3());
      const b = knuckle.getWorldPosition(new THREE.Vector3());
      this.restSpan = a.distanceTo(b) || 1;
      this.wristOffset.copy(a); // 그룹이 원점에 있을 때의 손목 위치
    }

    this.group.visible = false;
    this.ready = true;
  }

  /**
   * 인식한 관절 위치(월드 좌표)에 손을 맞춘다.
   * @param joints 21개 관절의 월드 좌표
   */
  update(joints: THREE.Vector3[]) {
    if (!this.ready || joints.length < 21) return;
    this.group.visible = true;

    // ── 1. 손 전체 놓기 ─────────────────────────────────────────────
    // 손이 향한 쪽(손목→중지뿌리)과 손등을 가로지르는 쪽(새끼→검지)으로 자세를 잡는다.
    this.fwd.subVectors(joints[LM.MIDDLE_MCP], joints[LM.WRIST]);
    const span = this.fwd.length();
    if (span < 1e-6) return;
    this.fwd.divideScalar(span);

    this.side.subVectors(joints[LM.INDEX_MCP], joints[LM.PINKY_MCP]).normalize();
    this.up.crossVectors(this.fwd, this.side).normalize();
    // 손이 기울면 side 가 fwd 와 직각이 아니게 된다. 다시 직각으로 세운다.
    this.side.crossVectors(this.up, this.fwd).normalize();

    // 모델의 축을 손의 축에 맞춘다.
    //   Y = 뼈가 뻗은 쪽(손가락 방향)  ← 모든 뼈의 local translation 이 +Y 다
    //   X = 손바닥 법선                ← 모델 치수가 5×25×20 이라 얇은 축이 X 다
    //   Z = 너클을 가로지르는 쪽
    // (side, fwd, up) 순으로 넣으면 손이 옆으로 누워 종잇장처럼 보인다.
    this.basis.makeBasis(this.up, this.fwd, this.side);
    this.group.quaternion.setFromRotationMatrix(this.basis);
    const scale = span / this.restSpan;
    this.group.scale.setScalar(scale);

    // 손목뼈가 그룹 원점에 있지 않으므로, 그만큼 빼야 손목이 제자리에 온다
    this.tmpDir.copy(this.wristOffset).multiplyScalar(scale).applyQuaternion(this.group.quaternion);
    this.group.position.copy(joints[LM.WRIST]).sub(this.tmpDir);
    this.group.updateMatrixWorld(true);

    // ── 2. 손가락 굽히기 ────────────────────────────────────────────
    // i=0 (손등뼈 / 엄지 손목뼈) 는 건드리지 않는다.
    // 실제 손에서 손등뼈는 거의 안 움직이는데, 이걸 인식 좌표대로 돌리면
    // 다섯 개가 제각각 벌어지면서 손바닥이 찢어진 것처럼 보인다.
    // 손 전체의 방향은 이미 바깥 그룹이 잡아 줬으므로 손가락 마디만 굽히면 된다.
    for (const { bones, joints: js } of CHAINS) {
      for (let i = 1; i < bones.length; i++) {
        const bone = this.bones.get(bones[i]);
        const axis = this.restAxis.get(bones[i]);
        if (!bone || !bone.parent || !axis) continue;

        // 이 뼈가 향해야 하는 방향 (월드)
        this.tmpDir.subVectors(joints[js[i + 1]], joints[js[i]]);
        if (this.tmpDir.lengthSq() < 1e-10) continue;
        this.tmpDir.normalize();

        // 부모 기준으로 바꾼 뒤, 쉬는 방향에서 그쪽으로 돌린다
        bone.parent.getWorldQuaternion(this.parentQ);
        this.tmpDir.applyQuaternion(this.parentQ.invert());
        bone.quaternion.setFromUnitVectors(axis, this.tmpDir);
        bone.updateMatrixWorld(true);
      }
    }
  }

  hide() {
    this.group.visible = false;
  }

  dispose() {
    this.group.traverse((o: THREE.Object3D) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose?.();
    });
    this.group.clear();
    this.bones.clear();
    this.restAxis.clear();
    this.ready = false;
  }
}
