/**
 * 손을 3D 씬 안에 세우는 부분.
 *
 * 예전에는 손 모양으로 깊이만 기록해(colorWrite:false) 그 자리에 카메라 영상의 진짜 손이
 * 비치게 했다. 그런데 관절 구·원기둥으로 만든 대략적인 실루엣이 실제 손 윤곽과 딱 맞지 않아,
 * "손이 위에 있다"가 아니라 "에셋이 지워졌다"로 읽혔다.
 *
 * 그래서 **눈에 보이는 백자빛 손을 무대 위에 얹는 방식**으로 바꿨다.
 *   · 무대를 다 그린 뒤 깊이만 비우고(clearDepth) 손을 따로 그린다
 *     → 깊이 추정이 흔들려도 손은 **항상** 에셋 위다. 손 안에서 손가락끼리는 정상적으로 가려진다.
 *   · 손 바로 아래에 어두운 실루엣을 살짝 어긋나게 깔아 에셋 위로 그림자가 지게 한다
 *     → 손이 떠 있고 에셋이 그 밑에 있다는 게 눈으로 읽힌다.
 *   · 실제 손보다 조금 두껍게 그려 카메라 영상 속 진짜 손을 덮는다.
 *
 * 좌표는 화면에서 역산한다(unproject). 가상 카메라의 화각이 실제 카메라와 달라도
 * 화면상 위치는 정확히 맞으므로 손이 진짜 손 위에 그대로 포개진다.
 */
import * as THREE from "three";
import { HAND_CONNECTIONS, LM, type HandFrame } from "@/lib/hand/types";

/** 화면에서 손이 이만큼 크게 보일 때를 기준 거리로 삼는다 (손목~중지뿌리, 화면 정규화) */
const REF_SPAN = 0.16;
/** 깊이 보정 한계 — 인식이 튀어도 손이 카메라를 뚫거나 무대 뒤로 날아가지 않게 */
const DEPTH_MIN = 0.45;
const DEPTH_MAX = 1.8;
/**
 * 관절별 두께 (손목~중지뿌리 길이 대비). 손가락 끝으로 갈수록 가늘어지게 해야
 * 사람 손처럼 보인다 — 전부 같은 굵기로 두면 풍선처럼 부푼다.
 * 카메라 영상 속 진짜 손을 덮어야 하므로 실제보다 조금씩 두껍게 잡았다.
 */
const JOINT_R = [
  0.2, //                      0  손목
  0.13, 0.115, 0.1, 0.092, //  1~4  엄지
  0.12, 0.105, 0.095, 0.088, // 5~8  검지
  0.12, 0.105, 0.095, 0.088, // 9~12 중지
  0.115, 0.1, 0.092, 0.084, // 13~16 약지
  0.11, 0.096, 0.088, 0.08, // 17~20 새끼
];
/** 손바닥 다각형을 중심에서 이만큼 부풀린다 — 관절점만 이으면 실제 손바닥보다 좁다 */
const PALM_SWELL = 1.28;
/** 손바닥을 이루는 관절 (손목에서 부채꼴로 이어 붙인다) */
const PALM_RIM = [1, 5, 9, 13, 17];
/** 그림자를 손에서 얼마나 어긋나게 놓을지 (손 너비 대비). 크면 손이 두 개로 보인다. */
const SHADOW_OFFSET = 0.1;

/** 비디오가 object-fit:cover 로 잘려 보이는 것을 감안한 좌표 변환값 */
export interface CoverFit {
  scaleX: number;
  scaleY: number;
  offX: number;
  offY: number;
}

/**
 * MediaPipe 랜드마크는 **영상 프레임** 기준 0~1 이다. 화면은 object-fit:cover 로
 * 일부가 잘려 나가므로 그 차이를 보정하지 않으면 손이 실제 손에서 어긋난다.
 */
export function coverFit(videoW: number, videoH: number, screenW: number, screenH: number): CoverFit {
  if (!videoW || !videoH || !screenW || !screenH) {
    return { scaleX: 1, scaleY: 1, offX: 0, offY: 0 };
  }
  const scale = Math.max(screenW / videoW, screenH / videoH);
  const drawW = videoW * scale;
  const drawH = videoH * scale;
  return {
    scaleX: drawW / screenW,
    scaleY: drawH / screenH,
    offX: (screenW - drawW) / 2 / screenW,
    offY: (screenH - drawH) / 2 / screenH,
  };
}

