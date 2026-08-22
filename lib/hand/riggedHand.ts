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
  right: "/ar/3d-assets/r_hand_texture.glb",
  left: "/ar/3d-assets/l_hand_texture.glb",
} as const;

/** 손 크기가 프레임마다 튀지 않게 하는 정도 (0에 가까울수록 느리게 따라감) */
const SCALE_EASE = 0.25;

type Finger = "thumb" | "index" | "middle" | "ring" | "pinky";

/**
 * 원본 WebXR 모델의 길고 균일한 손가락을 실제 손에 가까운 실루엣으로 보정한다.
 * 길이는 관절 간격에만 적용한다. 스킨 본에 축별 스케일을 주면 굽힌 관절에서
 * 서로 다른 웨이트가 충돌해 살이 접히므로 굵기 값은 모델 교체 시 참고값으로만 둔다.
 */
const FINGER_PROPORTION: Record<Finger, { length: number; thickness: number }> = {
  thumb: { length: 0.96, thickness: 1.08 },
  index: { length: 0.98, thickness: 0.94 },
  middle: { length: 1.02, thickness: 0.97 },
  ring: { length: 0.98, thickness: 0.91 },
  pinky: { length: 0.9, thickness: 0.82 },
};

function fingerOf(bone: string): Finger | undefined {
  if (bone.startsWith("thumb-")) return "thumb";
  if (bone.startsWith("index-finger-")) return "index";
  if (bone.startsWith("middle-finger-")) return "middle";
  if (bone.startsWith("ring-finger-")) return "ring";
  if (bone.startsWith("pinky-finger-")) return "pinky";
  return undefined;
}

/**
 * 자세가 목표를 따라가는 시간(초). 손 인식은 60ms 마다 한 번이고 화면은 그보다
 * 훨씬 자주 그리므로, 그대로 쓰면 손이 네 프레임에 한 번씩 뚝뚝 건너뛴다.
 */
const POSE_TAU = 0.08;

/** 좌우 판정이 목표를 따라가는 시간(초). 손을 바꾸는 일은 드무니 길게 잡는다. */
const SIDE_TAU = 0.5;

/**
 * 좌우를 바꾸려면 이만큼은 확실해야 한다. 엄지가 손바닥 면에서 벗어난 정도라
 * 원래 크지 않은 값이고, 손등이 보일 때는 깊이 추정이 흔들려 부호가 자주 뒤집힌다.
 * 그때마다 모델을 갈아 끼우면 손가락이 얽히고 화면이 깜빡인다.
 */
const SIDE_LOCK = 0.04;

/**
 * 손을 얼마나 눕힌 것까지 믿을지. 손이 시선과 나란해지면 화면에서 본 길이가
 * 0 에 가까워져, 그걸로 크기를 되돌리면 손이 터무니없이 커진다.
 */
const MIN_FORESHORTEN = 0.35;

/**
 * 깊이를 손 크기의 몇 배까지 인정할지.
 *
 * MediaPipe 의 깊이는 화면 좌표보다 한참 거칠고, 특히 손등이 보일 때는 앞뒤
 * 해석이 헷갈려 크게 튄다. 그대로 두면 손가락이 화면 안쪽으로 푹 꺾여 보인다.
 */
const MAX_DEPTH = 0.55;

/**
 * 부모가 물려준 방향에서 한 관절이 한 프레임에 꺾일 수 있는 최대 각도.
 * MediaPipe의 손끝 Z는 핀치 때 서로 앞뒤가 바뀌기 쉬워, 제한이 없으면 엄지
 * 끝마디가 검지를 뚫고 뒤로 접힌다. MCP는 좌우 벌림도 필요해 조금 넉넉히 둔다.
 */
