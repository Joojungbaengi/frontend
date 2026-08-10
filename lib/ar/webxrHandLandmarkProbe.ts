import * as THREE from "three";
import type { HandLandmarker } from "@mediapipe/tasks-vision";

const MEDIAPIPE_WASM_ROOT = "/mediapipe/wasm";
const HAND_MODEL_URL = "/mediapipe/hand_landmarker.task";
const MAX_INPUT_SIZE = 320;
const INFERENCE_INTERVAL_MS = 200;

export interface XRCameraTextureSample {
  texture: THREE.Texture;
  cameraWidth: number;
  cameraHeight: number;
  timestamp: number;
}

export interface XRHandLandmarkPoint {
  x: number;
  y: number;
  z: number;
}

export interface XRHandLandmarkSample {
  landmarks: XRHandLandmarkPoint[];
  cameraWidth: number;
  cameraHeight: number;
  timestamp: number;
}

export interface WebXRHandLandmarkProbe {
  onCameraTexture(sample: XRCameraTextureSample): void;
  dispose(): void;
}

interface ProbeOptions {
  renderer: THREE.WebGLRenderer;
  overlay: HTMLElement;
  onLandmarks?: (sample: XRHandLandmarkSample) => void;
}

/**
 * XR 카메라 텍스처를 작은 CPU 소유 캔버스로 복사한 뒤 손목 랜드마크만 확인한다.
 * 결과는 디버그 DOM에만 쓰며 Three.js 씬이나 양조 상태에는 연결하지 않는다.
 */
