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

/**
 * 내려받을 모델들.
 *  · hand_landmarker  — 손 관절 21개. 무엇을 집었는지 판정하는 데 쓴다.
 *  · selfie_segmenter — 픽셀 단위 사람/배경 분할. 카메라 영상에서 손만 오려내
 *                       AR 에셋 **위에** 얹기 위해 필요하다. 관절만으로는 윤곽을 알 수 없다.
 */
const MODELS = [
  {
    name: "hand_landmarker.task",
    url: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
    minBytes: 5_000_000,
  },
  {
    name: "selfie_segmenter.tflite",
    url: "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite",
    minBytes: 100_000,
  },
];

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

// 2) 모델들
for (const { name, url, minBytes } of MODELS) {
  const modelPath = join(outDir, name);
  if (existsSync(modelPath) && statSync(modelPath).size >= minBytes) {
    console.log(`[mediapipe] ${name} 이미 있음`);
    continue;
  }
  console.log(`[mediapipe] ${name} 내려받는 중…`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`모델 다운로드 실패 (${res.status} ${res.statusText}) — ${url}`);

  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length < minBytes) {
    throw new Error(`모델이 너무 작습니다 (${bytes.length}B). URL 이 바뀌었는지 확인하세요 — ${url}`);
  }
  writeFileSync(modelPath, bytes);
  console.log(`[mediapipe] ${name} 완료 (${(bytes.length / 1024).toFixed(0)}KB)`);
}