function maxJointSwing(bone: string): number {
  if (bone === "thumb-metacarpal") return THREE.MathUtils.degToRad(70);
  if (bone.startsWith("thumb-")) return THREE.MathUtils.degToRad(85);
  if (bone.endsWith("metacarpal")) return THREE.MathUtils.degToRad(55);
  return THREE.MathUtils.degToRad(105);
}

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
  private identityQ = new THREE.Quaternion();
  private fwd = new THREE.Vector3();
  private side = new THREE.Vector3();
  private up = new THREE.Vector3();
  private camQuat = new THREE.Quaternion();
  private viewDir = new THREE.Vector3();
  private eye = new THREE.Vector3();
  /** 인식한 손의 3D 자세를 월드 좌표로 옮겨 담는 곳 (부드럽게 따라간다) */
  private pose: THREE.Vector3[] = Array.from({ length: 21 }, () => new THREE.Vector3());
  /** 이번 프레임이 가리키는 목표 자세 */
  private target: THREE.Vector3[] = Array.from({ length: 21 }, () => new THREE.Vector3());
  private posed = false;
  private lastAt = 0;
  /** 좌우 판정을 시간에 걸쳐 눌러 둔 값 — 한 프레임 튐으로 손이 바뀌지 않게 */
  private sideScore = 0;
  private lockedSide: "left" | "right" | null = null;
  private pendingSide: "left" | "right" | null = null;
  private sideSwitchScore = 0;

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
    const n = this.up.length() * this.tmpV.length();
    // 손 크기로 나눠 둔다 — 화면에서 손이 크든 작든 같은 잣대로 재려고
    return n < 1e-12 ? 0 : this.up.dot(this.tmpV) / n;
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
        // 에셋 슬롯을 파일 이름대로 고정한다. 특히 사용자가 교체한
        // r_hand_texture.glb가 기하 부호 재판정 때문에 왼손 슬롯으로 넘어가면
        // 올바른 handedness가 와도 반대 모델이 표시된다.
        const root = gltf.scene;
        const bones = new Map<string, THREE.Bone>();
        root.traverse((o) => {
          if ((o as THREE.Bone).isBone) bones.set(o.name, o as THREE.Bone);
          const m = o as THREE.SkinnedMesh;
          if (m.isSkinnedMesh) {
            m.frustumCulled = false; // 뼈를 크게 옮기므로 화면 밖 판정을 끈다
            // 이제 왼손도 오른손과 같은 텍스처를 입고 온다. 재질을 덮어쓰면
            // 한쪽만 맨살로 나와 왼손을 비출 때마다 다른 손처럼 보인다.
          }
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

        this.hands[side] = {
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
      for (let i = 0; i < 21; i++) this.target[i].copy(joints[i]);
      return false;
    }

    // MediaPipe 축(x 오른쪽, y 아래, z 카메라에서 먼 쪽) → three.js 카메라 축.
    // 두 축을 뒤집으므로 좌우가 바뀌지 않는다 (거울이 되면 손이 뒤집힌다).
    // 기기에서 손이 통째로 거울처럼 나오면 고칠 곳은 이 한 줄이다.
    camera.getWorldQuaternion(this.camQuat);
    for (let i = 0; i < 21; i++) {
      this.target[i].set(w[i].x, -w[i].y, -w[i].z).applyQuaternion(this.camQuat);
    }

    // 손목을 원점으로 옮긴다
    this.tmpV.copy(this.target[0]);
    for (let i = 0; i < 21; i++) this.target[i].sub(this.tmpV);

    // 화면에 비치는 크기에 맞춘다. 손이 기울어 있으면 화면에서는 짧아 보이므로
    // 시선 방향 성분을 뺀 길이로 견줘야 크기가 튀지 않는다.
    camera.getWorldDirection(this.viewDir);
    this.fwd.copy(this.target[9]);
    this.fwd.addScaledVector(this.viewDir, -this.fwd.dot(this.viewDir));
    const full = this.target[9].length();
    const seen = joints[0].distanceTo(joints[9]);
    if (full < 1e-5 || seen < 1e-6) {
      for (let i = 0; i < 21; i++) this.target[i].copy(joints[i]);
      return false;
    }
    // 너무 눕은 손까지 되돌리려 들면 손이 폭발한다. 여기서 끊는다.
    const flat = Math.max(this.fwd.length(), full * MIN_FORESHORTEN);
    const k = seen / flat;
    for (let i = 0; i < 21; i++) this.target[i].multiplyScalar(k).add(joints[0]);

    // ── 두 신호를 각자 믿을 수 있는 데에만 쓴다 ────────────────────────
    // 화면 좌표는 화면 안에서 정확하고, 미터 좌표는 앞뒤를 알려 주지만 거칠다.
    // 그래서 관절마다 **화면 좌표가 가리키는 시선 위에** 올려 두고, 카메라에서
    // 얼마나 떨어뜨릴지만 미터 좌표에서 가져온다.
    //
    // 이렇게 하면 화면에 비치는 손 모양은 인식한 그대로가 되므로, 깊이가 좀
    // 틀려도 손가락이 화면에서 꺾여 보이는 일이 없다. 손등이 보일 때 손이
    // 일그러지던 것이 이 때문이었다.
    camera.getWorldPosition(this.eye);
    const base = joints[0].distanceTo(this.eye);
    const limit = seen * MAX_DEPTH;
    for (let i = 0; i < 21; i++) {
      const depth = THREE.MathUtils.clamp(
        this.tmpV.subVectors(this.target[i], joints[0]).dot(this.viewDir),
        -limit,
        limit
      );
      this.target[i]
        .subVectors(joints[i], this.eye)
        .normalize()
        .multiplyScalar(base + depth)
        .add(this.eye);
    }
    return true;
  }

  /**
   * 어느 손 모델을 쓸지 정한다.
   *
   * 부호만 보고 매 프레임 갈아 끼우면, 손등이 보일 때처럼 깊이 추정이 흔들리는
   * 상황에서 왼손·오른손이 번갈아 나와 손가락이 얽히고 화면이 깜빡인다.
   * 그래서 확신 정도를 시간에 걸쳐 눌러 두고, 충분히 기울었을 때만 바꾼다.
   */
  private decideSide(spatial: boolean, frame: HandFrame, a: number): "left" | "right" {
    // MediaPipe가 명시적으로 알려 준 좌우를 최우선으로 쓴다. 공간 chirality는
    // 깊이값이 없는 기기나 handedness가 비어 있을 때만 예비 판정으로 사용한다.
    if (frame.handedness && this.hands[frame.handedness]) {
      if (!this.lockedSide) {
        this.lockedSide = frame.handedness;
      } else if (frame.handedness !== this.lockedSide) {
        if (this.pendingSide !== frame.handedness) {
          this.pendingSide = frame.handedness;
          this.sideSwitchScore = 0;
        }
        this.sideSwitchScore += a;
        // 약 0.2초 동안 반대 결과가 유지될 때만 바꿔, 손 회전 중 한두 프레임
        // 오판은 무시하면서 실제로 다른 손을 내민 경우에는 전환한다.
        if (this.sideSwitchScore >= 0.35) {
          this.lockedSide = frame.handedness;
          this.pendingSide = null;
          this.sideSwitchScore = 0;
        }
      } else {
        this.pendingSide = null;
        this.sideSwitchScore = 0;
      }
      return this.lockedSide;
    }
    if (spatial) {
      const c = this.chirality(
        this.pose[0], this.pose[9], this.pose[5], this.pose[17], this.pose[2]
      );
      this.sideScore += (c - this.sideScore) * a;
      if (Math.abs(this.sideScore) > SIDE_LOCK) {
        const want = this.sideScore > 0 ? "right" : "left";
        if (this.hands[want]) this.lockedSide = want;
      }
    }
    const fallback = frame.handedness ?? "right";
    return this.lockedSide ?? fallback;
  }

  /** 손을 놓쳤을 때 — 다시 잡히면 이전 자리에서 쓸고 오지 않게 상태를 비운다 */
  reset() {
    this.posed = false;
    this.scale = 0;
    this.sideScore = 0;
    this.lockedSide = null;
    this.pendingSide = null;
    this.sideSwitchScore = 0;
  }

  /**
   * 인식한 손에 3D 모델을 맞춘다.
   * @param joints 21개 관절의 화면 기준 월드 좌표 — 어디에 그릴지
   * @param frame 미터 좌표와 좌우 정보
   * @param camera 미터 좌표를 월드로 돌리는 데 쓴다
   */
  update(joints: THREE.Vector3[], frame: HandFrame, camera: THREE.Camera) {
    if (joints.length < 21) return;

    // 지난 프레임에서 흐른 시간 — 화면이 빠르든 느리든 같은 속도로 따라가게
    const now = performance.now();
    const dt = this.lastAt ? Math.min((now - this.lastAt) / 1000, 0.1) : 0;
    this.lastAt = now;

    const spatial = this.buildPose(joints, frame, camera);

    // 목표 자세로 부드럽게. 손 인식이 렌더보다 드물어 목표는 계단처럼 오는데,
    // 여기서 눌러 주면 화면에서는 이어져 보인다.
    if (!this.posed || dt <= 0) {
      for (let i = 0; i < 21; i++) this.pose[i].copy(this.target[i]);
      this.posed = true;
    } else {
      const a = 1 - Math.exp(-dt / POSE_TAU);
      for (let i = 0; i < 21; i++) this.pose[i].lerp(this.target[i], a);
    }

    const which = this.decideSide(spatial, frame, dt > 0 ? 1 - Math.exp(-dt / SIDE_TAU) : 1);
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

        // 자리 — 모델이 가진 길이를 손가락별 비율로 다듬고 손 크기에 맞춘다.
        const pos = this.worldPos.get(j.bone)!;
        const parentFinger = fingerOf(j.parent);
        const lengthRatio = parentFinger ? FINGER_PROPORTION[parentFinger].length : 1;
        pos.copy(off).multiplyScalar(scale * lengthRatio).applyQuaternion(pQuat).add(pPos);

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
            this.tmpQ.setFromUnitVectors(this.side, this.tmpV);
            const swing = this.side.angleTo(this.tmpV);
            const limit = maxJointSwing(j.bone);
            if (swing > limit) {
              this.tmpQ.slerpQuaternions(this.identityQ, this.tmpQ, limit / swing);
            }
            quat.premultiply(this.tmpQ);
          }
        }
      }

      // 스킨 본은 반드시 균일 스케일을 쓴다. 축별 스케일은 펴진 자세에서는
      // 자연스러워도, 엄지·검지가 크게 굽을 때 관절 양쪽 웨이트를 서로 다른
      // 방향으로 잡아당겨 메시가 꼬이거나 안으로 파고들게 만든다. 손가락 길이
      // 비율은 위의 관절 위치(restOffset)에 이미 반영되어 있다.
      bone.scale.setScalar(scale);

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
