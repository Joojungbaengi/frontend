"use client";

/**
 * 리그드 손 — 뼈대가 들어 있는 3D 손 모델을 인식한 관절에 맞춰 움직인다.
 *
 * 모델의 뼈 구조가 우리가 인식하는 관절 21개와 그대로 맞아떨어져서, 뼈 이름만 보고
 * 짝을 지을 수 있다.
 *
 *   radius_ulna(손목) ─┬─ index_meta → index_prox → index_midd → index_dist
 *                      ├─ midd_·  ring_·  pinky_· (같은 구조)
 *                      └─ thumb_trapez → thumb_meta → thumb_prox → thumb_dist
 *
 * MediaPipe 는 관절의 **위치**만 주고 뼈의 **각도**는 주지 않는다. 그래서 뼈마다
 * "이 관절에서 다음 관절로 향하는 방향"을 구해 그쪽을 보도록 돌린다.
 * 부모부터 자식 순서로 돌려야 한다 — 부모가 움직이면 자식의 기준도 같이 움직이기 때문이다.
 *
 * **모델의 축·크기·기준점은 하나도 미리 정해 두지 않는다.** 어느 축이 손바닥 법선인지
 * 손이 얼마나 큰지를 코드에 박아 두면, 한 번 잘못 짚었을 때 손이 뒤집히거나 크기가 어긋난다.
 * 대신 불러온 직후 쉬는 자세에서 **직접 재서** 기준을 잡는다.
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

  /** 쉬는 자세에서 잰 값들 — 전부 측정한 것이지 정해 둔 상수가 아니다 */
  private restBasisInv = new THREE.Matrix4();
  private restKnuckle = new THREE.Vector3();
  private restWidth = 1;
  private ready = false;

  private tmpDir = new THREE.Vector3();
  private parentQ = new THREE.Quaternion();
  private fwd = new THREE.Vector3();
  private side = new THREE.Vector3();
  private up = new THREE.Vector3();
  private tmpSide = new THREE.Vector3();
  private obsBasis = new THREE.Matrix4();
  private rot = new THREE.Matrix4();
  private anchor = new THREE.Vector3();

  get loaded() {
    return this.ready;
  }

  /** fwd 를 기준으로 side 를 직각으로 고쳐 직교 기저를 만든다 */
  private basisFrom(fwd: THREE.Vector3, side: THREE.Vector3, out: THREE.Matrix4) {
    this.up.crossVectors(fwd, side).normalize();
    this.tmpSide.crossVectors(this.up, fwd).normalize();
    out.makeBasis(this.tmpSide, fwd, this.up);
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
        // 반대쪽 손일 때 뒤집어 쓰므로 뒷면도 그려야 한다
        if (mat) mat.side = THREE.DoubleSide;
      }
    });

    // 쉬는 자세에서 각 뼈가 보던 방향. 자식 뼈의 상대 위치가 곧 "이 뼈가 뻗은 쪽"이다.
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

    // ── 모델의 축과 크기를 직접 잰다 ────────────────────────────────
    // 뼈의 local position 만 더해서는 안 된다. 손가락을 벌려 놓는 건 각 뼈의 **회전**이라,
    // 회전을 빼고 위치만 더하면 다섯 손가락이 한 줄로 겹쳐 나온다.
    // getWorldPosition 은 회전까지 반영한 실제 자리를 준다.
    const at = (name: string) =>
      this.bones.get(name)?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3();

    const middleMeta = at("midd_meta");
    const middleKnuckle = at("midd_prox");
    const indexKnuckle = at("index_prox");
    const pinkyKnuckle = at("pinky_prox");

    // 손이 뻗은 쪽 — 중지 손등뼈. 인식 좌표의 손목→중지너클과 같은 구간이다.
    const restFwd = middleKnuckle.clone().sub(middleMeta).normalize();
    // 너클을 가로지르는 쪽 — 새끼에서 검지로
    const restSide = indexKnuckle.clone().sub(pinkyKnuckle).normalize();

    this.basisFrom(restFwd, restSide, this.rot);
    this.restBasisInv.copy(this.rot).transpose(); // 직교행렬이라 전치가 곧 역행렬

    // 크기 기준은 **너클 폭**으로 잡는다. 손목~너클을 쓰면 모델에 붙은 팔뚝까지 세어져
    // 실제 손보다 작게 그려진다 — 모델의 손목뼈는 손목이 아니라 팔뚝 끝에 있다.
    this.restWidth = indexKnuckle.distanceTo(pinkyKnuckle) || 1;
    // 손을 붙일 기준점도 팔뚝의 영향을 안 받는 중지 너클로 잡는다
    this.restKnuckle.copy(middleKnuckle);

    this.group.visible = false;
    this.ready = true;
  }

  /**
   * 인식한 관절 위치(월드 좌표)에 손을 맞춘다.
   * @param joints 21개 관절의 월드 좌표
   * @param mirrored 모델과 반대쪽 손이면 true — 손가락 축을 기준으로 반 바퀴 돌려 쓴다
   */
  update(joints: THREE.Vector3[], mirrored = false) {
    if (!this.ready || joints.length < 21) return;

    // ── 1. 손 전체 놓기 ─────────────────────────────────────────────
    this.fwd.subVectors(joints[LM.MIDDLE_MCP], joints[LM.WRIST]);
    if (this.fwd.lengthSq() < 1e-10) return;
    this.fwd.normalize();

    this.side.subVectors(joints[LM.INDEX_MCP], joints[LM.PINKY_MCP]);
    const width = this.side.length();
    if (width < 1e-6) return;
    this.side.divideScalar(width);

    // 반대쪽 손은 손가락 축을 기준으로 반 바퀴 돌린 모양이다.
    // side 를 뒤집으면 up 도 같이 뒤집혀 축 두 개가 바뀌므로, 뒤집힌 행렬이 아니라
    // 그냥 회전으로 남는다. (음수 배율을 쓰면 조명과 앞뒤면이 깨진다)
    if (mirrored) this.side.negate();

    this.basisFrom(this.fwd, this.side, this.obsBasis);

    // 모델 기저 → 관측 기저로 옮기는 회전
    this.rot.multiplyMatrices(this.obsBasis, this.restBasisInv);
    this.group.quaternion.setFromRotationMatrix(this.rot);

    const scale = width / this.restWidth;
    this.group.scale.setScalar(scale);

    // 중지 너클이 인식된 너클 자리에 오도록 그룹을 민다
    this.anchor.copy(this.restKnuckle).multiplyScalar(scale).applyQuaternion(this.group.quaternion);
    this.group.position.copy(joints[LM.MIDDLE_MCP]).sub(this.anchor);
    this.group.updateMatrixWorld(true);
    this.group.visible = true;

    // ── 2. 손가락 굽히기 ────────────────────────────────────────────
    // i=0 (손등뼈 / 엄지 손목뼈) 는 건드리지 않는다.
    // 실제 손에서 손등뼈는 거의 안 움직이는데, 이걸 인식 좌표대로 돌리면
    // 다섯 개가 제각각 벌어지면서 손바닥이 찢어진 것처럼 보인다.
    for (const { bones, joints: js } of CHAINS) {
      for (let i = 1; i < bones.length; i++) {
        const bone = this.bones.get(bones[i]);
        const axis = this.restAxis.get(bones[i]);
        if (!bone || !bone.parent || !axis) continue;

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
