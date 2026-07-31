"use client";

/**
 * ArBreweryExperience — WebXR + Three.js 양조 체험 (원본 index.html 이식)
 *
 * Next.js 주의점:
 *  - "use client" 필수 (WebGL/WebXR은 브라우저 전용)
 *  - three 는 useEffect 안에서 초기화 → SSR 시 window 접근 방지
 *  - DOM 오버레이 UI는 JSX로, 3D 로직은 ref + effect로 분리
 *  - <style jsx>로 원본 CSS를 컴포넌트 스코프에 유지
 *
 * 팀원 페이지(ArPage)의 "AR 구현 영역"에 이 컴포넌트를 끼우면 된다.
 */

import { useEffect, useRef } from "react";
import Link from "next/link";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as skinnedClone } from "three/addons/utils/SkeletonUtils.js";
import { MY_MODELS, type ModelDef, type ArStep } from "@/lib/arModels";
import { INGREDIENTS } from "@/lib/ingredientsData";

export default function ArBreweryExperience() {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const uiRoot = rootRef.current;
    if (!canvas || !uiRoot) return;

    const $ = <T extends Element = HTMLElement>(s: string) =>
      uiRoot.querySelector(s) as T | null;
    const $$ = (s: string) => Array.from(uiRoot.querySelectorAll(s));

    /* =====================================================================
     * 0. 상태
     * ===================================================================*/
    
    const GODUBAP_STEPS = [
      { id: "wash",  name: "쌀 씻기", caption: "쌀을 씻어 이물질을 걷어내요" },
      { id: "soak",  name: "불리기",  caption: "쌀알이 물을 머금고 부풀어요" },
      { id: "steam", name: "찌기",    caption: "고두밥 30분 · 김이 오릅니다" },
      { id: "cool",  name: "식히기",  caption: "25℃까지 식혀야 누룩이 살아요" },
    ];

    const S = {
      step: "place" as "place" | ArStep,
      /** 배치 크기 — "floor"는 실제 크기, "table"은 책상용 미니어처(55%) */
      surface: "floor",
      placed: false,
      selected: new Set<string>(),
      godubap: 0,
      quizDone: false,
      temp: 27,
      ferment: 0,
      tempLog: [] as number[],
      xr: false,
      isInitializing: true,
    };
    /**
     * 받침대 상판 위에 물건을 올릴 때 띄우는 높이(m).
     * 모든 모델이 이 하나의 기준을 쓴다 — 모델마다 기준이 달라지면
     * 어떤 건 허공에 뜨고 어떤 건 상판(또는 실제 탁자) 속에 파묻힌다.
     */
    const CONTENT_LIFT = 0.03;
    const platformContentY = (platformTop: number) => platformTop + CONTENT_LIFT;

    function setStep(next: typeof S.step) {
      S.step = next;
      uiRoot!.dataset.step = next;
      // 완료 화면은 한지 배경이라 헤더도 함께 밝아져야 한다.
      // 헤더는 이 컴포넌트 바깥에 있으므로 문서 루트에 표시해 두고 CSS로 받는다.
      document.documentElement.dataset.arStep = next;
      buildStageFor(next);
    }

    /* =====================================================================
     * 1. 렌더러 / 씬
     * ===================================================================*/
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.xr.enabled = true;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(55, 1, 0.01, 40);
    camera.position.set(0, 0.42, 0.95);

    // 3D 모드 조작: 좌우 드래그로 회전, 상하 드래그로 올려다보거나 내려다본다.
    const controls = new OrbitControls(camera, canvas);
    controls.target.set(0, 0.22, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.8;
    controls.enablePan = false; // 평행이동은 막아 두어 회전·확대에만 집중하게 한다
    controls.minDistance = 0.35;
    controls.maxDistance = 2.6;
    controls.minPolarAngle = Math.PI * 0.06; // 거의 수직에서 내려다보는 각도까지
    controls.maxPolarAngle = Math.PI * 0.49; // 바닥 아래로는 내려가지 않게

    scene.add(new THREE.HemisphereLight(0xdfe8e0, 0x1b2118, 1.15));
    const keyLight = new THREE.DirectionalLight(0xfff2d8, 1.9);
    keyLight.position.set(0.9, 1.6, 0.7);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.near = 0.1;
    keyLight.shadow.camera.far = 6;
    keyLight.shadow.camera.left = -1.2;
    keyLight.shadow.camera.right = 1.2;
    keyLight.shadow.camera.top = 1.2;
    keyLight.shadow.camera.bottom = -1.2;
    scene.add(keyLight);
    const rim = new THREE.PointLight(0xc2452f, 2.2, 3);
    rim.position.set(-0.7, 0.5, -0.5);
    scene.add(rim);

    const anchor = new THREE.Group();
    anchor.visible = false;
    scene.add(anchor);

    const reticle = new THREE.Mesh(
      new THREE.RingGeometry(0.075, 0.09, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xf2ecdb, transparent: true, opacity: 0.9 })
    );
    reticle.matrixAutoUpdate = false;
    reticle.visible = false;
    scene.add(reticle);

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(1.1, 48).rotateX(-Math.PI / 2),
      new THREE.ShadowMaterial({ opacity: 0.35 })
    );
    floor.receiveShadow = true;
    scene.add(floor);

    function resize() {
      const r = canvas!.getBoundingClientRect();
      renderer.setSize(r.width, r.height, false);
      camera.aspect = r.width / r.height;
      camera.updateProjectionMatrix();
    }
    window.addEventListener("resize", resize);
    resize();

    /* =====================================================================
     * 2. 모델 빌더
     * ===================================================================*/
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x5b4a35, roughness: 0.9 });

    const LOADED: Record<string, any> = {};
    const gltfLoader = new GLTFLoader();

    async function preloadModels() {
      await Promise.all(
        MY_MODELS.map(async (m) => {
          try {
            LOADED[m.id] = await gltfLoader.loadAsync(m.file);
          } catch (e: any) {
            console.warn("모델 로드 실패:", m.id, m.file, e?.message);
          }
        })
      );
    }

    function spawnModel(def: ModelDef): THREE.Object3D | null {
      const gltf = LOADED[def.id];
      if (!gltf) return null;

      const root = skinnedClone(gltf.scene) as THREE.Object3D;

      const box = new THREE.Box3().setFromObject(root);
      const size = box.getSize(new THREE.Vector3());
      const srcH = size.y || 1;
      root.scale.setScalar(def.height / srcH);

      const box2 = new THREE.Box3().setFromObject(root);
      const center = box2.getCenter(new THREE.Vector3());
      root.position.set(-center.x, -box2.min.y, -center.z);

      root.traverse((o: any) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });

      if (gltf.animations && gltf.animations.length) {
        const mixer = new THREE.AnimationMixer(root);
        mixer.clipAction(gltf.animations[0]).play();
        live.mixers.push(mixer);
      }
      return root;
    }

    // 모든 단계에 공통으로 띄울 모델 배치 (step:"common", 단 받침대 모델은 제외)
    function placeCommonModels(parent: THREE.Object3D, baseY: number) {
      const defs = MY_MODELS.filter(
        (m) => m.step === "common" && m.id !== "low_wooden_bench"
      );
      defs.forEach((def) => {
        const node = spawnModel(def);
        if (!node) return;
        const g = new THREE.Group();
        g.position.set(0, baseY + def.y, 0);   // 받침대 정중앙
        g.add(node);
        (g.userData as any).def = def;
        parent.add(g);
        live.models.push(g);
      });
    }

    function placeModelsForStep(step: ArStep, parent: THREE.Object3D, baseY: number) {
      // 0. 단계와 무관하게 공통 모델(대바구니)을 먼저 배치
      placeCommonModels(parent, baseY);

      // 1. 해당 단계의 모델들을 가져옵니다.
      const defs = MY_MODELS.filter((m) => m.step === step);
      if (!defs.length) return;

      defs.forEach((def, i) => {
        const node = spawnModel(def);
        if (!node) return;
        const g = new THREE.Group();

        // 높이는 모델 종류와 무관하게 항상 "상판 + def.y" 하나의 기준을 쓴다.
        // 하나뿐이면 정중앙, 여러 개면 원형으로 벌려 놓는다.
        const y = baseY + def.y;
        if (defs.length === 1) {
          g.position.set(0, y, 0);
        } else {
          const maxH = Math.max(...defs.map((d) => d.height));
          const radius = Math.max(0.14, maxH * 0.9);
          const ang = (i / defs.length) * Math.PI * 2 - Math.PI / 2;
          g.position.set(Math.cos(ang) * radius, y, Math.sin(ang) * radius);
          g.rotation.y = Math.atan2(g.position.x, g.position.z) + Math.PI;
        }

        g.add(node);
        (g.userData as any).def = def;
        parent.add(g);
        live.models.push(g);
      });
    }

    function onggiProfile(h: number, r: number) {
      const pts: THREE.Vector2[] = [];
      for (let i = 0; i <= 24; i++) {
        const t = i / 24;
        const rr = r * (0.42 + 0.72 * Math.sin(Math.PI * (0.16 + 0.7 * t)));
        pts.push(new THREE.Vector2(rr, t * h));
      }
      return pts;
    }
    function makeOnggi(h = 0.3, r = 0.14, color = 0x50402f) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.LatheGeometry(onggiProfile(h, r), 48),
        new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0.08 })
      );
      body.castShadow = body.receiveShadow = true;
      g.add(body);
      const lip = new THREE.Mesh(
        new THREE.TorusGeometry(r * 0.62, r * 0.045, 10, 40).rotateX(Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: 0x3a2d21, roughness: 0.5 })
      );
      lip.position.y = h;
      g.add(lip);
      return g;
    }

    interface ParticleOpt {
      color: number; size: number; opacity: number; speed: number;
      radius: number; baseY: number; height: number; taper: number;
    }
    function makeParticles(count: number, opt: ParticleOpt) {
      const pos = new Float32Array(count * 3);
      const seed = new Float32Array(count);
      for (let i = 0; i < count; i++) seed[i] = Math.random();
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      const mat = new THREE.PointsMaterial({
        color: opt.color, size: opt.size, transparent: true, opacity: opt.opacity,
        depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
      });
      const pts = new THREE.Points(geo, mat);
      (pts.userData as any) = { seed, count, opt, t: 0 };
      return pts;
    }
    function updateParticles(pts: THREE.Points, dt: number) {
      const ud = pts.userData as any;
      const { seed, count, opt } = ud;
      ud.t += dt;
      const t = ud.t;
      const arr = (pts.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
      for (let i = 0; i < count; i++) {
        const s = seed[i];
        const life = (t * opt.speed + s) % 1;
        const spread = opt.radius * (0.35 + s * 0.65);
        const ang = s * Math.PI * 2 + t * 0.5;
        arr[i * 3] = Math.cos(ang) * spread * (1 - life * opt.taper);
        arr[i * 3 + 1] = opt.baseY + life * opt.height;
        arr[i * 3 + 2] = Math.sin(ang) * spread * (1 - life * opt.taper);
      }
      (pts.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }

    /* --- 무대 관리 --- */
    const stageGroup = new THREE.Group();
    anchor.add(stageGroup);
    const live: {
      particles: THREE.Points[];
      mixers: THREE.AnimationMixer[];
      models: THREE.Object3D[];
      tick: ((t: number, dt: number) => void) | null;
    } = { particles: [], mixers: [], models: [], tick: null };

    function clearStage() {
      stageGroup.traverse((o: any) => {
        if (o.isMesh) {
          o.geometry?.dispose();
          (Array.isArray(o.material) ? o.material : [o.material]).forEach(
            (m: any) => m?.dispose && m.dispose()
          );
        }
      });
      stageGroup.clear();
      live.particles.length = 0;
      live.mixers.forEach((m) => m.stopAllAction());
      live.mixers.length = 0;
      live.models.length = 0;
      live.tick = null;
    }

    
    /** 받침대를 놓고 그 "상판 y좌표"를 돌려준다. y=0 이 곧 인식된 바닥면이다. */
    function addPlatform(): number {
      const gltf = LOADED["low_wooden_bench"];

      if (gltf) {
        const root = skinnedClone(gltf.scene) as THREE.Object3D;
        root.scale.setScalar(0.5);
        root.traverse((o: any) => {
          if (o.isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
          }
        });
        // GLB마다 원점 위치가 제각각이라, 바운딩 박스로 바닥면을 y=0에 정확히 맞춘다.
        // (예전처럼 -0.3 같은 상수를 쓰면 받침대가 실제 탁자 속으로 파묻힌다)
        // ※ 이 시점의 root 는 아직 부모가 없어 raw 가 곧 로컬 좌표 기준이다.
        //   씬에 넣은 뒤 Box3 를 다시 재면 anchor 의 위치·배율까지 섞인 월드 좌표가 나오는데,
        //   호출부는 이 값을 stageGroup 로컬 y 로 쓰므로 물건이 바닥 아래로 파묻힌다.
        const raw = new THREE.Box3().setFromObject(root);
        root.position.y = -raw.min.y;
        stageGroup.add(root);

        return raw.max.y - raw.min.y; // 받침대 높이 = 상판의 로컬 y
      }

      // 받침대 모델을 못 불러왔을 때의 대체 받침대. 두께 4cm, 바닥면을 y=0에 맞춘다.
      console.warn("[ar] low_wooden_bench.glb 로드 실패 — 임시 받침대로 대체합니다.");
      const thickness = 0.04;
      const fallbackMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.35, 0.38, thickness, 32),
        new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.8 })
      );
      fallbackMesh.position.set(0, thickness / 2, 0);
      fallbackMesh.castShadow = true;
      fallbackMesh.receiveShadow = true;
      stageGroup.add(fallbackMesh);
      return thickness;
    }

    /**
     * 3D 모드에서 단계별로 카메라를 잡아 준다. (AR은 실제 시점을 쓰므로 건드리지 않는다)
     * 화면 위아래를 코치 카드와 하단 조작부가 차지하므로, 바라보는 지점을 물체보다
     * 조금 낮게 두어 물체가 화면 가운데보다 위쪽 빈 공간에 오도록 한다.
     *   lookAtY : 바라볼 높이 (받침대 기준)
     *   back    : 뒤로 물러날 거리
     *   up      : 위로 올라갈 높이 (클수록 내려다보는 각도가 커진다)
     */
    function frame3D(lookAtY: number, back: number, up: number) {
      if (S.xr) return;
      const c = anchor.position;
      const s = anchor.scale.x;
      camera.position.set(c.x, c.y + up * s, c.z + back * s);
      controls.target.set(c.x, c.y + lookAtY * s, c.z);
      controls.update();
    }

    /* --- 12 · 원료 --- */
    let ingredientNodes: THREE.Group[] = [];

    function buildIngredients() {
      const platformTop = addPlatform();       // 실제 상판 높이를 받음
      placeModelsForStep("ingredient", stageGroup, platformTop);
      // 정면에서 보면 바구니 옆에 뜬 원료가 서로 겹치므로 대각선 위에서 내려다본다
      frame3D(platformTop + 0.02, 0.66, 0.92);

      // 3D 모드에서는 정면에서 보면 바구니 옆에 뜬 원료가 서로 겹쳐 보인다.
      // 대각선 위에서 내려다보는 시점으로 옮겨 원료가 한눈에 들어오게 한다. (AR은 실제 시점을 쓰므로 제외)
      if (!S.xr) {
        const c = anchor.position;
        const s = anchor.scale.x;
        camera.position.set(c.x, c.y + 0.82 * s, c.z + 0.7 * s);
        controls.target.set(c.x, c.y + (platformTop + 0.08) * s, c.z);
        controls.update();
      }

      const textureLoader = new THREE.TextureLoader();
      const floatY = platformTop + 0.1;       // 상판에서 살짝만 띄움 (기존 0.18 → 대체)
      const layoutRadius = 0.19;              // 0.2 → 0.26 (원 배치 반경도 넓혀서 안 겹치게)

      // 고르면 바구니 안으로 내려앉고, 해제하면 제자리로 떠오른다.
      const basketY = platformTop + 0.075;
      const basketSpread = 0.026;

      ingredientNodes = INGREDIENTS.map((ing, i) => {
        const a = (i / INGREDIENTS.length) * Math.PI * 2;
        const g = new THREE.Group();
        g.position.set(Math.cos(a) * layoutRadius, floatY, Math.sin(a) * layoutRadius);

        const radius = 0.055;

        // texture는 항상 있음 (ingredientsData.ts 기준). 로드 실패 대비 회색 fallback.
        const texture = textureLoader.load(
          ing.texture,
          undefined,
          undefined,
          (err) => console.warn("원료 텍스처 로드 실패:", ing.id, ing.texture, err)
        );
        texture.colorSpace = THREE.SRGBColorSpace;

        const mesh = new THREE.Mesh(
          new THREE.CircleGeometry(radius, 48),
          new THREE.MeshBasicMaterial({
            map: texture,
            color: 0xffffff, // 텍스처 로드 전/실패 시 흰색 원판으로라도 보이게
            side: THREE.DoubleSide,
            transparent: true,
          })
        );
        mesh.castShadow = true;

        // 항상 카메라 정면을 보게 하는 빌보드
        mesh.onBeforeRender = (renderer, scene, camera) => {
          mesh.quaternion.copy(camera.quaternion);
        };

        g.add(mesh);

        (g.userData as any) = {
          id: ing.id,
          mesh,
          phase: i,
          /** 담기는 정도 0(제자리) ~ 1(바구니 안) */
          t: 0,
          // 고르지 않았을 때 떠 있는 제자리
          home: new THREE.Vector3(Math.cos(a) * layoutRadius, floatY, Math.sin(a) * layoutRadius),
          // 골랐을 때 내려앉을 바구니 안 자리 (겹치지 않게 조금씩 흩어 놓는다)
          inside: new THREE.Vector3(Math.cos(a) * basketSpread, basketY, Math.sin(a) * basketSpread),
        };
        stageGroup.add(g);
        return g;
      });

      const seat = new THREE.Vector3();
      const rimY = platformTop + 0.2; // 바구니 입구보다 확실히 위

      live.tick = (t) => {
        ingredientNodes.forEach((n) => {
          const ud = n.userData as any;
          const on = S.selected.has(ud.id);
          const home: THREE.Vector3 = ud.home;
          const inside: THREE.Vector3 = ud.inside;

          ud.t = THREE.MathUtils.lerp(ud.t, on ? 1 : 0, 0.09);
          const p: number = ud.t;

          // 수평으로 먼저 바구니 입구 위까지 옮겨간 뒤에 아래로 내려앉는다.
          // 한 번에 직선으로 보내면 바구니 옆면을 뚫고 지나간다.
          const ph = THREE.MathUtils.smoothstep(p, 0, 0.62); // 수평 이동
          const pv = THREE.MathUtils.smoothstep(p, 0.45, 1); // 입구 위에서 하강

          // 둥둥 뜨는 흔들림은 그대로 두되, 바구니에 담길수록 잔물결 정도로 잦아든다
          const bob = Math.sin(t * 1.4 + ud.phase) * THREE.MathUtils.lerp(0.018, 0.004, p);
          seat.set(
            THREE.MathUtils.lerp(home.x, inside.x, ph),
            THREE.MathUtils.lerp(THREE.MathUtils.lerp(home.y, rimY, ph), inside.y, pv) + bob,
            THREE.MathUtils.lerp(home.z, inside.z, ph)
          );
          n.position.copy(seat);

          // 담기면 바구니에 들어앉은 것처럼 살짝 작아진다
          const s = THREE.MathUtils.lerp(1, 0.72, p);
          n.scale.setScalar(s);
        });
      };
    }

    /* --- 13 · 고두밥 --- */
    function buildGodubap() {
      const platformTop = addPlatform();
      // 가상의 찜기+아이코사헤드론 쌀알 대신 rice_bowl.glb 실물 모델을 놓는다.
      // (rice_bowl 은 arModels.ts 에 step:"godubap" 으로 등록되어 있어 이 호출로 자동 배치됨)
      placeModelsForStep("godubap", stageGroup, platformTop);
      frame3D(platformTop, 0.58, 0.52);

      const glow = new THREE.PointLight(0xffd9a0, 0, 0.8);
      glow.position.set(0, 0.2, 0);
      stageGroup.add(glow);

      const steam = makeParticles(140, {
        color: 0xf2ecdb, size: 0.016, opacity: 0.5, speed: 0.25,
        radius: 0.1, baseY: 0.24, height: 0.34, taper: 0.55,
      });
      stageGroup.add(steam);
      live.particles.push(steam);

      live.tick = () => {
        const stage = S.godubap;
        const hot = stage >= 4 ? 0.05 : stage >= 2 ? 1 : 0.15;
        glow.intensity += (hot * 1.6 - glow.intensity) * 0.05;
        steam.material.opacity += ((stage >= 2 && stage < 4 ? 0.55 : 0.06) - steam.material.opacity) * 0.05;
        (steam.userData as any).opt.speed = stage >= 2 ? 0.35 : 0.15;
      };
    }

    /* --- 14 · 발효 --- */
    function buildFerment() {
      const platformTop = addPlatform();
      // "누룩 섞고 항아리에 담기" 클릭 시 clearStage()로 rice_bowl.glb 는 사라지고,
      // 여기서 water_jar.glb (arModels.ts: step "ferment")가 대신 배치된다.
      // ※ 예전에 실물 항아리 모델이 없을 때 쓰던 간이 액체 원기둥(liquid 메쉬)은
      //    water_jar.glb가 그 역할을 대신하므로 제거했다. 발효 진행도는 물방울
      //    파티클(bubbles)만으로 표현한다.
      placeModelsForStep("ferment", stageGroup, platformTop);
      // 항아리가 하단 조작부에 가리지 않도록 조금 더 물러나 위에서 잡는다
      frame3D(platformTop, 0.64, 0.5);

      const bubbles = makeParticles(180, {
        color: 0xfff6dd, size: 0.009, opacity: 0.7, speed: 0.5,
        radius: 0.1, baseY: 0.06, height: 0.2, taper: 0.2,
      });
      stageGroup.add(bubbles);
      live.particles.push(bubbles);

      const heat = new THREE.PointLight(0xff8a4a, 0, 1.2);
      heat.position.set(0, 0.2, 0);
      stageGroup.add(heat);

      live.tick = () => {
        const fill = 0.06 + (S.ferment / 100) * 0.16;
        const hot = THREE.MathUtils.clamp((S.temp - 24) / 10, 0, 1);
        const bo = (bubbles.userData as any).opt;
        bo.speed = 0.25 + hot * 0.9;
        bo.baseY = 0.06;
        bo.height = fill + 0.05;
        bubbles.material.opacity = 0.35 + hot * 0.45;
        heat.intensity += (hot * 1.4 - heat.intensity) * 0.06;
      };
    }

    /* --- 15 · 완성 --- */
    function buildFinish() {
      const platformTop = addPlatform();
      const contentY = platformContentY(platformTop);
      placeModelsForStep("done", stageGroup, platformTop);
      const bottle = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.LatheGeometry(onggiProfile(0.26, 0.085), 40),
        new THREE.MeshPhysicalMaterial({
          color: 0xf4efe0, roughness: 0.25, transmission: 0.35, thickness: 0.3, clearcoat: 1,
        })
      );
      body.castShadow = true;
      bottle.add(body);
      const neck = new THREE.Mesh(
        new THREE.CylinderGeometry(0.022, 0.026, 0.07, 24),
        new THREE.MeshStandardMaterial({ color: 0xf4efe0, roughness: 0.3 })
      );
      neck.position.y = 0.29;
      bottle.add(neck);
      const cap = new THREE.Mesh(
        new THREE.CylinderGeometry(0.028, 0.028, 0.02, 24),
        new THREE.MeshStandardMaterial({ color: 0xc2452f, roughness: 0.5 })
      );
      cap.position.y = 0.335;
      bottle.add(cap);
      const label = new THREE.Mesh(
        new THREE.CylinderGeometry(0.087, 0.087, 0.09, 32, 1, true),
        new THREE.MeshStandardMaterial({ color: 0xe8dcbb, roughness: 0.9, side: THREE.DoubleSide })
      );
      label.position.y = 0.14;
      bottle.add(label);
      bottle.position.y = contentY;
      stageGroup.add(bottle);

      const sparks = makeParticles(90, {
        color: 0xffe9b8, size: 0.011, opacity: 0.75, speed: 0.2,
        radius: 0.22, baseY: contentY + 0.05, height: 0.45, taper: -0.3,
      });
      stageGroup.add(sparks);
      live.particles.push(sparks);

      live.tick = () => {
        bottle.rotation.y += 0.006;
      };
    }

    function buildStageFor(step: typeof S.step) {
      clearStage();
      if (!S.placed) return;
      if (step === "ingredient") buildIngredients();
      else if (step === "godubap") buildGodubap();
      else if (step === "ferment") buildFerment();
      else if (step === "done") buildFinish();
    }

    /* =====================================================================
     * 3. WebXR
     * ===================================================================*/
    let xrSession: XRSession | null = null;
    let hitTestSource: XRHitTestSource | null = null;
    let localSpace: XRReferenceSpace | null = null;
    let arSupported = false;
    let surfaceReady = false;

    async function checkAR() {
      const xr = (navigator as any).xr;
      if (!xr) return false;
      try {
        arSupported = await xr.isSessionSupported("immersive-ar");
      } catch {
        arSupported = false;
      }
      return arSupported;
    }

    async function enterAR() {
      const xr = (navigator as any).xr;
      try {
        xrSession = await xr.requestSession("immersive-ar", {
          requiredFeatures: ["hit-test", "local"],
          optionalFeatures: ["dom-overlay"],
          domOverlay: { root: uiRoot },
        });
      } catch (e: any) {
        arSupported = false;
        syncPlaceButton();
        const note = $("#place-note");
        if (note) note.textContent = "AR을 시작하지 못했어요 · " + (e?.name || e?.message);
        return false;
      }

      S.xr = true;
      uiRoot!.classList.add("ar-mode");
      controls.enabled = false;
      floor.visible = false;

      renderer.xr.setReferenceSpaceType("local");
      await renderer.xr.setSession(xrSession as any);

      const viewerSpace = await xrSession!.requestReferenceSpace("viewer");
      localSpace = await xrSession!.requestReferenceSpace("local");
      hitTestSource = await (xrSession as any).requestHitTestSource({ space: viewerSpace });

      xrSession!.addEventListener("end", () => {
        S.xr = false;
        xrSession = null;
        hitTestSource = null;
        uiRoot!.classList.remove("ar-mode");
        controls.enabled = true;
        floor.visible = true;
        surfaceReady = false;
        resize();
        syncPlaceButton();
      });

      syncPlaceButton();
      return true;
    }

    const raycaster = new THREE.Raycaster();
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    function fallbackHit() {
      raycaster.setFromCamera(new THREE.Vector2(0, -0.15), camera);
      const p = new THREE.Vector3();
      return raycaster.ray.intersectPlane(groundPlane, p) ? p : null;
    }

    /* =====================================================================
     * 4. 렌더 루프
     * ===================================================================*/
    const clock = new THREE.Clock();
    renderer.setAnimationLoop((_time, frame) => {
      const dt = Math.min(clock.getDelta(), 0.05);
      const t = clock.elapsedTime;

      if (S.step === "place" && !S.placed) {
        let found = false;
        if (frame && hitTestSource && localSpace) {
          const results = (frame as any).getHitTestResults(hitTestSource);
          if (results.length) {
            const pose = results[0].getPose(localSpace);
            reticle.matrix.fromArray(pose.transform.matrix);
            found = true;
          }
        } else if (!S.xr) {
          const p = fallbackHit();
          if (p) {
            reticle.matrix.makeTranslation(p.x, p.y, p.z);
            found = true;
          }
        }
        // 조준 링은 실제 AR에서만 의미가 있다 (3D 미리보기에서는 허공에 뜬 원처럼 보임)
        reticle.visible = found && S.xr;
        onSurfaceFound(found);
      } else {
        reticle.visible = false;
      }

      if (S.step === "ferment" && S.ferment < 100) {
        const dist = Math.abs(S.temp - 25);
        // 25℃에서 약 17초에 완주. 너무 빨리 끝나면 온도를 조절해 본 효과를 느끼기 어렵다.
        const rate = THREE.MathUtils.clamp(1 - dist / 9, 0.12, 1) * 6;
        S.ferment = Math.min(100, S.ferment + rate * dt);
        S.tempLog.push(S.temp);
        onFermentTick();
      }

      live.mixers.forEach((m) => m.update(dt));
      if (live.tick) live.tick(t, dt);
      live.particles.forEach((p) => updateParticles(p, dt));
      if (!S.xr) controls.update();
      renderer.render(scene, camera);
    });

    /* =====================================================================
     * 5. UI 바인딩
     * ===================================================================*/
    function onSurfaceFound(found: boolean) {
      if (found === surfaceReady) return;
      surfaceReady = found;
      syncPlaceButton();
    }
    function syncPlaceButton() {
      const b = $("#btn-place") as HTMLButtonElement | null;
      const note = $("#place-note");
      if (!b) return;
      const say = (text: string) => {
        if (note) note.textContent = text;
      };

      // 초기 로딩 중일 때는 무조건 준비 중 상태로 표시
      if (S.isInitializing) {
        b.disabled = true;
        b.textContent = "AR 환경 준비 중…";
        say("잠시만 기다려 주세요.");
        return;
      }

      if (arSupported && !S.xr) {
        b.disabled = false;
        b.textContent = "카메라 켜고 AR 시작";
        say("카메라를 켜면 바닥을 인식해 양조장을 놓을 수 있어요.");
      } else if (surfaceReady) {
        b.disabled = false;
        b.textContent = "여기에 양조장 배치";
        say("평면을 찾았어요. 아래 버튼으로 배치하세요.");
      } else {
        b.disabled = true;
        b.textContent = "평면을 찾는 중…";
        say(S.xr ? "바닥을 비추며 폰을 천천히 움직여 주세요." : "화면을 드래그해 둘러볼 수 있어요.");
      }
    }

    /** 선택한 크기(실제 / 미니어처)를 배치 그룹에 반영 */
    function applySurfaceScale() {
      anchor.scale.setScalar(S.surface === "table" ? 0.55 : 1);
    }

    $$(".seg button").forEach((btn) => {
      (btn as HTMLElement).onclick = () => {
        $$(".seg button").forEach((b) => b.setAttribute("aria-pressed", "false"));
        btn.setAttribute("aria-pressed", "true");
        S.surface = (btn as HTMLElement).dataset.surface!;
        applySurfaceScale();
      };
    });

    const placeBtn = $("#btn-place") as HTMLButtonElement | null;
    if (placeBtn) {
      placeBtn.onclick = async () => {
        if (arSupported && !S.xr) {
          placeBtn.textContent = "카메라 여는 중…";
          await enterAR();
          return;
        }
        const m = new THREE.Matrix4().copy(reticle.matrix);
        anchor.position.setFromMatrixPosition(m);
        anchor.visible = true;
        applySurfaceScale();
        S.placed = true;
        if (!S.xr) controls.target.copy(anchor.position).add(new THREE.Vector3(0, 0.2, 0));
        setStep("ingredient");
      };
    }

    /* --- 12 · 원료 --- */
    const grid = $("#grid");
    if (grid) {
      // 개발 모드(StrictMode)에서 이 effect가 두 번 실행돼도 카드가 쌓이지 않도록 비우고 시작한다.
      grid.innerHTML = "";
      INGREDIENTS.forEach((ing) => {
        const b = document.createElement("button");
        b.className = "card";
        b.setAttribute("aria-pressed", "false");
        // 배경 크기·정렬은 CSS에서 잡는다. 여기서 cover 를 주면 투명 PNG가 잘리고
        // .chip 의 배경색이 테두리처럼 비쳐 보인다.
        b.innerHTML = `<span class="chip" style="background-image:url('${ing.texture}')"></span>${ing.name}`;
        b.onclick = () => {
          if (S.selected.has(ing.id)) S.selected.delete(ing.id);
          else if (S.selected.size < 3) S.selected.add(ing.id);
          else return coach("#msg-ingredient", "재료는 세 가지까지만 넣을 수 있다네. 하나를 빼고 다시 골라보게.");
          b.setAttribute("aria-pressed", String(S.selected.has(ing.id)));
          syncIngredient();
        };
        grid.appendChild(b);
      });
    }
    function syncIngredient() {
      const n = S.selected.size;
      const needed = INGREDIENTS.filter((i) => i.essential && !S.selected.has(i.id));
      const b = $("#btn-ingredient") as HTMLButtonElement | null;
      if (!b) return;
      b.textContent = n === 3 && !needed.length ? "재료 3개 선택 완료" : `재료 ${n}개 선택`;
      b.disabled = !(n === 3 && !needed.length);
      if (n === 3 && needed.length)
        coach("#msg-ingredient", `막걸리의 뼈대는 ${needed.map((i) => i.name).join("·")}. 이것 없이는 술이 되지 않네.`);
      else if (n === 3) coach("#msg-ingredient", "좋아, 쌀·누룩·물이면 술이 된다네. 이제 고두밥을 지어보세.");
    }
    function coach(sel: string, text: string) {
      const el = $(sel);
      if (!el) return;
      el.textContent = text;
      const card = el.parentElement?.parentElement as HTMLElement | undefined;
      if (card) {
        card.style.animation = "none";
        void card.offsetWidth;
        card.style.animation = "";
      }
    }
    const btnIngredient = $("#btn-ingredient");
    if (btnIngredient) (btnIngredient as HTMLElement).onclick = () => setStep("godubap");

    /* --- 13 · 고두밥 --- */
    const pills = $("#pills");
    if (pills) {
      // 개발 모드(StrictMode)에서 이 effect가 두 번 실행돼도 pill이 쌓이지 않도록 비우고 시작한다.
      // 비우지 않으면 pill이 GODUBAP_STEPS 개수를 넘어가 syncGodubap 에서 undefined 를 읽는다.
      pills.innerHTML = "";
      GODUBAP_STEPS.forEach((st, i) => {
        const b = document.createElement("button");
        b.className = "pill";
        b.dataset.idx = String(i);
        b.textContent = st.name;
        b.onclick = () => {
          if (i !== S.godubap) return;
          if (i === 3 && !S.quizDone) {
            $("#quiz")?.classList.remove("hidden");
            return;
          }
          S.godubap = i + 1;
          syncGodubap();
        };
        pills.appendChild(b);
      });
    }
    function syncGodubap() {
      $$("#pills .pill").forEach((p, i) => {
        // 완료 표시(✓)는 CSS가 점 안에 그리므로 여기서는 이름만 둔다
        (p as HTMLElement).dataset.state = i < S.godubap ? "done" : i === S.godubap ? "now" : "todo";
        p.textContent = GODUBAP_STEPS[i].name;
      });
      const hint = $("#godubap-hint");
      if (hint) {
        hint.textContent =
          S.godubap >= 4
            ? "고두밥이 완성됐어요. 아래 버튼으로 이어가세요."
            : S.godubap === 3 && !S.quizDone
              ? "장인의 질문에 먼저 답해주세요"
              : "불이 켜진 단계를 눌러 순서대로 진행하세요";
      }
      const cur = GODUBAP_STEPS[Math.min(S.godubap, 3)];
      const cap = $("#cap-godubap");
      if (cap) cap.textContent = S.godubap >= 4 ? "고두밥 완성 · 25℃까지 식었어요" : cur.caption;
      if (S.godubap === 3 && !S.quizDone) $("#quiz")?.classList.remove("hidden");
      const b = $("#btn-godubap") as HTMLButtonElement | null;
      if (b) {
        b.disabled = S.godubap < 4;
        b.textContent = S.godubap < 4 ? "공정을 순서대로 진행하세요" : "누룩 섞고 항아리에 담기";
      }
    }
    $$("#quiz .choice").forEach((c) => {
      (c as HTMLElement).onclick = () => {
        const right = (c as HTMLElement).dataset.correct === "1";
        c.classList.add(right ? "ok" : "no");
        if (right) {
          S.quizDone = true;
          setTimeout(() => {
            $("#quiz")?.classList.add("hidden");
            S.godubap = 4;
            syncGodubap();
          }, 900);
        } else {
          setTimeout(() => c.classList.remove("no"), 900);
        }
      };
    });
    const btnGodubap = $("#btn-godubap");
    if (btnGodubap) (btnGodubap as HTMLElement).onclick = () => setStep("ferment");

    /* --- 14 · 발효 --- */
    const tempInput = $("#temp") as HTMLInputElement | null;
    if (tempInput) {
      tempInput.oninput = () => {
        S.temp = +tempInput.value;
        syncTemp();
      };
    }
    function tempLabel(v: number) {
      if (v < 21) return "조금 낮음";
      if (v <= 26) return "알맞음";
      if (v <= 29) return "조금 높음";
      return "너무 높음";
    }
    /** 25℃에서 얼마나 벗어났는지 — 색과 속도 표시에 함께 쓴다 */
    function tempState(): "ok" | "warn" | "bad" {
      const off = Math.abs(S.temp - 25);
      return off <= 2 ? "ok" : off <= 4 ? "warn" : "bad";
    }

    function syncTemp() {
      const state = tempState();
      const tv = $("#temp-val");
      if (tv) {
        tv.textContent = `${S.temp}℃ · ${tempLabel(S.temp)}`;
        (tv as HTMLElement).dataset.state = state;
      }
      // 지금 온도로 발효가 얼마나 잘 진행되는지 한 줄로 보여준다
      const rateEl = $("#ferment-rate");
      if (rateEl) {
        rateEl.textContent =
          state === "ok" ? "발효 속도 정상" : state === "warn" ? "발효가 더뎌지고 있어요" : "발효가 거의 멈췄어요";
        (rateEl as HTMLElement).dataset.state = state;
      }
      const m = $("#msg-ferment");
      if (!m) return;
      if (S.temp > 26) m.textContent = "온도가 높아 발효가 너무 빠르네. 항아리 환경을 조금 낮춰보게.";
      else if (S.temp < 21) m.textContent = "너무 서늘하면 효모가 잠들어 버린다네. 조금만 올려보게.";
      else m.textContent = "24~26℃, 딱 좋구먼. 이대로 두면 곱게 익겠네.";
    }
    function onFermentTick() {
      const bar = $("#bar-ferment");
      if (bar) {
        (bar as HTMLElement).style.width = S.ferment + "%";
        // 온도가 어긋나면 막대 색까지 바뀌어, 진행이 느려진 이유가 바로 보인다
        (bar as HTMLElement).dataset.state = tempState();
      }
      const pct = $("#ferment-pct");
      if (pct) pct.textContent = `${Math.round(S.ferment)}%`;
      const day = Math.min(7, 1 + Math.floor(S.ferment / 15));
      const cap = $("#cap-ferment");
      if (cap)
        cap.textContent =
          S.ferment >= 100
            ? "발효 완료 · 맑은 술이 떠올랐어요"
            : `발효 ${day}일차 · ${S.ferment < 40 ? "거품이 활발해요" : S.ferment < 80 ? "단내가 올라와요" : "기포가 잦아들어요"}`;
      const b = $("#btn-ferment") as HTMLButtonElement | null;
      if (b) {
        b.disabled = S.ferment < 100;
        b.textContent = S.ferment < 100 ? "발효가 무르익는 중…" : "체에 걸러 술 완성하기";
      }
    }
    const btnFerment = $("#btn-ferment");
    if (btnFerment) (btnFerment as HTMLElement).onclick = () => setStep("done");

    /* --- 15 · 완성 / 리포트 --- */
    const btnReport = $("#btn-report");
    if (btnReport) {
      (btnReport as HTMLElement).onclick = () => {
        const avg = S.tempLog.length ? S.tempLog.reduce((a, b) => a + b, 0) / S.tempLog.length : S.temp;
        const score = Math.round(THREE.MathUtils.clamp(100 - Math.abs(avg - 25) * 7, 40, 99));
        const notes: Record<string, string> = {
          omija: "붉은 빛과 새콤한 끝맛", flower: "은은한 국화 향", honey: "둥근 단맛",
        };
        const extra = INGREDIENTS.find((i) => !i.essential && S.selected.has(i.id));
        const body = $("#report-body");
        if (body)
          body.innerHTML = `
            <dt>사용한 원료</dt><dd>${[...S.selected].map((id) => INGREDIENTS.find((i) => i.id === id)!.name).join(" · ")}</dd>
            <dt>평균 발효 온도</dt><dd>${avg.toFixed(1)}℃</dd>
            <dt>발효 기간</dt><dd>7일 (가속 체험)</dd>
            <dt>맛 프로파일</dt><dd>${extra ? notes[extra.id] : "깔끔한 곡물 단맛"}</dd>
            <dt>양조 점수</dt><dd>${score}점</dd>`;
        $("#report")?.classList.add("open");
      };
    }
    const btnCloseReport = $("#btn-close-report");
    if (btnCloseReport) (btnCloseReport as HTMLElement).onclick = () => $("#report")?.classList.remove("open");

    const btnRestart = $("#btn-restart");
    if (btnRestart) {
      (btnRestart as HTMLElement).onclick = () => {
        S.selected.clear();
        S.godubap = 0;
        S.quizDone = false;
        S.temp = 27;
        S.ferment = 0;
        S.tempLog = [];
        $$(".card").forEach((c) => c.setAttribute("aria-pressed", "false"));
        $("#quiz")?.classList.add("hidden");
        $$("#quiz .choice").forEach((c) => c.classList.remove("ok", "no"));
        if (tempInput) tempInput.value = "27";
        syncTemp();
        syncIngredient();
        syncGodubap();
        onFermentTick();
        setStep("ingredient");
      };
    }

    /* --- 뒤로 --- */
    const ORDER: (typeof S.step)[] = ["place", "ingredient", "godubap", "ferment", "done"];
    $$("[data-back]").forEach((b) => {
      (b as HTMLElement).onclick = () => {
        const i = ORDER.indexOf(S.step);
        if (i > 0) setStep(ORDER[i - 1]);
      };
    });

    /* =====================================================================
     * 6. 부트
     * ===================================================================*/
    syncIngredient();
    syncGodubap();
    syncTemp();
    onFermentTick();
    syncPlaceButton();

    Promise.all([preloadModels(), checkAR()])
      .then(() => {
        S.isInitializing = false; // 👈 로딩 완료
        syncPlaceButton();         // 👈 준비가 끝나면 실제 버튼으로 갱신
      })
      .catch(() => {
        S.isInitializing = false;
        syncPlaceButton();
      });

    /* =====================================================================
     * 7. 정리 (언마운트 시 필수 — React가 재마운트할 때 WebGL 누수 방지)
     * ===================================================================*/
    return () => {
      window.removeEventListener("resize", resize);
      renderer.setAnimationLoop(null);
      if (xrSession) {
        try {
          xrSession.end();
        } catch {}
      }
      clearStage();
      controls.dispose();
      renderer.dispose();
      delete document.documentElement.dataset.arStep;
    };
  }, []);

  return (
    <div ref={rootRef} className="ar-ui" data-step="place">
      <canvas ref={canvasRef} id="gl" />

      {/* 11 · AR 시작 */}
      <div className="panel-step" id="p-place">
        <div className="fill lead-center">
          <div className="lead">
            <h2>양조장을 놓을 곳을 정해요</h2>
            <p id="place-note">바닥이나 책상 위 평면을 비춰주세요.</p>
          </div>
        </div>
        <div className="dock">
          <div className="seg">
            <button data-surface="floor" aria-pressed="true">바닥에 크게</button>
            <button data-surface="table" aria-pressed="false">책상에 작게</button>
          </div>
          <button className="cta" id="btn-place" disabled>평면을 찾는 중…</button>
        </div>
      </div>

      {/* 12 · 원료 확인 */}
      <div className="panel-step" id="p-ingredient">
        <div style={{ padding: "0 22px" }}>
          <div className="coach">
            <div className="avatar" />
            <div>
              <div className="who">술도가 장인</div>
              <div className="msg" id="msg-ingredient">이 술은 고양 가와지쌀로 빚는 냥이탁주라네. 들어갈 재료를 골라보게.</div>
            </div>
          </div>
        </div>
        <div className="fill" />
        <div className="dock">
          <div className="grid" id="grid" />
          <button className="cta" id="btn-ingredient" disabled>재료 0개 선택</button>
        </div>
      </div>

      {/* 13 · 고두밥 */}
      <div className="panel-step" id="p-godubap">
        <div className="steps" id="pills" />
        <div className="steps-hint" id="godubap-hint">불이 켜진 단계를 눌러 순서대로 진행하세요</div>
        <div className="fill">
          <div className="caption" id="cap-godubap">쌀을 씻어 이물질을 걷어내요</div>
        </div>
        <div className="dock">
          <div id="quiz" className="hidden">
            <div className="coach">
              <div className="avatar" />
              <div style={{ flex: 1 }}>
                <div className="who">술도가 장인</div>
                <div className="msg">고두밥이 아직 뜨겁네. 지금 누룩을 섞으면 발효에 어떤 영향을 줄까?</div>
                <div className="choices">
                  <button className="choice" data-correct="1">뜨거우면 누룩 속 효소·미생물이 죽어요</button>
                  <button className="choice" data-correct="0">더 빨리 발효돼서 좋아요</button>
                </div>
              </div>
            </div>
          </div>
          <button className="cta" id="btn-godubap" disabled>공정을 순서대로 진행하세요</button>
        </div>
      </div>

      {/* 14 · 발효 */}
      <div className="panel-step" id="p-ferment">
        <div className="fill">
          <div className="caption" id="cap-ferment">발효 1일차 · 거품이 오르기 시작해요</div>
        </div>
        <div className="dock">
          <div className="ferment-row">
            <span className="ferment-rate" id="ferment-rate">발효 속도 정상</span>
            <span className="ferment-pct" id="ferment-pct">0%</span>
          </div>
          <div className="bar"><i id="bar-ferment" /></div>
          <div className="meter">
            <div className="row"><span>발효 온도</span><span className="val" id="temp-val">27℃ · 조금 높음</span></div>
            <input type="range" id="temp" min={18} max={34} step={1} defaultValue={27} aria-label="발효 온도" />
          </div>
          <div className="coach" id="coach-ferment">
            <div className="avatar" />
            <div>
              <div className="who">술도가 장인</div>
              <div className="msg" id="msg-ferment">온도가 높아 발효가 너무 빠르네. 항아리 환경을 조금 낮춰보게.</div>
            </div>
          </div>
          <button className="cta" id="btn-ferment" disabled>발효가 무르익는 중…</button>
        </div>
      </div>

      {/* 15 · 완성 */}
      <div id="finish">
        <img className="finish-drink" src="/drinks/takju_goyang_nyangi9.webp" alt="냥이탁주9" />
        <h1>냥이탁주 9<br />양조 체험 완료!</h1>
        <p>고양 가와지쌀로 빚은 냥이탁주 9가 완성됐어요. 쌀을 씻어 고두밥을 짓고 누룩을 섞어 발효까지, 행주산성주가가 손으로 빚는 과정을 그대로 따라와 보셨어요.</p>
        <div className="finish-actions">
          <button className="cta" id="btn-report">양조 리포트 보기</button>
          <Link href="/dex" className="cta dex-link">술 도감으로 가기</Link>
        </div>
        <button className="cta ghost" id="btn-restart">처음부터 다시 빚기</button>
      </div>

      {/* 리포트 */}
      <div id="report">
        <div className="sheet">
          <h3>양조 리포트</h3>
          <div className="sub">이번 체험에서 만든 술의 기록</div>
          <dl id="report-body" />
          <button className="cta" id="btn-close-report">닫기</button>
        </div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: styles }} />
    </div>
  );
}

