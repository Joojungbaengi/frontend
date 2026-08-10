"use client";

/**
 * 손 좌표 계산 + 집는 지점 표시.
 *
 * 손 자체를 그리는 일은 여기서 하지 않는다 — 그건 lib/hand/handLayer.ts 가
 * 카메라 영상에서 손 픽셀을 오려 에셋 위에 얹는 방식으로 처리한다.
 * 여기 남은 몫은 두 가지다.
 *   · 랜드마크를 화면 좌표·월드 좌표로 옮긴다 (무엇을 집었는지 판정하는 데 쓴다)
 *   · 엄지·검지 사이에 작은 고리를 띄워 지금 쥐었는지 보여준다
 */
import * as THREE from "three";
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
  /** 집는 지점 고리 — 손 레이어까지 다 그린 뒤 맨 위에 얹는다 */
  readonly overlayScene = new THREE.Scene();
  private cursor: THREE.Mesh;

  /**
   * 집는 지점(엄지·검지 끝 중점)의 화면 좌표(0~1).
   * 무엇을 집었는지는 깊이가 아니라 이 화면 좌표로 고른다 — 거리 추정은 흔들리지만
   * 화면 좌표는 사용자가 보는 것("손가락이 쌀 위에 있다")과 항상 일치한다.
   */
  readonly pinchScreen = { x: 0.5, y: 0.5 };
  /** 손까지의 거리 추정(m). 집어 든 물건을 얼마나 멀리 둘지 정하는 데 쓴다. */
  depth = 1;

  get visible() {
    return this.overlayScene.visible;
  }

  private pinchWorld = new THREE.Vector3();
  private wrist = new THREE.Vector3();
  private mcp = new THREE.Vector3();

  constructor() {
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
    this.overlayScene.visible = false;
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
    this.overlayScene.visible = true;

    // 화면에서 손이 클수록 카메라에 가깝다
    const span = Math.max(frame.screenSpan, 1e-4);
    this.depth = THREE.MathUtils.clamp((baseDepth * REF_SPAN) / span, DEPTH_MIN, DEPTH_MAX);

    const ps = toScreen(frame.pinchPoint, fit);
    this.pinchScreen.x = ps.x;
    this.pinchScreen.y = ps.y;
    screenToWorld(ps.x, ps.y, this.depth, camera, this.pinchWorld);

    // 고리 크기는 손 크기를 따라간다 — 멀어지면 같이 작아진다
    const w = toScreen(frame.landmarks[LM.WRIST], fit);
    const m = toScreen(frame.landmarks[LM.MIDDLE_MCP], fit);
    screenToWorld(w.x, w.y, this.depth, camera, this.wrist);
    screenToWorld(m.x, m.y, this.depth, camera, this.mcp);
    const worldSpan = this.wrist.distanceTo(this.mcp);

    this.cursor.position.copy(this.pinchWorld);
    this.cursor.quaternion.copy(camera.quaternion); // 항상 화면을 마주보게
    // 쥐면 붉게, 펴면 금색으로
    (this.cursor.material as THREE.MeshBasicMaterial).color.setHex(
      frame.pinching ? 0xc2452f : 0xe8c98a
    );
    this.cursor.scale.setScalar(worldSpan * THREE.MathUtils.lerp(0.85, 0.5, frame.pinch));
  }

  hide() {
    this.overlayScene.visible = false;
  }

  dispose() {
    this.overlayScene.traverse((o: THREE.Object3D) => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose?.();
      (mesh.material as THREE.Material | undefined)?.dispose?.();
    });
    this.overlayScene.clear();
  }
}
