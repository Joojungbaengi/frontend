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
  /** 좌우 라벨은 확실한 결과가 연속될 때만 잠그며, 손을 잃기 전에는 바꾸지 않는다. */
  private handednessCandidate: "left" | "right" | null = null;
  private handednessEvidence = 0;
  private lockedHandedness: "left" | "right" | null = null;

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
      // 손을 빠르게 움직이면 잔상 때문에 확신도가 뚝 떨어진다. 문턱을 낮춰
      // 흐릿하게 잡힌 프레임도 받아들여야 손이 중간에 끊기지 않는다.
      minHandPresenceConfidence: 0.35,
      minTrackingConfidence: 0.35,
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
      this.resetHandedness();
      this.frame = emptyHandFrame();
    }
  }

  /** 검출 결과를 HandFrame 으로 바꿔 latest 에 남긴다 */
  private ingest(res: {
    landmarks: Landmark[][];
    worldLandmarks: Landmark[][];
    handedness?: { categoryName?: string; score?: number }[][];
  }) {
    const raw = res.landmarks?.[0];
    const world = res.worldLandmarks?.[0];

    if (!raw || !world) {
      // 몇 프레임 놓쳤다고 손을 지우면, 빠르게 움직일 때마다 손이 사라졌다 나타난다.
      // 마지막 자세를 붙들고 꽤 오래 버틴다 — 놓친 사이에도 손은 화면에 그대로 남는다.
      if (++this.missStreak >= 12 && this.frame.present) {
        this.gesture.reset();
        this.worldEma = null;
        this.resetHandedness();
        this.frame = emptyHandFrame();
      }
      return;
    }
    this.missStreak = 0;

    const landmarks = this.gesture.smooth(raw);
    const smoothWorld = this.smoothWorld(world);
    const ratio = pinchRatio(world);
    const { pinching, justPinched, justReleased } = this.gesture.updatePinch(ratio);

    const thumb = landmarks[LM.THUMB_TIP];
    const index = landmarks[LM.INDEX_TIP];

    // 검출이 렌더보다 빠른 순간에는 아직 읽어가지 않은 엣지가 덮여 사라질 수 있다.
    // 소비될 때까지 붙들되, 반대 방향 엣지가 오면 그쪽이 최신이므로 밀어낸다.
    const pendingPinch = justPinched || (this.frame.justPinched && !justReleased);
    const pendingRelease = justReleased || (this.frame.justReleased && !justPinched);

    const handednessCategory = res.handedness?.[0]?.[0];
    const handedness = this.updateHandedness(
      handednessCategory?.categoryName,
      handednessCategory?.score ?? 0,
    );

    this.frame = {
      present: true,
      landmarks,
      world: smoothWorld,
      pinchPoint: { x: (thumb.x + index.x) / 2, y: (thumb.y + index.y) / 2 },
      pinch: pinchAmount(ratio),
      pinching,
      justPinched: pendingPinch,
      justReleased: pendingRelease,
      screenSpan: screenSpan(landmarks),
      handedness,
      handednessScore: handednessCategory?.score ?? 0,
    };
  }

  private updateHandedness(name: string | undefined, score: number): "left" | "right" {
    const corrected = readHandedness(name);
    if (corrected && score >= 0.75) {
      if (this.handednessCandidate === corrected) this.handednessEvidence += 1;
      else {
        this.handednessCandidate = corrected;
        this.handednessEvidence = 1;
      }
      if (!this.lockedHandedness && this.handednessEvidence >= 3) {
        this.lockedHandedness = corrected;
      }
    }
    return this.lockedHandedness ?? "right";
  }

  private resetHandedness() {
    this.handednessCandidate = null;
    this.handednessEvidence = 0;
    this.lockedHandedness = null;
  }

  /**
   * 실제 3D 좌표도 떨림을 걷어낸다. 여기가 흔들리면 손 전체가 덜덜 떤다.
   * 화면 좌표와 달리 잡는 판정에 쓰지 않으므로 조금 더 세게 눌러도 된다.
   */
  private worldEma: Landmark[] | null = null;
  private smoothWorld(w: Landmark[]): Landmark[] {
    const A = 0.5;
    if (!this.worldEma || this.worldEma.length !== w.length) {
      this.worldEma = w.map((p) => ({ ...p }));
    } else {
      for (let i = 0; i < w.length; i++) {
        const e = this.worldEma[i];
        e.x += (w[i].x - e.x) * A;
        e.y += (w[i].y - e.y) * A;
        e.z += (w[i].z - e.z) * A;
      }
    }
    return this.worldEma.map((p) => ({ ...p }));
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
    this.resetHandedness();
  }
}

/**
 * MediaPipe 가 알려주는 좌우. 셀피(전면) 카메라처럼 좌우가 뒤집힌 화면을
 * 가정한 판정이라 후면 카메라에서는 맞지 않을 수 있다.
 *
 * 그래서 **어느 손 모델을 쓸지는 이 값으로 정하지 않는다.** 손 모양 자체에서
 * 잰 부호(riggedHand 의 chirality)로 고른다 — 이 표기가 틀려도 화면에 보이는
 * 손과 어긋나지 않게 하려는 것이다. 이 값은 미터 좌표가 없을 때의 예비용이다.
 */
function readHandedness(name?: string): "left" | "right" | null {
  // 이 프로젝트의 XR camera-access 프레임은 MediaPipe에 전달되는 시점에 이미
  // 좌우 방향이 보정되어 있다. 여기서 다시 교환하면 실제 오른손이 왼손으로
  // 잠기므로 Tasks Vision 라벨을 그대로 사용한다.
  if (name === "Left") return "left";
  if (name === "Right") return "right";
  return null;
}
