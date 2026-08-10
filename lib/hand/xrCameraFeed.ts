/**
 * WebXR 카메라 이미지 → MediaPipe 가 먹을 수 있는 2D 캔버스.
 *
 * immersive-ar 세션 동안에는 ARCore 가 카메라를 독점해서 getUserMedia 로 같은 카메라를 열 수 없다.
 * 그래서 평면 인식(hit-test)과 손 인식을 동시에 하려면 WebXR 이 넘겨주는 카메라 이미지를 써야 한다.
 * 그게 `camera-access` 기능이고, three 는 renderer.xr.getCameraTexture() 로 그 텍스처를 준다.
 *
 * 다만 그 텍스처는 GPU 에만 있고 MediaPipe 는 CPU 쪽 이미지를 원하므로 한 번 내려받아야 한다.
 *   1) 작은 렌더타깃에 카메라 텍스처를 한 장 그린다 (세로로 뒤집어서 — 아래 flip 설명)
 *   2) readRenderTargetPixels 로 픽셀을 내린다
 *   3) 2D 캔버스에 얹어 MediaPipe 에 넘긴다
 *
 * 내려받기는 GPU 를 잠깐 멈추게 하므로 화면 크기 그대로 하면 안 된다.
 * 손 인식에는 작은 이미지로 충분해서 가로 CAPTURE_W 로 줄여 받는다.
 */
import * as THREE from "three";

/** 내려받을 이미지 가로 크기. 손 인식은 이 정도면 충분하고, 키우면 그대로 비용이 된다. */
const CAPTURE_W = 256;

export class XrCameraFeed {
  private rt: THREE.WebGLRenderTarget | null = null;
  private buffer: Uint8Array | null = null;
  private imageData: ImageData | null = null;
  private readonly canvas = document.createElement("canvas");
  private readonly ctx = this.canvas.getContext("2d", { willReadFrequently: true });

  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly material: THREE.ShaderMaterial;

  /** 마지막으로 받은 카메라 이미지의 원본 크기 — 좌표 보정(coverFit)에 쓴다 */
  readonly size = { w: 0, h: 0 };

  constructor() {
    this.material = new THREE.ShaderMaterial({
      uniforms: { map: { value: null as THREE.Texture | null } },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }`,
      // readRenderTargetPixels 는 아래 줄부터 읽어 온다. 그릴 때 미리 세로로 뒤집어 두면
      // 내려받은 버퍼가 곧바로 위→아래 순서(ImageData 와 같은 순서)가 된다.
      fragmentShader: `
        uniform sampler2D map;
        varying vec2 vUv;
        void main() {
          gl_FragColor = texture2D(map, vec2(vUv.x, 1.0 - vUv.y));
        }`,
      depthTest: false,
      depthWrite: false,
    });

    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  /** 카메라 이미지 비율이 바뀌면 렌더타깃·버퍼를 그 비율로 다시 잡는다 */
  private ensureTarget(srcW: number, srcH: number) {
    const w = CAPTURE_W;
    const h = Math.max(1, Math.round((CAPTURE_W * srcH) / srcW));
    if (this.rt && this.rt.width === w && this.rt.height === h) return;

    this.rt?.dispose();
    this.rt = new THREE.WebGLRenderTarget(w, h, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: false,
      stencilBuffer: false,
    });
    this.buffer = new Uint8Array(w * h * 4);
    this.canvas.width = w;
    this.canvas.height = h;
    this.imageData = new ImageData(w, h);
  }

  /**
   * 이번 프레임의 카메라 이미지를 캔버스로 떠 온다.
   * @param texture renderer.xr.getCameraTexture() 가 준 텍스처 (이 프레임에만 유효)
   * @param srcW,srcH XRCamera 가 알려주는 원본 이미지 크기
   * @returns MediaPipe 에 넘길 캔버스. 실패하면 null.
   */
  capture(
    renderer: THREE.WebGLRenderer,
    texture: THREE.Texture,
    srcW: number,
    srcH: number
  ): HTMLCanvasElement | null {
    if (!srcW || !srcH || !this.ctx) return null;
    this.ensureTarget(srcW, srcH);
    if (!this.rt || !this.buffer || !this.imageData) return null;

    this.size.w = srcW;
    this.size.h = srcH;
    this.material.uniforms.map.value = texture;

    const prevTarget = renderer.getRenderTarget();
    const prevXr = renderer.xr.enabled;
    try {
      // XR 세션 중에는 render() 가 무조건 XR 카메라로 갈아끼우고, 넘긴 카메라의 near/far 로
      // session.updateRenderState() 까지 불러 버린다. 그대로 두면 이 정사영 카메라의
      // near/far(0~1)가 AR 장면의 깊이 범위로 밀려들어가 무대가 깨진다.
      // 이 한 장을 뜨는 동안만 XR 경로를 꺼서 평범한 렌더로 처리한다.
      renderer.xr.enabled = false;
      renderer.setRenderTarget(this.rt);
      renderer.render(this.scene, this.camera);
      renderer.readRenderTargetPixels(this.rt, 0, 0, this.rt.width, this.rt.height, this.buffer);
    } catch {
      // 기기에 따라 카메라 텍스처를 읽지 못할 수 있다. 이 프레임은 건너뛴다.
      return null;
    } finally {
      renderer.xr.enabled = prevXr;
      renderer.setRenderTarget(prevTarget);
    }

    this.imageData.data.set(this.buffer);
    this.ctx.putImageData(this.imageData, 0, 0);
    return this.canvas;
  }

  dispose() {
    this.rt?.dispose();
    this.rt = null;
    this.material.dispose();
    this.scene.clear();
  }
}
