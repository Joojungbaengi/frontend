import * as THREE from "three";

export interface WebXRDepthOcclusionProbe {
  onXRFrame(frame: XRFrame): void;
  dispose(): void;
}

interface ProbeOptions {
  session: XRSession;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  referenceSpace: XRReferenceSpace;
  overlay: HTMLElement;
}

const TEST_CUBE_SIZE_METERS = 0.18;
const TEST_CUBE_DISTANCE_METERS = 0.8;

/**
 * WebXR Depth Sensing의 Three.js 내장 GPU occlusion 경로만 검증한다.
 * 현실 depth를 직접 읽거나 별도 shader로 처리하지 않으며, 테스트 cube 외 scene 상태는 건드리지 않는다.
 */
export function createWebXRDepthOcclusionProbe({
  session,
  renderer,
  scene,
  referenceSpace,
  overlay,
}: ProbeOptions): WebXRDepthOcclusionProbe {
  const featureEl = overlay.querySelector<HTMLElement>("[data-depth-feature]");
  const sensingEl = overlay.querySelector<HTMLElement>("[data-depth-sensing]");
  const textureEl = overlay.querySelector<HTMLElement>("[data-depth-texture]");
  const occlusionEl = overlay.querySelector<HTMLElement>("[data-occlusion-test]");
  const usageEl = overlay.querySelector<HTMLElement>("[data-depth-usage]");
  const formatEl = overlay.querySelector<HTMLElement>("[data-depth-format]");
  const typeEl = overlay.querySelector<HTMLElement>("[data-depth-type]");

  const geometry = new THREE.BoxGeometry(
    TEST_CUBE_SIZE_METERS,
    TEST_CUBE_SIZE_METERS,
    TEST_CUBE_SIZE_METERS,
  );
  const material = new THREE.MeshBasicMaterial({
    color: 0xff2bd6,
    depthTest: true,
    depthWrite: true,
  });
  const cube = new THREE.Mesh(geometry, material);
  cube.visible = false;
  cube.name = "depth-occlusion-debug-cube";
  scene.add(cube);

  const featureGranted = session.enabledFeatures?.includes("depth-sensing") ?? false;
  let disposed = false;
  let cubePlaced = false;
  let errorLogged = false;

  function setText(element: HTMLElement | null, text: string) {
    if (element && element.textContent !== text) element.textContent = text;
  }

  function updateSessionDetails() {
    setText(usageEl, session.depthUsage ?? "UNAVAILABLE");
    setText(formatEl, session.depthDataFormat ?? "UNAVAILABLE");
    setText(typeEl, session.depthType ?? "UNAVAILABLE");
  }

  function placeCube(frame: XRFrame) {
    if (cubePlaced) return;

    const pose = frame.getViewerPose(referenceSpace);
    if (!pose) return;

    const { position, orientation } = pose.transform;
    const viewerPosition = new THREE.Vector3(position.x, position.y, position.z);
    const viewerOrientation = new THREE.Quaternion(
      orientation.x,
      orientation.y,
      orientation.z,
      orientation.w,
    );
    const offset = new THREE.Vector3(0, -0.05, -TEST_CUBE_DISTANCE_METERS)
      .applyQuaternion(viewerOrientation);

    cube.position.copy(viewerPosition).add(offset);
    cube.quaternion.copy(viewerOrientation);
    cube.updateMatrixWorld(true);
    cubePlaced = true;
  }

  setText(featureEl, featureGranted ? "GRANTED" : "UNAVAILABLE");
  setText(sensingEl, "UNAVAILABLE");
  setText(textureEl, "NULL");
  setText(occlusionEl, "INACTIVE");
  updateSessionDetails();

  return {
    onXRFrame(frame) {
      if (disposed) return;

      updateSessionDetails();

      try {
        const depthAvailable = featureGranted && renderer.xr.hasDepthSensing();
        const depthTexture = depthAvailable ? renderer.xr.getDepthTexture() : null;

        setText(sensingEl, depthAvailable ? "AVAILABLE" : "UNAVAILABLE");
        setText(textureEl, depthTexture ? "OK" : "NULL");

        if (depthAvailable && depthTexture) {
          placeCube(frame);
          cube.visible = cubePlaced;
        } else {
          cube.visible = false;
        }

        setText(occlusionEl, cube.visible ? "ACTIVE" : "INACTIVE");
      } catch (error) {
        cube.visible = false;
        setText(sensingEl, "UNAVAILABLE");
        setText(textureEl, "NULL");
        setText(occlusionEl, "INACTIVE");

        if (!errorLogged) {
          errorLogged = true;
          console.warn("[depth-debug] WebXR depth occlusion probe failed", error);
        }
      }
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      cube.visible = false;
      scene.remove(cube);
      geometry.dispose();
      material.dispose();
      setText(sensingEl, "UNAVAILABLE");
      setText(textureEl, "NULL");
      setText(occlusionEl, "INACTIVE");
    },
  };
}
