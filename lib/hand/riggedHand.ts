"use client";

/**
 * 리그드 손 — WebXR 표준 손 모델(l_hand / r_hand)을 인식한 관절에 맞춰 세운다.
 *
 * **방향은 인식한 손에서, 길이는 모델에서 가져온다.**
 * 뼈를 인식된 좌표에 그대로 꽂으면 모델이 가진 뼈 길이가 무시돼 살이 늘어나고
 * 손바닥이 찢어진 것처럼 보인다. 그래서 각 뼈는
 *   · 어느 쪽을 볼지 → 인식한 관절에서 다음 관절로 향하는 방향
 *   · 어디에 있을지 → 부모 뼈에서 **모델이 원래 갖고 있던 만큼** 떨어진 자리
 * 로 정한다. 손 모양은 사용자를 따라가고 비율은 모델 그대로라, 어떤 자세에서도
 * 손이 늘어나거나 찢어지지 않는다.
 *
 * 모델 규약은 짐작하지 않고 재서 확인했다.
 *   · 뼈 25개가 전부 형제다 (부모-자식으로 안 엮여 있다) → 부모 관계를 여기서 정의한다
 *   · 뼈의 **-Z 가 다음 관절 쪽**을 향한다 (WebXR 손 입력 사양)
 *   · 치수는 실제 미터 (손 길이 0.178m)
 *   · 왼손·오른손 모델이 따로 있어 뒤집는 잔재주가 필요 없다
 */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { HandFrame } from "@/lib/hand/types";

const MODEL = {
  right: "/ar/3d-assets/r_hand.glb",
  left: "/ar/3d-assets/l_hand.glb",
} as const;

/** 손 크기가 프레임마다 튀지 않게 하는 정도 (0에 가까울수록 느리게 따라감) */
const SCALE_EASE = 0.25;

interface JointDef {
  bone: string;
  /** 부모 뼈 (없으면 손목) */
  parent?: string;
  /**
   * 이 뼈가 향할 방향을 정하는 랜드마크 짝. 없으면 부모에 붙어 같이 돈다
   * (손등뼈처럼 손바닥 안에서 거의 안 움직이는 뼈).
   */
  from?: number;
  to?: number;
}

/** WebXR 관절 25개 — 부모 관계와, 방향을 정할 랜드마크 짝 */
const JOINTS: JointDef[] = [
  { bone: "wrist", from: 0, to: 9 },

  { bone: "thumb-metacarpal", parent: "wrist", from: 1, to: 2 },
  { bone: "thumb-phalanx-proximal", parent: "thumb-metacarpal", from: 2, to: 3 },
  { bone: "thumb-phalanx-distal", parent: "thumb-phalanx-proximal", from: 3, to: 4 },
  { bone: "thumb-tip", parent: "thumb-phalanx-distal" },

  { bone: "index-finger-metacarpal", parent: "wrist" },
  { bone: "index-finger-phalanx-proximal", parent: "index-finger-metacarpal", from: 5, to: 6 },
  { bone: "index-finger-phalanx-intermediate", parent: "index-finger-phalanx-proximal", from: 6, to: 7 },
  { bone: "index-finger-phalanx-distal", parent: "index-finger-phalanx-intermediate", from: 7, to: 8 },
  { bone: "index-finger-tip", parent: "index-finger-phalanx-distal" },

  { bone: "middle-finger-metacarpal", parent: "wrist" },
  { bone: "middle-finger-phalanx-proximal", parent: "middle-finger-metacarpal", from: 9, to: 10 },
  { bone: "middle-finger-phalanx-intermediate", parent: "middle-finger-phalanx-proximal", from: 10, to: 11 },
  { bone: "middle-finger-phalanx-distal", parent: "middle-finger-phalanx-intermediate", from: 11, to: 12 },
  { bone: "middle-finger-tip", parent: "middle-finger-phalanx-distal" },

  { bone: "ring-finger-metacarpal", parent: "wrist" },
  { bone: "ring-finger-phalanx-proximal", parent: "ring-finger-metacarpal", from: 13, to: 14 },
  { bone: "ring-finger-phalanx-intermediate", parent: "ring-finger-phalanx-proximal", from: 14, to: 15 },
  { bone: "ring-finger-phalanx-distal", parent: "ring-finger-phalanx-intermediate", from: 15, to: 16 },
  { bone: "ring-finger-tip", parent: "ring-finger-phalanx-distal" },

  { bone: "pinky-finger-metacarpal", parent: "wrist" },
  { bone: "pinky-finger-phalanx-proximal", parent: "pinky-finger-metacarpal", from: 17, to: 18 },
  { bone: "pinky-finger-phalanx-intermediate", parent: "pinky-finger-phalanx-proximal", from: 18, to: 19 },
  { bone: "pinky-finger-phalanx-distal", parent: "pinky-finger-phalanx-intermediate", from: 19, to: 20 },
  { bone: "pinky-finger-tip", parent: "pinky-finger-phalanx-distal" },
];

