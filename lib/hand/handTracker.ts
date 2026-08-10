"use client";

/**
 * 손 인식기 — 카메라 이미지 한 장을 받아 HandFrame 하나로 바꾼다.
 *
 * 영상은 WebXR 이 준다. immersive-ar 세션 동안에는 ARCore 가 카메라를 독점해서
 * getUserMedia 로 같은 카메라를 열 수 없기 때문에, `camera-access` 로 받은 XR 카메라
 * 이미지를 렌더 루프가 detect() 로 밀어 넣는다. (lib/hand/xrCameraFeed.ts 참고)
 *
 * 그래서 이 클래스는 카메라를 직접 열지 않는다 — 모델을 올리고, 주어진 이미지로
 * 검출하고, 결과를 손 하나의 상태로 정리하는 것까지만 한다.
 *
 * wasm·모델은 scripts/fetch-mediapipe.mjs 가 public/mediapipe/ 에 준비해 둔다.
 */
import type { HandLandmarker } from "@mediapipe/tasks-vision";
import { GestureState, pinchAmount, pinchRatio, screenSpan } from "@/lib/hand/gestures";
import { emptyHandFrame, LM, type HandFrame, type Landmark } from "@/lib/hand/types";

/** scripts/fetch-mediapipe.mjs 가 채우는 폴더 */
const MEDIAPIPE_BASE = "/mediapipe";
const MODEL_URL = `${MEDIAPIPE_BASE}/hand_landmarker.task`;

export class HandTracker {
  private landmarker: HandLandmarker | null = null;
  private gesture = new GestureState();
  private frame: HandFrame = emptyHandFrame();
  private paused = false;
  /** 손을 잠깐 놓쳐도 바로 사라지지 않게 버티는 프레임 수 */
  private missStreak = 0;

  /** 지금까지 본 것 중 가장 최신 손 상태. 렌더 루프가 매 프레임 읽어간다. */
  get latest(): HandFrame {
    return this.frame;
  }

  /** 모델을 올린다. 무거운 wasm 번들이라 손을 실제로 쓸 때 처음 받는다. */
  async load() {
    const { FilesetResolver, HandLandmarker } = await import("@mediapipe/tasks-vision");
    const fileset = await FilesetResolver.forVisionTasks(MEDIAPIPE_BASE);
    this.landmarker = await HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
      runningMode: "VIDEO",
      // 이번 체험은 한 손이면 충분하다. 2로 올리면 비용이 그대로 두 배.
      numHands: 1,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  }

  /**
   * 이미지 한 장으로 검출한다. 호출 간격은 부르는 쪽(렌더 루프)이 조절한다 —
   * 카메라 이미지를 GPU 에서 내려받는 비용이 있어 매 프레임 부르면 3D 가 느려진다.
   */
  detect(source: CanvasImageSource, timestampMs: number) {
    if (!this.landmarker || this.paused) return;
    try {
      this.ingest(this.landmarker.detectForVideo(source as HTMLCanvasElement, timestampMs));
    } catch {
      // 한 프레임 실패는 넘어간다 (다음 프레임에서 회복)
    }
  }

  /**
   * 손을 쓰지 않는 단계에서는 검출을 쉬게 한다.
   * 발효·완성 단계까지 MediaPipe 를 계속 돌리면 GPU 를 나눠 쓰느라 3D 가 버벅인다.
   */
  setPaused(paused: boolean) {
    if (this.paused === paused) return;
    this.paused = paused;
    // 멈춘 사이의 손 상태를 그대로 들고 있다가 재개하면 엉뚱한 집기가 발생한다
    if (paused) {
      this.gesture.reset();
      this.frame = emptyHandFrame();
    }
  }

  /** 검출 결과를 HandFrame 으로 바꿔 latest 에 남긴다 */
  private ingest(res: { landmarks: Landmark[][]; worldLandmarks: Landmark[][] }) {
    const raw = res.landmarks?.[0];
    const world = res.worldLandmarks?.[0];

    if (!raw || !world) {
      // 두세 프레임 놓친 정도로 손을 지우면 잡고 있던 물건이 뚝 떨어진다. 조금 버틴다.
      if (++this.missStreak >= 4 && this.frame.present) {
        this.gesture.reset();
        this.frame = emptyHandFrame();
      }
      return;
    }
    this.missStreak = 0;

    const landmarks = this.gesture.smooth(raw);
    const ratio = pinchRatio(world);
    const { pinching, justPinched, justReleased } = this.gesture.updatePinch(ratio);

    const thumb = landmarks[LM.THUMB_TIP];
    const index = landmarks[LM.INDEX_TIP];

    // 검출이 렌더보다 빠른 순간에는 아직 읽어가지 않은 엣지가 덮여 사라질 수 있다.
    // 소비될 때까지 붙들되, 반대 방향 엣지가 오면 그쪽이 최신이므로 밀어낸다.
    const pendingPinch = justPinched || (this.frame.justPinched && !justReleased);
    const pendingRelease = justReleased || (this.frame.justReleased && !justPinched);

    this.frame = {
      present: true,
      landmarks,
      pinchPoint: { x: (thumb.x + index.x) / 2, y: (thumb.y + index.y) / 2 },
      pinch: pinchAmount(ratio),
      pinching,
      justPinched: pendingPinch,
      justReleased: pendingRelease,
      screenSpan: screenSpan(landmarks),
    };
  }

  /**
   * justPinched / justReleased 는 "그 순간 한 번"이어야 한다.
   * 렌더 루프가 읽어간 뒤 이 함수로 내려 두 번 처리되는 것을 막는다.
   */
  consumeEdges() {
    if (this.frame.justPinched || this.frame.justReleased) {
      this.frame = { ...this.frame, justPinched: false, justReleased: false };
    }
  }

  dispose() {
    this.landmarker?.close();
    this.landmarker = null;
    this.frame = emptyHandFrame();
    this.gesture.reset();
  }
}
