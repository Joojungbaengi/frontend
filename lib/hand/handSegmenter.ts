"use client";

/**
 * 손 픽셀 마스크 — 카메라 영상에서 "여기는 손/사람이다"를 픽셀 단위로 가려낸다.
 *
 * 왜 필요한가: 카메라는 책상과 손이 한 장에 섞인 평평한 이미지를 준다.
 * 손을 AR 에셋 **위 레이어**로 올리려면 그 이미지에서 손 픽셀만 오려내야 하는데,
 * 관절 21개(HandLandmarker)로는 관절 위치만 알 뿐 윤곽선을 알 수 없다.
 * 구·원기둥으로 실루엣을 흉내 내면 실제 손 윤곽과 어긋나 에셋이 잘못 뚫린다.
 *
 * 그래서 분할 모델을 따로 돌린다. 결과는 three 텍스처로 올려 두고,
 * lib/hand/handLayer.ts 가 그 마스크대로 카메라 영상을 오려 에셋 위에 얹는다.
 *
 * 경계가 딱딱하면 오려낸 티가 나므로 확률 마스크(0~1 연속값)를 받아 가장자리를 부드럽게 쓴다.
 */
import * as THREE from "three";
import type { ImageSegmenter } from "@mediapipe/tasks-vision";

const MEDIAPIPE_BASE = "/mediapipe";
const MODEL_URL = `${MEDIAPIPE_BASE}/selfie_segmenter.tflite`;

export class HandSegmenter {
  private segmenter: ImageSegmenter | null = null;
  private texture: THREE.DataTexture | null = null;
  private bytes: Uint8Array | null = null;

  /** 마스크 텍스처 (아직 한 장도 못 받았으면 null) */
  get mask(): THREE.DataTexture | null {
    return this.texture;
  }

  async load() {
    const { FilesetResolver, ImageSegmenter } = await import("@mediapipe/tasks-vision");
    const fileset = await FilesetResolver.forVisionTasks(MEDIAPIPE_BASE);
    this.segmenter = await ImageSegmenter.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
      runningMode: "VIDEO",
      // 확률 마스크를 쓴다 — 0/1 로 딱 자르면 손 가장자리가 톱니처럼 보인다
      outputConfidenceMasks: true,
      outputCategoryMask: false,
    });
  }

  /** 이미지 한 장에서 마스크를 갱신한다. 호출 간격은 부르는 쪽이 조절한다. */
  segment(source: CanvasImageSource, timestampMs: number) {
    if (!this.segmenter) return;
    try {
      const res = this.segmenter.segmentForVideo(source as HTMLCanvasElement, timestampMs);
      const masks = res.confidenceMasks;
      if (masks?.length) {
        // 2분류 모델은 [배경, 사람] 순으로 준다. 1개만 주는 모델이면 그게 곧 전경이다.
        this.upload(masks[masks.length - 1]);
      }
      res.close();
    } catch {
      // 한 프레임 실패는 넘어간다 (다음 프레임에서 회복)
    }
  }

  /** MPMask(실수 0~1) → three 가 샘플링할 8비트 단채널 텍스처 */
  private upload(mpMask: { width: number; height: number; getAsFloat32Array(): Float32Array }) {
    const w = mpMask.width;
    const h = mpMask.height;
    const src = mpMask.getAsFloat32Array();

    if (!this.texture || this.texture.image.width !== w || this.texture.image.height !== h) {
      this.texture?.dispose();
      this.bytes = new Uint8Array(w * h);
      this.texture = new THREE.DataTexture(this.bytes, w, h, THREE.RedFormat, THREE.UnsignedByteType);
      // 마스크는 카메라 영상보다 훨씬 작다. 선형 보간으로 늘려야 경계가 계단지지 않는다.
      this.texture.minFilter = THREE.LinearFilter;
      this.texture.magFilter = THREE.LinearFilter;
      this.texture.wrapS = THREE.ClampToEdgeWrapping;
      this.texture.wrapT = THREE.ClampToEdgeWrapping;
      // MPMask 는 위에서 아래로 채워진 배열이다. 뒤집지 않아야 화면과 방향이 맞는다.
      this.texture.flipY = false;
    }

    const dst = this.bytes!;
    for (let i = 0; i < dst.length; i++) dst[i] = src[i] * 255;
    this.texture.needsUpdate = true;
  }

  dispose() {
    this.segmenter?.close();
    this.segmenter = null;
    this.texture?.dispose();
    this.texture = null;
    this.bytes = null;
  }
}
