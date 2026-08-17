"use client";

/**
 * 손 좌표 계산 + 장갑 손 그리기.
 *
 * 그리는 순서로 층을 만든다.
 *   L0  카메라 영상 — WebXR 이 캔버스 뒤에 (바닥·책상)
 *   L1  AR 에셋     — 엔진이 먼저 그린다
 *   L2  손 그림자   — 손 모양을 어둡게, 살짝 어긋나게. 에셋 위에 그림자가 진다.
 *   L3  장갑 손     — 깊이를 비우고 그려 항상 에셋 위. 손가락끼리는 정상적으로 가려진다.
 *   L4  집는 고리
 *
 * 손 모양은 뼈대가 든 3D 모델(riggedHand.ts)이 맡는다. 모델은 비동기로 오므로,
 * 도착하기 전이나 못 불러왔을 때는 코드로 그린 손(gloveHand.ts)이 대신 나온다.
 * 시연 도중 손이 통째로 사라지는 것보다는 낫다.
 */
import * as THREE from "three";
import { GloveHand, HAND_DRAW_DEPTH } from "@/lib/hand/gloveHand";
import { RiggedHand } from "@/lib/hand/riggedHand";
import { LM, type HandFrame } from "@/lib/hand/types";

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
  /** 장갑 손 씬 — 그림자 패스에도 같은 지오메트리를 재사용한다 */
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
  /** 손까지의 거리 추정(m). 집어 든 물건을 얼마나 멀리 둘지 정하는 데 쓴다. */
  depth = 1;

  get visible() {
    return this.handScene.visible;
  }

  private pinchWorld = new THREE.Vector3();
  private attachedToMainScene = false;

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

    this.handScene.add(this.glove.group);

    this.handScene.add(new THREE.HemisphereLight(0xfff6e6, 0x4a3a28, 1.1));
    const key = new THREE.DirectionalLight(0xfff4e2, 2.3);
    key.position.set(0.4, 1, 0.8);
    this.handScene.add(key);

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
    // 고리도 같은 씬에 둔다 — 씬을 나누면 그릴 때마다 XR 이 카메라를 다시 세팅해 비싸다
    this.handScene.add(this.cursor);
    this.handScene.visible = false;
  }

  /**
   * XR에서는 한 프레임에 renderer.render()를 한 번만 호출해야 카메라 pose가
   * 손과 AR 오브젝트에 동일하게 적용된다. 가상 손과 커서를 메인 scene에
   * 직접 붙여 별도 렌더 패스를 없앤다.
   */
  attachTo(scene: THREE.Scene) {
    if (this.attachedToMainScene) return;
    scene.add(this.glove.group);
    scene.add(this.rigged.group);
    scene.add(this.cursor);
    this.glove.group.visible = false;
    this.rigged.group.visible = false;
    this.cursor.visible = false;
    this.attachedToMainScene = true;
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
        // 실제 손 cutout 대신 가상 손을 항상 AR 오브젝트 위에 보여 준다.
        // 같은 scene의 단일 render pass이므로 XR pose는 한 번만 적용된다.
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        materials.forEach((material) => {
          material.depthTest = false;
          material.depthWrite = false;
          material.needsUpdate = true;
        });
        mesh.renderOrder = 900;
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
  update(frame: HandFrame, camera: THREE.Camera, fit: CoverFit, baseDepth: number) {
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
          material.depthTest = false;
          material.depthWrite = false;
        });
        mesh.renderOrder = 900;
      });
    }

    this.cursor.position.copy(this.pinchWorld);
    this.cursor.quaternion.copy(camera.quaternion); // 항상 화면을 마주보게
    // 쥐면 붉게, 펴면 금색으로
    (this.cursor.material as THREE.MeshBasicMaterial).color.setHex(
      frame.pinching ? 0xc2452f : 0xe8c98a
    );
    this.cursor.scale.setScalar(worldSpan * THREE.MathUtils.lerp(0.85, 0.5, frame.pinch));
  }

  hide() {
    this.handScene.visible = false;
    this.cursor.visible = false;
    this.rigged.group.visible = false;
    this.glove.group.visible = false;
    // 다시 잡혔을 때 사라진 자리에서 화면을 가로질러 쓸고 오지 않게 비운다
    this.rigged.reset();
  }

  //(별)
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
