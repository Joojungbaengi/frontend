/**
 * 손 인식기 — 후면 카메라 영상을 MediaPipe HandLandmarker 로 훑어 HandFrame 을 만든다.
 *
 * 설계 요점
 *  · 영상을 어디서 받는지는 두 가지다.
 *      - 카메라 모드 : getUserMedia 로 직접 연 <video>. 자기 속도로 도는 루프를 스스로 굴린다.
 *      - AR 모드     : WebXR 이 ARCore 로 카메라를 독점하므로 getUserMedia 를 못 쓴다.
 *                      대신 camera-access 로 받은 XR 카메라 이미지를 밖에서 detect() 로 밀어 넣는다.
 *    어느 쪽이든 만들어 내는 HandFrame 은 똑같아서 상호작용 코드는 하나로 간다.
 *  · 검출과 렌더는 **분리**한다. 검출은 최신 결과만 남기고 렌더(60fps)는 그 최신값을 읽어간다.
 *    같이 묶으면 검출이 느린 기기에서 3D 화면이 통째로 버벅인다.
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
  /** 카메라 모드에서만 쓴다. AR 모드에서는 null 이고 detect() 로 이미지를 받는다. */
  private video: HTMLVideoElement | null;
  private gesture = new GestureState();
  private frame: HandFrame = emptyHandFrame();
  private running = false;
  private paused = false;
  private lastVideoTime = -1;
  /** 손을 잠깐 놓쳐도 바로 사라지지 않게 버티는 프레임 수 */
  private missStreak = 0;

  constructor(video: HTMLVideoElement | null = null) {
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
      this.video ? this.startCamera() : Promise.resolve(),
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
    // 카메라 모드만 스스로 루프를 돈다. AR 모드는 렌더 루프가 detect() 를 불러 준다.
    if (this.video) void this.loop();
  }

  /**
   * 밖에서 준 이미지 한 장으로 검출한다 (AR 모드 — XR 카메라 이미지).
   * 렌더 루프가 부르므로 호출 간격은 부르는 쪽이 조절한다.
   */
  detect(source: CanvasImageSource, timestampMs: number) {
    if (!this.landmarker || this.paused) return;
    try {
      this.ingest(this.landmarker.detectForVideo(source as HTMLCanvasElement, timestampMs));
    } catch {
      // 한 프레임 실패는 넘어간다 (다음 프레임에서 회복)
    }
  }

  private async startCamera() {
    const video = this.video!;
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
    video.srcObject = this.stream;
    await video.play();
  }

  private stopCamera() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.video) this.video.srcObject = null;
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
      this.lastVideoTime = -1;
    }
  }

  /** 검출 루프 — 렌더와 따로 돈다 */
  private async loop() {
    const video = this.video!;
    while (this.running && this.landmarker) {
      if (this.paused) {
        await new Promise((r) => setTimeout(r, 150));
        continue;
      }
      // 같은 프레임을 두 번 넣으면 MediaPipe 가 타임스탬프 오류를 낸다
      if (video.readyState >= 2 && video.currentTime !== this.lastVideoTime) {
        this.lastVideoTime = video.currentTime;
        try {
          this.ingest(this.landmarker.detectForVideo(video, performance.now()));
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