/** 영상 정규화 좌표 → 화면 정규화 좌표 (0~1, 좌상단 원점) */
export function toScreen(p: { x: number; y: number }, fit: CoverFit) {
  return { x: fit.offX + p.x * fit.scaleX, y: fit.offY + p.y * fit.scaleY };
}

/** 화면 정규화 좌표 → 카메라 앞 distance 만큼 떨어진 월드 좌표 */
export function screenToWorld(
  sx: number,
  sy: number,
  distance: number,
  camera: THREE.Camera,
  out = new THREE.Vector3()
): THREE.Vector3 {
  out.set(sx * 2 - 1, 1 - sy * 2, 0.5).unproject(camera);
  out.sub(camera.position).normalize().multiplyScalar(distance).add(camera.position);
  return out;
}

/** 월드 좌표 → 화면 정규화 좌표 (0~1, 좌상단 원점) */
const _proj = new THREE.Vector3();
export function worldToScreen(v: THREE.Vector3, camera: THREE.Camera, out = { x: 0, y: 0 }) {
  _proj.copy(v).project(camera);
  out.x = (_proj.x + 1) / 2;
  out.y = (1 - _proj.y) / 2;
  return out;
}

/** 화면 정규화 좌표 두 점 사이 거리 */
export function screenDist(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** 관절 구 + 뼈 원기둥 한 벌. 손 본체와 그림자가 같은 구조를 쓴다. */
interface Limbs {
  joints: THREE.InstancedMesh;
  bones: THREE.InstancedMesh;
  /** 손바닥 — 관절과 뼈만으로는 가운데가 뻥 뚫려 철사처럼 보인다 */
  palm: THREE.Mesh;
}

export class HandVisual {
  /**
   * 손 전용 씬. 무대를 다 그린 뒤 깊이를 비우고 이것만 따로 그린다.
   * (같은 씬에 두고 depthTest 를 끄면 손가락끼리 서로 가리지 못해 뭉개진다)
   */
  readonly scene = new THREE.Scene();

  private hand: Limbs;
  private shadow: Limbs;
  private cursor: THREE.Mesh;

  /** 이번 프레임의 관절 월드 좌표 — 잡기 판정에서 그대로 읽어 쓴다 */
  readonly worldJoints: THREE.Vector3[] = Array.from({ length: 21 }, () => new THREE.Vector3());
  /** 이번 프레임의 집는 지점(엄지·검지 끝 중점) 월드 좌표 */
  readonly pinchWorld = new THREE.Vector3();
  /**
   * 같은 지점의 화면 좌표(0~1). 깊이 추정은 흔들리므로 무엇을 집었는지는
   * 이 화면 좌표로 고른다 — 사용자가 보는 그대로("손가락이 쌀 위에 있다")와 일치한다.
   */
  readonly pinchScreen = { x: 0.5, y: 0.5 };
  /** 이번 프레임에 추정한 손까지의 거리(m) */
  depth = 1;

  /** 그릴 손이 있는지 — 엔진이 두 번째 렌더 패스를 건너뛸지 판단한다 */
  get visible() {
    return this.scene.visible;
  }

  private tmpM = new THREE.Matrix4();
  private tmpQ = new THREE.Quaternion();
  private tmpV = new THREE.Vector3();
  private tmpFrom = new THREE.Vector3();
  private tmpScale = new THREE.Vector3();
  private tmpUp = new THREE.Vector3(0, 1, 0);
  private shadowShift = new THREE.Vector3();
  private palmCenter = new THREE.Vector3();
  private camRight = new THREE.Vector3();
  private camUp = new THREE.Vector3();
  private camFwd = new THREE.Vector3();

  constructor() {
    // 백자빛 손 — 어두운 나무 무대 위에서 또렷하게 떠 보인다
    const skin = new THREE.MeshStandardMaterial({
      color: 0xf2e3c9,
      roughness: 0.62,
      metalness: 0.04,
      // 손바닥 다각형은 왼손·오른손, 손등·손바닥 방향에 따라 감기는 순서가 뒤집힌다.
      // 한쪽만 그리면 그 경우 손바닥이 통째로 사라진다.
      side: THREE.DoubleSide,
    });
    // 에셋 위로 지는 그림자. 깊이 검사를 끄고 먼저 그려 손 본체가 그 위를 덮게 한다.
    const shade = new THREE.MeshBasicMaterial({
      color: 0x140d06,
      transparent: true,
      opacity: 0.26,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    this.shadow = this.makeLimbs(shade, 0);
    this.hand = this.makeLimbs(skin, 1);

    // 조명은 손 씬에 따로 둔다 — 무대 조명이 어떻든 손 밝기는 일정하게
    this.scene.add(new THREE.HemisphereLight(0xfff6e6, 0x4a3a28, 2.2));
    const key = new THREE.DirectionalLight(0xfff4e2, 1.6);
    key.position.set(0.5, 1, 0.9);
    this.scene.add(key);

    // 집는 지점 표시 — 쥐면 색이 바뀌어 "지금 쥐었다"가 손끝에서 바로 읽힌다
    this.cursor = new THREE.Mesh(
      new THREE.RingGeometry(0.22, 0.3, 28),
      new THREE.MeshBasicMaterial({
        color: 0xe8c98a,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    this.cursor.renderOrder = 2;
    this.cursor.frustumCulled = false;
    this.scene.add(this.cursor);

    this.scene.visible = false;
  }

  private makeLimbs(material: THREE.Material, renderOrder: number): Limbs {
    const joints = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 14, 12), material, 21);
    const bones = new THREE.InstancedMesh(
      // 길이를 늘려 쓸 수 있게 +Y 방향 단위 원기둥으로 만든다
      new THREE.CylinderGeometry(1, 1, 1, 12).translate(0, 0.5, 0),
      material,
      HAND_CONNECTIONS.length
    );

    // 손바닥 — 손목에서 각 손가락 뿌리로 이어지는 부채꼴. 매 프레임 꼭짓점만 옮긴다.
    const palmGeo = new THREE.BufferGeometry();
    palmGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array((PALM_RIM.length + 1) * 3), 3));
    const idx: number[] = [];
    for (let i = 1; i < PALM_RIM.length; i++) idx.push(0, i, i + 1);
    palmGeo.setIndex(idx);
    const palm = new THREE.Mesh(palmGeo, material);

    for (const m of [joints, bones, palm]) {
      m.frustumCulled = false;
      m.renderOrder = renderOrder;
      this.scene.add(m);
    }
    return { joints, bones, palm };
  }

  /**
   * 한 프레임 갱신.
   * @param baseDepth 무대(앵커)까지의 거리. 손 크기로 앞뒤를 보정하는 기준이 된다.
   */
  update(frame: HandFrame, camera: THREE.Camera, fit: CoverFit, baseDepth: number) {
    if (!frame.present || frame.landmarks.length < 21) {
      this.scene.visible = false;
      return;
    }
    this.scene.visible = true;

    // 화면에서 손이 클수록 카메라에 가깝다 — 앞뒤로 뻗는 동작이 크기로 드러난다
    const span = Math.max(frame.screenSpan, 1e-4);
    this.depth = THREE.MathUtils.clamp((baseDepth * REF_SPAN) / span, DEPTH_MIN, DEPTH_MAX);

    for (let i = 0; i < 21; i++) {
      const s = toScreen(frame.landmarks[i], fit);
      screenToWorld(s.x, s.y, this.depth, camera, this.worldJoints[i]);
    }
    const ps = toScreen(frame.pinchPoint, fit);
    this.pinchScreen.x = ps.x;
    this.pinchScreen.y = ps.y;
    screenToWorld(ps.x, ps.y, this.depth, camera, this.pinchWorld);

    // 손 두께도 화면상 손 크기를 따라간다 — 멀어지면 같이 얇아진다
    const worldSpan = this.worldJoints[LM.WRIST].distanceTo(this.worldJoints[LM.MIDDLE_MCP]);

    // 그림자는 화면 기준 오른쪽 아래로 어긋나게 — 손이 떠 있는 것처럼 보인다
    camera.matrixWorld.extractBasis(this.camRight, this.camUp, this.camFwd);
    this.shadowShift
      .copy(this.camRight)
      .multiplyScalar(worldSpan * SHADOW_OFFSET)
      .addScaledVector(this.camUp, -worldSpan * SHADOW_OFFSET);

    this.layout(this.shadow, worldSpan, this.shadowShift);
    this.layout(this.hand, worldSpan, null);
    this.updateCursor(frame, camera, worldSpan);
  }

  /** 관절·뼈·손바닥을 지금 손 모양에 맞춰 배치한다. shift 가 있으면 그만큼 밀어 그림자로 쓴다. */
  private layout(limbs: Limbs, span: number, shift: THREE.Vector3 | null) {
    for (let i = 0; i < 21; i++) {
      this.tmpV.copy(this.worldJoints[i]);
      if (shift) this.tmpV.add(shift);
      const r = span * JOINT_R[i];
      this.tmpM.makeScale(r, r, r).setPosition(this.tmpV);
      limbs.joints.setMatrixAt(i, this.tmpM);
    }
    limbs.joints.instanceMatrix.needsUpdate = true;

    HAND_CONNECTIONS.forEach(([a, b], i) => {
      this.tmpFrom.copy(this.worldJoints[a]);
      if (shift) this.tmpFrom.add(shift);
      const len = this.tmpV.subVectors(this.worldJoints[b], this.worldJoints[a]).length();
      // 뼈는 양 끝 관절 중 가는 쪽에 맞춘다 — 굵은 쪽에 맞추면 손가락이 뭉툭해진다
      const r = span * Math.min(JOINT_R[a], JOINT_R[b]) * 0.92;
      // 단위 원기둥(+Y)을 뼈 방향으로 눕히고 길이만큼 늘인다
      this.tmpQ.setFromUnitVectors(this.tmpUp, this.tmpV.normalize());
      this.tmpM.compose(this.tmpFrom, this.tmpQ, this.tmpScale.set(r, len, r));
      limbs.bones.setMatrixAt(i, this.tmpM);
    });
    limbs.bones.instanceMatrix.needsUpdate = true;

    this.layoutPalm(limbs.palm, shift);
  }

  /** 손목 + 손가락 뿌리를 이은 다각형. 중심에서 살짝 부풀려 실제 손바닥 폭에 가깝게 만든다. */
  private layoutPalm(palm: THREE.Mesh, shift: THREE.Vector3 | null) {
    const attr = palm.geometry.attributes.position as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;

    this.palmCenter.copy(this.worldJoints[LM.WRIST]);
    for (const j of PALM_RIM) this.palmCenter.add(this.worldJoints[j]);
    this.palmCenter.multiplyScalar(1 / (PALM_RIM.length + 1));

    const put = (slot: number, joint: number) => {
      this.tmpV
        .copy(this.worldJoints[joint])
        .sub(this.palmCenter)
        .multiplyScalar(PALM_SWELL)
        .add(this.palmCenter);
      if (shift) this.tmpV.add(shift);
      this.tmpV.toArray(arr, slot * 3);
    };
    put(0, LM.WRIST);
    PALM_RIM.forEach((j, i) => put(i + 1, j));

    attr.needsUpdate = true;
    palm.geometry.computeVertexNormals();
  }

  private updateCursor(frame: HandFrame, camera: THREE.Camera, worldSpan: number) {
    this.cursor.position.copy(this.pinchWorld);
    this.cursor.quaternion.copy(camera.quaternion); // 항상 화면을 마주보게
    // 쥐면 붉게, 펴면 금색으로
    const mat = this.cursor.material as THREE.MeshBasicMaterial;
    mat.color.setHex(frame.pinching ? 0xc2452f : 0xe8c98a);
    this.cursor.scale.setScalar(worldSpan * THREE.MathUtils.lerp(1, 0.62, frame.pinch));
  }

  /** 손을 놓쳤을 때 — 다음 프레임까지 잔상이 남지 않게 숨긴다 */
  hide() {
    this.scene.visible = false;
  }

  dispose() {
    this.scene.traverse((o: THREE.Object3D) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose?.();
    });
    this.scene.clear();
  }
}
