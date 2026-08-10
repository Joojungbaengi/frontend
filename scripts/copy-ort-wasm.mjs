/**
 * 브라우저 추론용 WASM 런타임을 public 아래로 복사한다.
 * 큰 바이너리는 저장소에 커밋하지 않고 dev·build 직전에 node_modules에서 가져온다.
 * (public/ort, public/mediapipe/wasm 은 .gitignore 처리)
 *
 * .wasm 만으로는 부족하다 — 런타임이 같은 경로에서 짝이 되는 .mjs 글루도 받아간다.
 */
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const GROUPS = [
  {
    label: "ort",
    outDir: join(process.cwd(), "public", "ort"),
    files: ["ort-wasm-simd-threaded.wasm", "ort-wasm-simd-threaded.mjs"],
    resolve: (file) => require.resolve(`onnxruntime-web/${file}`),
  },
  {
    label: "mediapipe",
    outDir: join(process.cwd(), "public", "mediapipe", "wasm"),
    files: ["vision_wasm_internal.js", "vision_wasm_internal.wasm"],
    resolve: (file) => require.resolve(`@mediapipe/tasks-vision/${file}`),
  },
];

for (const group of GROUPS) {
  mkdirSync(group.outDir, { recursive: true });
  for (const file of group.files) {
    const src = group.resolve(file);
    const dst = join(group.outDir, file);

    if (existsSync(dst) && statSync(dst).size === statSync(src).size) {
      console.log(`[${group.label}] ${file} 이미 최신`);
    } else {
      copyFileSync(src, dst);
      console.log(`[${group.label}] ${file} 복사 완료 (${(statSync(dst).size / 1024).toFixed(0)}KB)`);
    }
  }
}
