import * as THREE from "three";

import type { XRHandLandmarkSample } from "@/lib/ar/webxrHandLandmarkProbe";

// All size values are ratios of palmWidth = distance(index MCP, pinky MCP).
// Keeping them together makes on-device silhouette tuning straightforward.
const MASK_TUNING = {
  palmExpansion: 0.15,
  thumbBaseRadius: 0.145,
  thumbTipRadius: 0.105,
  indexBaseRadius: 0.12,
  indexTipRadius: 0.085,
  middleBaseRadius: 0.13,
  middleTipRadius: 0.095,
  ringBaseRadius: 0.115,
  ringTipRadius: 0.08,
  pinkyBaseRadius: 0.1,
  pinkyTipRadius: 0.07,
  jointExpansion: 1.1,
  fingertipExtension: 0.65,
  wristWidthRatio: 0.56,
  wristLengthRatio: 0.5,
  smoothing: 0.3,
  landmarkTimeout: 300,
} as const;

const CIRCLE_SEGMENTS = 8;
const MAX_VERTICES = 2048;
const MAX_OUTLINE_VERTICES = 512;

const PALM_INDICES = [0, 5, 9, 13, 17] as const;
const FINGERS = [
  { chain: [1, 2, 3, 4], baseRadius: MASK_TUNING.thumbBaseRadius, tipRadius: MASK_TUNING.thumbTipRadius },
  { chain: [5, 6, 7, 8], baseRadius: MASK_TUNING.indexBaseRadius, tipRadius: MASK_TUNING.indexTipRadius },
  { chain: [9, 10, 11, 12], baseRadius: MASK_TUNING.middleBaseRadius, tipRadius: MASK_TUNING.middleTipRadius },
  { chain: [13, 14, 15, 16], baseRadius: MASK_TUNING.ringBaseRadius, tipRadius: MASK_TUNING.ringTipRadius },
  { chain: [17, 18, 19, 20], baseRadius: MASK_TUNING.pinkyBaseRadius, tipRadius: MASK_TUNING.pinkyTipRadius },
] as const;

interface ProbeOptions {
  renderer: THREE.WebGLRenderer;
  session: XRSession;
  debugOverlay: HTMLElement;
  showOutline?: boolean;
}

interface Point2 {
  x: number;
  y: number;
}

export interface WebXRHandOcclusionProbe {
  onLandmarks(sample: XRHandLandmarkSample): void;
  renderAfterScene(frameTime: number): void;
  dispose(): void;
}

function distance(a: Point2, b: Point2) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Hand Landmarker의 화면 좌표로 만든 geometry를 main scene 이후 투명 RGBA로 그려
 * 해당 XR color attachment 영역에서 passthrough가 드러나게 한다.
 */
