/**
 * 손을 3D 씬 안에 세우는 부분 — "손이 에셋 위로 보인다"를 두 겹으로 만든다.
 *
 *  1) 오클루더 : 관절 구 + 뼈 원기둥을 **색은 안 쓰고 깊이만 기록**하도록(colorWrite:false) 그린다.
 *     캔버스가 투명(alpha:true)이라, 오클루더가 원료를 가린 자리에는 뒤에 깔린 video 의
 *     **진짜 손 픽셀**이 그대로 드러난다. 손을 원료 앞으로 넣으면 원료가 손 뒤로 가려진다.
 *  2) 골격선  : 그 위에 depthTest:false 로 얇은 금색 선을 얹어 추적이 살아있음을 항상 보여준다.
 *
 * 좌표는 화면에서 역산한다(unproject). 가상 카메라의 화각이 실제 카메라와 달라도
 * 화면상 위치는 정확히 맞으므로 골격이 진짜 손 위에 그대로 포개진다.
 */
import * as THREE from "three";
import { HAND_CONNECTIONS, LM, type HandFrame } from "@/lib/hand/types";

/** 화면에서 손이 이만큼 크게 보일 때를 기준 거리로 삼는다 (손목~중지뿌리, 화면 정규화) */
const REF_SPAN = 0.16;
/** 깊이 보정 한계 — 인식이 튀어도 손이 카메라를 뚫거나 무대 뒤로 날아가지 않게 */
const DEPTH_MIN = 0.45;
const DEPTH_MAX = 1.8;

/** 비디오가 object-fit:cover 로 잘려 보이는 것을 감안한 좌표 변환값 */
export interface CoverFit {
  scaleX: number;
  scaleY: number;
  offX: number;
  offY: number;
}