export function createWebXRHandLandmarkProbe({
  renderer,
  overlay,
  onLandmarks,
}: ProbeOptions): WebXRHandLandmarkProbe {
  const modelEl = overlay.querySelector<HTMLElement>("[data-hand-model]");
  const handEl = overlay.querySelector<HTMLElement>("[data-hand]");
  const wristXEl = overlay.querySelector<HTMLElement>("[data-wrist-x]");
  const wristYEl = overlay.querySelector<HTMLElement>("[data-wrist-y]");

  const inputCanvas = document.createElement("canvas");
  const maybeInputContext = inputCanvas.getContext("2d");
  if (!maybeInputContext) throw new Error("2D hand inference canvas is unavailable");
  const inputContext = maybeInputContext;

  const copyScene = new THREE.Scene();
  const copyCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const copyMaterial = new THREE.MeshBasicMaterial({ depthTest: false, depthWrite: false });
  copyMaterial.toneMapped = false;
  const copyQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), copyMaterial);
  copyScene.add(copyQuad);

  let renderTarget: THREE.WebGLRenderTarget | null = null;
  let readPixels = new Uint8Array(0);
  let topDownPixels = new Uint8ClampedArray(0);
  let handLandmarker: HandLandmarker | null = null;
  let disposed = false;
  let failed = false;
  let inferenceBusy = false;
  let lastInferenceAt = -Infinity;
  let errorLogged = false;

  function setText(element: HTMLElement | null, text: string) {
    if (element && element.textContent !== text) element.textContent = text;
  }

  function resetHandResult() {
    setText(handEl, "NOT DETECTED");
    setText(wristXEl, "0.000");
    setText(wristYEl, "0.000");
  }

  function fail(error: unknown) {
    if (disposed) return;
    failed = true;
    setText(modelEl, "ERROR");
    resetHandResult();
    if (!errorLogged) {
      errorLogged = true;
      console.warn("[hand-debug] Hand Landmarker probe failed", error);
    }
  }

  function ensureInputSize(cameraWidth: number, cameraHeight: number) {
    const sourceWidth = cameraWidth > 0 ? cameraWidth : 4;
    const sourceHeight = cameraHeight > 0 ? cameraHeight : 3;
    const scale = MAX_INPUT_SIZE / Math.max(sourceWidth, sourceHeight);
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));

    if (renderTarget?.width === width && renderTarget.height === height) return;

    renderTarget?.dispose();
    renderTarget = new THREE.WebGLRenderTarget(width, height, {
      depthBuffer: false,
      stencilBuffer: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
    });
    inputCanvas.width = width;
    inputCanvas.height = height;
    readPixels = new Uint8Array(width * height * 4);
    topDownPixels = new Uint8ClampedArray(width * height * 4);
  }

  function copyTextureToCanvas(sample: XRCameraTextureSample) {
    ensureInputSize(sample.cameraWidth, sample.cameraHeight);
    if (!renderTarget) throw new Error("Hand inference render target was not created");

    const previousTarget = renderer.getRenderTarget();
    const previousXrEnabled = renderer.xr.enabled;

    const mapWasEmpty = copyMaterial.map === null;
    copyMaterial.map = sample.texture;
    if (mapWasEmpty) copyMaterial.needsUpdate = true;

    try {
      // XR 카메라 자동 치환을 잠시 끄고 소유한 작은 render target에만 복사한다.
      renderer.xr.enabled = false;
      renderer.setRenderTarget(renderTarget);
      renderer.clear();
      renderer.render(copyScene, copyCamera);
      renderer.readRenderTargetPixels(
        renderTarget,
        0,
        0,
        renderTarget.width,
        renderTarget.height,
        readPixels,
      );
    } finally {
      renderer.setRenderTarget(previousTarget);
      renderer.xr.enabled = previousXrEnabled;
    }

    // WebGL readback은 아래 행부터 오므로 Canvas 2D의 위 행부터 순서로 뒤집는다.
    const rowBytes = renderTarget.width * 4;
    for (let y = 0; y < renderTarget.height; y++) {
      const sourceStart = (renderTarget.height - 1 - y) * rowBytes;
      topDownPixels.set(readPixels.subarray(sourceStart, sourceStart + rowBytes), y * rowBytes);
    }
    inputContext.putImageData(
      new ImageData(topDownPixels, renderTarget.width, renderTarget.height),
      0,
      0,
    );
  }

  setText(modelEl, "LOADING");
  resetHandResult();

  void (async () => {
    try {
      const { FilesetResolver, HandLandmarker } = await import("@mediapipe/tasks-vision");
      const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_ROOT);
      const model = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: HAND_MODEL_URL,
          delegate: "CPU",
        },
        runningMode: "VIDEO",
        numHands: 1,
      });

      if (disposed) {
        model.close();
        return;
      }

      handLandmarker = model;
      setText(modelEl, "READY");
    } catch (error) {
      if (!disposed) fail(error);
    }
  })();

  return {
    onCameraTexture(sample) {
      if (
        disposed ||
        failed ||
        !handLandmarker ||
        inferenceBusy ||
        sample.timestamp - lastInferenceAt < INFERENCE_INTERVAL_MS
      ) {
        return;
      }

      inferenceBusy = true;
      lastInferenceAt = sample.timestamp;

      try {
        // 불투명 XR 텍스처가 유효한 현재 animation frame 안에서 CPU 프레임을 확보한다.
        copyTextureToCanvas(sample);
      } catch (error) {
        inferenceBusy = false;
        fail(error);
        return;
      }

      // CPU 소유 canvas가 준비된 뒤 추론을 분리해 기존 XR frame 작업을 먼저 끝낸다.
      void Promise.resolve()
        .then(() => {
          if (disposed || !handLandmarker) return;
          const result = handLandmarker.detectForVideo(inputCanvas, sample.timestamp);
          const wrist = result.landmarks[0]?.[0];
          if (wrist) {
            setText(handEl, "DETECTED");
            setText(wristXEl, wrist.x.toFixed(3));
            setText(wristYEl, wrist.y.toFixed(3));
            onLandmarks?.({
              landmarks: result.landmarks[0].map(({ x, y, z }) => ({ x, y, z })),
              cameraWidth: sample.cameraWidth,
              cameraHeight: sample.cameraHeight,
              timestamp: sample.timestamp,
            });
          } else {
            resetHandResult();
            onLandmarks?.({
              landmarks: [],
              cameraWidth: sample.cameraWidth,
              cameraHeight: sample.cameraHeight,
              timestamp: sample.timestamp,
            });
          }
        })
        .catch(fail)
        .finally(() => {
          inferenceBusy = false;
        });
    },

    dispose() {
      disposed = true;
      failed = true;
      inferenceBusy = false;
      try {
        handLandmarker?.close();
      } catch (error) {
        console.warn("[hand-debug] Hand Landmarker cleanup failed", error);
      }
      handLandmarker = null;
      renderTarget?.dispose();
      renderTarget = null;
      copyMaterial.dispose();
      copyQuad.geometry.dispose();
      inputCanvas.width = 0;
      inputCanvas.height = 0;
      setText(modelEl, "LOADING");
      resetHandResult();
    },
  };
}
