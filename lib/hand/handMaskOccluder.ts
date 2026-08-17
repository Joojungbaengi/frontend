"use client";

import * as THREE from "three";
import { LM } from "@/lib/hand/types";

/**
 * MediaPipe 21개 관절로 만드는 "화면 공간 손 실루엣".
 *
 * 실제 색은 전혀 그리지 않고 depth만 기록한다.
 *
 * 기존 GloveHand와 다른 점:
 * - 원통형 3D 손가락 X
 * - 손가락을 카메라를 바라보는 얇은 평면으로 생성
 * - 관절마다 원형 마스크를 겹쳐 capsule처럼 연결
 * - 손바닥은 얇은 polygon으로 구성
 *
 * → AR 모델만 손 실루엣 모양으로 잘리고
 *   실제 카메라 손이 그대로 드러난다.
 */

const FINGERS = [
  [1, 2, 3, 4],       // 엄지
  [5, 6, 7, 8],       // 검지
  [9, 10, 11, 12],    // 중지
  [13, 14, 15, 16],   // 약지
  [17, 18, 19, 20],   // 새끼
] as const;

/**
 * 손바닥 외곽.
 *
 * wrist → thumb → index → middle → ring → pinky
 */
const PALM_RIM = [
  LM.WRIST,
  1,
  LM.INDEX_MCP,
  LM.MIDDLE_MCP,
  LM.RING_MCP,
  LM.PINKY_MCP,
] as const;


/**
 * 손가락별 상대 굵기
 */
const FINGER_WIDTH = [
  0.20, // 엄지
  0.155,
  0.165,
  0.155,
  0.14,
] as const;


export class HandMaskOccluder {

  readonly group = new THREE.Group();

  /**
   * 화면에는 아무 색도 쓰지 않고
   * depth buffer에만 쓴다.
   */
  private readonly material =
    new THREE.MeshBasicMaterial({
      color: 0x000000,

      colorWrite: false,

      depthTest: true,
      depthWrite: true,

      side: THREE.DoubleSide,
    });


  /**
   * 손가락 뼈 사이를 연결하는 직사각형들.
   *
   * 5 fingers × 3 segments = 15
   */
  private readonly segments: THREE.Mesh[] = [];


  /**
   * 관절 사이에 빈 틈이 생기지 않게
   * 작은 원을 겹친다.
   */
  private readonly jointDiscs: THREE.Mesh[] = [];


  /**
   * 손바닥 polygon
   */
  private readonly palmGeometry = new THREE.BufferGeometry();
  private readonly palm: THREE.Mesh;


  private readonly palmPositions =
    new Float32Array((PALM_RIM.length + 1) * 3);


  private readonly camRight = new THREE.Vector3();
  private readonly camUp = new THREE.Vector3();

  private readonly delta = new THREE.Vector3();
  private readonly center = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();


  constructor() {

    /*
     * ─────────────────────────────
     * 손가락 segment
     * ─────────────────────────────
     */

    for (let i = 0; i < 15; i++) {

      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        this.material
      );

      mesh.frustumCulled = false;

      this.group.add(mesh);
      this.segments.push(mesh);
    }


    /*
     * ─────────────────────────────
     * 관절 원형 mask
     * ─────────────────────────────
     */

    for (let i = 0; i < 21; i++) {

      const mesh = new THREE.Mesh(
        new THREE.CircleGeometry(0.5, 12),
        this.material
      );

      mesh.frustumCulled = false;

      this.group.add(mesh);
      this.jointDiscs.push(mesh);
    }


    /*
     * ─────────────────────────────
     * 손바닥
     * ─────────────────────────────
     */

