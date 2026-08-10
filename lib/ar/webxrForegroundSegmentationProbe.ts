import * as THREE from "three";
import type { ImageSegmenter, ImageSegmenterResult } from "@mediapipe/tasks-vision";

import type { XRCameraTextureSample } from "@/lib/ar/webxrHandLandmarkProbe";

const MEDIAPIPE_WASM_ROOT = "/mediapipe/wasm";
const SEGMENT_MODEL_URL = "/mediapipe/selfie_segmenter.tflite";
const MAX_INPUT_SIZE = 256;
const INFERENCE_INTERVAL_MS = 200;
const FOREGROUND_CONFIDENCE = 0.5;
const MIN_FOREGROUND_RATIO = 0.005;

export interface WebXRForegroundSegmentationProbe {
  onCameraTexture(sample: XRCameraTextureSample): void;
  dispose(): void;
}

interface ProbeOptions {
  renderer: THREE.WebGLRenderer;
  overlayRoot: HTMLElement;
  debugOverlay: HTMLElement;
}

interface CoverTransform {
  cameraAspect: number;
  viewportAspect: number;
  drawWidth: number;
  drawHeight: number;
  offsetX: number;
  offsetY: number;
}

function calculateCoverTransform(
  cameraWidth: number,
  cameraHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): CoverTransform {
  const cameraAspect = cameraWidth / cameraHeight;
  const viewportAspect = viewportWidth / viewportHeight;

  if (cameraAspect > viewportAspect) {
    const drawHeight = viewportHeight;
    const drawWidth = drawHeight * cameraAspect;
    return {
      cameraAspect,
      viewportAspect,
      drawWidth,
      drawHeight,
      offsetX: (viewportWidth - drawWidth) / 2,
      offsetY: 0,
    };
  }

  const drawWidth = viewportWidth;
  const drawHeight = drawWidth / cameraAspect;
  return {
    cameraAspect,
    viewportAspect,
    drawWidth,
    drawHeight,
    offsetX: 0,
    offsetY: (viewportHeight - drawHeight) / 2,
  };
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const t = THREE.MathUtils.clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * XR camera foreground만 DOM overlay에 다시 그리는 segmentation 기술 probe.
 * Three.js scene, hit-test, 공정 상태에는 연결하지 않는다.
 */
export function createWebXRForegroundSegmentationProbe({
  renderer,
  overlayRoot,
  debugOverlay,
}: ProbeOptions): WebXRForegroundSegmentationProbe {
  const cameraEl = debugOverlay.querySelector<HTMLElement>("[data-segment-camera]");
  const modelEl = debugOverlay.querySelector<HTMLElement>("[data-segment-model]");
  const foregroundEl = debugOverlay.querySelector<HTMLElement>("[data-segment-foreground]");
  const maskEl = debugOverlay.querySelector<HTMLElement>("[data-segment-mask]");
  const overlayEl = debugOverlay.querySelector<HTMLElement>("[data-segment-overlay]");
  const fpsEl = debugOverlay.querySelector<HTMLElement>("[data-segment-fps]");
  const cameraSizeEl = debugOverlay.querySelector<HTMLElement>("[data-segment-camera-size]");
  const viewportSizeEl = debugOverlay.querySelector<HTMLElement>("[data-segment-viewport-size]");
  const offsetEl = debugOverlay.querySelector<HTMLElement>("[data-segment-offset]");
  const maskPreview = debugOverlay.querySelector<HTMLCanvasElement>("[data-segment-mask-preview]");
  const maskPreviewContext = maskPreview?.getContext("2d") ?? null;

  const overlayCanvas = document.createElement("canvas");
  overlayCanvas.className = "segment-foreground-overlay";
  overlayCanvas.setAttribute("aria-hidden", "true");
  const maybeOverlayContext = overlayCanvas.getContext("2d");
  if (!maybeOverlayContext) throw new Error("2D segmentation overlay canvas is unavailable");
  const overlayContext = maybeOverlayContext;
  overlayRoot.appendChild(overlayCanvas);

  const inputCanvas = document.createElement("canvas");
  const maybeInputContext = inputCanvas.getContext("2d");
  if (!maybeInputContext) throw new Error("2D segmentation input canvas is unavailable");
  const inputContext = maybeInputContext;

  const foregroundCanvas = document.createElement("canvas");
  const maybeForegroundContext = foregroundCanvas.getContext("2d");
  if (!maybeForegroundContext) throw new Error("2D foreground canvas is unavailable");
  const foregroundContext = maybeForegroundContext;

  const copyScene = new THREE.Scene();
  const copyCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const copyMaterial = new THREE.MeshBasicMaterial({ depthTest: false, depthWrite: false });
  copyMaterial.toneMapped = false;
  const copyQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), copyMaterial);
  copyScene.add(copyQuad);

  let renderTarget: THREE.WebGLRenderTarget | null = null;
  let readPixels = new Uint8Array(0);
  let topDownPixels = new Uint8ClampedArray(0);
  let foregroundPixels = new Uint8ClampedArray(0);
  let imageSegmenter: ImageSegmenter | null = null;
  let personMaskIndex = 1;
  let disposed = false;
  let failed = false;
  let inferenceBusy = false;
  let lastInferenceAt = -Infinity;
  let lastCompletedAt = -Infinity;
  let measuredFps = 0;
  let errorLogged = false;

  function setText(element: HTMLElement | null, text: string) {
    if (element && element.textContent !== text) element.textContent = text;
  }

  function setOverlayActive(active: boolean) {
    overlayCanvas.style.display = active ? "block" : "none";
    setText(overlayEl, active ? "ACTIVE" : "INACTIVE");
  }

  function resetForeground() {
    overlayContext.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    setOverlayActive(false);
    setText(foregroundEl, "NOT DETECTED");
  }

  function fail(error: unknown) {
    if (disposed) return;
    failed = true;
    inferenceBusy = false;
    setText(modelEl, "ERROR");
    setText(maskEl, "ERROR");
    resetForeground();
    if (!errorLogged) {
      errorLogged = true;
      console.warn("[segment-debug] Foreground segmentation probe failed", error);
    }
  }

  function ensureInputSize(cameraWidth: number, cameraHeight: number) {
    const scale = MAX_INPUT_SIZE / Math.max(cameraWidth, cameraHeight);
    const width = Math.max(1, Math.round(cameraWidth * scale));
    const height = Math.max(1, Math.round(cameraHeight * scale));

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
    foregroundCanvas.width = width;
    foregroundCanvas.height = height;
    readPixels = new Uint8Array(width * height * 4);
    topDownPixels = new Uint8ClampedArray(width * height * 4);
    foregroundPixels = new Uint8ClampedArray(width * height * 4);
  }

  function copyTextureToInput(sample: XRCameraTextureSample) {
    ensureInputSize(sample.cameraWidth, sample.cameraHeight);
    if (!renderTarget) throw new Error("Segmentation render target was not created");

    const previousTarget = renderer.getRenderTarget();
    const previousXrEnabled = renderer.xr.enabled;
    const mapWasEmpty = copyMaterial.map === null;
    copyMaterial.map = sample.texture;
    if (mapWasEmpty) copyMaterial.needsUpdate = true;

    try {
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

  function sampleMask(
    values: Float32Array,
    maskWidth: number,
    maskHeight: number,
    x: number,
    y: number,
    targetWidth: number,
    targetHeight: number,
  ) {
    const maskX = Math.min(maskWidth - 1, Math.floor((x / targetWidth) * maskWidth));
    const maskY = Math.min(maskHeight - 1, Math.floor((y / targetHeight) * maskHeight));
    return values[maskY * maskWidth + maskX] ?? 0;
  }

  function updateMaskPreview(values: Float32Array, maskWidth: number, maskHeight: number) {
    if (!maskPreview || !maskPreviewContext) return;

    const preview = maskPreviewContext.createImageData(maskPreview.width, maskPreview.height);
    for (let y = 0; y < maskPreview.height; y++) {
      for (let x = 0; x < maskPreview.width; x++) {
        const confidence = sampleMask(
          values,
          maskWidth,
          maskHeight,
          x,
          y,
          maskPreview.width,
          maskPreview.height,
        );
        const value = Math.round(THREE.MathUtils.clamp(confidence, 0, 1) * 255);
        const index = (y * maskPreview.width + x) * 4;
        preview.data[index] = value;
        preview.data[index + 1] = value;
        preview.data[index + 2] = value;
        preview.data[index + 3] = 255;
      }
    }
    maskPreviewContext.putImageData(preview, 0, 0);
  }

  function compositeForeground(result: ImageSegmenterResult, sample: XRCameraTextureSample) {
    if (!renderTarget) throw new Error("Segmentation input is unavailable");

    const masks = result.confidenceMasks;
    const mask = masks?.[personMaskIndex] ?? (masks?.length === 1 ? masks[0] : undefined);
    if (!mask) throw new Error("Person confidence mask is unavailable");

    const values = mask.getAsFloat32Array();
    const width = renderTarget.width;
    const height = renderTarget.height;
    let foregroundCount = 0;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const pixel = y * width + x;
        const rgba = pixel * 4;
        const confidence = sampleMask(values, mask.width, mask.height, x, y, width, height);
        const alpha = smoothstep(0.3, 0.7, confidence);

        foregroundPixels[rgba] = topDownPixels[rgba];
        foregroundPixels[rgba + 1] = topDownPixels[rgba + 1];
        foregroundPixels[rgba + 2] = topDownPixels[rgba + 2];
        foregroundPixels[rgba + 3] = Math.round(alpha * 255);
        if (confidence >= FOREGROUND_CONFIDENCE) foregroundCount++;
      }
    }

    foregroundContext.putImageData(new ImageData(foregroundPixels, width, height), 0, 0);
    updateMaskPreview(values, mask.width, mask.height);

    const viewportRect = overlayRoot.getBoundingClientRect();
    const viewportWidth = Math.max(1, Math.round(viewportRect.width));
    const viewportHeight = Math.max(1, Math.round(viewportRect.height));
    if (overlayCanvas.width !== viewportWidth || overlayCanvas.height !== viewportHeight) {
      overlayCanvas.width = viewportWidth;
      overlayCanvas.height = viewportHeight;
    }

    const transform = calculateCoverTransform(
      sample.cameraWidth,
      sample.cameraHeight,
      viewportWidth,
      viewportHeight,
    );
    setText(cameraSizeEl, `${sample.cameraWidth}x${sample.cameraHeight}`);
    setText(viewportSizeEl, `${viewportWidth}x${viewportHeight}`);
    setText(offsetEl, `${transform.offsetX.toFixed(1)}, ${transform.offsetY.toFixed(1)}`);

    overlayContext.clearRect(0, 0, viewportWidth, viewportHeight);
    overlayContext.imageSmoothingEnabled = true;
    overlayContext.drawImage(
      foregroundCanvas,
      transform.offsetX,
      transform.offsetY,
      transform.drawWidth,
      transform.drawHeight,
    );

    const foregroundDetected = foregroundCount / (width * height) >= MIN_FOREGROUND_RATIO;
    setText(maskEl, "OK");
    setText(foregroundEl, foregroundDetected ? "DETECTED" : "NOT DETECTED");
    setOverlayActive(foregroundDetected);

    if (Number.isFinite(lastCompletedAt)) {
      const instantFps = 1000 / Math.max(1, sample.timestamp - lastCompletedAt);
      measuredFps = measuredFps === 0 ? instantFps : measuredFps * 0.75 + instantFps * 0.25;
    }
    lastCompletedAt = sample.timestamp;
    setText(fpsEl, measuredFps.toFixed(1));
  }

  setText(cameraEl, "UNAVAILABLE");
  setText(modelEl, "LOADING");
  setText(foregroundEl, "NOT DETECTED");
  setText(maskEl, "ERROR");
  setText(fpsEl, "0.0");
  setOverlayActive(false);

  void (async () => {
    try {
      const { FilesetResolver, ImageSegmenter } = await import("@mediapipe/tasks-vision");
      const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_ROOT);
      const model = await ImageSegmenter.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: SEGMENT_MODEL_URL,
          delegate: "CPU",
        },
        runningMode: "VIDEO",
        outputConfidenceMasks: true,
        outputCategoryMask: false,
      });

      if (disposed) {
        model.close();
        return;
      }

      const labels = model.getLabels();
      const detectedPersonIndex = labels.findIndex((label) => /person|foreground/i.test(label));
      personMaskIndex = detectedPersonIndex >= 0 ? detectedPersonIndex : labels.length > 1 ? 1 : 0;
      imageSegmenter = model;
      setText(modelEl, "READY");
    } catch (error) {
      if (!disposed) fail(error);
    }
  })();

  return {
    onCameraTexture(sample) {
      if (disposed || failed) return;

      setText(cameraEl, sample.cameraWidth > 0 && sample.cameraHeight > 0 ? "READY" : "UNAVAILABLE");
      if (
        !imageSegmenter ||
        inferenceBusy ||
        sample.cameraWidth <= 0 ||
        sample.cameraHeight <= 0 ||
        sample.timestamp - lastInferenceAt < INFERENCE_INTERVAL_MS
      ) {
        return;
      }

      inferenceBusy = true;
      lastInferenceAt = sample.timestamp;

      try {
        copyTextureToInput(sample);
      } catch (error) {
        inferenceBusy = false;
        fail(error);
        return;
      }

      void Promise.resolve()
        .then(() => {
          if (disposed || !imageSegmenter) return;
          imageSegmenter.segmentForVideo(inputCanvas, sample.timestamp, (result) => {
            compositeForeground(result, sample);
          });
        })
        .catch(fail)
        .finally(() => {
          inferenceBusy = false;
        });
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      failed = true;
      inferenceBusy = false;
      try {
        imageSegmenter?.close();
      } catch (error) {
        console.warn("[segment-debug] Image Segmenter cleanup failed", error);
      }
      imageSegmenter = null;
      renderTarget?.dispose();
      renderTarget = null;
      copyMaterial.dispose();
      copyQuad.geometry.dispose();
      overlayContext.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
      overlayCanvas.remove();
      inputCanvas.width = 0;
      inputCanvas.height = 0;
      foregroundCanvas.width = 0;
      foregroundCanvas.height = 0;
      if (maskPreview && maskPreviewContext) {
        maskPreviewContext.clearRect(0, 0, maskPreview.width, maskPreview.height);
      }
      setText(cameraEl, "UNAVAILABLE");
      setText(modelEl, "LOADING");
      setText(maskEl, "ERROR");
      setText(fpsEl, "0.0");
      resetForeground();
    },
  };
}
