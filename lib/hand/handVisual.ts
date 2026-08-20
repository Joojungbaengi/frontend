"use client";

/**
 * 손 좌표 계산 + 장갑 손 그리기.
 *
 * 메인 장면의 깊이와 커서 오버레이를 분리한다.
 *   L0  카메라 영상 — WebXR 이 캔버스 뒤에 (바닥·책상)
 *   L1  AR 에셋     — 엔진이 먼저 그린다
 *   L2  장갑 손     — AR 에셋과 같은 깊이 버퍼를 써서 실제 앞뒤 관계를 표현한다.
 *   L3  집는 고리   — 조작 위치가 가려지지 않도록 별도 오버레이로 그린다.
 *
 * 손 모양은 뼈대가 든 3D 모델(riggedHand.ts)이 맡는다. 모델은 비동기로 오므로,
 * 도착하기 전이나 못 불러왔을 때는 코드로 그린 손(gloveHand.ts)이 대신 나온다.
 * 시연 도중 손이 통째로 사라지는 것보다는 낫다.
 */
import * as THREE from "three";
import { GloveHand, HAND_DRAW_DEPTH } from "@/lib/hand/gloveHand";
import { RiggedHand } from "@/lib/hand/riggedHand";
import { LM, type HandFrame } from "@/lib/hand/types";
import {
  resolveVisualHandPenetration,
  type VisualHandCollisionSpace,
} from "@/lib/hand/visualCollision";

/** 화면에서 손이 이만큼 크게 보일 때를 기준 거리로 삼는다 (손목~중지뿌리, 화면 정규화) */
const REF_SPAN = 0.16;
/** 손 거리 추정 한계 — 집어 든 물건을 어디에 둘지 정할 때 쓴다 */
const DEPTH_MIN = 0.45;
const DEPTH_MAX = 1.8;

/** 비디오가 화면에 cover 로 잘려 보이는 것을 감안한 좌표 변환값 */
export interface CoverFit {
  scaleX: number;
  scaleY: number;
  offX: number;
  offY: number;
}

