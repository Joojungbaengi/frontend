"use client";
// 임시 가공 페이지 — 무거운 원본을 폰에서 쓸 크기로 굽는다
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { decimate, split, ground, triCount } from "@/lib/bake/mesh";

interface Job {
  src: string;
  out: string;
  /** 목표 삼각형 수 */
  target: number;
  /** 떨어진 덩어리로 갈라 그중 몇 번째를 쓸지 (없으면 통째로) */
  pick?: number;
  /** 입힐 색 — 격자로 뭉치면서 UV 가 사라지므로 텍스처 대신 색으로 간다 */
  color: number;
}

const JOBS: Job[] = [
  { src: "/ar/3d-assets/nuruk_clean_cylinder.glb", out: "nuruk_lump", target: 1500, pick: 0, color: 0xd9c79b },
  { src: "/ar/3d-assets/nuruk_broken_cylinder.glb", out: "nuruk_broken", target: 1500, pick: 0, color: 0xd3bf92 },
  { src: "/ar/3d-assets/nuruk_grain.fbx", out: "nuruk_grain", target: 900, pick: 0, color: 0xcbb489 },
  { src: "/ar/3d-assets/rice-washing_bowl.fbx", out: "rice_washing_bowl", target: 5000, pick: 0, color: 0x8b6444 },
  { src: "/ar/3d-assets/wheat_bag.fbx", out: "wheat_bowl", target: 3500, pick: 0, color: 0xc9b58d },
];

function exportGlb(obj: THREE.Object3D): Promise<string> {
  return new Promise((res, rej) => {
    new GLTFExporter().parse(
      obj,
      (buf) => {
        const u8 = new Uint8Array(buf as ArrayBuffer);
        let s = "";
        for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
        res(btoa(s));
      },
      rej,
      { binary: true, maxTextureSize: 512 }
    );
  });
}

/** 원본에서 가장 큰 메시 하나를 고른다 (여러 조각이면 합쳐 본다) */
function biggest(root: THREE.Object3D): THREE.Mesh | null {
  let best: THREE.Mesh | null = null;
  let bestN = -1;
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.geometry) return;
    const n = m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count;
    if (n > bestN) { bestN = n; best = m; }
  });
  return best;
}

export default function Page() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    (async () => {
      const notes: string[] = [];
      const files: Record<string, string> = {};
      const previews: THREE.Object3D[] = [];

      for (const job of JOBS) {
        try {
          const isFbx = job.src.endsWith(".fbx");
          const root: THREE.Object3D = isFbx
            ? await new FBXLoader().loadAsync(job.src)
            : (await new GLTFLoader().loadAsync(job.src)).scene;
          const before = triCount(root);

          const mesh = biggest(root);
          if (!mesh) { notes.push(`${job.out}: 메시 없음`); continue; }
          mesh.updateWorldMatrix(true, false);
          let geo = mesh.geometry.clone();
          geo.applyMatrix4(mesh.matrixWorld); // 원본의 회전·배율을 구워 넣는다

          let pieces = 1;
          if (job.pick !== undefined) {
            const parts = split(geo);
            pieces = parts.length;
            if (parts[job.pick]) geo = parts[job.pick];
          }
          geo = decimate(geo, job.target);

          // 격자로 뭉치면서 UV 가 사라지므로 텍스처 대신 색으로 간다.
          // 원본 텍스처는 4K 씩이라 어차피 폰에 올릴 수 없었다.
          const mat = new THREE.MeshStandardMaterial({
            color: new THREE.Color(job.color),
            roughness: 0.9,
            metalness: 0.02,
            flatShading: true,
          });
          const out = new THREE.Mesh(geo, mat);
          out.name = job.out;
          const holder = new THREE.Group();
          holder.name = job.out;
          holder.add(out);
          const size = ground(holder);

          files[job.out] = await exportGlb(holder);
          notes.push(
            `${job.out}: 삼각형 ${before.toLocaleString()} → ${triCount(holder).toLocaleString()}` +
              (job.pick !== undefined ? ` (덩어리 ${pieces}개 중 1개)` : "") +
              `  크기 ${size.x.toFixed(2)}x${size.y.toFixed(2)}x${size.z.toFixed(2)}`
          );
          previews.push(holder);
        } catch (e) {
          notes.push(`${job.out}: 실패 — ${(e as Error).message}`);
        }
      }

      // 미리보기
      const row = document.createElement("div");
      row.style.cssText = "display:flex;gap:4px";
      ref.current!.appendChild(row);
      for (const obj of previews) {
        const r = new THREE.WebGLRenderer({ antialias: true });
        r.setSize(230, 230);
        r.outputColorSpace = THREE.SRGBColorSpace;
        const w = document.createElement("div");
        w.style.cssText = "color:#eee;font:11px sans-serif;text-align:center";
        w.appendChild(r.domElement);
        const cap = document.createElement("div");
        cap.textContent = obj.name;
        w.appendChild(cap);
        row.appendChild(w);
        const sc = new THREE.Scene();
        sc.background = new THREE.Color(0x2a2119);
        sc.add(new THREE.HemisphereLight(0xfff6e6, 0x4a3a28, 2.0));
        const k = new THREE.DirectionalLight(0xfff4e2, 2.0);
        k.position.set(1, 2, 2);
        sc.add(k);
        sc.add(obj);
        const b = new THREE.Box3().setFromObject(obj);
        const c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3());
        const cam = new THREE.PerspectiveCamera(35, 1, 0.001, 1000);
        const d = Math.max(s.x, s.y, s.z) * 2.2;
        cam.position.set(c.x + d * 0.5, c.y + d * 0.5, c.z + d);
        cam.lookAt(c);
        r.render(sc, cam);
      }

      (window as unknown as { __files: Record<string, string> }).__files = files;
      (window as unknown as { __notes: string[] }).__notes = notes;
      (window as unknown as { __ready: boolean }).__ready = true;
      const pre = document.createElement("pre");
      pre.style.cssText = "color:#ffd;font:12px monospace";
      pre.textContent = notes.join("\n");
      ref.current!.appendChild(pre);
    })();
  }, []);
  return <div ref={ref} style={{ position: "fixed", inset: 0, background: "#181310", padding: 8, zIndex: 9999 }} />;
}
