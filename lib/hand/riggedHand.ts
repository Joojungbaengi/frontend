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
  /**
   * 이 모델이 왼손인지 오른손인지를 **부호 하나로** 잰 값.
   * 오른손과 왼손은 거울상이라 이 부호가 반대다. 인식한 손에서 같은 값을
   * 재서 부호가 맞는 모델을 고르면, 좌우 판정이 틀려도 손 모양이 뒤집히지 않는다.
   */
  restChirality: number;
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
  private camQuat = new THREE.Quaternion();
  private viewDir = new THREE.Vector3();
  /** 인식한 손의 3D 자세를 월드 좌표로 옮겨 담는 곳 */
  private pose: THREE.Vector3[] = Array.from({ length: 21 }, () => new THREE.Vector3());

  get loaded() {
    return Boolean(this.hands.right || this.hands.left);
  }

  /**
   * 마지막으로 세운 뼈의 월드 위치. 집는 고리를 **눈에 보이는 손끝**에
   * 붙이려고 연다 — 인식 좌표에 붙이면 3D 자세와 어긋나 손에서 떨어진다.
   */
  jointAt(bone: string): THREE.Vector3 | undefined {
    return this.worldPos.get(bone);
  }

  /**
   * 손의 좌우를 부호로 잰다. 손바닥 법선과 엄지가 같은 쪽이면 +, 반대면 -.
   * 거울상인 두 손은 반드시 반대 부호가 나온다.
   */
  /**
   * 오른손이면 +1, 왼손이면 -1.
   *
   * 오른손을 손바닥이 보이게 세우면 검지가 새끼보다 왼쪽에 온다. 그래서
   * (손목→중지너클) × (검지너클→새끼너클) 은 손바닥 바깥을 향하고, 엄지도
   * 손바닥 쪽에 있으므로 둘의 내적이 양수가 된다. 왼손은 거울상이라 반대다.
   * 자세와 무관한 값이라 주먹을 쥐든 손을 뒤집든 부호는 그대로다.
   */
  private chirality(
    wrist: THREE.Vector3,
    middleMcp: THREE.Vector3,
    indexMcp: THREE.Vector3,
    pinkyMcp: THREE.Vector3,
    thumb: THREE.Vector3
  ): number {
    this.fwd.subVectors(middleMcp, wrist);
    this.side.subVectors(indexMcp, pinkyMcp);
    this.up.crossVectors(this.fwd, this.side);
    this.tmpV.subVectors(thumb, wrist);
    const d = this.up.dot(this.tmpV);
    return d > 0 ? 1 : d < 0 ? -1 : 0;
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
        // 파일 이름이 아니라 **모델을 재서** 어느 손인지 정한다.
        // 실제로 이 두 파일은 이름과 반대 손이 들어 있었다.
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
        const restChirality = this.chirality(
          wrist, midMcp, idxMcp, pkyMcp, bindPos.get("thumb-phalanx-proximal")!
        );

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

        this.hands[restChirality > 0 ? "right" : "left"] = {
          root,
          bones,
          restOffset,
          restLocalQuat,
          restPalmQuat,
          restWristQuat,
          restAim,
          restChirality,
          restSpan: wrist.distanceTo(midMcp) || 1,
        };
      })
    );
  }

  /**
   * 인식한 손의 **실제 3D 자세**를 월드 좌표로 옮겨 this.pose 에 담는다.
   *
   * 화면 좌표(joints)는 카메라에서 같은 거리에 놓이므로 손이 납작해진다.
   * 납작한 손에는 뼈 길이가 정해진 모델을 맞출 수 없고(손가락이 남거나 모자란다),
   * 손등이 보이는지 손바닥이 보이는지도 알 수 없다. 그래서 모양은 미터 좌표에서
   * 가져오고, **화면 어디에 얼마만 하게** 그릴지만 화면 좌표에서 가져온다.
   *
   * @returns 3D 자세를 쓸 수 있으면 true, 미터 좌표가 없어 납작하게 갔으면 false
   */
  private buildPose(joints: THREE.Vector3[], frame: HandFrame, camera: THREE.Camera): boolean {
    const w = frame.world;
    if (!w || w.length < 21) {
      for (let i = 0; i < 21; i++) this.pose[i].copy(joints[i]);
      return false;
    }

    // MediaPipe 축(x 오른쪽, y 아래, z 카메라에서 먼 쪽) → three.js 카메라 축.
    // 두 축을 뒤집으므로 좌우가 바뀌지 않는다 (거울이 되면 손이 뒤집힌다).
    // 기기에서 손이 통째로 거울처럼 나오면 고칠 곳은 이 한 줄이다.
    camera.getWorldQuaternion(this.camQuat);
    for (let i = 0; i < 21; i++) {
      this.pose[i].set(w[i].x, -w[i].y, -w[i].z).applyQuaternion(this.camQuat);
    }

    // 손목을 원점으로 옮긴다
    this.tmpV.copy(this.pose[0]);
    for (let i = 0; i < 21; i++) this.pose[i].sub(this.tmpV);

    // 화면에 비치는 크기에 맞춘다. 손이 기울어 있으면 화면에서는 짧아 보이므로
    // 시선 방향 성분을 뺀 길이로 견줘야 크기가 튀지 않는다.
    camera.getWorldDirection(this.viewDir);
    this.fwd.copy(this.pose[9]);
    this.fwd.addScaledVector(this.viewDir, -this.fwd.dot(this.viewDir));
    const flat = this.fwd.length();
    const seen = joints[0].distanceTo(joints[9]);
    if (flat < 1e-5 || seen < 1e-6) {
      for (let i = 0; i < 21; i++) this.pose[i].copy(joints[i]);
      return false;
    }
    const k = seen / flat;
    for (let i = 0; i < 21; i++) this.pose[i].multiplyScalar(k).add(joints[0]);
    return true;
  }

  /**
   * 인식한 손에 3D 모델을 맞춘다.
   * @param joints 21개 관절의 화면 기준 월드 좌표 — 어디에 그릴지
   * @param frame 미터 좌표와 좌우 정보
   * @param camera 미터 좌표를 월드로 돌리는 데 쓴다
   */
  update(joints: THREE.Vector3[], frame: HandFrame, camera: THREE.Camera) {
    if (joints.length < 21) return;
    const spatial = this.buildPose(joints, frame, camera);

    // 어느 손 모델인지 — 인식한 손에서 직접 잰다. MediaPipe 의 좌우 표기는
    // 영상이 거울인지에 따라 뒤집히지만, 이 부호는 손 모양 자체에서 나오므로
    // 표기가 틀려도 화면에 보이는 손과 어긋나지 않는다.
    let which: "left" | "right" = frame.handedness ?? "right";
    if (spatial) {
      const c = this.chirality(this.pose[0], this.pose[9], this.pose[5], this.pose[17], this.pose[2]);
      if (c !== 0) {
        for (const sd of ["right", "left"] as const) {
          if (this.hands[sd] && this.hands[sd]!.restChirality === c) which = sd;
        }
      }
    }

    const hand = this.hands[which] ?? this.hands.right ?? this.hands.left;
    if (!hand) return;

    if (this.shown !== which) {
      for (const s of ["left", "right"] as const) {
        const h = this.hands[s];
        if (h) h.root.visible = h === hand;
      }
      this.shown = which;
    }

    // 손 크기 — 갑자기 튀지 않게 조금씩 따라간다
    const span = this.pose[0].distanceTo(this.pose[9]);
    if (span < 1e-6) return;
    const want = span / hand.restSpan;
    this.scale = this.scale === 0 ? want : this.scale + (want - this.scale) * SCALE_EASE;
    const scale = this.scale;

    // 손목 — 여기서부터 아래로 뻗어 나간다.
    // 인식한 자세를 그대로 넣지 않고, **쉬는 자세에서 여기까지 온 회전**을
    // 모델의 바인드 손목에 얹는다. 그래야 쉬는 자세를 그대로 보여 줄 때
    // 모델 원본과 정확히 겹치고, 손의 앞뒤가 모델이 가진 대로 나온다.
    this.palmQuat(this.pose[0], this.pose[9], this.pose[5], this.pose[17], this.palm);
    this.worldPos.get("wrist")!.copy(this.pose[0]);
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
          this.tmpV.subVectors(this.pose[j.to], this.pose[j.from]);
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
