/**
 * three 의 Draco 디코더를 public/draco/ 로 복사한다.
 *
 * AR 3D 에셋(.glb)은 KHR_draco_mesh_compression 으로 압축해 두었다 —
 * 원본 6.6MB 가 0.6MB 로 줄지만, 브라우저가 풀려면 이 디코더가 같은 도메인에 있어야 한다.
 * 760KB 짜리 바이너리라 저장소에 올리지 않고 dev·build 직전에 node_modules 에서 가져온다.
 * (public/draco 는 .gitignore 처리)
 *
 * .wasm 만으로는 부족하다 — 디코더가 같은 경로에서 짝이 되는 wrapper 스크립트도 받아간다.
 */
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const FILES = ["draco_decoder.js", "draco_decoder.wasm", "draco_wasm_wrapper.js"];

// three 는 package.json 을 exports 로 막아 두었다. 진입점(build/three.core.js)에서 거슬러 올라간다.
const threeRoot = dirname(dirname(require.resolve("three")));
const srcDir = join(threeRoot, "examples", "jsm", "libs", "draco", "gltf");
const outDir = join(process.cwd(), "public", "draco");
mkdirSync(outDir, { recursive: true });

for (const file of FILES) {
  const src = join(srcDir, file);
  const dst = join(outDir, file);

  if (!existsSync(src)) {
    console.warn(`[draco] ${file} 을(를) three 패키지에서 찾지 못했습니다 — ${src}`);
    continue;
  }
  if (existsSync(dst) && statSync(dst).size === statSync(src).size) {
    console.log(`[draco] ${file} 이미 최신`);
  } else {
    copyFileSync(src, dst);
    console.log(`[draco] ${file} 복사 완료 (${(statSync(dst).size / 1024).toFixed(0)}KB)`);
  }
}