/**
 * MediaPipe 랜드마크는 **영상 프레임** 기준 0~1 이다. 화면은 object-fit:cover 로
 * 일부가 잘려 나가므로 그 차이를 보정하지 않으면 골격이 실제 손에서 어긋난다.
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

export class HandVisual {
  readonly group = new THREE.Group();

  private joints: THREE.InstancedMesh;
  private bones: THREE.InstancedMesh;
  private skeleton: THREE.LineSegments;
  private dots: THREE.Points;
  private cursor: THREE.Mesh;

  /** 이번 프레임의 관절 월드 좌표 — 잡기 판정에서 그대로 읽어 쓴다 */
  readonly worldJoints: THREE.Vector3[] = Array.from({ length: 21 }, () => new THREE.Vector3());
  /** 이번 프레임의 집는 지점(엄지·검지 끝 중점) 월드 좌표 */
  readonly pinchWorld = new THREE.Vector3();
  /** 이번 프레임에 추정한 손까지의 거리(m) */
  depth = 1;

  private tmpM = new THREE.Matrix4();
  private tmpQ = new THREE.Quaternion();
  private tmpV = new THREE.Vector3();
  private tmpScale = new THREE.Vector3();
  private tmpUp = new THREE.Vector3(0, 1, 0);

  constructor() {
    // 오클루더 — 그림은 안 그리고 깊이만 남긴다
    const occluderMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true });

    this.joints = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 12, 10), occluderMat, 21);
    this.bones = new THREE.InstancedMesh(
      // 위아래로 늘려 쓸 수 있게 y 축 방향 단위 원기둥으로 만든다
      new THREE.CylinderGeometry(1, 1, 1, 10).translate(0, 0.5, 0),
      occluderMat,
      HAND_CONNECTIONS.length
    );
    for (const m of [this.joints, this.bones]) {
      m.frustumCulled = false;
      // 원료보다 먼저 그려 깊이를 먼저 깔아 둔다
      m.renderOrder = -1;
      this.group.add(m);
    }

    // 골격선 — 항상 최상단
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
        opacity: 0.85,
        depthTest: false,
        depthWrite: false,
      })
    );
    this.skeleton.renderOrder = 999;
    this.skeleton.frustumCulled = false;
    this.group.add(this.skeleton);

    const dotGeo = new THREE.BufferGeometry();
    dotGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(21 * 3), 3));
    this.dots = new THREE.Points(
      dotGeo,
      new THREE.PointsMaterial({
        color: 0xf6ecd6,
        size: 0.012,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
        depthWrite: false,
        sizeAttenuation: true,
      })
    );
    this.dots.renderOrder = 1000;
    this.dots.frustumCulled = false;
    this.group.add(this.dots);

    // 집는 지점 표시 — 쥐면 색이 바뀌어 "지금 쥐었다"가 눈으로 보인다
    this.cursor = new THREE.Mesh(
      new THREE.RingGeometry(0.014, 0.02, 28),
      new THREE.MeshBasicMaterial({
        color: 0xe8c98a,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    this.cursor.renderOrder = 1001;
    this.cursor.frustumCulled = false;
    this.group.add(this.cursor);

    this.group.visible = false;
  }

  /**
   * 한 프레임 갱신.
   * @param baseDepth 무대(앵커)까지의 거리. 손 크기로 앞뒤를 보정하는 기준이 된다.
   */
  update(frame: HandFrame, camera: THREE.Camera, fit: CoverFit, baseDepth: number) {
    if (!frame.present || frame.landmarks.length < 21) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;

    // 화면에서 손이 클수록 카메라에 가깝다 — 앞뒤로 뻗는 동작이 반영된다
    const span = Math.max(frame.screenSpan, 1e-4);
    this.depth = THREE.MathUtils.clamp((baseDepth * REF_SPAN) / span, DEPTH_MIN, DEPTH_MAX);

    for (let i = 0; i < 21; i++) {
      const s = toScreen(frame.landmarks[i], fit);
      screenToWorld(s.x, s.y, this.depth, camera, this.worldJoints[i]);
    }
    const pinchScreen = toScreen(frame.pinchPoint, fit);
    screenToWorld(pinchScreen.x, pinchScreen.y, this.depth, camera, this.pinchWorld);

    // 손 두께도 화면상 손 크기를 따라간다 — 멀어지면 같이 얇아진다
    const worldSpan = this.worldJoints[LM.WRIST].distanceTo(this.worldJoints[LM.MIDDLE_MCP]);
    this.updateOccluder(worldSpan * 0.2, worldSpan * 0.15);
    this.updateSkeleton();
    this.updateCursor(frame, camera);
  }

  private updateOccluder(jointR: number, boneR: number) {
    for (let i = 0; i < 21; i++) {
      this.tmpM.makeScale(jointR, jointR, jointR).setPosition(this.worldJoints[i]);
      this.joints.setMatrixAt(i, this.tmpM);
    }
    this.joints.instanceMatrix.needsUpdate = true;

    HAND_CONNECTIONS.forEach(([a, b], i) => {
      const from = this.worldJoints[a];
      const len = this.tmpV.subVectors(this.worldJoints[b], from).length();
      // 단위 원기둥(+Y)을 뼈 방향으로 눕히고 길이만큼 늘인다
      this.tmpQ.setFromUnitVectors(this.tmpUp, this.tmpV.normalize());
      this.tmpM.compose(from, this.tmpQ, this.tmpScale.set(boneR, len, boneR));
      this.bones.setMatrixAt(i, this.tmpM);
    });
    this.bones.instanceMatrix.needsUpdate = true;
  }

  private updateSkeleton() {
    const line = this.skeleton.geometry.attributes.position as THREE.BufferAttribute;
    const arr = line.array as Float32Array;
    HAND_CONNECTIONS.forEach(([a, b], i) => {
      this.worldJoints[a].toArray(arr, i * 6);
      this.worldJoints[b].toArray(arr, i * 6 + 3);
    });
    line.needsUpdate = true;

    const dot = this.dots.geometry.attributes.position as THREE.BufferAttribute;
    const darr = dot.array as Float32Array;
    for (let i = 0; i < 21; i++) this.worldJoints[i].toArray(darr, i * 3);
    dot.needsUpdate = true;
  }

  private updateCursor(frame: HandFrame, camera: THREE.Camera) {
    this.cursor.position.copy(this.pinchWorld);
    this.cursor.quaternion.copy(camera.quaternion); // 항상 화면을 마주보게
    // 쥐면 붉게, 펴면 금색으로 — 상태가 손끝에서 바로 읽힌다
    const mat = this.cursor.material as THREE.MeshBasicMaterial;
    mat.color.setHex(frame.pinching ? 0xc2452f : 0xe8c98a);
    this.cursor.scale.setScalar(THREE.MathUtils.lerp(1, 0.62, frame.pinch) * this.depth);
  }

  /** 손을 놓쳤을 때 — 다음 프레임까지 잔상이 남지 않게 숨긴다 */
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
  }
}
