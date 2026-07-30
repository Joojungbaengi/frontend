/**
 * onnxruntime-web의 WASM 런타임을 public/ort/ 로 복사한다.
 * 13MB 바이너리라 저장소에 커밋하지 않고 dev·build 직전에 node_modules에서 가져온다.
 * (public/ort 는 .gitignore 처리)
 */
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const FILE = "ort-wasm-simd-threaded.wasm";

const src = require.resolve(`onnxruntime-web/${FILE}`);
const outDir = join(process.cwd(), "public", "ort");
const dst = join(outDir, FILE);

mkdirSync(outDir, { recursive: true });

if (existsSync(dst) && statSync(dst).size === statSync(src).size) {
  console.log(`[ort] ${FILE} 이미 최신`);
} else {
  copyFileSync(src, dst);
  console.log(`[ort] ${FILE} 복사 완료 (${(statSync(dst).size / 1024 / 1024).toFixed(1)}MB)`);
}