/** 손 하나 분량 — 모델과, 쉬는 자세에서 잰 값들 */
interface Loaded {
  root: THREE.Object3D;
  bones: Map<string, THREE.Bone>;
  /** 부모에서 이 뼈까지, 부모 기준으로 잰 거리 (모델이 가진 뼈 길이) */
  restOffset: Map<string, THREE.Vector3>;
  /** 부모 기준 회전 — 손등뼈처럼 방향을 안 받는 뼈가 그대로 쓴다 */
  restLocalQuat: Map<string, THREE.Quaternion>;
  /** 쉬는 자세의 손바닥 방향 — 인식한 자세와 견줄 기준 */
  restPalmQuat: THREE.Quaternion;
  /** 쉬는 자세의 손목 뼈 회전 — 모델이 가진 앞뒤가 여기 들어 있다 */
  restWristQuat: THREE.Quaternion;
  /** 뼈가 제 기준으로 어느 쪽을 가리키는지 (자식 쪽 단위벡터) */
  restAim: Map<string, THREE.Vector3>;
  /** 쉬는 자세의 손목~중지너클 길이 — 크기 맞추는 기준 */
  restSpan: number;
}

export class RiggedHand {
  /** 두 손 모델이 모두 들어 있는 그룹. 쓰는 쪽만 보이게 한다. */
  readonly group = new THREE.Group();

  private hands: Partial<Record<"left" | "right", Loaded>> = {};
  private shown: "left" | "right" | null = null;
  private scale = 0;

  // 매 프레임 새로 만들면 초당 수천 개가 쌓여 프레임이 튄다. 한 번 잡고 계속 쓴다.
  private worldPos = new Map<string, THREE.Vector3>();
  private worldQuat = new Map<string, THREE.Quaternion>();
  private palm = new THREE.Quaternion();

  private tmpM = new THREE.Matrix4();
  private tmpV = new THREE.Vector3();
  private tmpQ = new THREE.Quaternion();
  private fwd = new THREE.Vector3();
  private side = new THREE.Vector3();
  private up = new THREE.Vector3();

  get loaded() {
    return Boolean(this.hands.right || this.hands.left);
  }

  /**
   * 손이 놓인 **자세**를 쿼터니언으로 잰다.
   *
   * 이 축이 손바닥 쪽인지 손등 쪽인지는 **알 필요가 없다**. 쉬는 자세와 인식한
   * 자세를 똑같은 방법으로 재서 그 사이의 회전만 쓰기 때문에, 어느 쪽으로
   * 잡든 상쇄된다. 예전에는 여기서 오른손만 축을 뒤집었는데, 그 추측이
   * 모델의 실제 바인드 자세와 어긋나면 손의 앞뒤가 뒤집혀 보였다.
   */
  private palmQuat(
    wrist: THREE.Vector3,
    middleMcp: THREE.Vector3,
    indexMcp: THREE.Vector3,
    pinkyMcp: THREE.Vector3,
    out: THREE.Quaternion
  ) {
    this.fwd.subVectors(middleMcp, wrist).normalize();
    this.side.subVectors(indexMcp, pinkyMcp).normalize();
    this.up.crossVectors(this.fwd, this.side).normalize();
    if (this.up.lengthSq() < 1e-8) this.up.set(0, 1, 0);
    this.tmpV.copy(wrist).addScaledVector(this.fwd, 1); // -Z 가 손끝을 보게
    this.tmpM.lookAt(wrist, this.tmpV, this.up);
    out.setFromRotationMatrix(this.tmpM);
  }

