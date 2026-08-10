/**
 * 손 인식기 — 후면 카메라 영상을 MediaPipe HandLandmarker 로 훑어 HandFrame 을 만든다.
 *
 * 설계 요점
 *  · 검출 루프와 렌더 루프를 **분리**한다. 검출은 자기 속도로 돌면서 최신 결과만 남기고,
 *    렌더(60fps)는 매 프레임 그 최신값을 읽어간다. 같이 묶으면 검출이 느린 기기에서
 *    3D 화면이 통째로 버벅인다.
 *  · WebXR 은 ARCore 가 카메라를 독점해 getUserMedia 와 함께 쓸 수 없다.
 *    그래서 이 모드는 WebXR 세션 대신 쓰는 별도 경로다.
 *  · wasm·모델은 scripts/fetch-mediapipe.mjs 가 public/mediapipe/ 에 준비해 둔다.
 */
import type { HandLandmarker } from "@mediapipe/tasks-vision";
import { GestureState, pinchAmount, pinchRatio, screenSpan } from "@/lib/hand/gestures";
import { emptyHandFrame, LM, type HandFrame, type Landmark } from "@/lib/hand/types";

/** scripts/fetch-mediapipe.mjs 가 채우는 폴더 */
const MEDIAPIPE_BASE = "/mediapipe";
const MODEL_URL = `${MEDIAPIPE_BASE}/hand_landmarker.task`;

/**
 * 검출 사이 최소 간격(ms). 0 이면 카메라가 주는 대로 전부 훑는다.
 * 렌더와 GPU 를 나눠 써야 하므로 조금 쉬어 준다 — LabelScanner 의 FRAME_GAP_MS 와 같은 이유.
 */
const DETECT_GAP_MS = 16;

/** 검출에 쓸 영상 크기 — 크게 받아봐야 손 인식 정확도는 거의 안 오르고 비용만 는다 */
const VIDEO_W = 640;
const VIDEO_H = 480;

export class HandTracker {
  private landmarker: HandLandmarker | null = null;
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement;
  private gesture = new GestureState();
  private frame: HandFrame = emptyHandFrame();
  private running = false;
  private lastVideoTime = -1;
  /** 손을 잠깐 놓쳐도 바로 사라지지 않게 버티는 프레임 수 */
  private missStreak = 0;

  constructor(video: HTMLVideoElement) {
    this.video = video;
  }

  /** 지금까지 본 것 중 가장 최신 손 상태. 렌더 루프가 매 프레임 읽어간다. */
  get latest(): HandFrame {
    return this.frame;
  }

  /**
   * 카메라를 켜고 모델을 올린다.
   * 카메라 실패와 모델 실패는 사용자에게 다르게 안내해야 하므로 원인을 구분해 던진다.
   */
  async start() {
    // 무거운 wasm 번들이라 손 모드를 고른 순간에만 받는다 (첫 화면 로딩을 늦추지 않게)
    const { FilesetResolver, HandLandmarker } = await import("@mediapipe/tasks-vision");

    const [camera, model] = await Promise.allSettled([
      this.startCamera(),
      (async () => {
        const fileset = await FilesetResolver.forVisionTasks(MEDIAPIPE_BASE);
        return HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
          runningMode: "VIDEO",
          // 이번 체험은 한 손이면 충분하다. 2로 올리면 비용이 그대로 두 배.
          numHands: 1,
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
      })(),
    ]);

    if (camera.status === "rejected") {
      if (model.status === "fulfilled") model.value.close();
      throw camera.reason;
    }
    if (model.status === "rejected") {
      this.stopCamera();
      throw model.reason;
    }

    this.landmarker = model.value;
    this.running = true;
    void this.loop();
  }

  private async startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("mediaDevices-unavailable");
    // 후면 카메라 고정. 웹캠만 있는 PC 에서는 브라우저가 알아서 전면으로 준다(ideal).
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: VIDEO_W },
        height: { ideal: VIDEO_H },
      },
      audio: false,
    });
    this.video.srcObject = this.stream;
    await this.video.play();
  }

  private stopCamera() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }

  /** 검출 루프 — 렌더와 따로 돈다 */
  private async loop() {
    while (this.running && this.landmarker) {
      // 같은 프레임을 두 번 넣으면 MediaPipe 가 타임스탬프 오류를 낸다
      if (this.video.readyState >= 2 && this.video.currentTime !== this.lastVideoTime) {
        this.lastVideoTime = this.video.currentTime;
        try {
          const res = this.landmarker.detectForVideo(this.video, performance.now());
          this.ingest(res);
        } catch {
          // 한 프레임 실패는 넘어간다 (다음 프레임에서 회복)
        }
      }
      await new Promise((r) => setTimeout(r, DETECT_GAP_MS));
    }
  }

  /** 검출 결과를 HandFrame 으로 바꿔 latest 에 남긴다 */
  private ingest(res: { landmarks: Landmark[][]; worldLandmarks: Landmark[][] }) {
    const raw = res.landmarks?.[0];
    const world = res.worldLandmarks?.[0];

    if (!raw || !world) {
      // 두세 프레임 놓친 정도로 손을 지우면 잡고 있던 물건이 뚝 떨어진다. 조금 버틴다.
      if (++this.missStreak >= 4) {
        if (this.frame.present) {
          this.gesture.reset();
          this.frame = emptyHandFrame();
        }
      }
      return;
    }
    this.missStreak = 0;

    const landmarks = this.gesture.smooth(raw);
    const ratio = pinchRatio(world);
    const { pinching, justPinched, justReleased } = this.gesture.updatePinch(ratio);

    const thumb = landmarks[LM.THUMB_TIP];
    const index = landmarks[LM.INDEX_TIP];

    this.frame = {
      present: true,
      landmarks,
      pinchPoint: { x: (thumb.x + index.x) / 2, y: (thumb.y + index.y) / 2 },
      pinch: pinchAmount(ratio),
      pinching,
      justPinched,
      justReleased,
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

  /** 카메라·모델·루프를 모두 정리한다. 언마운트에서 반드시 부를 것. */
  dispose() {
    this.running = false;
    this.stopCamera();
    this.landmarker?.close();
    this.landmarker = null;
    this.frame = emptyHandFrame();
    this.gesture.reset();
  }
}

/** getUserMedia 실패 사유를 사용자 문장으로 (LabelScanner 와 같은 문구를 쓴다) */
export function describeHandError(err: unknown): string {
  const name = err instanceof Error ? err.name : "";
  const message = err instanceof Error ? err.message : "";

  if (typeof window !== "undefined" && !window.isSecureContext)
    return "카메라는 HTTPS 또는 localhost 에서만 열 수 있어요. 배포된 주소로 접속해 주세요.";
  if (message === "mediaDevices-unavailable")
    return "이 브라우저에서 카메라 API를 쓸 수 없어요. 최신 크롬·사파리에서 열어주세요.";
  if (name === "NotAllowedError")
    return "카메라 권한이 거부되었어요. 주소창의 자물쇠 아이콘에서 허용으로 바꿔주세요.";
  if (name === "NotFoundError")
    return "연결된 카메라를 찾지 못했어요.";
  if (name === "NotReadableError")
    return "다른 앱이 카메라를 쓰고 있어요. 카메라 앱을 모두 끄고 다시 시도해 주세요.";
  return `손 인식을 시작하지 못했어요. (${name || "오류"}: ${message || "원인 불명"})`;
}
