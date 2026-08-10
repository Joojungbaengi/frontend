"use client";

/**
 * 장갑 낀 손 — 인식한 관절 21개로 매끈한 손 모양을 만든다.
 *
 * 카메라 영상에서 진짜 손 픽셀을 오려 쓰는 건 접었다(분할 모델이 책상 위로 뻗은 손을
 * 제대로 못 잡았다). 대신 손을 직접 그리되, 서비스 톤에 맞는 **한지빛 면장갑**으로 만든다.
 *
 * 관절마다 구를 놓고 뼈마다 원기둥을 잇는 방식은 이음매가 다 보여 기계 팔처럼 보였다.
 * 여기서는 다르게 만든다.
 *   · 손가락 : 관절 4개를 지나는 곡선을 따라 **끝으로 갈수록 가늘어지는 관**을 뽑는다.
 *              곡선이라 마디가 안 보이고, 손끝은 둥글게 막는다.
 *   · 손바닥 : 손목·손가락 뿌리를 이은 다각형을 바깥으로 부풀리고 두께를 줘 도톰하게.
 *   · 이음매 : 손가락 뿌리와 손끝에 관 굵기와 같은 구를 겹쳐 놓아 경계를 지운다.
 *   · 소매   : 손목에 금색 고리를 둘러 "장갑"으로 읽히게 하고 UI 색과 묶는다.
 *
 * 관절 위치는 화면 좌표에서 역산하므로, 어느 거리에 놓든 화면에 비치는 크기·모양은 같다.
 * 그래서 거리는 적당한 고정값을 쓰고, 손이 에셋 위에 오는 건 그리는 순서로 보장한다.
 */
import * as THREE from "three";
import { LM } from "@/lib/hand/types";

/** 손가락 하나를 이루는 관절 (뿌리 → 끝) */
const FINGERS: readonly (readonly number[])[] = [
  [1, 2, 3, 4], //     엄지
  [5, 6, 7, 8], //     검지
  [9, 10, 11, 12], //  중지
  [13, 14, 15, 16], // 약지
  [17, 18, 19, 20], // 새끼
];

/** 손가락별 뿌리·끝 굵기 (손목~중지뿌리 길이 대비). 엄지는 조금 굵다. */
const FINGER_R: readonly (readonly [number, number])[] = [
  [0.1, 0.07], //    엄지
  [0.088, 0.058], // 검지
  [0.09, 0.059], //  중지
  [0.084, 0.055], // 약지
  [0.076, 0.05], //  새끼
];

/** 손바닥 테두리 (손목에서 시계 방향으로 한 바퀴) */
const PALM_RIM = [1, 5, 9, 13, 17];
/** 손바닥 다각형을 중심에서 부풀리는 정도 — 관절점만 이으면 실제 손바닥보다 좁다 */
const PALM_SWELL = 1.1;
/** 손바닥 반두께 */
const PALM_T = 0.07;

/** 관을 따라 몇 번 끊어 재는지 / 관 둘레를 몇 각형으로 만드는지 */
const RINGS = 12;
const SEG = 10;

/** 손을 그릴 거리(m). 화면 실루엣은 거리와 무관하므로 안정적인 값이면 된다. */
export const HAND_DRAW_DEPTH = 0.5;

/**
 * 곡선을 따라 굵기가 변하는 관 하나. 매 프레임 정점만 옮긴다
 * (BufferGeometry 를 새로 만들면 프레임마다 GPU 로 다시 올라가 느려진다).
 */
class TaperedTube {
  readonly mesh: THREE.Mesh;
  private pos: THREE.BufferAttribute;
  private nrm: THREE.BufferAttribute;