  /** 두 손 모델을 모두 올린다. 합쳐 190KB 남짓이라 한 번에 받아도 부담이 없다. */
  async load() {
    const loader = new GLTFLoader();
    await Promise.all(
      (["right", "left"] as const).map(async (side) => {
        const gltf = await loader.loadAsync(MODEL[side]);
        const root = gltf.scene;
        const bones = new Map<string, THREE.Bone>();
        root.traverse((o) => {
          if ((o as THREE.Bone).isBone) bones.set(o.name, o as THREE.Bone);
          const m = o as THREE.SkinnedMesh;
          if (m.isSkinnedMesh) m.frustumCulled = false; // 뼈를 크게 옮기므로 화면 밖 판정을 끈다
        });

        root.visible = false;
        this.group.add(root);
        root.updateMatrixWorld(true);

        // ── 쉬는 자세에서 뼈 길이와 방향을 재 둔다 ────────────────────
        const bindPos = new Map<string, THREE.Vector3>();
        const bindQuat = new Map<string, THREE.Quaternion>();
        for (const { bone } of JOINTS) {
          const b = bones.get(bone);
          if (!b) continue;
          bindPos.set(bone, b.getWorldPosition(new THREE.Vector3()));
          bindQuat.set(bone, b.getWorldQuaternion(new THREE.Quaternion()));
        }

        const restOffset = new Map<string, THREE.Vector3>();
        const restLocalQuat = new Map<string, THREE.Quaternion>();
        for (const { bone, parent } of JOINTS) {
          if (!parent) continue;
          const p = bindPos.get(parent);
          const pq = bindQuat.get(parent);
          const c = bindPos.get(bone);
          const cq = bindQuat.get(bone);
          if (!p || !pq || !c || !cq) continue;
          // 부모 기준으로 바꿔 둬야 부모가 돌 때 자식이 같이 따라온다
          restOffset.set(bone, c.clone().sub(p).applyQuaternion(pq.clone().invert()));
          restLocalQuat.set(bone, pq.clone().invert().multiply(cq));
        }

        const wrist = bindPos.get("wrist")!;
        const midMcp = bindPos.get("middle-finger-phalanx-proximal")!;
        const idxMcp = bindPos.get("index-finger-phalanx-proximal")!;
        const pkyMcp = bindPos.get("pinky-finger-phalanx-proximal")!;
        const restPalmQuat = new THREE.Quaternion();
        this.palmQuat(wrist, midMcp, idxMcp, pkyMcp, restPalmQuat);
        const restWristQuat = bindQuat.get("wrist")!.clone();

        // 뼈가 제 기준으로 어느 쪽을 가리키는지 — 축 이름을 짐작하지 않고 잰다
        const restAim = new Map<string, THREE.Vector3>();
        for (const { bone, from } of JOINTS) {
          if (from === undefined) continue;
          const child = JOINTS.find((j) => j.parent === bone);
          const a = bindPos.get(bone);
          const b = child && bindPos.get(child.bone);
          const q = bindQuat.get(bone);
          if (!a || !b || !q) continue;
          restAim.set(bone, b.clone().sub(a).normalize().applyQuaternion(q.clone().invert()));
        }

        // 뼈마다 쓸 자리를 미리 만들어 둔다
        for (const { bone } of JOINTS) {
          if (!this.worldPos.has(bone)) {
            this.worldPos.set(bone, new THREE.Vector3());
            this.worldQuat.set(bone, new THREE.Quaternion());
          }
        }

        this.hands[side] = {
          root,
          bones,
          restOffset,
          restLocalQuat,
          restPalmQuat,
          restWristQuat,
          restAim,
          restSpan: wrist.distanceTo(midMcp) || 1,
        };
      })
    );
  }