/* 원본 index.html의 CSS를 이식하되, 값은 앱 공통 디자인(globals.css :root)에 맞춘다.
   .topbar 는 ScreenHeader가 대신하므로 제거. #ui → .ar-ui 로 치환.
   이 <style> 은 전역으로 주입되므로 모든 선택자를 .ar-ui 로 감싸
   앱 공통 클래스(.card, .hidden 등)와 부딪히지 않게 한다. */
const styles = `
.ar-ui{position:absolute; inset:0; display:flex; flex-direction:column; overflow:hidden;
  font-family:var(--font-gowun), system-ui, sans-serif;
  color:#f3e6cc;
  /* 앱 팔레트에 맞춘 지역 별칭 — --hanji/--seal/--gold/--sage 등은 :root 것을 그대로 쓴다 */
  --cream:var(--hanji); --cream-dim:rgba(243,230,204,.66); --panel-2:#3a2c1c;
  --clay:var(--seal); --clay-hi:#c9573c; --sage-deep:var(--gold);
  --line:rgba(232,201,138,.22);
  --r-md:16px; --r-sm:14px; --safe-b:env(safe-area-inset-bottom,0px);
  padding-top:20px;}
.ar-ui canvas#gl{position:absolute; inset:0; width:100%; height:100%; display:block; z-index:0}
.ar-ui > *{position:relative; z-index:1}

.ar-ui.ar-mode{background:transparent}
.ar-ui.ar-mode canvas#gl{background:transparent}
.ar-ui.ar-mode .lead h2{text-shadow:0 2px 12px rgba(0,0,0,.75)}
.ar-ui.ar-mode .lead p{color:#f3e6cc; text-shadow:0 1px 8px rgba(0,0,0,.8)}
.ar-ui.ar-mode .caption{color:#f3e6cc; text-shadow:0 1px 8px rgba(0,0,0,.8)}

.ar-ui .fill{flex:1; position:relative}
/* 하단 여백은 헤더 위 여백과 비슷하게 — 버튼이 화면 끝에 붙지 않도록 */
.ar-ui .dock{padding:0 22px calc(34px + var(--safe-b)); display:flex; flex-direction:column; gap:14px}
/* 첫 화면 안내문은 카메라 화면 가운데에 */
.ar-ui .lead-center{display:flex; align-items:center; justify-content:center; padding:0 22px}

.ar-ui .coach{display:flex; gap:12px; align-items:flex-start; background:var(--cream); color:var(--ink-strong);
  border:1px solid rgba(198,165,104,.4); border-radius:var(--r-md); padding:14px 15px;
  box-shadow:0 8px 20px rgba(120,95,50,.22);
  animation:ar-rise .34s cubic-bezier(.2,.8,.3,1) both}
@keyframes ar-rise{from{opacity:0; transform:translateY(10px)}to{opacity:1; transform:none}}
.ar-ui .coach .avatar{width:28px;height:28px;border-radius:50%;flex:none;margin-top:2px;
  background:radial-gradient(circle at 35% 30%, #e8c98a, #a67c3e)}
.ar-ui .coach .who{font-size:11px; font-weight:700; color:var(--clay); letter-spacing:.02em}
.ar-ui .coach .msg{font-size:13px; line-height:1.65; margin-top:4px; color:var(--ink-soft)}

.ar-ui .choices{display:flex; flex-direction:column; gap:9px; margin-top:12px}
.ar-ui .choice{text-align:left; width:100%; cursor:pointer; background:var(--hanji-bright);
  border:1px solid rgba(198,165,104,.45); color:var(--ink-strong); font:inherit; font-size:13px;
  padding:12px 14px; border-radius:var(--r-sm); transition:.18s}
.ar-ui .choice.ok{background:var(--sage); border-color:#8ea77f}
.ar-ui .choice.no{background:#f4e0da; border-color:#c58c80}

/* 재료 고르기 — 네모 상자 없이 재료만 놓인 것처럼.
   투명 PNG라 배경색을 깔면 테두리처럼 비쳐 보이므로 색을 주지 않고,
   대신 그림자로 카메라 화면 위에서도 또렷하게 보이게 한다. */
.ar-ui .grid{display:grid; grid-template-columns:repeat(3,1fr); gap:4px}
.ar-ui .card{background:none; border:none; border-radius:12px; padding:8px 4px 6px; cursor:pointer;
  color:var(--cream-dim); display:flex; flex-direction:column; align-items:center; gap:7px;
  font:inherit; font-size:12px; text-shadow:0 1px 6px rgba(0,0,0,.85);
  -webkit-tap-highlight-color:transparent; transition:.2s}
.ar-ui .card .chip{width:54px; height:54px; background-color:transparent;
  background-size:contain; background-repeat:no-repeat; background-position:center;
  filter:drop-shadow(0 3px 7px rgba(0,0,0,.6)); transition:transform .22s, filter .22s}
.ar-ui .card[aria-pressed="true"]{color:var(--gold-bright); font-weight:700}
.ar-ui .card[aria-pressed="true"] .chip{transform:scale(1.18) translateY(-2px);
  filter:drop-shadow(0 0 11px rgba(232,201,138,.9)) drop-shadow(0 4px 8px rgba(0,0,0,.5))}
.ar-ui .card:active .chip{transform:scale(.94)}

/* 고두밥 공정 진행 표시 — 점과 선으로 잇는 타임라인.
   지금 눌러야 할 단계만 인주색으로 살아 있어, 어디를 눌러야 하는지 바로 보인다. */
.ar-ui .steps{display:flex; align-items:flex-start; padding:0 20px; margin-top:2px}
.ar-ui .pill{position:relative; z-index:1; flex:1; display:flex; flex-direction:column; align-items:center; gap:8px;
  border:none; background:none; padding:0; cursor:default; font:inherit; font-size:11.5px; font-weight:600;
  color:rgba(243,230,204,.42); text-shadow:0 1px 6px rgba(0,0,0,.7); transition:.2s}
.ar-ui .pill::before{content:""; box-sizing:border-box; width:22px; height:22px; border-radius:50%;
  background:var(--panel-2); border:2px solid rgba(232,201,138,.3);
  display:grid; place-items:center; font-size:12px; line-height:1; transition:.2s}
/* 다음 점까지 잇는 선 (마지막 단계 제외) */
.ar-ui .pill::after{content:""; position:absolute; z-index:-1; top:10px; left:50%; width:100%; height:2px;
  background:rgba(232,201,138,.25)}
.ar-ui .pill:last-child::after{display:none}
.ar-ui .pill[data-state="done"]{color:rgba(243,230,204,.72)}
.ar-ui .pill[data-state="done"]::before{content:"✓"; color:var(--ink); background:var(--sage); border-color:var(--sage)}
.ar-ui .pill[data-state="done"]::after{background:var(--sage)}
.ar-ui .pill[data-state="now"]{color:var(--gold-bright); cursor:pointer}
.ar-ui .pill[data-state="now"]::before{background:var(--clay); border-color:#dd8a72;
  animation:ar-pulse 1.8s ease-in-out infinite}
@keyframes ar-pulse{0%,100%{box-shadow:0 0 0 0 rgba(181,72,47,.55)}50%{box-shadow:0 0 0 8px rgba(181,72,47,0)}}
.ar-ui .steps-hint{margin:10px 22px 0; text-align:center; font-size:12px; color:var(--gold-bright);
  text-shadow:0 1px 6px rgba(0,0,0,.75)}

.ar-ui .caption{position:absolute; left:0; right:0; bottom:18px; text-align:center; font-size:12px; color:var(--cream-dim)}

.ar-ui .meter{background:var(--cream); color:var(--ink-strong); border:1px solid rgba(198,165,104,.4);
  border-radius:var(--r-md); padding:14px 15px}
.ar-ui .meter .row{display:flex; justify-content:space-between; align-items:baseline; font-size:12.5px; font-weight:600}
.ar-ui .meter .val{color:var(--clay); font-size:14px; font-variant-numeric:tabular-nums}
.ar-ui .meter input[type=range]{-webkit-appearance:none; appearance:none; width:100%; height:9px; margin:12px 0 0;
  border-radius:999px; outline:none; background:linear-gradient(90deg,#3f7a4e,#8fae4a,#e0b23c,#d1662f,#b7332a)}
.ar-ui .meter input[type=range]::-webkit-slider-thumb{-webkit-appearance:none; width:19px;height:19px;border-radius:50%;
  background:#fff; border:2px solid var(--brown); cursor:pointer}
.ar-ui .meter input[type=range]::-moz-range-thumb{width:19px;height:19px;border-radius:50%;background:#fff;border:2px solid var(--brown)}

.ar-ui .bar{height:8px; border-radius:999px; background:rgba(232,201,138,.18); overflow:hidden}
.ar-ui .bar i{display:block; height:100%; width:0; background:var(--sage-deep);
  transition:width .4s linear, background .3s}
/* 온도가 어긋나면 진행 막대와 안내 문구가 함께 색으로 알려준다 */
.ar-ui .bar i[data-state="warn"]{background:#d8a441}
.ar-ui .bar i[data-state="bad"]{background:var(--clay)}
.ar-ui .ferment-row{display:flex; justify-content:space-between; align-items:baseline; font-size:12.5px;
  color:var(--cream-dim); text-shadow:0 1px 6px rgba(0,0,0,.7)}
.ar-ui .ferment-rate[data-state="ok"]{color:var(--sage)}
.ar-ui .ferment-rate[data-state="warn"]{color:#e8c07a}
.ar-ui .ferment-rate[data-state="bad"]{color:#e8927a}
.ar-ui .ferment-pct{font-weight:700; color:var(--gold-bright); font-variant-numeric:tabular-nums}
.ar-ui .meter .val[data-state="ok"]{color:#3f7a4e}
.ar-ui .meter .val[data-state="warn"]{color:#c1862a}
.ar-ui .meter .val[data-state="bad"]{color:var(--clay)}

/* 앱의 .btn-seal(인주 강조버튼)과 같은 규격 — 그림자 없이 색만 다르게 */
.ar-ui .cta{width:100%; box-sizing:border-box; border:1px solid transparent; font-family:var(--font-myeongjo), serif;
  font-weight:700; font-size:15px; line-height:1.3; letter-spacing:.02em; color:#fbeee5; background:var(--clay);
  padding:15px; border-radius:14px; cursor:pointer; box-shadow:none; transition:.2s}
.ar-ui .cta:hover:not(:disabled){background:var(--clay-hi)}
.ar-ui .cta:disabled{background:#3a2c1c; color:rgba(243,230,204,.35); cursor:default}
.ar-ui .cta.ghost{background:transparent; border-color:var(--line); color:var(--cream-dim)}

.ar-ui .seg{display:flex; gap:8px; justify-content:center}
.ar-ui .seg button{border:1px solid var(--line); background:transparent; color:var(--cream-dim); font:inherit;
  font-size:12.5px; padding:9px 16px; border-radius:999px; cursor:pointer}
.ar-ui .seg button[aria-pressed="true"]{background:var(--sage); border-color:var(--sage); color:var(--ink); font-weight:600}

.ar-ui .lead{text-align:center}
.ar-ui .lead h2{margin:0; font-family:var(--font-myeongjo), serif; font-size:19px; letter-spacing:.02em; font-weight:700}
.ar-ui .lead p{margin:10px 0 0; font-size:13px; line-height:1.7; color:var(--cream-dim)}

/* 완료 화면 — 앱의 한지 배경으로 */
/* 위아래 여백을 헤더 위 간격과 비슷하게 두어 내용이 화면 가운데 놓이게 한다 */
.ar-ui #finish{position:absolute; inset:0; display:none; flex-direction:column; align-items:center;
  justify-content:center; text-align:center; padding:46px 22px calc(46px + var(--safe-b));
  overflow-y:auto;
  background:linear-gradient(180deg,#f3ece0 0%,#e7dac3 100%); color:var(--ink);
  animation:ar-rise .5s cubic-bezier(.2,.8,.3,1) both}
/* 도감 카드와 같은 3:4 비율로, 여백 없이 꽉 채운다 */
.ar-ui #finish .finish-drink{width:138px; aspect-ratio:3/4; height:auto; object-fit:cover; display:block;
  border-radius:14px; background:var(--hanji-bright); border:1px solid rgba(198,165,104,.4);
  box-shadow:0 12px 30px rgba(120,95,50,.18); padding:0; margin-bottom:20px}
.ar-ui #finish h1{margin:0; font-family:var(--font-myeongjo), serif; font-size:22px; line-height:1.45;
  letter-spacing:.02em; color:var(--ink)}
.ar-ui #finish p{margin:12px 0 20px; font-size:13px; line-height:1.75; color:var(--ink-soft); max-width:300px}
/* 버튼은 색만 다르게. 위 두 개는 한 줄에 반씩, 아래 하나는 전체 폭 */
.ar-ui #finish .cta{max-width:320px; box-sizing:border-box; display:block; text-align:center; text-decoration:none}
.ar-ui #finish .finish-actions{display:flex; gap:10px; width:100%; max-width:320px}
.ar-ui #finish .finish-actions .cta{flex:1; min-width:0; max-width:none; font-size:14px; padding:14px 8px;
  line-height:1.35; word-break:keep-all}
.ar-ui #finish .finish-actions + .cta{margin-top:10px}
.ar-ui #finish .dex-link{background:var(--brown); color:#f3e6cc}
.ar-ui #finish .dex-link:hover{background:var(--brown-deep)}
/* 밝은 배경에서는 앱의 .btn-outline 처럼 */
.ar-ui #finish .cta.ghost{border:1px solid rgba(58,44,27,.3); background:rgba(255,255,255,.5); color:var(--ink-strong)}

.ar-ui #report{position:absolute; inset:0; background:rgba(36,27,16,.62); backdrop-filter:blur(3px);
  display:none; align-items:flex-end; z-index:20}
.ar-ui #report.open{display:flex}
.ar-ui #report .sheet{width:100%; background:var(--cream); color:var(--ink-strong); border-radius:18px 18px 0 0;
  border-top:1px solid rgba(198,165,104,.4);
  padding:22px 22px calc(22px + var(--safe-b)); animation:ar-up .32s cubic-bezier(.2,.8,.3,1) both}
@keyframes ar-up{from{transform:translateY(100%)}to{transform:none}}
.ar-ui #report h3{margin:0 0 4px; font-family:var(--font-myeongjo), serif; font-size:17px; color:var(--ink)}
.ar-ui #report .sub{font-size:12px; color:var(--ink-faint); margin-bottom:16px}
.ar-ui #report dl{display:grid; grid-template-columns:auto 1fr; gap:11px 14px; margin:0 0 18px; font-size:13px}
.ar-ui #report dt{color:var(--ink-faint)}
.ar-ui #report dd{margin:0; text-align:right; font-weight:600; color:var(--ink-strong)}

.ar-ui .hidden{display:none !important}
/* 단계 패널은 화면 전체를 덮으므로 포인터를 통과시킨다.
   그래야 3D 모드에서 캔버스를 드래그해 시점을 돌릴 수 있다.
   실제로 눌러야 하는 영역(하단 조작부·진행 표시)만 다시 살린다. */
.ar-ui .panel-step{display:none; flex-direction:column; flex:1; pointer-events:none}
.ar-ui .dock, .ar-ui .steps{pointer-events:auto}
.ar-ui[data-step="place"] #p-place,
.ar-ui[data-step="ingredient"] #p-ingredient,
.ar-ui[data-step="godubap"] #p-godubap,
.ar-ui[data-step="ferment"] #p-ferment{display:flex}
.ar-ui[data-step="done"] #finish{display:flex}

@media (prefers-reduced-motion:reduce){.ar-ui *{animation:none !important; transition:none !important}}
`;