export function createWebXRHandOcclusionProbe({
  renderer,
  session,
  debugOverlay,
  showOutline = false,
}: ProbeOptions): WebXRHandOcclusionProbe {
  const modelEl = debugOverlay.querySelector<HTMLElement>("[data-hand-model]");
  const handEl = debugOverlay.querySelector<HTMLElement>("[data-hand]");
  const landmarksEl = debugOverlay.querySelector<HTMLElement>("[data-occlusion-landmarks]");
  const fpsEl = debugOverlay.querySelector<HTMLElement>("[data-occlusion-fps]");
  const ageEl = debugOverlay.querySelector<HTMLElement>("[data-occlusion-age]");
  const maskEl = debugOverlay.querySelector<HTMLElement>("[data-occlusion-mask]");
  const passEl = debugOverlay.querySelector<HTMLElement>("[data-occlusion-pass]");
  const viewportEl = debugOverlay.querySelector<HTMLElement>("[data-occlusion-viewport]");
  const blendModeEl = debugOverlay.querySelector<HTMLElement>("[data-xr-blend-mode]");

  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(MAX_VERTICES * 3);
  const positionAttribute = new THREE.BufferAttribute(positions, 3);
  positionAttribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", positionAttribute);
  geometry.setDrawRange(0, 0);

  const eraserMaterial = new THREE.RawShaderMaterial({
    vertexShader: `
      precision highp float;
      attribute vec3 position;
      uniform mat4 modelViewMatrix;
      uniform mat4 projectionMatrix;
      void main() {
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      void main() {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
      }
    `,
    blending: THREE.NoBlending,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const eraserMesh = new THREE.Mesh(geometry, eraserMaterial);
  eraserMesh.frustumCulled = false;

  const maskScene = new THREE.Scene();
  maskScene.add(eraserMesh);

  const outlineGeometry = new THREE.BufferGeometry();
  const outlinePositions = new Float32Array(MAX_OUTLINE_VERTICES * 3);
  const outlinePositionAttribute = new THREE.BufferAttribute(outlinePositions, 3);
  outlinePositionAttribute.setUsage(THREE.DynamicDrawUsage);
  outlineGeometry.setAttribute("position", outlinePositionAttribute);
  outlineGeometry.setDrawRange(0, 0);

  let outlineMaterial: THREE.LineBasicMaterial | null = null;
  if (showOutline) {
    outlineMaterial = new THREE.LineBasicMaterial({
      color: 0xff1acc,
      depthTest: false,
      depthWrite: false,
      transparent: false,
      toneMapped: false,
    });
    const outline = new THREE.LineSegments(outlineGeometry, outlineMaterial);
    outline.frustumCulled = false;
    outline.renderOrder = 1;
    maskScene.add(outline);
  }

  const maskCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const targetLandmarks = Array.from({ length: 21 }, () => new THREE.Vector2());
  const currentLandmarks = Array.from({ length: 21 }, () => new THREE.Vector2());

  let disposed = false;
  let hasTarget = false;
  let currentInitialized = false;
  let cameraWidth = 0;
  let cameraHeight = 0;
  let lastLandmarkAt = -Infinity;
  let lastSampleAt = -Infinity;
  let measuredFps = 0;
  let vertexCount = 0;
  let errorLogged = false;

  function setText(element: HTMLElement | null, text: string) {
    if (element && element.textContent !== text) element.textContent = text;
  }

  function setInactive() {
    geometry.setDrawRange(0, 0);
    outlineGeometry.setDrawRange(0, 0);
    setText(maskEl, "INACTIVE");
    setText(passEl, "INACTIVE");
  }

  function addVertex(point: Point2, viewportWidth: number, viewportHeight: number) {
    if (vertexCount >= MAX_VERTICES) return;
    const offset = vertexCount * 3;
    positions[offset] = (point.x / viewportWidth) * 2 - 1;
    positions[offset + 1] = 1 - (point.y / viewportHeight) * 2;
    positions[offset + 2] = 0;
    vertexCount++;
  }

  function addTriangle(a: Point2, b: Point2, c: Point2, width: number, height: number) {
    addVertex(a, width, height);
    addVertex(b, width, height);
    addVertex(c, width, height);
  }

  function addCircle(center: Point2, radius: number, width: number, height: number) {
    for (let index = 0; index < CIRCLE_SEGMENTS; index++) {
      const angleA = (index / CIRCLE_SEGMENTS) * Math.PI * 2;
      const angleB = ((index + 1) / CIRCLE_SEGMENTS) * Math.PI * 2;
      addTriangle(
        center,
        { x: center.x + Math.cos(angleA) * radius, y: center.y + Math.sin(angleA) * radius },
        { x: center.x + Math.cos(angleB) * radius, y: center.y + Math.sin(angleB) * radius },
        width,
        height,
      );
    }
  }

  function addTaperedCapsule(
    a: Point2,
    b: Point2,
    startRadius: number,
    endRadius: number,
    width: number,
    height: number,
  ) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length < 0.001) return;
    const normalX = -dy / length;
    const normalY = dx / length;
    const aLeft = { x: a.x + normalX * startRadius, y: a.y + normalY * startRadius };
    const aRight = { x: a.x - normalX * startRadius, y: a.y - normalY * startRadius };
    const bLeft = { x: b.x + normalX * endRadius, y: b.y + normalY * endRadius };
    const bRight = { x: b.x - normalX * endRadius, y: b.y - normalY * endRadius };
    addTriangle(aLeft, aRight, bLeft, width, height);
    addTriangle(aRight, bRight, bLeft, width, height);
  }

  let outlineVertexCount = 0;

  function addOutlineVertex(point: Point2, viewportWidth: number, viewportHeight: number) {
    if (!showOutline || outlineVertexCount >= MAX_OUTLINE_VERTICES) return;
    const offset = outlineVertexCount * 3;
    outlinePositions[offset] = (point.x / viewportWidth) * 2 - 1;
    outlinePositions[offset + 1] = 1 - (point.y / viewportHeight) * 2;
    outlinePositions[offset + 2] = 0;
    outlineVertexCount++;
  }

  function addOutlineSegment(
    a: Point2,
    b: Point2,
    viewportWidth: number,
    viewportHeight: number,
  ) {
    addOutlineVertex(a, viewportWidth, viewportHeight);
    addOutlineVertex(b, viewportWidth, viewportHeight);
  }

  function addOutlineCircle(
    center: Point2,
    radius: number,
    viewportWidth: number,
    viewportHeight: number,
  ) {
    if (!showOutline) return;
    for (let index = 0; index < CIRCLE_SEGMENTS; index++) {
      const angleA = (index / CIRCLE_SEGMENTS) * Math.PI * 2;
      const angleB = ((index + 1) / CIRCLE_SEGMENTS) * Math.PI * 2;
      addOutlineSegment(
        { x: center.x + Math.cos(angleA) * radius, y: center.y + Math.sin(angleA) * radius },
        { x: center.x + Math.cos(angleB) * radius, y: center.y + Math.sin(angleB) * radius },
        viewportWidth,
        viewportHeight,
      );
    }
  }

  function addFingerOutline(
    chain: readonly number[],
    points: Point2[],
    baseRadius: number,
    tipRadius: number,
    viewportWidth: number,
    viewportHeight: number,
  ) {
    if (!showOutline) return;

    const left: Point2[] = [];
    const right: Point2[] = [];
    const radii: number[] = [];
    for (let index = 0; index < chain.length; index++) {
      const ratio = index / (chain.length - 1);
      const radius = THREE.MathUtils.lerp(baseRadius, tipRadius, ratio);
      const point = points[chain[index]];
      const previous = points[chain[Math.max(0, index - 1)]];
      const next = points[chain[Math.min(chain.length - 1, index + 1)]];
      const dx = next.x - previous.x;
      const dy = next.y - previous.y;
      const length = Math.max(0.001, Math.hypot(dx, dy));
      const normalX = -dy / length;
      const normalY = dx / length;
      left.push({ x: point.x + normalX * radius, y: point.y + normalY * radius });
      right.push({ x: point.x - normalX * radius, y: point.y - normalY * radius });
      radii.push(radius);
    }

    for (let index = 0; index < left.length - 1; index++) {
      addOutlineSegment(left[index], left[index + 1], viewportWidth, viewportHeight);
      addOutlineSegment(right[index], right[index + 1], viewportWidth, viewportHeight);
    }

    const tip = points[chain[chain.length - 1]];
    const previousTip = points[chain[chain.length - 2]];
    const directionX = tip.x - previousTip.x;
    const directionY = tip.y - previousTip.y;
    const directionLength = Math.max(0.001, Math.hypot(directionX, directionY));
    const extendedTip = {
      x: tip.x + (directionX / directionLength) * tipRadius * MASK_TUNING.fingertipExtension,
      y: tip.y + (directionY / directionLength) * tipRadius * MASK_TUNING.fingertipExtension,
    };
    addOutlineSegment(left[left.length - 1], extendedTip, viewportWidth, viewportHeight);
    addOutlineSegment(right[right.length - 1], extendedTip, viewportWidth, viewportHeight);
    addOutlineCircle(extendedTip, radii[radii.length - 1], viewportWidth, viewportHeight);
  }

  function buildGeometry(viewportWidth: number, viewportHeight: number) {
    if (!hasTarget || cameraWidth <= 0 || cameraHeight <= 0) {
      setInactive();
      return false;
    }

    for (let index = 0; index < 21; index++) {
      currentLandmarks[index].lerp(targetLandmarks[index], MASK_TUNING.smoothing);
    }

    const cameraAspect = cameraWidth / cameraHeight;
    const viewportAspect = viewportWidth / viewportHeight;
    let drawWidth: number;
    let drawHeight: number;
    let offsetX: number;
    let offsetY: number;
    if (cameraAspect > viewportAspect) {
      drawHeight = viewportHeight;
      drawWidth = drawHeight * cameraAspect;
      offsetX = (viewportWidth - drawWidth) / 2;
      offsetY = 0;
    } else {
      drawWidth = viewportWidth;
      drawHeight = drawWidth / cameraAspect;
      offsetX = 0;
      offsetY = (viewportHeight - drawHeight) / 2;
    }

    const points = currentLandmarks.map((landmark) => ({
      x: offsetX + landmark.x * drawWidth,
      y: offsetY + landmark.y * drawHeight,
    }));
    const palmWidth = Math.max(1, distance(points[5], points[17]));

    vertexCount = 0;
    outlineVertexCount = 0;

    const palmCenter = PALM_INDICES.reduce(
      (center, index) => {
        center.x += points[index].x / PALM_INDICES.length;
        center.y += points[index].y / PALM_INDICES.length;
        return center;
      },
      { x: 0, y: 0 },
    );
    const expandedPalm = PALM_INDICES.map((index) => ({
      x: palmCenter.x + (points[index].x - palmCenter.x) * (1 + MASK_TUNING.palmExpansion),
      y: palmCenter.y + (points[index].y - palmCenter.y) * (1 + MASK_TUNING.palmExpansion),
    }));
    for (let index = 0; index < expandedPalm.length; index++) {
      addTriangle(
        palmCenter,
        expandedPalm[index],
        expandedPalm[(index + 1) % expandedPalm.length],
        viewportWidth,
        viewportHeight,
      );
    }

    for (const finger of FINGERS) {
      const baseRadius = Math.max(2, palmWidth * finger.baseRadius);
      const tipRadius = Math.max(2, palmWidth * finger.tipRadius);
      const chain = finger.chain;
      const jointRadii: number[] = [];
      for (let index = 0; index < chain.length - 1; index++) {
        const startRadius = THREE.MathUtils.lerp(
          baseRadius,
          tipRadius,
          index / (chain.length - 1),
        );
        const endRadius = THREE.MathUtils.lerp(
          baseRadius,
          tipRadius,
          (index + 1) / (chain.length - 1),
        );
        jointRadii[index] = startRadius;
        if (index === chain.length - 2) jointRadii[index + 1] = endRadius;
        addTaperedCapsule(
          points[chain[index]],
          points[chain[index + 1]],
          startRadius,
          endRadius,
          viewportWidth,
          viewportHeight,
        );
      }
      for (let index = 0; index < chain.length; index++) {
        addCircle(
          points[chain[index]],
          jointRadii[index] * MASK_TUNING.jointExpansion,
          viewportWidth,
          viewportHeight,
        );
      }

      const tip = points[chain[chain.length - 1]];
      const previousTip = points[chain[chain.length - 2]];
      const tipDirectionX = tip.x - previousTip.x;
      const tipDirectionY = tip.y - previousTip.y;
      const tipDirectionLength = Math.max(0.001, Math.hypot(tipDirectionX, tipDirectionY));
      const extendedTip = {
        x: tip.x + (tipDirectionX / tipDirectionLength) * tipRadius * MASK_TUNING.fingertipExtension,
        y: tip.y + (tipDirectionY / tipDirectionLength) * tipRadius * MASK_TUNING.fingertipExtension,
      };
      addTaperedCapsule(tip, extendedTip, tipRadius, tipRadius, viewportWidth, viewportHeight);
      addCircle(extendedTip, tipRadius, viewportWidth, viewportHeight);
      addFingerOutline(chain, points, baseRadius, tipRadius, viewportWidth, viewportHeight);
    }

    // The thumb CMC is intentionally joined to the palm separately: it is wider and
    // angled differently from the four fingers, so this prevents a visible gap at its base.
    addTaperedCapsule(
      points[0],
      points[1],
      palmWidth * MASK_TUNING.thumbBaseRadius * 0.8,
      palmWidth * MASK_TUNING.thumbBaseRadius,
      viewportWidth,
      viewportHeight,
    );

    const knuckleCenter = [5, 9, 13, 17].reduce(
      (center, index) => {
        center.x += points[index].x / 4;
        center.y += points[index].y / 4;
        return center;
      },
      { x: 0, y: 0 },
    );
    const wrist = points[0];
    const armX = wrist.x - knuckleCenter.x;
    const armY = wrist.y - knuckleCenter.y;
    const armLength = Math.max(1, Math.hypot(armX, armY));
    const directionX = armX / armLength;
    const directionY = armY / armLength;
    const perpendicularX = -directionY;
    const perpendicularY = directionX;
    const farCenter = {
      x: wrist.x + directionX * palmWidth * MASK_TUNING.wristLengthRatio,
      y: wrist.y + directionY * palmWidth * MASK_TUNING.wristLengthRatio,
    };
    const nearHalfWidth = palmWidth * MASK_TUNING.wristWidthRatio * 0.5;
    const farHalfWidth = nearHalfWidth * 0.86;
    const nearLeft = {
      x: wrist.x + perpendicularX * nearHalfWidth,
      y: wrist.y + perpendicularY * nearHalfWidth,
    };
    const nearRight = {
      x: wrist.x - perpendicularX * nearHalfWidth,
      y: wrist.y - perpendicularY * nearHalfWidth,
    };
    const farLeft = {
      x: farCenter.x + perpendicularX * farHalfWidth,
      y: farCenter.y + perpendicularY * farHalfWidth,
    };
    const farRight = {
      x: farCenter.x - perpendicularX * farHalfWidth,
      y: farCenter.y - perpendicularY * farHalfWidth,
    };
    addTriangle(nearLeft, nearRight, farLeft, viewportWidth, viewportHeight);
    addTriangle(nearRight, farRight, farLeft, viewportWidth, viewportHeight);
    addCircle(wrist, nearHalfWidth, viewportWidth, viewportHeight);
    addCircle(farCenter, farHalfWidth, viewportWidth, viewportHeight);

    // Debug contour deliberately omits triangle edges and bone boundaries. It traces
    // the palm sides and the short wrist cap, while each finger helper traces its outline.
    addOutlineSegment(expandedPalm[0], expandedPalm[1], viewportWidth, viewportHeight);
    addOutlineSegment(expandedPalm[3], expandedPalm[4], viewportWidth, viewportHeight);
    addOutlineSegment(nearLeft, farLeft, viewportWidth, viewportHeight);
    addOutlineSegment(farLeft, farRight, viewportWidth, viewportHeight);
    addOutlineSegment(farRight, nearRight, viewportWidth, viewportHeight);

    geometry.setDrawRange(0, vertexCount);
    positionAttribute.needsUpdate = true;
    outlineGeometry.setDrawRange(0, outlineVertexCount);
    outlinePositionAttribute.needsUpdate = true;
    setText(maskEl, vertexCount > 0 ? "ACTIVE" : "INACTIVE");
    return vertexCount > 0;
  }

  setText(blendModeEl, session.environmentBlendMode ?? "UNKNOWN");
  setText(landmarksEl, "0");
  setText(fpsEl, "0.0");
  setText(ageEl, "0 ms");
  setInactive();

  return {
    onLandmarks(sample) {
      if (disposed) return;

      if (Number.isFinite(lastSampleAt)) {
        const instantFps = 1000 / Math.max(1, sample.timestamp - lastSampleAt);
        measuredFps = measuredFps === 0 ? instantFps : measuredFps * 0.75 + instantFps * 0.25;
      }
      lastSampleAt = sample.timestamp;
      setText(fpsEl, measuredFps.toFixed(1));
      setText(modelEl, "READY");

      if (sample.landmarks.length !== 21) {
        hasTarget = false;
        currentInitialized = false;
        setText(handEl, "NOT DETECTED");
        setText(landmarksEl, "0");
        setInactive();
        return;
      }

      cameraWidth = sample.cameraWidth;
      cameraHeight = sample.cameraHeight;
      lastLandmarkAt = sample.timestamp;
      hasTarget = true;
      setText(handEl, "DETECTED");
      setText(landmarksEl, "21");

      for (let index = 0; index < 21; index++) {
        const landmark = sample.landmarks[index];
        targetLandmarks[index].set(landmark.x, landmark.y);
        if (!currentInitialized) currentLandmarks[index].copy(targetLandmarks[index]);
      }
      currentInitialized = true;
    },

    renderAfterScene(frameTime) {
      if (disposed) return;

      const landmarkAge = Number.isFinite(lastLandmarkAt)
        ? Math.max(0, frameTime - lastLandmarkAt)
        : 0;
      setText(ageEl, `${Math.round(landmarkAge)} ms`);
      if (!hasTarget || landmarkAge > MASK_TUNING.landmarkTimeout) {
        hasTarget = false;
        currentInitialized = false;
        setText(handEl, "NOT DETECTED");
        setText(landmarksEl, "0");
        setInactive();
        return;
      }

      const xrCamera = renderer.xr.getCamera();
      const subCamera = xrCamera.cameras[0];
      const viewport = subCamera?.viewport;
      if (!viewport || viewport.z <= 0 || viewport.w <= 0) {
        setText(viewportEl, "0x0");
        setInactive();
        return;
      }

      const viewportWidth = viewport.z;
      const viewportHeight = viewport.w;
      setText(viewportEl, `${Math.round(viewportWidth)}x${Math.round(viewportHeight)}`);
      if (!buildGeometry(viewportWidth, viewportHeight)) return;

      const previousXrEnabled = renderer.xr.enabled;
      const previousAutoClear = renderer.autoClear;
      const previousToneMapping = renderer.toneMapping;
      const previousTarget = renderer.getRenderTarget();
      const previousViewport = renderer.getViewport(new THREE.Vector4());
      const previousScissor = renderer.getScissor(new THREE.Vector4());
      const previousScissorTest = renderer.getScissorTest();

      try {
        renderer.xr.enabled = false;
        renderer.autoClear = false;
        renderer.toneMapping = THREE.NoToneMapping;
        renderer.setViewport(viewport.x, viewport.y, viewportWidth, viewportHeight);
        renderer.setScissor(viewport.x, viewport.y, viewportWidth, viewportHeight);
        renderer.setScissorTest(true);
        renderer.render(maskScene, maskCamera);
        setText(passEl, "ACTIVE");
      } catch (error) {
        setText(passEl, "INACTIVE");
        if (!errorLogged) {
          errorLogged = true;
          console.warn("[hand-occlusion-debug] Transparent eraser pass failed", error);
        }
      } finally {
        renderer.setRenderTarget(previousTarget);
        renderer.setViewport(previousViewport);
        renderer.setScissor(previousScissor);
        renderer.setScissorTest(previousScissorTest);
        renderer.toneMapping = previousToneMapping;
        renderer.autoClear = previousAutoClear;
        renderer.xr.enabled = previousXrEnabled;
      }
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      hasTarget = false;
      currentInitialized = false;
      geometry.dispose();
      outlineGeometry.dispose();
      eraserMaterial.dispose();
      outlineMaterial?.dispose();
      maskScene.clear();
      setText(handEl, "NOT DETECTED");
      setText(landmarksEl, "0");
      setText(fpsEl, "0.0");
      setText(ageEl, "0 ms");
      setInactive();
    },
  };
}
