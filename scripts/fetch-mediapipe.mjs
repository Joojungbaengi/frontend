/**
 * MediaPipe HandLandmarker 실행에 필요한 파일을 public/mediapipe/ 로 모은다.
 * (copy-ort-wasm.mjs 와 같은 이유 — 큰 바이너리는 저장소에 커밋하지 않고
 *  dev·build 직전에 node_modules / 구글 CDN 에서 가져온다. public/mediapipe 는 .gitignore 처리)
 *
 *  1) wasm 런타임 — node_modules 에서 복사. .wasm 만으로는 부족하고 짝이 되는 .js 글루도 받아간다.
 *     SIMD 를 못 쓰는 브라우저가 nosimd 쪽으로 폴백하므로 둘 다 둔다.
 *  2) hand_landmarker.task — npm 패키지에 들어있지 않아 한 번 내려받는다(약 7.5MB).
 */
import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);

const WASM_FILES = [
  "vision_wasm_internal.js",
  "vision_wasm_internal.wasm",
  "vision_wasm_nosimd_internal.js",
  "vision_wasm_nosimd_internal.wasm",
];

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const MODEL_NAME = "hand_landmarker.task";
/** 내려받은 파일이 이보다 작으면 오류 페이지를 받은 것으로 본다 */
const MODEL_MIN_BYTES = 5_000_000;

const outDir = join(process.cwd(), "public", "mediapipe");
mkdirSync(outDir, { recursive: true });

// 1) wasm 런타임
for (const file of WASM_FILES) {
  // 패키지가 wasm 파일들을 최상위 subpath 로 export 해 둔다 (./wasm/... 는 막혀 있다)
  const src = require.resolve(`@mediapipe/tasks-vision/${file}`);
  const dst = join(outDir, file);

  if (existsSync(dst) && statSync(dst).size === statSync(src).size) {
    console.log(`[mediapipe] ${file} 이미 최신`);
  } else {
    copyFileSync(src, dst);
    console.log(`[mediapipe] ${file} 복사 완료 (${(statSync(dst).size / 1024).toFixed(0)}KB)`);
  }
}

// 2) 손 랜드마크 모델
const modelPath = join(outDir, MODEL_NAME);
if (existsSync(modelPath) && statSync(modelPath).size >= MODEL_MIN_BYTES) {
  console.log(`[mediapipe] ${MODEL_NAME} 이미 있음`);
} else {
  console.log(`[mediapipe] ${MODEL_NAME} 내려받는 중…`);
  const res = await fetch(MODEL_URL);
  if (!res.ok) throw new Error(`모델 다운로드 실패 (${res.status} ${res.statusText}) — ${MODEL_URL}`);

  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length < MODEL_MIN_BYTES) {
    throw new Error(`모델이 너무 작습니다 (${bytes.length}B). URL 이 바뀌었는지 확인하세요 — ${MODEL_URL}`);
  }
  writeFileSync(modelPath, bytes);
  console.log(`[mediapipe] ${MODEL_NAME} 완료 (${(bytes.length / 1024 / 1024).toFixed(1)}MB)`);
}