  private curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
  ]);
  private pts: THREE.Vector3[] = [];
  private tangent = new THREE.Vector3();
  private normal = new THREE.Vector3();
  private binormal = new THREE.Vector3();
  private tmp = new THREE.Vector3();

  constructor(material: THREE.Material) {
    const vertexCount = RINGS * SEG + 1; // 마지막 하나는 손끝 중심
    const geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3);
    this.nrm = new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3);
    geo.setAttribute("position", this.pos);
    geo.setAttribute("normal", this.nrm);

    const idx: number[] = [];
    for (let r = 0; r < RINGS - 1; r++) {
      for (let s = 0; s < SEG; s++) {
        const a = r * SEG + s;
        const b = r * SEG + ((s + 1) % SEG);
        idx.push(a, b, a + SEG, b, b + SEG, a + SEG);
      }
    }
    const tip = RINGS * SEG;
    for (let s = 0; s < SEG; s++) {
      const a = (RINGS - 1) * SEG + s;
      const b = (RINGS - 1) * SEG + ((s + 1) % SEG);
      idx.push(a, b, tip);
    }
    geo.setIndex(idx);

    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.frustumCulled = false;
  }

  /** 관절 4개를 지나는 매끈한 관으로 갱신한다 */
  update(joints: THREE.Vector3[], rBase: number, rTip: number) {
    for (let i = 0; i < 4; i++) this.curve.points[i].copy(joints[i]);
    this.pts = this.curve.getPoints(RINGS - 1);

    const P = this.pos.array as Float32Array;
    const N = this.nrm.array as Float32Array;

    for (let r = 0; r < RINGS; r++) {
      const t = r / (RINGS - 1);
      const p = this.pts[r];

      // 접선 — 끝점에서는 이웃 한쪽만 쓴다
      const prev = this.pts[Math.max(0, r - 1)];
      const next = this.pts[Math.min(RINGS - 1, r + 1)];
      this.tangent.subVectors(next, prev).normalize();
      if (this.tangent.lengthSq() < 1e-8) this.tangent.set(0, 1, 0);

      if (r === 0) {
        // 첫 고리의 기준 방향 — 접선과 나란하지 않은 축을 골라 만든다
        this.tmp.set(0, 0, 1);
        if (Math.abs(this.tangent.dot(this.tmp)) > 0.9) this.tmp.set(1, 0, 0);
        this.normal.crossVectors(this.tangent, this.tmp).normalize();
      } else {
        // 앞 고리의 방향을 접선에 수직으로만 고쳐 이어간다 (평행이송).
        // 매번 새로 만들면 관이 축을 따라 홱홱 돌아 비틀린 것처럼 보인다.
        this.normal.addScaledVector(this.tangent, -this.normal.dot(this.tangent)).normalize();
      }
      this.binormal.crossVectors(this.tangent, this.normal);

      // 뿌리에서 끝으로 갈수록 가늘어진다 (끝쪽에서 조금 더 빨리)
      const radius = THREE.MathUtils.lerp(rBase, rTip, t * t * 0.5 + t * 0.5);

      for (let s = 0; s < SEG; s++) {
        const a = (s / SEG) * Math.PI * 2;
        const cos = Math.cos(a);
        const sin = Math.sin(a);
        const nx = this.normal.x * cos + this.binormal.x * sin;
        const ny = this.normal.y * cos + this.binormal.y * sin;
        const nz = this.normal.z * cos + this.binormal.z * sin;
        const o = (r * SEG + s) * 3;
        P[o] = p.x + nx * radius;
        P[o + 1] = p.y + ny * radius;
        P[o + 2] = p.z + nz * radius;
        N[o] = nx;
        N[o + 1] = ny;
        N[o + 2] = nz;
      }
    }

    // 손끝 중심 — 마지막 고리보다 살짝 더 나가 둥글게 마무리된다
    const last = this.pts[RINGS - 1];
    const o = RINGS * SEG * 3;
    P[o] = last.x + this.tangent.x * rTip;
    P[o + 1] = last.y + this.tangent.y * rTip;
    P[o + 2] = last.z + this.tangent.z * rTip;
    N[o] = this.tangent.x;
    N[o + 1] = this.tangent.y;
    N[o + 2] = this.tangent.z;

    this.pos.needsUpdate = true;
    this.nrm.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
  }
}

/** 손목·손가락 뿌리를 이은 도톰한 손바닥 */
class Palm {
  readonly mesh: THREE.Mesh;
  private pos: THREE.BufferAttribute;

  private center = new THREE.Vector3();
  private planeN = new THREE.Vector3();
  private e1 = new THREE.Vector3();
  private e2 = new THREE.Vector3();
  private tmp = new THREE.Vector3();

  /** 테두리 점 개수 (손목 + 손가락 뿌리들) */
  private readonly rim = [LM.WRIST, ...PALM_RIM];

  constructor(material: THREE.Material) {
    const n = this.rim.length;
    // 앞뒤 면 각각 (중심 1 + 테두리 n)
    const geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array((n + 1) * 2 * 3), 3);
    geo.setAttribute("position", this.pos);