  /**
   * 인식한 관절 위치(월드 좌표)에 손을 맞춘다.
   * @param joints 21개 관절의 월드 좌표
   * @param frame 좌우 정보를 쓴다
   */
  update(joints: THREE.Vector3[], frame: HandFrame) {
    const which = frame.handedness ?? "right";
    const hand = this.hands[which] ?? this.hands.right ?? this.hands.left;
    if (!hand || joints.length < 21) return;

    if (this.shown !== which) {
      for (const s of ["left", "right"] as const) {
        const h = this.hands[s];
        if (h) h.root.visible = h === hand;
      }
      this.shown = which;
    }

    // 손 크기 — 갑자기 튀지 않게 조금씩 따라간다
    const span = joints[0].distanceTo(joints[9]);
    if (span < 1e-6) return;
    const want = span / hand.restSpan;
    this.scale = this.scale === 0 ? want : this.scale + (want - this.scale) * SCALE_EASE;
    const scale = this.scale;

    // 손목 — 여기서부터 아래로 뻗어 나간다.
    // 인식한 자세를 그대로 넣지 않고, **쉬는 자세에서 여기까지 온 회전**을
    // 모델의 바인드 손목에 얹는다. 그래야 쉬는 자세를 그대로 보여 줄 때
    // 모델 원본과 정확히 겹치고, 손의 앞뒤가 모델이 가진 대로 나온다.
    this.palmQuat(joints[0], joints[9], joints[5], joints[17], this.palm);
    this.worldPos.get("wrist")!.copy(joints[0]);
    this.worldQuat
      .get("wrist")!
      .copy(this.palm)
      .multiply(this.tmpQ.copy(hand.restPalmQuat).invert())
      .multiply(hand.restWristQuat);

    for (const j of JOINTS) {
      const bone = hand.bones.get(j.bone);
      if (!bone) continue;

      if (j.parent) {
        const pPos = this.worldPos.get(j.parent);
        const pQuat = this.worldQuat.get(j.parent);
        const off = hand.restOffset.get(j.bone);
        if (!pPos || !pQuat || !off) continue;

        // 자리 — 모델이 가진 길이만큼 부모에서 떨어뜨린다 (손 크기에 맞춰 배율만)
        const pos = this.worldPos.get(j.bone)!;
        pos.copy(off).multiplyScalar(scale).applyQuaternion(pQuat).add(pPos);

        // 먼저 부모를 그대로 따라 도는 자세를 만든다. 방향을 안 받는 뼈
        // (손등뼈·손끝)는 이걸 그대로 쓴다.
        const quat = this.worldQuat.get(j.bone)!;
        const rest = hand.restLocalQuat.get(j.bone);
        if (rest) quat.copy(pQuat).multiply(rest);
        else quat.copy(pQuat);

        // 방향을 받는 뼈는 여기서 **가리키는 쪽만** 인식한 손 쪽으로 돌린다.
        // 축을 새로 세우지 않고 최소 회전만 얹으므로, 손가락이 제멋대로
        // 비틀리지 않고 롤은 부모에게서 물려받는다.
        const aim = hand.restAim.get(j.bone);
        if (aim && j.from !== undefined && j.to !== undefined) {
          this.tmpV.subVectors(joints[j.to], joints[j.from]);
          if (this.tmpV.lengthSq() > 1e-12) {
            this.tmpV.normalize();
            this.side.copy(aim).applyQuaternion(quat); // 지금 가리키는 쪽
            quat.premultiply(this.tmpQ.setFromUnitVectors(this.side, this.tmpV));
          }
        }
      }

      // 뼈가 전부 형제라 월드 자세를 그대로 넣으면 된다 (그룹은 원점에 둔다)
      bone.position.copy(this.worldPos.get(j.bone)!);
      bone.quaternion.copy(this.worldQuat.get(j.bone)!);
    }

    this.group.visible = true;
    this.group.updateMatrixWorld(true);
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
    this.hands = {};
    this.shown = null;
    this.scale = 0;
  }
}