    this.palmGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(
        this.palmPositions,
        3
      )
    );


    /*
     * vertex 0 = center
     * 1~6 = 손바닥 외곽
     */
    const index: number[] = [];

    for (let i = 0; i < PALM_RIM.length; i++) {

      const a = i + 1;

      const b =
        ((i + 1) % PALM_RIM.length) + 1;

      index.push(
        0,
        a,
        b
      );
    }

    this.palmGeometry.setIndex(index);


    this.palm = new THREE.Mesh(
      this.palmGeometry,
      this.material
    );

    this.palm.frustumCulled = false;

    this.group.add(this.palm);
  }


  update(
    joints: THREE.Vector3[],
    camera: THREE.Camera
  ) {

    if (joints.length < 21) {
      this.group.visible = false;
      return;
    }

    this.group.visible = true;


    /*
     * 손 크기 기준
     */
    const span =
      joints[LM.WRIST].distanceTo(
        joints[LM.MIDDLE_MCP]
      );


    /*
     * 카메라 화면의 X/Y 축
     */
    this.camRight
      .set(1, 0, 0)
      .applyQuaternion(camera.quaternion);

    this.camUp
      .set(0, 1, 0)
      .applyQuaternion(camera.quaternion);


    /*
     * ─────────────────────────────
     * 손가락 mask
     * ─────────────────────────────
     */

    let segmentIndex = 0;

    FINGERS.forEach((finger, fingerIndex) => {

      const width =
        span *
        FINGER_WIDTH[fingerIndex];


      for (let j = 0; j < 3; j++) {

        const a =
          joints[finger[j]];

        const b =
          joints[finger[j + 1]];


        const mesh =
          this.segments[
            segmentIndex++
          ];


        /*
         * 가운데 위치
         */
        mesh.position
          .copy(a)
          .add(b)
          .multiplyScalar(0.5);


        /*
         * 길이
         */
        this.delta.subVectors(
          b,
          a
        );

        const len =
          this.delta.length();


        /*
         * 화면 기준 각도 계산
         */
        const dx =
          this.delta.dot(
            this.camRight
          );

        const dy =
          this.delta.dot(
            this.camUp
          );

        const angle =
          Math.atan2(
            dy,
            dx
          );


        /*
         * 항상 카메라를 바라보는
         * 얇은 평면
         */
        mesh.quaternion.copy(
          camera.quaternion
        );

        mesh.rotateZ(angle);


        /*
         * 관절 원과 겹치도록
         * 약간 길게 만든다.
         */
        mesh.scale.set(
          len + width * 0.8,
          width,
          1
        );
      }
    });


    /*
     * ─────────────────────────────
     * 관절 원
     *
     * rectangle 사이 틈을 메워
     * capsule silhouette 형성
     * ─────────────────────────────
     */

    for (let i = 0; i < 21; i++) {

      const disc =
        this.jointDiscs[i];

      disc.position.copy(
        joints[i]
      );

      disc.quaternion.copy(
        camera.quaternion
      );


      let radius =
        span * 0.075;


      /*
       * 손바닥 관절은 조금 크게
       */
      if (
        i === LM.WRIST ||
        i === LM.INDEX_MCP ||
        i === LM.MIDDLE_MCP ||
        i === LM.RING_MCP ||
        i === LM.PINKY_MCP
      ) {

        radius =
          span * 0.105;
      }


      disc.scale.setScalar(
        radius * 2
      );
    }


    /*
     * ─────────────────────────────
     * 손바닥 polygon
     * ─────────────────────────────
     */

    this.center.set(
      0,
      0,
      0
    );


    for (const idx of PALM_RIM) {

      this.center.add(
        joints[idx]
      );
    }


    this.center.multiplyScalar(
      1 / PALM_RIM.length
    );


    /*
     * 중심 vertex
     */
    this.palmPositions[0] =
      this.center.x;

    this.palmPositions[1] =
      this.center.y;

    this.palmPositions[2] =
      this.center.z;


    /*
     * 실제 landmark polygon보다
     * 약간 넓혀서 손 가장자리에서
     * AR 모델이 삐져나오는 현상을 줄인다.
     */
    const PALM_SWELL = 1.10;


    PALM_RIM.forEach(
      (jointIndex, i) => {

        this.tmp
          .copy(
            joints[jointIndex]
          )
          .sub(
            this.center
          )
          .multiplyScalar(
            PALM_SWELL
          )
          .add(
            this.center
          );


        const o =
          (i + 1) * 3;


        this.palmPositions[o] =
          this.tmp.x;

        this.palmPositions[o + 1] =
          this.tmp.y;

        this.palmPositions[o + 2] =
          this.tmp.z;
      }
    );


    (
      this.palmGeometry
        .attributes
        .position as THREE.BufferAttribute
    ).needsUpdate = true;
  }


  hide() {
    this.group.visible = false;
  }


  dispose() {

    this.segments.forEach(
      mesh =>
        mesh.geometry.dispose()
    );

    this.jointDiscs.forEach(
      mesh =>
        mesh.geometry.dispose()
    );

    this.palmGeometry.dispose();

    this.material.dispose();

    this.group.clear();
  }
}