/**
 * MediaPipe 랜드마크는 **영상 프레임** 기준 0~1 이다. 화면은 cover 로 일부가 잘려 나가므로
 * 그 차이를 보정하지 않으면 손 좌표가 화면에서 어긋난다.
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
  /** 집는 고리만 그리는 가벼운 오버레이 Scene */
  private readonly handScene = new THREE.Scene();
  private glove: GloveHand;
  private rigged = new RiggedHand();

  private cursor: THREE.Mesh;
  /** 21개 관절의 월드 좌표 */
  private joints: THREE.Vector3[] = Array.from({ length: 21 }, () => new THREE.Vector3());
  private camRight = new THREE.Vector3();
  private camUp = new THREE.Vector3();
  private camFwd = new THREE.Vector3();

  /**
   * 집는 지점(엄지·검지 끝 중점)의 화면 좌표(0~1).
   * 무엇을 집었는지는 깊이가 아니라 이 화면 좌표로 고른다 — 거리 추정은 흔들리지만
   * 화면 좌표는 사용자가 보는 것("손가락이 쌀 위에 있다")과 항상 일치한다.
   */
  readonly pinchScreen = { x: 0.5, y: 0.5 };
  /**
   * 물건을 쥐는 지점의 화면 좌표(0~1).
   * 엄지-검지를 맞대면 손끝, 주먹을 쥐면 손바닥 한가운데가 된다 — 원료·소쿠리·뚜껑처럼
   * "움켜쥐어 잡는" 물건은 pinchScreen 대신 이 값으로 판정한다.
   */
  readonly grabScreen = { x: 0.5, y: 0.5 };
  /** 손까지의 거리 추정(m). 집어 든 물건을 얼마나 멀리 둘지 정하는 데 쓴다. */
  depth = 1;

  get visible() {
    return this.handScene.visible;
  }

  private pinchWorld = new THREE.Vector3();
  private grabWorld = new THREE.Vector3();
  private collisionOffset = new THREE.Vector3();
  private collisionTarget = new THREE.Vector3();
  private overlayReady = false;

  constructor() {
    // 한지빛 면장갑 — 어두운 나무 무대 위에서 또렷하되 튀지 않는다
    const glove = new THREE.MeshStandardMaterial({
      color: 0xf6efe0, // --hanji
      roughness: 0.86, // 면직물이라 반사가 거의 없다
      metalness: 0.0,
      side: THREE.DoubleSide, // 손바닥 다각형은 손 방향에 따라 감기는 순서가 뒤집힌다
    });
    // 손목 소매 — UI 의 금선 색
    const cuff = new THREE.MeshStandardMaterial({
      color: 0xc6a568, // --gold
      roughness: 0.4,
      metalness: 0.45,
    });
    this.glove = new GloveHand(glove, cuff);

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
    this.cursor.renderOrder = 1000;
    // 고리만 별도 패스로 그린다. MeshBasicMaterial이라 별도 조명은 필요 없다.
    this.handScene.add(this.cursor);
    this.handScene.visible = false;
  }

  /** 손 모델은 메인 AR Scene에, 커서는 별도 Overlay Scene에 준비한다. */
  attachTo(scene: THREE.Scene) {
    if (this.overlayReady) return;
    scene.add(this.glove.group);
    scene.add(this.rigged.group);
    this.glove.group.visible = false;
    this.rigged.group.visible = false;
    this.cursor.visible = false;
    this.overlayReady = true;
  }

  /**
   * 메인 Scene에는 이미 손 모델이 함께 렌더링되어 있다.
   * 깊이를 비운 뒤 조작 위치를 알리는 커서만 별도 패스로 덧그린다.
   */
  renderOverlay(renderer: THREE.WebGLRenderer, camera: THREE.Camera) {
    if (!this.overlayReady || !this.handScene.visible) return;
    renderer.clearDepth();
    renderer.render(this.handScene, camera);
  }

  /**
   * 손 모델을 올린다. 실패해도 체험은 계속된다 — 코드로 그린 손으로 떨어질 뿐이다.
   */
  async loadModel() {
    try {
      await this.rigged.load();
      this.rigged.group.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        // 메인 AR 에셋과 같은 깊이 버퍼를 사용해 손과 물체의 앞뒤를 구분한다.
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        materials.forEach((material) => {
          material.depthTest = true;
          material.depthWrite = true;
          material.needsUpdate = true;
        });
        mesh.renderOrder = 0;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
      });
    } catch (e) {
      console.warn("[ar] 가상 손 모델을 불러오지 못해 기본 손을 사용합니다.", e);
    }
  }

  /**
   * 한 프레임 갱신.
   * @param baseDepth 무대(앵커)까지의 거리 — 손 거리 추정의 기준
   */
  update(
    frame: HandFrame,
    camera: THREE.Camera,
    fit: CoverFit,
    baseDepth: number,
    visualCollision: VisualHandCollisionSpace | null = null,
  ) {
    if (!frame.present || frame.landmarks.length < 21) {
      this.hide();
      return;
    }
    this.handScene.visible = true;
    this.cursor.visible = true;

    // 집어 든 물건을 놓을 거리 — 화면에서 손이 클수록 카메라에 가깝다
    const span = Math.max(frame.screenSpan, 1e-4);
    this.depth = THREE.MathUtils.clamp((baseDepth * REF_SPAN) / span, DEPTH_MIN, DEPTH_MAX);

    // 손 자체는 고정 거리에 그린다. 화면 좌표에서 역산하므로 거리를 바꿔도
    // 화면에 비치는 크기·모양은 똑같고, 에셋 위에 오는 건 그리는 순서가 보장한다.
    for (let i = 0; i < 21; i++) {
      const s = toScreen(frame.landmarks[i], fit);
      screenToWorld(s.x, s.y, HAND_DRAW_DEPTH, camera, this.joints[i]);
    }

    const ps = toScreen(frame.pinchPoint, fit);
    this.pinchScreen.x = ps.x;
    this.pinchScreen.y = ps.y;
    screenToWorld(ps.x, ps.y, HAND_DRAW_DEPTH, camera, this.pinchWorld);

    // 움켜쥐는 지점 — 주먹을 쥐면 손끝이 아니라 손바닥 쪽으로 옮겨간다.
    const gs = toScreen(frame.grabPoint, fit);
    this.grabScreen.x = gs.x;
    this.grabScreen.y = gs.y;
    screenToWorld(gs.x, gs.y, HAND_DRAW_DEPTH, camera, this.grabWorld);

    // 상호작용은 원래 MediaPipe 좌표를 그대로 사용하고, 렌더링용 관절만
    // 별도 충돌 계층으로 보정한다. 충돌 중에는 즉시 밀어내고 해제 시에만
    // 잔여 오프셋을 짧게 감쇠해 표면에서 떨리는 현상을 줄인다.
    resolveVisualHandPenetration(this.joints, visualCollision, this.collisionTarget);
    if (this.collisionTarget.lengthSq() > 1e-8) this.collisionOffset.copy(this.collisionTarget);
    else this.collisionOffset.multiplyScalar(0.72);
    if (this.collisionOffset.lengthSq() > 1e-10) {
      this.joints.forEach((joint) => joint.add(this.collisionOffset));
    }

    // 손 크기 — 집는 고리를 얼마나 키울지의 기준
    const worldSpan = this.joints[LM.WRIST].distanceTo(this.joints[LM.MIDDLE_MCP]);

    // 모델이 도착했으면 그걸 쓰고, 아직이면 코드로 그린 손을 쓴다
    if (this.rigged.loaded) {
      // 왼손·오른손 모델이 따로 있어 프레임의 좌우 정보만 넘기면 된다
      this.rigged.update(this.joints, frame, camera);
      this.rigged.group.visible = true;
      this.glove.group.visible = false;
    } else {
      this.glove.update(this.joints, worldSpan);
      this.glove.group.visible = true;
      this.glove.group.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        materials.forEach((material) => {
          material.depthTest = true;
          material.depthWrite = true;
        });
        mesh.renderOrder = 0;
      });
    }

    // 고리는 실제로 물건을 잡는 지점에 둔다 (핀치면 손끝, 주먹이면 손바닥)
    this.cursor.position.copy(this.grabWorld);
    this.cursor.quaternion.copy(camera.quaternion); // 항상 화면을 마주보게
    // 쥐면 붉게, 펴면 금색으로
    (this.cursor.material as THREE.MeshBasicMaterial).color.setHex(
      frame.grasping ? 0xc2452f : 0xe8c98a
    );
    this.cursor.scale.setScalar(worldSpan * THREE.MathUtils.lerp(0.85, 0.5, frame.grasp));
  }

  hide() {
    this.handScene.visible = false;
    this.cursor.visible = false;
    this.rigged.group.visible = false;
    this.glove.group.visible = false;
    // 다시 잡혔을 때 사라진 자리에서 화면을 가로질러 쓸고 오지 않게 비운다
    this.rigged.reset();
    this.collisionOffset.set(0, 0, 0);
  }

  dispose() {
    this.glove.dispose();
    this.rigged.dispose();
    this.cursor.geometry.dispose();
    (this.cursor.material as THREE.Material).dispose();
    for (const sc of [this.handScene]) {

      sc.traverse(
        (o: THREE.Object3D) => {

          const mesh =
            o as THREE.Mesh;

          mesh.geometry?.dispose?.();

          const mat =
            mesh.material as
              | THREE.Material
              | THREE.Material[]
              | undefined;

          if (Array.isArray(mat)) {
            mat.forEach(
              x => x.dispose()
            );
          } else {
            mat?.dispose?.();
          }
        }
      );

      sc.clear();
    }
  }

  /*
  dispose() {
    this.glove.dispose();
    this.rigged.dispose();
    for (const sc of [this.handScene]) {
      sc.traverse((o: THREE.Object3D) => {
        const mesh = o as THREE.Mesh;
        mesh.geometry?.dispose?.();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose?.();
      });
      sc.clear();
    }
  }
  */
}
