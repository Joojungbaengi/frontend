type XRViewWithCamera = XRView & { camera?: unknown | null };
type XRSessionWithFeatures = XRSession & { enabledFeatures?: readonly string[] };
type XRManagerWithCameraAccess = {
  getCameraTexture(camera: unknown): unknown;
};
type CameraTextureRenderer = { xr: XRManagerWithCameraAccess };

export interface WebXRCameraAccessProbe {
  onXRFrame(frame: XRFrame): void;
  dispose(): void;
}

interface ProbeOptions {
  session: XRSession;
  renderer: CameraTextureRenderer;
  referenceSpace: XRReferenceSpace;
  overlay: HTMLElement;
}

/**
 * Raw Camera Access 1차 기술 스파이크.
 * 카메라 텍스처의 존재만 확인하며 픽셀을 읽거나 Three.js 씬에 연결하지 않는다.
 */
export function createWebXRCameraAccessProbe({
  session,
  renderer,
  referenceSpace,
  overlay,
}: ProbeOptions): WebXRCameraAccessProbe {
  const accessEl = overlay.querySelector<HTMLElement>("[data-camera-access]");
  const xrCameraEl = overlay.querySelector<HTMLElement>("[data-xr-camera]");
  const textureEl = overlay.querySelector<HTMLElement>("[data-camera-texture]");

  let disposed = false;
  let textureAttempted = false;
  let errorLogged = false;

  const enabledFeatures = (session as XRSessionWithFeatures).enabledFeatures;
  const featureGranted = enabledFeatures?.includes("camera-access") ?? false;

  function setText(element: HTMLElement | null, text: string) {
    if (element && element.textContent !== text) element.textContent = text;
  }

  setText(accessEl, featureGranted ? "GRANTED" : "UNAVAILABLE");
  setText(xrCameraEl, "NULL");
  setText(textureEl, "ERROR");

  return {
    onXRFrame(frame) {
      if (disposed || textureAttempted) return;

      try {
        const pose = frame.getViewerPose(referenceSpace);
        const view = pose?.views.find((candidate) => "camera" in candidate) as
          | XRViewWithCamera
          | undefined;
        const xrCamera = view?.camera;

        if (!xrCamera) {
          setText(xrCameraEl, "NULL");
          return;
        }

        // view.camera는 camera-access가 실제로 부여된 세션에서만 제공된다.
        setText(accessEl, "GRANTED");
        setText(xrCameraEl, "AVAILABLE");

        // 불투명 텍스처는 보관하지 않고, 최초 1회 호출 결과만 확인한다.
        textureAttempted = true;
        const texture = renderer.xr.getCameraTexture(xrCamera);
        if (texture) {
          setText(textureEl, "OK");
        } else {
          setText(textureEl, "ERROR");
        }
      } catch (error) {
        setText(textureEl, "ERROR");
        if (!errorLogged) {
          errorLogged = true;
          console.warn("[hand-debug] WebXR camera texture probe failed", error);
        }
      }
    },

    dispose() {
      disposed = true;
      textureAttempted = false;
      setText(accessEl, "UNAVAILABLE");
      setText(xrCameraEl, "NULL");
      setText(textureEl, "ERROR");
    },
  };
}
