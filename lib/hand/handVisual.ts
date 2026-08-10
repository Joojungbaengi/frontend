/**
 * 손을 3D 씬 안에 세우는 부분 — 카메라에 잡힌 **진짜 손이 AR 에셋 위로 드러나게** 만든다.
 *
 * 핵심은 손 모양으로 깊이 버퍼를 먼저 채워 두는 것이다(오클루더).
 * 손 자리에는 에셋이 그려지지 못하고, 캔버스가 투명하니 그 자리에 카메라 영상 —
 * 곧 진짜 손 — 이 그대로 보인다. 색을 칠하는 게 아니라 비워 두는 방식이라
 * 손 픽셀이 어긋날 일이 없다. 브라우저가 합성한 카메라 화면 그 자체이기 때문이다.
 *
 * 두 가지가 이 방식을 쓸 만하게 만든다.
 *   1) 손 모양을 제대로 만든다. 관절이 손끝으로 갈수록 가늘어지고 손바닥이 채워져 있어야
 *      실제 손 윤곽과 맞는다. 굵기가 일정한 막대 손은 윤곽이 어긋나 "에셋이 지워졌다"로 보인다.
 *   2) 오클루더를 **카메라 코앞의 고정 거리**에 놓는다. 관절 위치를 화면 좌표에서 역산하므로
 *      거리를 바꿔도 화면에 비치는 실루엣은 완전히 똑같다. 거리만 가까워질 뿐이다.
 *      그래서 손 거리 추정이 흔들려도 에셋은 **항상** 손보다 뒤에 있게 된다.
 *
 * 그 위에 얇은 금색 골격선과 집는 지점 표시를 덧그려 인식이 살아있음을 보여준다.
 * 진짜 손을 가리지 않을 만큼만 얇게.
 */
import * as THREE from "three";
import { HAND_CONNECTIONS, LM, type HandFrame } from "@/lib/hand/types";

/** 화면에서 손이 이만큼 크게 보일 때를 기준 거리로 삼는다 (손목~중지뿌리, 화면 정규화) */
const REF_SPAN = 0.16;
/** 손 거리 추정 한계 — 집어 든 물건을 어디에 둘지 정할 때만 쓴다 */
const DEPTH_MIN = 0.45;
const DEPTH_MAX = 1.8;
/**
 * 오클루더를 놓을 거리(m). 무대보다 확실히 앞이면 되고, 화면 실루엣은 거리와 무관하다.
 * 무대가 아주 가까이 놓였을 때를 대비해 무대 거리의 절반으로도 한 번 더 제한한다.
 */
const OCCLUDER_NEAR = 0.25;
/**
 * 관절별 두께 (손목~중지뿌리 길이 대비). 손가락 끝으로 갈수록 가늘어지게 해야
 * 사람 손처럼 보인다 — 전부 같은 굵기로 두면 풍선처럼 부푼다.
 * 진짜 손을 다 덮어야 하므로 실제보다 조금씩 두껍게 잡았다.
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

/** 비디오가 화면에 cover 로 잘려 보이는 것을 감안한 좌표 변환값 */
export interface CoverFit {
  scaleX: number;
  scaleY: number;
  offX: number;
  offY: number;
}

