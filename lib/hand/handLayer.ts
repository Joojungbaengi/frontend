"use client";

/**
 * 손 레이어 (L2) — 카메라 영상에서 손 픽셀만 오려 AR 에셋 **위에** 얹는다.
 *
 * 레이어 구성:
 *   L0  카메라 영상   — WebXR 이 캔버스 뒤에 깔아 준다 (바닥·책상)
 *   L1  AR 에셋       — 구멍 없이 그대로 그린다
 *   L2  손            — 여기. 에셋을 다 그린 뒤 화면을 덮는 사각형 하나를 얹되,
 *                       분할 마스크가 "손"이라고 한 픽셀만 남기고 나머지는 버린다.
 *
 * 에셋을 뚫는 방식(오클루더)과 결정적으로 다르다. 그때는 손 자리에 에셋을 안 그려서
 * 뒤에 있는 카메라 영상이 비치게 했을 뿐이라, 흉내 낸 실루엣이 조금만 어긋나도
 * 그 틈으로 책상이 보였다. 여기서는 손 픽셀 자체를 다시 그려 위에 올리므로
 * 에셋은 온전하고, 마스크가 틀린 만큼만 손 가장자리가 아쉬워질 뿐이다.
 *
 * 카메라 텍스처는 매 프레임 새것을 받고(선명하게), 마스크만 가끔 갱신한다.
 */
import * as THREE from "three";
import type { CoverFit } from "@/lib/hand/handVisual";

export class HandLayer {
  readonly scene = new THREE.Scene();
  private material: THREE.ShaderMaterial;

  constructor() {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        cameraTex: { value: null as THREE.Texture | null },
        maskTex: { value: null as THREE.Texture | null },
        // 카메라 영상이 화면에 cover 로 잘려 들어간 정도. 화면 좌표 → 영상 좌표 역변환에 쓴다.
        fitOffset: { value: new THREE.Vector2(0, 0) },
        fitScale: { value: new THREE.Vector2(1, 1) },
        // 추적 중인 손 주변 영역 (영상 좌표 0~1). 이 밖은 마스크를 무시한다.
        regionMin: { value: new THREE.Vector2(0, 0) },
        regionMax: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          // 카메라와 무관하게 화면 전체를 덮는다
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }`,
      fragmentShader: `
        uniform sampler2D cameraTex;
        uniform sampler2D maskTex;
        uniform vec2 fitOffset;
        uniform vec2 fitScale;
        uniform vec2 regionMin;
        uniform vec2 regionMax;
        varying vec2 vUv;

        void main() {
          // vUv 는 좌하단 원점. 화면 좌표계(좌상단 원점)로 바꾼 뒤,
          // cover 로 잘려 들어간 만큼 되돌려 카메라 영상 안의 위치를 구한다.
          vec2 screen = vec2(vUv.x, 1.0 - vUv.y);
          vec2 img = (screen - fitOffset) / fitScale;

          // 영상 밖은 손일 수 없다
          if (img.x < 0.0 || img.x > 1.0 || img.y < 0.0 || img.y > 1.0) discard;

          // 분할 모델은 "사람"을 통째로 잡는다. 화면에 얼굴이나 몸이 같이 들어오면
          // 그것까지 에셋 위로 떠오르므로, 추적 중인 손 주변으로 범위를 제한한다.
          vec2 inMin = smoothstep(regionMin - 0.04, regionMin + 0.04, img);
          vec2 inMax = smoothstep(regionMax + 0.04, regionMax - 0.04, img);
          float region = inMin.x * inMin.y * inMax.x * inMax.y;
          if (region <= 0.01) discard;

          // 마스크는 위에서 아래로 채워진 배열이라 img 를 그대로 쓴다.
          float m = texture2D(maskTex, img).r;
          // 확률을 부드럽게 자른다 — 딱 자르면 손 가장자리가 톱니처럼 보인다
          float a = smoothstep(0.4, 0.7, m) * region;
          if (a <= 0.01) discard;

          // 카메라 텍스처는 아래에서 위로 감긴다 (GL 기본). 세로만 뒤집어 샘플링한다.
          vec3 rgb = texture2D(cameraTex, vec2(img.x, 1.0 - img.y)).rgb;
          gl_FragColor = vec4(rgb, a);
        }`,
      transparent: true,
      // 에셋 위에 무조건 얹는다 — 이 레이어가 존재하는 이유 자체가 z 순서다
      depthTest: false,
      depthWrite: false,
    });

    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.scene.add(quad);
    this.scene.visible = false;
  }

  /** 카메라 텍스처는 이 프레임에만 유효하므로 매 프레임 다시 넣는다 */
  setCameraTexture(tex: THREE.Texture | null) {
    this.material.uniforms.cameraTex.value = tex;
  }

  setMask(tex: THREE.Texture | null) {
    this.material.uniforms.maskTex.value = tex;
  }

  /**
   * 손이 있는 범위를 랜드마크로 정해 준다 (영상 정규화 좌표).
   * 손목 아래 팔뚝까지 자연스럽게 이어지도록 넉넉히 넓힌다.
   */
  setRegionFromLandmarks(landmarks: { x: number; y: number }[], pad = 0.35) {
    if (!landmarks.length) return;
    let minX = 1, minY = 1, maxX = 0, maxY = 0;
    for (const p of landmarks) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const padX = (maxX - minX) * pad;
    const padY = (maxY - minY) * pad;
    this.material.uniforms.regionMin.value.set(minX - padX, minY - padY);
    this.material.uniforms.regionMax.value.set(maxX + padX, maxY + padY);
  }

  setFit(fit: CoverFit) {
    this.material.uniforms.fitOffset.value.set(fit.offX, fit.offY);
    this.material.uniforms.fitScale.value.set(fit.scaleX, fit.scaleY);
  }

  /** 카메라 영상과 마스크가 모두 있어야 그릴 수 있다 */
  get ready() {
    const u = this.material.uniforms;
    const ok = !!u.cameraTex.value && !!u.maskTex.value;
    this.scene.visible = ok;
    return ok;
  }

  dispose() {
    this.material.dispose();
    this.scene.traverse((o: THREE.Object3D) => (o as THREE.Mesh).geometry?.dispose?.());
    this.scene.clear();
  }
}