    const idx: number[] = [];
    const frontC = 0;
    const backC = n + 1;
    for (let i = 0; i < n; i++) {
      const a = 1 + i;
      const b = 1 + ((i + 1) % n);
      idx.push(frontC, a, b); //                        앞면
      idx.push(backC, backC + 1 + ((i + 1) % n), backC + 1 + i); // 뒷면
      // 옆면 — 앞뒤를 잇는다
      idx.push(a, backC + 1 + i, b, b, backC + 1 + i, backC + 1 + ((i + 1) % n));
    }
    geo.setIndex(idx);

    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.frustumCulled = false;
  }

  update(joints: THREE.Vector3[], thickness: number) {
    const n = this.rim.length;
    const P = this.pos.array as Float32Array;

    this.center.set(0, 0, 0);
    for (const j of this.rim) this.center.add(joints[j]);
    this.center.multiplyScalar(1 / n);

    // 손바닥이 놓인 평면의 법선 — 두께를 줄 방향
    this.e1.subVectors(joints[LM.INDEX_MCP], joints[LM.WRIST]);
    this.e2.subVectors(joints[LM.PINKY_MCP], joints[LM.WRIST]);
    this.planeN.crossVectors(this.e1, this.e2).normalize();
    if (this.planeN.lengthSq() < 1e-8) this.planeN.set(0, 0, 1);

    const frontC = 0;
    const backC = n + 1;
    this.tmp.copy(this.center).addScaledVector(this.planeN, thickness).toArray(P, frontC * 3);
    this.tmp.copy(this.center).addScaledVector(this.planeN, -thickness).toArray(P, backC * 3);

    for (let i = 0; i < n; i++) {
      // 중심에서 바깥으로 부풀린 뒤 앞뒤로 벌린다
      this.tmp
        .copy(joints[this.rim[i]])
        .sub(this.center)
        .multiplyScalar(PALM_SWELL)
        .add(this.center);
      this.tmp.addScaledVector(this.planeN, thickness).toArray(P, (1 + i) * 3);
      this.tmp.addScaledVector(this.planeN, -2 * thickness).toArray(P, (backC + 1 + i) * 3);
    }

    this.pos.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
  }

  dispose() {
    this.mesh.geometry.dispose();
  }
}

export class GloveHand {
  /** 장갑 손 전체. 엔진이 무대를 다 그린 뒤 이 그룹만 따로 그린다. */
  readonly group = new THREE.Group();

  private tubes: TaperedTube[] = [];
  private palm: Palm;
  /** 손가락 뿌리·손끝의 이음매를 지우는 구들 */
  private blobs: THREE.InstancedMesh;
  private cuff: THREE.Mesh;

  private tmpM = new THREE.Matrix4();
  private tmpQ = new THREE.Quaternion();
  private tmpV = new THREE.Vector3();
  private tmpS = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  private fingerJoints: THREE.Vector3[] = [];

  /** blobs 인스턴스가 어느 관절에 어떤 굵기로 붙는지 */
  private blobSpec: { joint: number; r: number }[] = [];

  constructor(material: THREE.Material, cuffMaterial: THREE.Material) {
    FINGERS.forEach(() => {
      const tube = new TaperedTube(material);
      this.tubes.push(tube);
      this.group.add(tube.mesh);
    });

    this.palm = new Palm(material);
    this.group.add(this.palm.mesh);

    // 손가락 뿌리(관 굵기와 같게) + 손끝 + 손목
    FINGERS.forEach((f, i) => this.blobSpec.push({ joint: f[0], r: FINGER_R[i][0] }));
    FINGERS.forEach((f, i) => this.blobSpec.push({ joint: f[3], r: FINGER_R[i][1] }));
    this.blobSpec.push({ joint: LM.WRIST, r: PALM_T * 1.15 });

    this.blobs = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 14, 12),
      material,
      this.blobSpec.length
    );
    this.blobs.frustumCulled = false;
    this.group.add(this.blobs);

    // 손목 금색 소매 — 이게 있어야 맨손이 아니라 장갑으로 읽힌다
    this.cuff = new THREE.Mesh(new THREE.TorusGeometry(1, 0.15, 10, 28), cuffMaterial);
    this.cuff.frustumCulled = false;
    this.group.add(this.cuff);
  }

  /**
   * 관절 월드 좌표로 손 모양을 갱신한다.
   * @param span 손목~중지뿌리 거리. 모든 굵기의 기준이 된다.
   */
  update(joints: THREE.Vector3[], span: number) {
    FINGERS.forEach((f, i) => {
      this.fingerJoints.length = 0;
      for (const j of f) this.fingerJoints.push(joints[j]);
      this.tubes[i].update(this.fingerJoints, span * FINGER_R[i][0], span * FINGER_R[i][1]);
    });

    this.palm.update(joints, span * PALM_T);

    this.blobSpec.forEach((b, i) => {
      const r = span * b.r;
      this.tmpM.makeScale(r, r, r).setPosition(joints[b.joint]);
      this.blobs.setMatrixAt(i, this.tmpM);
    });
    this.blobs.instanceMatrix.needsUpdate = true;

    // 소매는 손목에 두르고, 팔 방향(중지뿌리 → 손목)을 축으로 세운다
    const r = span * 0.36;
    this.tmpV.subVectors(joints[LM.WRIST], joints[LM.MIDDLE_MCP]).normalize();
    this.tmpQ.setFromUnitVectors(this.up, this.tmpV);
    // 토러스는 XY 평면에 눕혀 있으므로 축(Z)을 팔 방향에 맞춘다
    this.tmpQ.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));
    this.tmpM.compose(joints[LM.WRIST], this.tmpQ, this.tmpS.set(r, r, r));
    this.cuff.matrix.copy(this.tmpM);
    this.cuff.matrixAutoUpdate = false;
  }

  dispose() {
    this.tubes.forEach((t) => t.dispose());
    this.palm.dispose();
    this.blobs.geometry.dispose();
    this.cuff.geometry.dispose();
    this.group.clear();
  }
}