/**
 * MediaPipe 랜드마크는 **영상 프레임** 기준 0~1 이다. 화면은 cover 로 일부가 잘려 나가므로
 * 그 차이를 보정하지 않으면 오클루더가 실제 손에서 어긋난다.
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

export class HandVisual {
  /**
   * 깊이만 채우는 손 — **무대보다 먼저** 그린다. 색은 쓰지 않고 깊이만 남겨
   * 이 자리에 에셋이 그려지지 못하게 막는다. 그 결과 진짜 손이 드러난다.
   */
  readonly occluderScene = new THREE.Scene();
  /** 골격선·집는 지점 — 무대까지 다 그린 뒤 깊이를 비우고 맨 위에 얹는다 */
  readonly overlayScene = new THREE.Scene();

  private joints: THREE.InstancedMesh;
  private bones: THREE.InstancedMesh;
  private palm: THREE.Mesh;
  private skeleton: THREE.LineSegments;
  private dots: THREE.Points;
  private cursor: THREE.Mesh;

  /** 오클루더가 놓인 자리의 관절 월드 좌표 */
  readonly worldJoints: THREE.Vector3[] = Array.from({ length: 21 }, () => new THREE.Vector3());
  /** 집는 지점(엄지·검지 끝 중점) 화면 좌표(0~1). 무엇을 집었는지는 이걸로 고른다. */
  readonly pinchScreen = { x: 0.5, y: 0.5 };
  /**
   * 손까지의 거리 추정(m). 오클루더에는 쓰지 않고 — 그건 고정 거리다 —
   * 집어 든 물건을 얼마나 멀리 둘지 정하는 데만 쓴다.
   */
  depth = 1;

  /** 그릴 손이 있는지 — 엔진이 손 렌더 패스를 건너뛸지 판단한다 */
  get visible() {
    return this.occluderScene.visible;
  }

  private tmpM = new THREE.Matrix4();
  private tmpQ = new THREE.Quaternion();
  private tmpV = new THREE.Vector3();
  private tmpFrom = new THREE.Vector3();
  private tmpScale = new THREE.Vector3();
  private tmpUp = new THREE.Vector3(0, 1, 0);
  private palmCenter = new THREE.Vector3();
  private pinchWorld = new THREE.Vector3();

  constructor() {
    // 색은 쓰지 않고 깊이만 남기는 재질 — 이게 손 자리를 비워 진짜 손을 드러낸다
    const occluder = new THREE.MeshBasicMaterial({
      colorWrite: false,
      depthWrite: true,
      // 손바닥 다각형은 왼손·오른손, 손등·손바닥 방향에 따라 감기는 순서가 뒤집힌다.
      // 한쪽만 그리면 그 경우 손바닥에 구멍이 뚫린다.
      side: THREE.DoubleSide,
    });

    this.joints = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 14, 12), occluder, 21);
    this.bones = new THREE.InstancedMesh(
      // 길이를 늘려 쓸 수 있게 +Y 방향 단위 원기둥으로 만든다
      new THREE.CylinderGeometry(1, 1, 1, 12).translate(0, 0.5, 0),
      occluder,
      HAND_CONNECTIONS.length
    );

    // 손바닥 — 관절과 뼈만으로는 가운데가 뻥 뚫려 에셋이 손 안쪽에 비친다
    const palmGeo = new THREE.BufferGeometry();
    palmGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array((PALM_RIM.length + 1) * 3), 3)
    );
    const idx: number[] = [];
    for (let i = 1; i < PALM_RIM.length; i++) idx.push(0, i, i + 1);
    palmGeo.setIndex(idx);
    this.palm = new THREE.Mesh(palmGeo, occluder);

    for (const m of [this.joints, this.bones, this.palm]) {
      m.frustumCulled = false;
      this.occluderScene.add(m);
    }

    // ── 맨 위에 얹는 표시들 — 진짜 손을 가리지 않게 얇고 성기게 ──────────────
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(HAND_CONNECTIONS.length * 2 * 3), 3)
    );
    this.skeleton = new THREE.LineSegments(
      lineGeo,
      new THREE.LineBasicMaterial({
        color: 0xe8c98a,
        transparent: true,
        opacity: 0.7,
        depthTest: false,
        depthWrite: false,
      })
    );
    this.skeleton.frustumCulled = false;
    this.overlayScene.add(this.skeleton);

    const dotGeo = new THREE.BufferGeometry();
    dotGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(21 * 3), 3));
    this.dots = new THREE.Points(
      dotGeo,
      new THREE.PointsMaterial({
        color: 0xf6ecd6,
        transparent: true,
        opacity: 0.85,
        depthTest: false,
        depthWrite: false,
        sizeAttenuation: true,
      })
    );
    this.dots.frustumCulled = false;
    this.overlayScene.add(this.dots);

    // 집는 지점 표시 — 쥐면 붉게 바뀌어 "지금 쥐었다"가 손끝에서 바로 읽힌다
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
    this.cursor.frustumCulled = false;
    this.overlayScene.add(this.cursor);

    this.occluderScene.visible = false;
    this.overlayScene.visible = false;
  }

  /**
   * 한 프레임 갱신.
   * @param baseDepth 무대(앵커)까지의 거리. 손 거리 추정의 기준이자 오클루더 거리의 상한.
   */
  update(frame: HandFrame, camera: THREE.Camera, fit: CoverFit, baseDepth: number) {
    if (!frame.present || frame.landmarks.length < 21) {
      this.hide();
      return;
    }
    this.occluderScene.visible = true;
    this.overlayScene.visible = true;

    // 집어 든 물건을 놓을 거리 — 화면에서 손이 클수록 카메라에 가깝다
    const span = Math.max(frame.screenSpan, 1e-4);
    this.depth = THREE.MathUtils.clamp((baseDepth * REF_SPAN) / span, DEPTH_MIN, DEPTH_MAX);

    // 오클루더는 무대 앞 고정 거리에. 화면 좌표에서 역산하므로 실루엣은 그대로이고
    // 깊이만 앞으로 당겨져, 에셋이 손보다 뒤에 있는 게 보장된다.
    const occDepth = Math.min(OCCLUDER_NEAR, baseDepth * 0.5);

    for (let i = 0; i < 21; i++) {
      const s = toScreen(frame.landmarks[i], fit);
      screenToWorld(s.x, s.y, occDepth, camera, this.worldJoints[i]);
    }
    const ps = toScreen(frame.pinchPoint, fit);
    this.pinchScreen.x = ps.x;
    this.pinchScreen.y = ps.y;
    screenToWorld(ps.x, ps.y, occDepth, camera, this.pinchWorld);

    const worldSpan = this.worldJoints[LM.WRIST].distanceTo(this.worldJoints[LM.MIDDLE_MCP]);
    this.layoutOccluder(worldSpan);
    this.layoutOverlay(frame, camera, worldSpan);
  }

  /** 관절·뼈·손바닥을 지금 손 모양에 맞춰 배치한다 */
  private layoutOccluder(span: number) {
    for (let i = 0; i < 21; i++) {
      const r = span * JOINT_R[i];
      this.tmpM.makeScale(r, r, r).setPosition(this.worldJoints[i]);
      this.joints.setMatrixAt(i, this.tmpM);
    }
    this.joints.instanceMatrix.needsUpdate = true;

    HAND_CONNECTIONS.forEach(([a, b], i) => {
      this.tmpFrom.copy(this.worldJoints[a]);
      const len = this.tmpV.subVectors(this.worldJoints[b], this.tmpFrom).length();
      // 뼈는 양 끝 관절 중 가는 쪽에 맞춘다 — 굵은 쪽에 맞추면 손가락이 뭉툭해진다
      const r = span * Math.min(JOINT_R[a], JOINT_R[b]) * 0.92;
      // 단위 원기둥(+Y)을 뼈 방향으로 눕히고 길이만큼 늘인다
      this.tmpQ.setFromUnitVectors(this.tmpUp, this.tmpV.normalize());
      this.tmpM.compose(this.tmpFrom, this.tmpQ, this.tmpScale.set(r, len, r));
      this.bones.setMatrixAt(i, this.tmpM);
    });
    this.bones.instanceMatrix.needsUpdate = true;

    // 손바닥 — 손목 + 손가락 뿌리를 이은 다각형을 중심에서 살짝 부풀린다
    const attr = this.palm.geometry.attributes.position as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;

    this.palmCenter.copy(this.worldJoints[LM.WRIST]);
    for (const j of PALM_RIM) this.palmCenter.add(this.worldJoints[j]);
    this.palmCenter.multiplyScalar(1 / (PALM_RIM.length + 1));

    const put = (slot: number, joint: number) => {
      this.tmpV
        .copy(this.worldJoints[joint])
        .sub(this.palmCenter)
        .multiplyScalar(PALM_SWELL)
        .add(this.palmCenter)
        .toArray(arr, slot * 3);
    };
    put(0, LM.WRIST);
    PALM_RIM.forEach((j, i) => put(i + 1, j));
    attr.needsUpdate = true;
  }

  /** 골격선·점·집는 지점 표시를 갱신한다 */
  private layoutOverlay(frame: HandFrame, camera: THREE.Camera, worldSpan: number) {
    const line = this.skeleton.geometry.attributes.position as THREE.BufferAttribute;
    const larr = line.array as Float32Array;
    HAND_CONNECTIONS.forEach(([a, b], i) => {
      this.worldJoints[a].toArray(larr, i * 6);
      this.worldJoints[b].toArray(larr, i * 6 + 3);
    });
    line.needsUpdate = true;

    const dot = this.dots.geometry.attributes.position as THREE.BufferAttribute;
    const darr = dot.array as Float32Array;
    for (let i = 0; i < 21; i++) this.worldJoints[i].toArray(darr, i * 3);
    dot.needsUpdate = true;
    (this.dots.material as THREE.PointsMaterial).size = worldSpan * 0.09;

    this.cursor.position.copy(this.pinchWorld);
    this.cursor.quaternion.copy(camera.quaternion); // 항상 화면을 마주보게
    const mat = this.cursor.material as THREE.MeshBasicMaterial;
    mat.color.setHex(frame.pinching ? 0xc2452f : 0xe8c98a);
    this.cursor.scale.setScalar(worldSpan * THREE.MathUtils.lerp(1, 0.62, frame.pinch));
  }

  /** 손을 놓쳤을 때 — 다음 프레임까지 잔상이 남지 않게 숨긴다 */
  hide() {
    this.occluderScene.visible = false;
    this.overlayScene.visible = false;
  }

  dispose() {
    for (const s of [this.occluderScene, this.overlayScene]) {
      s.traverse((o: THREE.Object3D) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose?.();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose?.();
      });
      s.clear();
    }
  }
}
