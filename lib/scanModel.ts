import type { InferenceSession } from "onnxruntime-web";

/**
 * 전통주 라벨 스캔 — YOLO11n ONNX 추론 (브라우저에서 onnxruntime-web으로 실행).
 *
 * 모델: public/yolo/best.onnx
 *   input  : images  [1, 3, 640, 640]  (RGB, 0~1 정규화, NCHW)
 *   output : output0 [1, 6, 8400]      (cx, cy, w, h, cls0, cls1) — NMS 미포함
 * 학습 산출물·설정 기록: material/yolo/
 */

export const YOLO_MODEL_URL = "/yolo/best.onnx";
/** onnxruntime-web WASM 위치 — scripts/copy-ort-wasm.mjs 가 여기에 복사한다 */
const ORT_WASM_PATH = "/ort/";
export const YOLO_INPUT = 640;

/** 이 점수 미만은 버린다 */
export const CONF_THRESHOLD = 0.55;
/** 같은 클래스 박스가 이 정도로 겹치면 하나만 남긴다 */
const IOU_THRESHOLD = 0.45;

/**
 * best.onnx 메타데이터의 names 순서와 **반드시** 일치해야 한다.
 *   names = {0: 'dongnim_cheongju', 1: 'cheonbihyang'}
 * 순서가 어긋나면 엉뚱한 술 상세로 이동한다. 재학습 시 반드시 다시 확인할 것.
 */
export const YOLO_CLASSES = [
  { drinkId: "cheongju_yongin_dongnim", label: "동림청주" },
  { drinkId: "yakju_pyeongtaek_cheonbihyang", label: "천비향 약주" },
] as const;

/** 인식 결과 1건 — 박스는 비디오 원본 픽셀 좌표계 */
export interface Detection {
  classIdx: number;
  score: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 레터박스 변환값 — 모델 좌표를 비디오 좌표로 되돌릴 때 쓴다 */
interface Letterbox {
  scale: number;
  padX: number;
  padY: number;
}

/** 비율을 유지한 채 640x640 캔버스에 그리고, 남는 자리는 회색으로 채운다 */
function drawLetterboxed(video: HTMLVideoElement, ctx: CanvasRenderingContext2D): Letterbox {
  const sw = video.videoWidth;
  const sh = video.videoHeight;
  const scale = Math.min(YOLO_INPUT / sw, YOLO_INPUT / sh);
  const dw = Math.round(sw * scale);
  const dh = Math.round(sh * scale);
  const padX = Math.floor((YOLO_INPUT - dw) / 2);
  const padY = Math.floor((YOLO_INPUT - dh) / 2);

  ctx.fillStyle = "rgb(114,114,114)"; // Ultralytics 기본 패딩색
  ctx.fillRect(0, 0, YOLO_INPUT, YOLO_INPUT);
  ctx.drawImage(video, 0, 0, sw, sh, padX, padY, dw, dh);
  return { scale, padX, padY };
}

/** RGBA 픽셀 → NCHW float32 (0~1) */
function toTensorData(rgba: Uint8ClampedArray): Float32Array {
  const pixels = YOLO_INPUT * YOLO_INPUT;
  const out = new Float32Array(pixels * 3);
  for (let i = 0; i < pixels; i++) {
    out[i] = rgba[i * 4] / 255;
    out[pixels + i] = rgba[i * 4 + 1] / 255;
    out[pixels * 2 + i] = rgba[i * 4 + 2] / 255;
  }
  return out;
}

function iou(a: Detection, b: Detection): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const overlap = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.w * a.h + b.w * b.h - overlap;
  return union <= 0 ? 0 : overlap / union;
}

/** 점수 높은 것부터 남기고, 같은 클래스의 겹치는 박스를 제거 */
function nms(dets: Detection[]): Detection[] {
  const kept: Detection[] = [];
  for (const d of [...dets].sort((p, q) => q.score - p.score)) {
    const overlapping = kept.some((k) => k.classIdx === d.classIdx && iou(k, d) >= IOU_THRESHOLD);
    if (!overlapping) kept.push(d);
  }
  return kept;
}

/**
 * output0 [1, 6, 8400] 을 박스 목록으로 변환.
 * 채널 우선 배치라 i번째 앵커의 c번째 값은 output[c * anchors + i] 이다.
 */
function decode(output: Float32Array, box: Letterbox): Detection[] {
  const nc = YOLO_CLASSES.length;
  const anchors = output.length / (4 + nc);
  const dets: Detection[] = [];

  for (let i = 0; i < anchors; i++) {
    let classIdx = 0;
    let score = output[4 * anchors + i];
    for (let c = 1; c < nc; c++) {
      const s = output[(4 + c) * anchors + i];
      if (s > score) {
        score = s;
        classIdx = c;
      }
    }
    if (score < CONF_THRESHOLD) continue;

    const cx = output[i];
    const cy = output[anchors + i];
    const w = output[2 * anchors + i];
    const h = output[3 * anchors + i];
    // 레터박스 패딩을 빼고 스케일을 되돌려 비디오 원본 좌표로
    dets.push({
      classIdx,
      score,
      x: (cx - w / 2 - box.padX) / box.scale,
      y: (cy - h / 2 - box.padY) / box.scale,
      w: w / box.scale,
      h: h / box.scale,
    });
  }
  return nms(dets);
}

type OrtModule = typeof import("onnxruntime-web/wasm");

/** 모델 세션 + 전처리 캔버스를 한 덩어리로 들고 있는 추론기 */
export class LabelDetector {
  private constructor(
    private readonly ort: OrtModule,
    private readonly session: InferenceSession,
    private readonly ctx: CanvasRenderingContext2D,
  ) {}

  static async load(): Promise<LabelDetector> {
    const ort = await import("onnxruntime-web/wasm");
    ort.env.wasm.wasmPaths = ORT_WASM_PATH;
    // 멀티스레드는 SharedArrayBuffer(COOP/COEP 헤더)가 필요해 단일 스레드로 고정
    ort.env.wasm.numThreads = 1;

    const session = await ort.InferenceSession.create(YOLO_MODEL_URL, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    });

    const canvas = document.createElement("canvas");
    canvas.width = YOLO_INPUT;
    canvas.height = YOLO_INPUT;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("전처리용 캔버스를 만들 수 없습니다");

    return new LabelDetector(ort, session, ctx);
  }

  /** 현재 비디오 프레임에서 라벨을 찾는다 */
  async detect(video: HTMLVideoElement): Promise<Detection[]> {
    if (!video.videoWidth || !video.videoHeight) return [];

    const box = drawLetterboxed(video, this.ctx);
    const { data } = this.ctx.getImageData(0, 0, YOLO_INPUT, YOLO_INPUT);
    const input = new this.ort.Tensor("float32", toTensorData(data), [1, 3, YOLO_INPUT, YOLO_INPUT]);

    const result = await this.session.run({ [this.session.inputNames[0]]: input });
    const output = result[this.session.outputNames[0]];
    return decode(output.data as Float32Array, box);
  }

  async release(): Promise<void> {
    await this.session.release();
  }
}
