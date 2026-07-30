/**
 * onnxruntime-web의 WASM 런타임을 public/ort/ 로 복사한다.
 * 13MB 바이너리라 저장소에 커밋하지 않고 dev·build 직전에 node_modules에서 가져온다.
 * (public/ort 는 .gitignore 처리)
 *
 * .wasm 만으로는 부족하다 — 런타임이 같은 경로에서 짝이 되는 .mjs 글루도 받아간다.
 */
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const FILES = ["ort-wasm-simd-threaded.wasm", "ort-wasm-simd-threaded.mjs"];

const outDir = join(process.cwd(), "public", "ort");
mkdirSync(outDir, { recursive: true });

for (const file of FILES) {
  const src = require.resolve(`onnxruntime-web/${file}`);
  const dst = join(outDir, file);

  if (existsSync(dst) && statSync(dst).size === statSync(src).size) {
    console.log(`[ort] ${file} 이미 최신`);
  } else {
    copyFileSync(src, dst);
    console.log(`[ort] ${file} 복사 완료 (${(statSync(dst).size / 1024).toFixed(0)}KB)`);
  }
}
