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
import type { Recipe, ModelDef, ArStep } from "@/lib/brewery/types";
import { HandTracker } from "@/lib/hand/handTracker";
import { HandVisual, coverFit, screenDist, screenToWorld, toScreen, worldToScreen, type CoverFit } from "@/lib/hand/handVisual";
import type { HandFrame } from "@/lib/hand/types";
import { FanGesture } from "@/lib/hand/fanGesture";
import { StirGesture } from "@/lib/hand/stirGesture";
import { TRAY_PULL, TrayPullGesture, type TrayPullSnapshot } from "@/lib/hand/trayPullGesture";
import {
  RICE_SPREAD,
  RiceSpreadGesture,
  palmCenter,
  type RiceSpreadSnapshot,
} from "@/lib/hand/riceSpreadGesture";
import { KNEAD, KneadGesture, type KneadSnapshot } from "@/lib/hand/kneadGesture";
import { markObtained } from "@/lib/dex";
import { XrCameraFeed } from "@/lib/hand/xrCameraFeed";
import { styles } from "@/components/arBreweryStyles";

/**
 * 공통 엔진 — 술 종류별 데이터는 recipe(Recipe) 하나로만 받는다.
 * recipe 를 넘기지 않으면 기본 레시피(냥이탁주)로 동작한다.
 */
export default function ArBreweryExperience({ recipe }: { recipe: Recipe }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const uiRoot = rootRef.current;
    if (!canvas || !uiRoot) return;

    const $ = <T extends Element = HTMLElement>(s: string) =>
      uiRoot.querySelector(s) as T | null;
    const $$ = (s: string) => Array.from(uiRoot.querySelectorAll(s));
    const query = new URLSearchParams(window.location.search);
    const trayDebug = query.get("trayDebug") === "1";
    const riceSpreadDebug = query.get("riceSpreadDebug") === "1";
    const kneadDebug = query.get("kneadDebug") === "1";
    const mitsulMixDebug = query.get("mitsulMixDebug") === "1";
    const skipToCooling = trayDebug && query.get("skipTo") === "cooling";
    const skipToRiceSpread = riceSpreadDebug && query.get("skipTo") === "riceSpread";
    const skipToKnead = kneadDebug && query.get("skipTo") === "knead";
    const skipToMitsulMix = mitsulMixDebug && query.get("skipTo") === "mitsulMix";
    /** debug query가 없을 때는 검증된 냉각①~④를 실제 공정으로 사용한다. */
    const productionCooling = !trayDebug && !riceSpreadDebug;
    const productionMitsulMix = mitsulMixDebug || (!trayDebug && !riceSpreadDebug && !kneadDebug);
    uiRoot.classList.toggle("tray-debug", trayDebug);
    uiRoot.classList.toggle("rice-spread-debug", riceSpreadDebug);
    uiRoot.classList.toggle("knead-debug", kneadDebug);
    uiRoot.classList.toggle("mitsul-mix-debug", mitsulMixDebug);

    /* =====================================================================
     * 0. 상태 — 이 술의 바뀌는 데이터는 전부 recipe 에서 온다.
     * ===================================================================*/

    const MODELS = recipe.models;
    const GODUBAP_MODELS = recipe.godubapModels ?? []; // 고두밥 하위 단계별 무대 모델
    const FINISH_MODEL = recipe.finishModel;           // 출고 단계 완성 제품 모델
    const INGREDIENTS = recipe.ingredients;
    const ESSENTIALS = INGREDIENTS.filter((i) => i.essential);
    const ESS_N = ESSENTIALS.length;                 // 주원료 개수 (술마다 달라짐)
    const ESS_NAMES = ESSENTIALS.map((i) => i.name).join("·");
    const OPTIMAL_C = recipe.ferment.optimalC;       // 최적 발효 온도

    const GODUBAP_STEPS = recipe.godubapSteps;
    // 핀 개수가 바뀌어도 로직이 따라오도록 하드코딩 대신 길이를 쓴다.
    const GB_N = GODUBAP_STEPS.length;      // 전체 단계 수
    const GB_LAST = GB_N - 1;               // 마지막 단계 인덱스 — 여기서 장인 퀴즈가 뜬다

    // 담금·발효 타임라인 — 탭을 눌러 진행, 마지막 단계에서만 항아리+자동 발효.
    const FERMENT_STEPS = recipe.fermentSteps;

    // 완성 공정 타임라인 — 발효가 끝난 뒤 손으로 마무리하는 단계들(클릭해 진행).
    const PRESS_STEPS = recipe.pressSteps;

    /** 고두밥을 다 식히는 데 필요한 부채질 횟수 */
    const REQUIRED_FANS = 5;
    /** 쌀을 다 헹구는 데 필요한 휘젓기 바퀴 수 */
    const REQUIRED_RINSE_TURNS = 3;
    /** 침수 — 이만큼 가만히 두면 다 불었다고 본다 */
    const SOAK_MS = 4500;

    const S = {
      step: "place" as "place" | ArStep,
      /** 배치 크기 — "floor"는 실제 크기, "table"은 책상용 미니어처(55%) */
      surface: "floor",
      placed: false,
      selected: new Set<string>(),
      godubap: 0,
      /** 세미 단계에서 지금까지 헹군 바퀴 수 */
      rinseTurns: 0,
      /** 지금 돌고 있는 바퀴의 진행분(0~1) — 막대가 뚝뚝 끊기지 않게 */
      rinsePartial: 0,
      /** 침수를 시작한 시각 (0이면 아직 안 담갔다) */
      soakAt: 0,
      /** 냉각 단계에서 지금까지 부친 횟수 */
      coolFans: 0,
      coolingPhase: "TRAY_PULL" as "TRAY_PULL" | "RICE_SPREAD" | "QUIZ" | "FAN" | "COMPLETE",
      coolTrayProgress: 0,
      coolRiceProgress: 0,
      /** 냉각④ 부채질까지 끝나 고두밥 냉각이 완료됐는가 */
      coolDone: false,
      quizDone: false,
      temp: 27,
      ferment: 0,
      fstage: 0,
      mitsulPhase: "RICE" as "RICE" | "NURUK" | "WATER" | "KNEAD" | "COMPLETE",
      mitsulPourProgress: 0,
      mitsulKneadCount: 0,
      mitsulDone: false,
      press: 0,
      tempLog: [] as number[],
      xr: false,
      /** 손 인식이 돌고 있는가 (AR·카메라 모드 공통) */
      hand: false,
      isInitializing: true,
    };
    /**
     * 받침대 상판 위에 물건을 올릴 때 띄우는 높이(m).
     * 모든 모델이 이 하나의 기준을 쓴다 — 모델마다 기준이 달라지면
     * 어떤 건 허공에 뜨고 어떤 건 상판(또는 실제 탁자) 속에 파묻힌다.
     */
    const CONTENT_LIFT = 0.03;
    const platformContentY = (platformTop: number) => platformTop + CONTENT_LIFT;

    // 원료 단계에 막 들어온 시각 — 화면 전환 직후 밀려오는 '유령 클릭'을 걸러내는 데 쓴다.
    let enteredIngredientAt = 0;
    // 고두밥 하위 단계가 바뀔 때 무대 모델을 갈아 끼우는 함수(buildGodubap 이 채운다)
    let godubapShowStage: (() => void) | null = null;
    let resetCoolingInteraction: (() => void) | null = null;
    let startCoolingFan: (() => void) | null = null;
    let resetKneadInteraction: (() => void) | null = null;
    let resetMitsulMixInteraction: (() => void) | null = null;
    // 완성 공정 단계가 바뀔 때 출고 제품(Nyangi)을 보이는 함수(buildFinish 가 채운다)
    let finishShowShip: (() => void) | null = null;
    // 발효 하위 단계가 바뀔 때 채반고두밥/항아리를 갈아 끼우는 함수(buildFerment 가 채운다)
    let fermentShowStage: (() => void) | null = null;
    /**
     * 지금이 부채질로 식혀야 하는 국면인가.
     *
     * 냉각 단계에 들어오면 장인이 먼저 묻는다 — "지금 누룩을 섞으면 어떻게 되겠나".
     * 답을 하고 나서야 식히기 시작한다. 뜨거우면 안 된다는 걸 알고 손을 부치는 편이
     * 그냥 부치고 나서 질문을 받는 것보다 앞뒤가 맞는다.
     *
     * 손 인식이 돌고 있을 때만 해당한다 — 안 그러면 손을 못 쓰는 기기에서
     * 영영 못 넘어가는 화면이 된다.
     */
    /**
     * 지금이 손으로 헹궈야 하는 국면인가 (세미).
     * 손을 못 쓰는 기기에서는 예전처럼 탭으로 넘어간다.
     */
    function rinseActive() {
      return S.hand && S.godubap === 0 && S.rinseTurns < REQUIRED_RINSE_TURNS;
    }

    /** 지금이 물에 불리는 중인가 (침수) — 손은 필요 없고 시간만 흐르면 된다 */
    function soakActive() {
      return S.hand && S.godubap === 1;
    }

    function coolingActive() {
      return S.hand && S.godubap === GB_LAST && S.coolingPhase === "FAN" && S.quizDone && !S.coolDone;
    }

    function resetIngredientSelection() {
      enteredIngredientAt = performance.now();
      S.selected.clear();
      $$("#grid .card").forEach((c) => c.setAttribute("aria-pressed", "false"));
      const msg = $("#msg-ingredient");
      if (msg) msg.textContent = recipe.intro; // 진입 시 항상 인트로부터
      syncIngredient(); // 버튼 "주원료 0/N" 로 초기화 (interacted=false → 멘트는 인트로 유지)
    }

    /** 손으로 조작하는 단계 — 원료(집기)와 고두밥(부채질) */
    const HAND_STEPS = new Set<typeof S.step>([
      "ingredient",
      "godubap",
      ...((kneadDebug || productionMitsulMix) ? (["ferment"] as const) : []),
    ]);

    function setStep(next: typeof S.step) {
      if (productionCooling && S.step === "godubap" && next !== "godubap") {
        resetCoolingInteraction?.();
      }
      if (productionMitsulMix && S.step === "ferment" && next !== "ferment") {
        resetMitsulMixInteraction?.();
      }
      S.step = next;
      uiRoot!.dataset.step = next;
      // 손을 쓰는 단계에서만 검출을 돌린다. 나머지 단계까지 MediaPipe 를 계속 굴리면
      // GPU 를 나눠 쓰느라 발효·완성 연출이 버벅인다.
      handTracker?.setPaused(!HAND_STEPS.has(next));
      // 완료 화면은 한지 배경이라 헤더도 함께 밝아져야 한다.
      // 다만 'done'의 앞 국면(압착~출고 완성 공정 walkthrough)은 AR 카메라를 그대로 두므로,
      // 헤더도 카메라 톤을 유지한다. 한지 축하 화면(.shipped)일 때만 밝은 헤더로 바꾼다.
      document.documentElement.dataset.arStep = next === "done" ? "ferment" : next;
      // 원료 단계에 들어올 때마다 선택을 깨끗이 비워 '1개 선택된 채 시작'을 막는다.
      if (next === "ingredient") resetIngredientSelection();
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
    // 손을 두 번째 패스로 덧그리므로 자동 클리어를 끄고 직접 관리한다
    renderer.autoClear = false;

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
    const DEBUG_TRAY_ID = "__tray_pull_debug";
    const DEBUG_TRAY_FILE = "/ar/3d-assets/metal_tray.glb";
    const MITSUL_JAR_ID = "__mitsul_jar_body";
    const MITSUL_JAR_FILE = "/ar/3d-assets/jar_body_optimized.glb";

    async function preloadModels() {
      const recipeLoads = Promise.all(
        [...MODELS, ...GODUBAP_MODELS, ...(FINISH_MODEL ? [FINISH_MODEL] : [])].map(async (m) => {
          try {
            LOADED[m.id] = await gltfLoader.loadAsync(m.file);
          } catch (e: any) {
            console.warn("모델 로드 실패:", m.id, m.file, e?.message);
          }
        })
      );
      const debugTrayLoad = trayDebug || riceSpreadDebug || productionCooling
        ? gltfLoader.loadAsync(DEBUG_TRAY_FILE)
            .then((gltf) => { LOADED[DEBUG_TRAY_ID] = gltf; })
            .catch((e: unknown) => console.warn(
              "debug tray 로드 실패:",
              DEBUG_TRAY_FILE,
              e instanceof Error ? e.message : e
            ))
        : Promise.resolve();
      const mitsulJarLoad = productionMitsulMix
        ? gltfLoader.loadAsync(MITSUL_JAR_FILE)
            .then((gltf) => { LOADED[MITSUL_JAR_ID] = gltf; })
            .catch((e: unknown) => console.warn(
              "밑술 항아리 로드 실패:",
              MITSUL_JAR_FILE,
              e instanceof Error ? e.message : e
            ))
        : Promise.resolve();
      await Promise.all([recipeLoads, debugTrayLoad, mitsulJarLoad]);
    }

    function spawnModel(def: ModelDef): THREE.Object3D | null {
      const gltf = LOADED[def.id];
      if (!gltf) return null;

      const root = skinnedClone(gltf.scene) as THREE.Object3D;

      // scaleFactor 가 있으면 원본 대비 배율로, 없으면 목표 높이에 맞춰 자동 정규화한다.
      if (def.scaleFactor) {
        root.scale.setScalar(def.scaleFactor);
      } else {
        const box = new THREE.Box3().setFromObject(root);
        const size = box.getSize(new THREE.Vector3());
        const srcH = size.y || 1;
        root.scale.setScalar(def.height / srcH);
      }

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
      const defs = MODELS.filter(
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
      const defs = MODELS.filter((m) => m.step === step);
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
      /** 손 모드에서 매 프레임 손 상태를 받는 훅. 단계별 build 함수가 채운다. */
      onHand: ((frame: HandFrame, hand: HandVisual) => void) | null;
    } = { particles: [], mixers: [], models: [], tick: null, onHand: null };

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
      live.onHand = null;
      godubapShowStage = null;
      resetCoolingInteraction = null;
      startCoolingFan = null;
      resetKneadInteraction = null;
      resetMitsulMixInteraction = null;
      finishShowShip = null;
      fermentShowStage = null;
      uiRoot!.classList.remove("cooling"); // 냉각 비네트는 무대가 바뀌면 끈다
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

          // 손에 들려 있으면 위치는 onHand 가 정한다. 크기만 키워 "들고 있다"를 보인다.
          if (ud.grabbed) {
            ud.vis = THREE.MathUtils.lerp(ud.vis ?? 1, 1.3, 0.22);
            n.scale.setScalar(ud.vis);
            return;
          }

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

          // 담기면 바구니에 들어앉은 것처럼 살짝 작아진다.
          // 손을 갖다 대면(호버) 커져서 "이걸 집을 수 있다"가 바로 보인다.
          const base = THREE.MathUtils.lerp(1, 0.72, p);
          const want = ud.hover ? base * 1.22 : base;
          ud.vis = THREE.MathUtils.lerp(ud.vis ?? base, want, 0.2);
          n.scale.setScalar(ud.vis);
        });
      };

      /* ── 손으로 집어 담기 ──────────────────────────────────────────────
       * 무엇을 집었는지는 **화면 좌표**로 고른다. 손까지의 거리 추정은 흔들리는데,
       * 3D 거리로 고르면 화면에서는 원료 위에 손이 있는데도 안 집히는 일이 생긴다.
       * 화면 기준으로 고르면 사용자가 보는 것과 판정이 항상 일치한다.
       */
      const basketLocal = new THREE.Vector3(0, basketY, 0);
      const basketWorld = new THREE.Vector3();
      const basketScreen = { x: 0.5, y: 0.5 };
      const nodeWorld = new THREE.Vector3();
      const nodeScreen = { x: 0.5, y: 0.5 };
      const grabTarget = new THREE.Vector3();

      /** 화면에서 이 반경(0~1) 안에 있으면 집을 수 있다 */
      const PICK_R = 0.13;
      /** 바구니 위로 인정하는 반경 — 놓기는 넉넉하게 봐준다 */
      const DROP_R = 0.18;

      let hovered: THREE.Group | null = null;
      let held: THREE.Group | null = null;
      /**
       * 집은 순간의 카메라~원료 거리. 들고 다니는 동안 이 거리를 유지해야
       * 손 거리 추정이 흔들려도 원료 크기가 커졌다 작아졌다 하지 않는다.
       */
      let heldDepth = 1;

      const nameOf = (id: string) => INGREDIENTS.find((i) => i.id === id)?.name ?? "원료";
      const cardOf = (id: string) => $(`#grid .card[data-id="${id}"]`);

      const setHover = (n: THREE.Group | null) => {
        if (hovered === n) return;
        if (hovered) (hovered.userData as any).hover = false;
        hovered = n;
        if (hovered) (hovered.userData as any).hover = true;
      };

      /** 손을 놓쳤거나 단계를 벗어날 때 — 들고 있던 것을 제자리로 돌린다 */
      const dropHeld = () => {
        if (!held) return;
        (held.userData as any).grabbed = false;
        held = null;
      };

      // 조명이 어둡거나 손이 화면 밖이면 인식이 안 잡힌다. 한참 못 잡으면
      // 아래 카드로도 담을 수 있다는 걸 알려 체험이 막히지 않게 한다.
      let lastSeenAt = performance.now();
      const LOST_HINT_MS = 6000;

      live.onHand = (f, hand) => {
        if (!f.present) {
          dropHeld();
          setHover(null);
          setHandHud(
            "idle",
            performance.now() - lastSeenAt > LOST_HINT_MS
              ? "손이 안 보여요 · 아래 카드를 눌러 담아도 돼요"
              : "손을 카메라에 비춰 주세요"
          );
          return;
        }
        lastSeenAt = performance.now();

        const pinch = hand.pinchScreen;

        // 1) 들고 있는 중 — 손끝을 따라오게 하고, 펴면 놓는다
        if (held) {
          const ud = held.userData as any;
          // 화면상 손끝을 따라간다. 거리는 집었을 때 그대로 — 크기가 들쭉날쭉하지 않게.
          screenToWorld(pinch.x, pinch.y, heldDepth, camera, grabTarget);
          stageGroup.worldToLocal(grabTarget);
          held.position.lerp(grabTarget, 0.5);

          stageGroup.localToWorld(basketWorld.copy(basketLocal));
          worldToScreen(basketWorld, camera, basketScreen);
          const overBasket = screenDist(pinch, basketScreen) < DROP_R;

          if (f.justReleased) {
            const id: string = ud.id;
            if (overBasket) {
              // 기존 담기 애니메이션(ud.t 0→1)이 이어받아 바구니 안으로 내려앉는다
              S.selected.add(id);
              cardOf(id)?.setAttribute("aria-pressed", "true");
              syncIngredient(INGREDIENTS.find((i) => i.id === id), true);
              setHandHud("dropped", `${nameOf(id)}을(를) 바구니에 담았어요`);
            } else {
              setHandHud("tracking", `${nameOf(id)}을(를) 놓쳤어요 · 다시 집어 보세요`);
            }
            dropHeld();
            return;
          }

          setHandHud(
            "holding",
            overBasket ? `${nameOf(ud.id)} · 손을 펴서 바구니에 놓으세요` : `${nameOf(ud.id)}을(를) 집었어요`
          );
          return;
        }

        // 2) 빈손 — 화면에서 가장 가까운 원료를 고른다
        let best: THREE.Group | null = null;
        let bestD = PICK_R;
        for (const n of ingredientNodes) {
          n.getWorldPosition(nodeWorld);
          worldToScreen(nodeWorld, camera, nodeScreen);
          const d = screenDist(pinch, nodeScreen);
          if (d < bestD) {
            bestD = d;
            best = n;
          }
        }
        setHover(best);

        if (!best) {
          setHandHud("tracking", "원료 위로 손을 옮겨 보세요");
          return;
        }

        const id: string = (best.userData as any).id;

        // 3) 원료 위에서 쥐면 집어 든다
        if (f.justPinched) {
          const ud = best.userData as any;
          ud.grabbed = true;
          held = best;
          best.getWorldPosition(nodeWorld);
          heldDepth = camera.getWorldPosition(handOrigin).distanceTo(nodeWorld);
          // 바구니에 담겨 있던 걸 다시 집었다면 선택에서 빼 준다 (손에 들려 있으니까)
          if (S.selected.has(id)) {
            S.selected.delete(id);
            cardOf(id)?.setAttribute("aria-pressed", "false");
            syncIngredient(undefined, true);
          }
          setHandHud("holding", `${nameOf(id)}을(를) 집었어요`);
          return;
        }

        setHandHud("hover", `${nameOf(id)} · 엄지와 검지를 붙여 집으세요`);
      };
    }

    // ── 냉각/혼합 공용 헬퍼 ─────────────────────────────────────────────
    // 모델의 가로·세로(바닥 면적) 실측 (스폰 직후 부모 없을 때 로컬 좌표)
    function trayFootprint(node: THREE.Object3D): [number, number] {
      const b = new THREE.Box3().setFromObject(node);
      return [b.max.x - b.min.x, b.max.z - b.min.z];
    }
    // 고두밥(쌀) 텍스처 평면 — w×d 크기로. 채반 위에 깔린 고두밥을 표현.
    function makeRicePlane(baseY: number, w: number, d: number): THREE.Mesh | null {
      const rp = recipe.godubapRicePlane;
      if (!rp) return null;
      const tex = new THREE.TextureLoader().load(rp.texture, undefined, undefined,
        (err) => console.warn("고두밥 텍스처 로드 실패:", rp.texture, err));
      tex.colorSpace = THREE.SRGBColorSpace;
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2),
        new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, side: THREE.DoubleSide })
      );
      plane.position.set(0, baseY + rp.y, 0);
      plane.receiveShadow = true;
      return plane;
    }
    // 채반 + 그 위 고두밥 평면을 한 그룹으로. (냉각→혼합 연결에 재사용)
    function makeCooledRice(baseY: number): THREE.Group {
      const group = new THREE.Group();
      const rp = recipe.godubapRicePlane;
      let tw = 0, td = 0;
      const trayDef = GODUBAP_MODELS.find((m) => m.id === "metal_food_tray");
      if (trayDef) {
        const node = spawnModel(trayDef);
        if (node) {
          [tw, td] = trayFootprint(node);
          const g = new THREE.Group();
          g.position.set(0, baseY + trayDef.y, 0);
          g.add(node);
          group.add(g);
        }
      }
      const w = tw > 0 ? tw * 0.92 : (rp?.width ?? 0.2);
      const d = td > 0 ? td * 0.92 : (rp?.depth ?? 0.3);
      const rice = makeRicePlane(baseY, w, d);
      if (rice) group.add(rice);
      return group;
    }

    /* --- 13 · 고두밥 --- */
    function buildGodubap() {
      const platformTop = addPlatform();
      placeCommonModels(stageGroup, platformTop);
      frame3D(platformTop, 0.58, 0.52);

      // 하위 단계별로 갈아 끼울 무대 모델을 미리 만들어 두고 보이기만 토글한다.
      const stage: Record<string, THREE.Object3D[]> = {};
      const drops: THREE.Object3D[] = [];    // 위에서 내려앉는 모션(보자기)
      const scatters: THREE.Object3D[] = []; // 흩뿌리는 모션(고두밥 쌀)
      let gTrayW = 0, gTrayD = 0;            // 채반 실측 (고두밥 평면 크기에 사용)
      GODUBAP_MODELS.forEach((def) => {
        const count = def.scatter && def.scatter > 0 ? def.scatter : 1;
        const groups: THREE.Object3D[] = [];
        for (let k = 0; k < count; k++) {
          const node = spawnModel(def); // 파일이 없으면 null → 빈 그룹(보이지 않음)
          if (node && def.id === "metal_food_tray") [gTrayW, gTrayD] = trayFootprint(node);
          const g = new THREE.Group();
          if (node) g.add(node);
          if (count > 1) {
            // 채반 위 랜덤 산포 (고두밥을 마구 뿌린 느낌)
            const rr = 0.1 * Math.sqrt(Math.random());
            const aa = Math.random() * Math.PI * 2;
            g.position.set(Math.cos(aa) * rr, platformTop + def.y, Math.sin(aa) * rr);
            g.rotation.y = Math.random() * Math.PI * 2;
            g.scale.setScalar(0.001);
            (g.userData as any).delay = 0.05 + k * 0.06; // 스태거 등장
            scatters.push(g);
          } else {
            g.position.set(0, platformTop + def.y, 0);
            if (def.drop) {
              (g.userData as any).restY = platformTop + def.y;
              drops.push(g);
            }
          }
          g.visible = false;
          stageGroup.add(g);
          groups.push(g);
        }
        stage[def.id] = groups;
      });

      /* ── 냉각① tray pull 기술 검증 (?trayDebug=1 전용) ───────────────
       * 실제 metal_tray.glb scene 전체를 하나의 물체로 취급한다. 임시 레일은
       * 방향과 이동량을 읽기 위한 debug geometry이며 production 에셋이 아니다.
      */
      const trayGesture = trayDebug || productionCooling ? new TrayPullGesture() : null;
      const emptyTraySnapshot = (): TrayPullSnapshot => ({
        state: "IDLE", grabbed: false, startSpan: null,
        currentSpan: 0, spanRatio: 1, progress: 0,
      });
      let traySnapshot = emptyTraySnapshot();
      let trayRig: THREE.Group | null = null;
      let trayMover: THREE.Group | null = null;
      let trayModel: THREE.Object3D | null = null;
      let trayTarget: THREE.Object3D | null = null;
      let trayVisualProgress = 0;

      const setDebugText = (id: string, value: string) => {
        const el = $(id);
        if (el) el.textContent = value;
      };

      function updateTrayDebugPanel(frame: HandFrame | null, hovering: boolean) {
        if (!trayDebug) return;
        setDebugText("#tray-debug-hand", frame?.present ? "FOUND" : "LOST");
        setDebugText("#tray-debug-pinch", frame?.pinching ? "CLOSED" : "OPEN");
        setDebugText("#tray-debug-target", hovering ? "HOVER" : "NONE");
        setDebugText("#tray-debug-grab", traySnapshot.grabbed ? "YES" : "NO");
        setDebugText("#tray-debug-start", traySnapshot.startSpan?.toFixed(4) ?? "—");
        setDebugText("#tray-debug-current", traySnapshot.currentSpan.toFixed(4));
        setDebugText("#tray-debug-ratio", traySnapshot.spanRatio.toFixed(3));
        setDebugText("#tray-debug-progress", `${Math.round(traySnapshot.progress * 100)}%`);
        setDebugText("#tray-debug-state", traySnapshot.state);
        $("#tray-debug-ok")?.classList.toggle("visible", traySnapshot.state === "COMPLETE");
      }

      function resetTrayPull() {
        trayGesture?.reset();
        traySnapshot = emptyTraySnapshot();
        trayVisualProgress = 0;
        if (trayMover) trayMover.position.z = 0;
        updateTrayHighlight(false);
        updateTrayDebugPanel(null, false);
        setHandHud("tracking", "노란 표시에 손을 가까이 대세요");
      }

      // metal tray는 냉각①/②가 공유한다. riceSpreadDebug 단독 진입에서도 반드시 꺼낸다.
      const debugGltf = trayDebug || riceSpreadDebug || productionCooling ? LOADED[DEBUG_TRAY_ID] : null;
      if ((trayDebug || productionCooling) && debugGltf?.scene) {
        trayRig = new THREE.Group();
        trayRig.position.set(0, platformTop + 0.12, 0);
        stageGroup.add(trayRig);

        trayMover = new THREE.Group();
        trayMover.position.y = 0.02; // 레일 상단에 트레이 바닥이 얹히도록 띄운다.
        trayRig.add(trayMover);

        // mesh 이름이나 중간 wrapper 구조에 의존하지 않고 scene 전체를 복제한다.
        trayModel = skinnedClone(debugGltf.scene) as THREE.Object3D;
        trayModel.traverse((o: THREE.Object3D) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          if (Array.isArray(mesh.material)) mesh.material = mesh.material.map((m) => m.clone());
          else if (mesh.material) mesh.material = mesh.material.clone();
          const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          materials.forEach((m) => {
            if (!(m instanceof THREE.MeshStandardMaterial)) return;
            m.userData.trayBaseEmissive = m.emissive.getHex();
            m.userData.trayBaseEmissiveIntensity = m.emissiveIntensity;
          });
        });
        const rawTrayBox = new THREE.Box3().setFromObject(trayModel);
        const rawTrayCenter = rawTrayBox.getCenter(new THREE.Vector3());
        trayModel.position.set(-rawTrayCenter.x, -rawTrayBox.min.y, -rawTrayCenter.z);
        trayMover.add(trayModel);

        const trayBox = new THREE.Box3().setFromObject(trayModel);
        const traySize = trayBox.getSize(new THREE.Vector3());

        // 카메라 쪽(+Z)이 실제로 손을 대는 앞 테두리다.
        const targetMarker = new THREE.Mesh(
          new THREE.SphereGeometry(0.012, 16, 12),
          new THREE.MeshBasicMaterial({ color: 0xffd45c, depthTest: false })
        );
        targetMarker.position.set(0, traySize.y + 0.018, traySize.z * 0.5 - 0.025);
        targetMarker.renderOrder = 8;
        targetMarker.visible = trayDebug;
        trayMover.add(targetMarker);
        trayTarget = targetMarker;

        // 최종 선반 에셋이 오기 전까지만 쓰는 얇은 레일/프레임.
        const railMat = new THREE.MeshStandardMaterial({
          color: 0x4b6470, metalness: 0.72, roughness: 0.38,
          transparent: true, opacity: 0.72,
        });
        const addRail = (size: THREE.Vector3, position: THREE.Vector3) => {
          const rail = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), railMat);
          rail.position.copy(position);
          rail.castShadow = rail.receiveShadow = true;
          trayRig!.add(rail);
        };
        const railX = traySize.x * 0.5 + 0.017;
        addRail(new THREE.Vector3(0.018, 0.025, traySize.z + 0.06), new THREE.Vector3(-railX, 0.006, 0));
        addRail(new THREE.Vector3(0.018, 0.025, traySize.z + 0.06), new THREE.Vector3(railX, 0.006, 0));
        addRail(new THREE.Vector3(traySize.x + 0.052, 0.025, 0.018), new THREE.Vector3(0, 0.006, -traySize.z * 0.5 - 0.021));
        addRail(new THREE.Vector3(0.018, 0.12, 0.018), new THREE.Vector3(-railX, -0.047, -traySize.z * 0.5));
        addRail(new THREE.Vector3(0.018, 0.12, 0.018), new THREE.Vector3(railX, -0.047, -traySize.z * 0.5));

        // 레일 방향(+Z)과 완료 위치를 폰 화면에서 바로 확인한다.
        if (trayDebug) {
          const arrow = new THREE.ArrowHelper(
            new THREE.Vector3(0, 0, 1),
            new THREE.Vector3(0, traySize.y + 0.045, traySize.z * 0.5),
            TRAY_PULL.TRAY_PULL_DISTANCE,
            0x52d8ff,
            0.045,
            0.024
          );
          trayRig.add(arrow);
          const endMarker = new THREE.Mesh(
            new THREE.RingGeometry(0.018, 0.026, 24).rotateX(-Math.PI / 2),
            new THREE.MeshBasicMaterial({ color: 0x52d8ff, side: THREE.DoubleSide })
          );
          endMarker.position.set(0, traySize.y + 0.006, TRAY_PULL.TRAY_PULL_DISTANCE);
          trayRig.add(endMarker);
        }
        trayRig.visible = false;
      } else if (trayDebug) {
        console.warn("[trayDebug] metal_tray.glb를 불러오지 못해 tray pull 검증을 비활성화합니다.");
      }
      const trayResetButton = $("#tray-debug-reset") as HTMLButtonElement | null;
      if (trayResetButton) trayResetButton.onclick = resetTrayPull;

      /* ── 냉각② rice spread 기술 검증 (?riceSpreadDebug=1 전용) ───── */
      const riceGesture = riceSpreadDebug || productionCooling ? new RiceSpreadGesture() : null;
      const emptyRiceSnapshot = (): RiceSpreadSnapshot => ({
        state: "IDLE", palm: { x: 0.5, y: 0.5 }, onRice: false,
        moveDistance: 0, currentZone: null, zoneCoverage: [0, 0, 0, 0, 0, 0],
        totalCoverage: 0, progress: 0, justSpread: false,
      });
      let riceSnapshot = emptyRiceSnapshot();
      let riceRig: THREE.Group | null = null;
      let riceSurfaceGroup: THREE.Group | null = null;
      let riceTrayObject: THREE.Object3D | null = null;
      let riceMesh: THREE.Mesh | null = null;
      let riceGeometry: THREE.BufferGeometry | null = null;
      let riceTexture: THREE.Texture | null = null;
      let riceVisualProgress = 0;
      let riceTargetWidth = 0;
      let riceTargetDepth = 0;
      let riceTrayWidth = 0;
      let riceTrayDepth = 0;
      let riceTrayTop = 0;
      let riceSpreadPulseUntil = -Infinity;
      let riceSceneLogged = false;
      const riceZoneMaterials: THREE.MeshBasicMaterial[] = [];
      const riceZoneMeshes: THREE.Mesh[] = [];

      const RICE_VISUAL = {
        startAreaRatio: 0.36,
        finalAreaRatio: 0.95,
        startThickness: 0.042,
        middleThickness: 0.023,
        finalThickness: 0.009,
        startExponent: 2,
        finalExponent: 10,
        textureTileMeters: 0.09,
        segments: 64,
        rings: 10,
      } as const;

      type RiceVertex = { radial: number; angle: number; top: boolean };
      const riceVertices: RiceVertex[] = [];

      function createRiceGeometry() {
        const positions: number[] = [];
        const uvs: number[] = [];
        const indices: number[] = [];
        const addVertex = (radial: number, angle: number, top: boolean) => {
          const index = riceVertices.length;
          riceVertices.push({ radial, angle, top });
          positions.push(0, 0, 0);
          uvs.push(0.5, 0.5);
          return index;
        };

        const topCenter = addVertex(0, 0, true);
        const ringStarts: number[] = [];
        for (let ring = 1; ring <= RICE_VISUAL.rings; ring++) {
          ringStarts.push(riceVertices.length);
          const radial = ring / RICE_VISUAL.rings;
          for (let segment = 0; segment < RICE_VISUAL.segments; segment++) {
            addVertex(radial, segment / RICE_VISUAL.segments * Math.PI * 2, true);
          }
        }

        const firstRing = ringStarts[0];
        for (let segment = 0; segment < RICE_VISUAL.segments; segment++) {
          const next = (segment + 1) % RICE_VISUAL.segments;
          indices.push(topCenter, firstRing + next, firstRing + segment);
        }
        for (let ring = 0; ring < ringStarts.length - 1; ring++) {
          const inner = ringStarts[ring];
          const outer = ringStarts[ring + 1];
          for (let segment = 0; segment < RICE_VISUAL.segments; segment++) {
            const next = (segment + 1) % RICE_VISUAL.segments;
            indices.push(inner + segment, inner + next, outer + segment);
            indices.push(inner + next, outer + next, outer + segment);
          }
        }

        const outerTop = ringStarts[ringStarts.length - 1];
        const bottomRing = riceVertices.length;
        for (let segment = 0; segment < RICE_VISUAL.segments; segment++) {
          addVertex(1, segment / RICE_VISUAL.segments * Math.PI * 2, false);
        }
        const bottomCenter = addVertex(0, 0, false);
        for (let segment = 0; segment < RICE_VISUAL.segments; segment++) {
          const next = (segment + 1) % RICE_VISUAL.segments;
          indices.push(outerTop + segment, outerTop + next, bottomRing + segment);
          indices.push(outerTop + next, bottomRing + next, bottomRing + segment);
          indices.push(bottomCenter, bottomRing + segment, bottomRing + next);
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
        geometry.setIndex(indices);
        return geometry;
      }

      function applyRiceVisual(progress: number) {
        if (!riceMesh || !riceGeometry) return;
        const p = THREE.MathUtils.clamp(progress, 0, 1);
        const shapeT = THREE.MathUtils.smoothstep(p, 0, 1);
        const startLinear = Math.sqrt(RICE_VISUAL.startAreaRatio);
        const finalLinear = Math.sqrt(RICE_VISUAL.finalAreaRatio);
        const linear = THREE.MathUtils.lerp(startLinear, finalLinear, shapeT);
        const width = riceTrayWidth * linear;
        const depth = riceTrayDepth * linear;
        const exponent = THREE.MathUtils.lerp(
          RICE_VISUAL.startExponent,
          RICE_VISUAL.finalExponent,
          shapeT
        );
        const thickness = p <= 0.5
          ? THREE.MathUtils.lerp(RICE_VISUAL.startThickness, RICE_VISUAL.middleThickness, p * 2)
          : THREE.MathUtils.lerp(RICE_VISUAL.middleThickness, RICE_VISUAL.finalThickness, (p - 0.5) * 2);
        const edgeRatio = THREE.MathUtils.lerp(0.52, 0.88, shapeT);
        const edgeHeight = thickness * edgeRatio;

        const position = riceGeometry.getAttribute("position") as THREE.BufferAttribute;
        const uv = riceGeometry.getAttribute("uv") as THREE.BufferAttribute;
        riceVertices.forEach((vertex, index) => {
          const cos = Math.cos(vertex.angle);
          const sin = Math.sin(vertex.angle);
          const boundaryX = Math.sign(cos) * Math.pow(Math.abs(cos), 2 / exponent) * width * 0.5;
          const boundaryZ = Math.sign(sin) * Math.pow(Math.abs(sin), 2 / exponent) * depth * 0.5;
          const x = boundaryX * vertex.radial;
          const z = boundaryZ * vertex.radial;
          const mound = Math.pow(Math.max(0, 1 - vertex.radial * vertex.radial), 1.35);
          const y = vertex.top ? edgeHeight + (thickness - edgeHeight) * mound : 0;
          position.setXYZ(index, x, y, z);
          // 미터 기준 UV로 새로 드러난 면에 texture가 반복되어 밥알 크기가 늘어나지 않는다.
          uv.setXY(
            index,
            0.5 + x / RICE_VISUAL.textureTileMeters,
            0.5 + z / RICE_VISUAL.textureTileMeters
          );
        });
        position.needsUpdate = true;
        uv.needsUpdate = true;
        riceGeometry.computeVertexNormals();
        riceGeometry.computeBoundingBox();
        riceMesh.position.y = riceTrayTop + 0.004;
        riceZoneMeshes.forEach((zone) => {
          zone.position.y = riceTrayTop + 0.004 + thickness + 0.006;
        });
      }

      function updateRiceZones() {
        riceZoneMaterials.forEach((material, zone) => {
          const coverage = riceSnapshot.zoneCoverage[zone] ?? 0;
          material.color.setHex(coverage === 2 ? 0x69d98a : coverage === 1 ? 0xffc857 : 0x52d8ff);
          material.opacity = coverage === 2 ? 0.34 : coverage === 1 ? 0.22 : 0.08;
        });
      }

      function updateRiceDebugPanel(frame: HandFrame | null) {
        if (!riceSpreadDebug) return;
        setDebugText("#rice-debug-hand", frame?.present ? "FOUND" : "LOST");
        setDebugText("#rice-debug-on", riceSnapshot.onRice ? "YES" : "NO");
        setDebugText("#rice-debug-palm-x", riceSnapshot.palm.x.toFixed(3));
        setDebugText("#rice-debug-palm-y", riceSnapshot.palm.y.toFixed(3));
        setDebugText("#rice-debug-move", riceSnapshot.moveDistance.toFixed(3));
        setDebugText("#rice-debug-zone", riceSnapshot.currentZone === null ? "—" : String(riceSnapshot.currentZone + 1));
        const requiredCoverage =
          RICE_SPREAD.ZONE_COLUMNS * RICE_SPREAD.ZONE_ROWS * RICE_SPREAD.COVERAGE_PER_ZONE;
        const firstRow = riceSnapshot.zoneCoverage.slice(0, RICE_SPREAD.ZONE_COLUMNS).join(",");
        const secondRow = riceSnapshot.zoneCoverage.slice(RICE_SPREAD.ZONE_COLUMNS).join(",");
        setDebugText("#rice-debug-coverage", `${riceSnapshot.totalCoverage} / ${requiredCoverage}`);
        setDebugText("#rice-debug-zone-coverage", `${firstRow} / ${secondRow}`);
        setDebugText("#rice-debug-progress", `${Math.round(riceSnapshot.progress * 100)}%`);
        setDebugText("#rice-debug-state", riceSnapshot.state);
        $("#rice-debug-ok")?.classList.toggle("visible", riceSnapshot.state === "COMPLETE");
        const marker = $("#rice-debug-palm-marker") as HTMLElement | null;
        if (marker) {
          marker.style.left = `${riceSnapshot.palm.x * 100}%`;
          marker.style.top = `${riceSnapshot.palm.y * 100}%`;
          marker.classList.toggle("visible", frame?.present === true);
        }
        updateRiceSceneDebug();
      }

      function updateRiceSceneDebug() {
        if (!riceSpreadDebug) return;
        const trayReady = riceTrayObject !== null;
        const riceReady = riceMesh !== null;
        const gridReady = riceZoneMaterials.length === RICE_SPREAD.ZONE_COLUMNS * RICE_SPREAD.ZONE_ROWS;
        setDebugText("#rice-debug-tray-model", debugGltf?.scene ? "READY" : "MISSING");
        setDebugText("#rice-debug-tray-visible", trayReady && riceRig?.visible ? "YES" : "NO");
        setDebugText("#rice-debug-rice-ready", riceReady ? "READY" : "MISSING");
        setDebugText("#rice-debug-grid-ready", gridReady ? "READY" : "MISSING");

        if (!riceSurfaceGroup || !riceRig) {
          setDebugText("#rice-debug-tray-pos", "—");
          return;
        }
        riceRig.updateWorldMatrix(true, true);
        const trayPosition = riceSurfaceGroup.getWorldPosition(new THREE.Vector3());
        setDebugText(
          "#rice-debug-tray-pos",
          `${trayPosition.x.toFixed(2)}, ${trayPosition.y.toFixed(2)}, ${trayPosition.z.toFixed(2)}`
        );

        if (!riceSceneLogged && trayReady && riceReady && gridReady && riceRig.visible) {
          riceSceneLogged = true;
          const trayBounds = new THREE.Box3().setFromObject(riceTrayObject!);
          const ricePosition = riceMesh!.getWorldPosition(new THREE.Vector3());
          console.info("[riceSpreadDebug] scene ready", {
            trayPosition: trayPosition.toArray(),
            trayBounds: {
              min: trayBounds.min.toArray(),
              max: trayBounds.max.toArray(),
            },
            ricePosition: ricePosition.toArray(),
            platformTop,
            cameraPosition: camera.getWorldPosition(new THREE.Vector3()).toArray(),
          });
        }
      }

      function resetRiceSpread() {
        riceGesture?.reset();
        riceSnapshot = emptyRiceSnapshot();
        riceVisualProgress = 0;
        riceSpreadPulseUntil = -Infinity;
        applyRiceVisual(0);
        updateRiceZones();
        updateRiceDebugPanel(null);
        $("#rice-debug-spread")?.classList.remove("visible");
        setHandHud("tracking", "채반 위 여러 영역을 손바닥으로 쓸어주세요");
      }

      if ((riceSpreadDebug || productionCooling) && debugGltf?.scene) {
        riceRig = new THREE.Group();
        // Galaxy에서 검증된 Tray Pull rack 높이와 완료 거리 그대로 재사용한다.
        riceRig.position.set(0, platformTop + 0.12, 0);
        stageGroup.add(riceRig);

        // 사용자가 작업하기 편하도록 tray의 앞(+Z)이 카메라를 향하고 조금 꺼내진 위치에 둔다.
        const cameraLocal = camera.getWorldPosition(new THREE.Vector3());
        stageGroup.worldToLocal(cameraLocal);
        const towardCamera = cameraLocal.sub(riceRig.position).setY(0).normalize();
        if (towardCamera.lengthSq() > 1e-6) {
          riceRig.rotation.y = Math.atan2(towardCamera.x, towardCamera.z);
        }

        riceSurfaceGroup = new THREE.Group();
        riceSurfaceGroup.position.set(0, 0.02, TRAY_PULL.TRAY_PULL_DISTANCE);
        riceRig.add(riceSurfaceGroup);

        const riceTray = skinnedClone(debugGltf.scene) as THREE.Object3D;
        riceTray.traverse((o: THREE.Object3D) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          if (Array.isArray(mesh.material)) mesh.material = mesh.material.map((m) => m.clone());
          else if (mesh.material) mesh.material = mesh.material.clone();
        });
        const rawBox = new THREE.Box3().setFromObject(riceTray);
        const rawCenter = rawBox.getCenter(new THREE.Vector3());
        const traySize = rawBox.getSize(new THREE.Vector3());
        riceTray.position.set(-rawCenter.x, -rawBox.min.y, -rawCenter.z);
        riceSurfaceGroup.add(riceTray);
        riceTrayObject = riceTray;

        riceTrayTop = traySize.y;
        riceTrayWidth = traySize.x;
        riceTrayDepth = traySize.z;
        riceTargetWidth = traySize.x * RICE_SPREAD.TARGET_SURFACE_RATIO;
        riceTargetDepth = traySize.z * RICE_SPREAD.TARGET_SURFACE_RATIO;

        const riceTexturePath = recipe.godubapRicePlane?.texture;
        riceTexture = riceTexturePath
          ? new THREE.TextureLoader().load(
              riceTexturePath,
              undefined,
              undefined,
              (error) => console.warn("rice spread texture 로드 실패:", riceTexturePath, error)
            )
          : null;
        if (riceTexture) {
          riceTexture.colorSpace = THREE.SRGBColorSpace;
          riceTexture.wrapS = THREE.MirroredRepeatWrapping;
          riceTexture.wrapT = THREE.MirroredRepeatWrapping;
          riceTexture.needsUpdate = true;
        }
        riceGeometry = createRiceGeometry();
        riceMesh = new THREE.Mesh(
          riceGeometry,
          new THREE.MeshStandardMaterial({
            color: 0xf1ead7,
            map: riceTexture,
            roughness: 0.96,
          })
        );
        riceMesh.castShadow = riceMesh.receiveShadow = true;
        riceMesh.frustumCulled = false;
        riceSurfaceGroup.add(riceMesh);
        applyRiceVisual(0);

        // 2×3 target grid. 방문한 zone은 청록색에서 녹색으로 바뀐다.
        const cellW = riceTargetWidth / RICE_SPREAD.ZONE_COLUMNS;
        const cellD = riceTargetDepth / RICE_SPREAD.ZONE_ROWS;
        for (let row = 0; row < RICE_SPREAD.ZONE_ROWS; row++) {
          for (let col = 0; col < RICE_SPREAD.ZONE_COLUMNS; col++) {
            const material = new THREE.MeshBasicMaterial({
              color: 0x52d8ff, transparent: true, opacity: 0.08,
              depthTest: false, side: THREE.DoubleSide,
            });
            const zone = new THREE.Mesh(
              new THREE.PlaneGeometry(cellW * 0.94, cellD * 0.94).rotateX(-Math.PI / 2),
              material
            );
            zone.position.set(
              -riceTargetWidth * 0.5 + cellW * (col + 0.5),
              riceTrayTop + 0.06,
              -riceTargetDepth * 0.5 + cellD * (row + 0.5)
            );
            zone.renderOrder = 9;
            zone.visible = riceSpreadDebug;
            riceSurfaceGroup.add(zone);
            riceZoneMaterials.push(material);
            riceZoneMeshes.push(zone);
          }
        }
        riceRig.visible = false;
        updateRiceSceneDebug();
      } else if (riceSpreadDebug) {
        console.warn("[riceSpreadDebug] metal_tray.glb를 불러오지 못해 rice spread 검증을 비활성화합니다.");
        updateRiceSceneDebug();
      }

      const riceResetButton = $("#rice-debug-reset") as HTMLButtonElement | null;
      if (riceResetButton) riceResetButton.onclick = resetRiceSpread;

      // 냉각 때 채반 위에 까는 고두밥(쌀) 텍스처 평면 — 채반 크기에 맞춰 덮는다.
      if (recipe.godubapRicePlane) {
        const rp = recipe.godubapRicePlane;
        const w = gTrayW > 0 ? gTrayW * 0.92 : rp.width;
        const d = gTrayD > 0 ? gTrayD * 0.92 : rp.depth;
        const plane = makeRicePlane(platformTop, w, d);
        if (plane) {
          plane.visible = false;
          stageGroup.add(plane);
          stage["rice_plane"] = [plane];
        }
      }

      const glow = new THREE.PointLight(0xffd9a0, 0, 0.8);
      glow.position.set(0, 0.2, 0);
      stageGroup.add(glow);

      const steam = makeParticles(140, {
        color: 0xf2ecdb, size: 0.016, opacity: 0, speed: 0.15,
        radius: 0.1, baseY: 0.24, height: 0.34, taper: 0.55,
      });
      stageGroup.add(steam);
      live.particles.push(steam);

      // 그릇 물 — 평면이 아니라 납작한 반구 돔(휘어진 면)으로. 침수에서 차오르고 탈수에서 빠진다.
      // (높이·곡률이 안 맞으면 아래 세 값만 조절하면 된다)
      const WATER_R = 0.14;                    // 물 반경
      const DOME_FLATTEN = 0.34;               // 돔 납작 정도 (작을수록 평평, 클수록 봉긋)
      const waterLowY = platformTop + 0.03;
      const waterHighY = platformTop + 0.14;   // ★ 물 높이: 이 숫자를 키우면 물이 더 높이 찬다 (쌀 위로 올리려면 0.18~0.20)
      const water = new THREE.Mesh(
        // 위쪽 반구(돔). thetaLength=π/2 → 가장자리(적도)에서 정수리까지 휘어진 면.
        new THREE.SphereGeometry(WATER_R, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshBasicMaterial({
          color: 0x5db4e6, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false,
        })
      );
      water.scale.set(1, DOME_FLATTEN, 1);
      water.position.y = waterLowY;
      water.visible = false;
      stageGroup.add(water);
      let waterLevel = 0;

      // 탈수 물빠짐 물방울 — 물이 빠지는 동안 아래로 후두둑 떨어진다.
      const drip = makeParticles(70, {
        color: 0xcfe6ef, size: 0.011, opacity: 0, speed: 0.9,
        radius: WATER_R * 0.9, baseY: waterHighY, height: -0.24, taper: -0.15,
      });
      stageGroup.add(drip);
      live.particles.push(drip);

      // 그릇 속 쌀 — 물에 잠겨 있다가 휘저으면 물살을 따라 돈다.
      // 낱알 모델을 뿌리는 대신 쌀 텍스처를 입힌 원판 하나로 둔다. 물 밑에서
      // 살짝 비쳐 보이기만 하면 되는 자리라 낱알을 세는 비용이 아깝다.
      const bowlRice = (() => {
        const rp = recipe.godubapRicePlane;
        if (!rp) return null;
        const tex = new THREE.TextureLoader().load(rp.texture, undefined, undefined,
          (err) => console.warn("쌀 텍스처 로드 실패:", rp.texture, err));
        tex.colorSpace = THREE.SRGBColorSpace;
        const mesh = new THREE.Mesh(
          new THREE.CircleGeometry(WATER_R * 0.72, 40).rotateX(-Math.PI / 2),
          new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, transparent: true })
        );
        mesh.position.y = platformTop + 0.055;
        mesh.visible = false;
        stageGroup.add(mesh);
        return mesh;
      })();
      if (bowlRice) stage["bowl_rice"] = [bowlRice];

      let coolT = 0; // 냉각 연출 진행 시간
      /** 한 번 부칠 때마다 1로 튀었다가 잦아든다 — 김이 훅 흩어지는 연출에 쓴다 */
      let fanPulse = 0;

      // 현재 하위 단계에 맞춰 무대 모델을 보이거나 숨긴다.
      godubapShowStage = () => {
        const cur = GODUBAP_STEPS[Math.min(S.godubap, GB_LAST)];
        const show = new Set(cur?.models ?? []);
        Object.entries(stage).forEach(([id, groups]) => {
          // 검증된 냉각 interaction에서는 기존 metal_food_tray를 새 metal_tray로 교체한다.
          const interactiveCooling =
            (trayDebug || riceSpreadDebug || (productionCooling && S.godubap >= GB_LAST)) && cur?.dark;
          const debugReplacement = interactiveCooling &&
            (id === "metal_food_tray" || id === "rice_plane");
          const on = show.has(id) && !debugReplacement;
          groups.forEach((g) => (g.visible = on));
        });
        if (trayRig) {
          trayRig.visible =
            (trayDebug && cur?.dark === true) ||
            (productionCooling && S.godubap === GB_LAST && S.coolingPhase === "TRAY_PULL");
        }
        if (riceRig) {
          // 손 상태나 model list가 아니라 debug mode + cooling index만으로 표시한다.
          riceRig.visible =
            (riceSpreadDebug && S.godubap === GB_LAST) ||
            (productionCooling && S.godubap >= GB_LAST && S.coolingPhase !== "TRAY_PULL");
          updateRiceSceneDebug();
        }
        steam.visible = skipToRiceSpread && S.godubap === GB_LAST
          ? false
          : productionCooling && S.godubap >= GB_LAST
            ? S.coolingPhase === "FAN" || S.coolingPhase === "COMPLETE"
            : true;
        const dark = cur?.dark === true;
        if (!dark) coolT = 0;
        uiRoot!.classList.toggle("cooling", dark); // 가장자리 비네트
      };
      godubapShowStage();

      live.tick = (t, dt) => {
        const cur = GODUBAP_STEPS[S.godubap];

        if (trayMover) {
          trayVisualProgress += (traySnapshot.progress - trayVisualProgress) * 0.18;
          trayMover.position.z = trayVisualProgress * TRAY_PULL.TRAY_PULL_DISTANCE;
        }
        if (riceMesh) {
          riceVisualProgress +=
            (riceSnapshot.progress - riceVisualProgress) * RICE_SPREAD.VISUAL_SMOOTHING;
          applyRiceVisual(riceVisualProgress);
          $("#rice-debug-spread")?.classList.toggle(
            "visible",
            performance.now() < riceSpreadPulseUntil
          );
        }

        if (
          productionCooling &&
          S.godubap === GB_LAST &&
          S.coolingPhase === "TRAY_PULL" &&
          traySnapshot.state === "COMPLETE" &&
          trayVisualProgress >= 0.985
        ) {
          S.coolTrayProgress = 1;
          S.coolingPhase = "RICE_SPREAD";
          if (trayRig && riceRig) {
            riceRig.position.copy(trayRig.position);
            riceRig.quaternion.copy(trayRig.quaternion);
            riceRig.scale.copy(trayRig.scale);
          }
          riceGesture?.reset();
          riceSnapshot = emptyRiceSnapshot();
          riceVisualProgress = 0;
          applyRiceVisual(0);
          godubapShowStage?.();
          syncGodubap();
          setHandHud("tracking", "고두밥을 채반 위에 골고루 펼쳐주세요");
        }

        if (
          productionCooling &&
          S.godubap === GB_LAST &&
          S.coolingPhase === "RICE_SPREAD" &&
          riceSnapshot.state === "COMPLETE" &&
          riceVisualProgress >= 0.985
        ) {
          S.coolRiceProgress = 1;
          S.coolingPhase = "QUIZ";
          godubapShowStage?.();
          syncGodubap();
          $("#quiz")?.classList.remove("hidden");
          setHandHud("idle", "고두밥을 골고루 펼쳤어요 · 장인의 질문에 답해주세요");
        }

        // 침수 — 담가 두고 기다리면 다 분다. 손으로 할 일은 없다.
        if (soakActive()) {
          if (!S.soakAt) S.soakAt = performance.now();
          const soaked = performance.now() - S.soakAt;
          syncGodubapGame();
          if (soaked >= SOAK_MS) {
            S.godubap = 2; // 탈수 — 아래 water 값이 0이라 물이 빠지는 연출로 이어진다
            syncGodubap();
          }
        }

        // 김 — steam:true 단계에서만
        const steaming = cur?.steam === true;

        // 냉각 단계에서는 김이 남아 있다가 부칠수록 걷힌다 — 진행도가 눈에 보이게.
        const cooling = cur?.dark === true && coolingActive();
        const coolLeft = Math.max(0, 1 - S.coolFans / REQUIRED_FANS);
        fanPulse = Math.max(0, fanPulse - dt * 1.6);

        const glowTarget = steaming ? 1.6 : cooling ? 0.5 * coolLeft : 0.05;
        glow.intensity += (glowTarget - glow.intensity) * 0.05;

        const steamTarget = steaming ? 0.55 : cooling ? 0.5 * coolLeft : 0;
        steam.material.opacity += (steamTarget - steam.material.opacity) * 0.06;
        const opt = (steam.userData as any).opt;
        // 부친 순간에는 김이 빠르게 옆으로 퍼진다
        opt.speed = steaming ? 0.35 : cooling ? 0.2 + fanPulse * 0.9 : 0.15;
        opt.radius = 0.1 + fanPulse * 0.12;

        // 물 — 현재 단계 water 값으로 채워지고 빠진다
        const targetWater = cur?.water ?? 0;
        waterLevel += (targetWater - waterLevel) * 0.06;
        water.visible = waterLevel > 0.01;
        water.position.y = THREE.MathUtils.lerp(waterLowY, waterHighY, waterLevel);
        (water.material as THREE.MeshBasicMaterial).opacity = 0.72 * waterLevel;
        // 휘저으면 물이 더 크게 출렁이고 쌀도 물살을 따라 돈다
        const swirl = stir.speed;
        water.rotation.y += (0.25 + swirl * 6) * dt;
        const wobble = (0.012 + swirl * 0.05) * waterLevel;
        const ripple = 1 + Math.sin(t * (2.2 + swirl * 6)) * wobble;
        water.scale.set(ripple, DOME_FLATTEN * (1 + swirl * 0.12), ripple);
        if (bowlRice) {
          bowlRice.rotation.y += (0.1 + swirl * 7) * dt;
          // 찰박이는 느낌 — 물살이 셀수록 쌀도 위아래로 조금 들썩인다
          bowlRice.position.y =
            platformTop + 0.055 + Math.sin(t * (3 + swirl * 8)) * swirl * 0.006;
        }

        // 물빠짐 물방울 — 물이 있는데 목표가 0(=탈수)일 때만 떨어진다
        const draining = targetWater < 0.1 && waterLevel > 0.06;
        drip.material.opacity += ((draining ? 0.85 : 0) - drip.material.opacity) * 0.12;

        // 냉각 연출 — 보자기 내려앉기 + 고두밥 흩뿌리기
        if (cur?.dark) {
          coolT += dt;
          drops.forEach((g) => {
            const restY = (g.userData as any).restY as number;
            const p = THREE.MathUtils.smoothstep(THREE.MathUtils.clamp(coolT / 0.8, 0, 1), 0, 1);
            g.position.y = restY + (1 - p) * 0.09; // 위에서 사뿐히 내려앉음
          });
          scatters.forEach((g) => {
            const d = (g.userData as any).delay as number;
            const pp = THREE.MathUtils.clamp((coolT - d) / 0.3, 0, 1);
            g.scale.setScalar(THREE.MathUtils.smoothstep(pp, 0, 1));
          });
        }
      };

      /* ── 손으로 부채질하기 ──────────────────────────────────────────
       * 좌우로 흔든 왕복을 세어 REQUIRED_FANS 번이면 다 식은 것으로 본다.
       * 판정은 lib/hand/fanGesture.ts 가 하고, 여기서는 결과만 받아 쓴다.
       */
      const fan = new FanGesture();
      const stir = new StirGesture();
      resetCoolingInteraction = () => {
        S.coolingPhase = "TRAY_PULL";
        S.coolTrayProgress = 0;
        S.coolRiceProgress = 0;
        S.coolFans = 0;
        S.coolDone = false;
        S.quizDone = false;
        resetTrayPull();
        resetRiceSpread();
        fan.reset();
        $("#quiz")?.classList.add("hidden");
        handTracker?.setPaused(false);
        godubapShowStage?.();
        setHandHud("tracking", "채반 앞쪽을 잡고 앞으로 당겨주세요");
      };
      startCoolingFan = () => {
        S.coolingPhase = "FAN";
        S.coolFans = 0;
        fan.reset();
        steam.visible = true;
        steam.material.opacity = 0.55;
        godubapShowStage?.();
        syncGodubap();
        setHandHud("tracking", "손을 좌우로 흔들어 고두밥을 식혀주세요");
      };
      const trayWorld = new THREE.Vector3();
      const trayCameraLocal = new THREE.Vector3();
      const trayScreen = { x: 0, y: 0 };
      const riceCenterWorld = new THREE.Vector3();
      const riceRightWorld = new THREE.Vector3();
      const riceFrontWorld = new THREE.Vector3();
      const riceCenterScreen = { x: 0, y: 0 };
      const riceRightScreen = { x: 0, y: 0 };
      const riceFrontScreen = { x: 0, y: 0 };

      function updateTrayHighlight(hovering: boolean) {
        trayModel?.traverse((o: THREE.Object3D) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          materials.forEach((m) => {
            if (!(m instanceof THREE.MeshStandardMaterial)) return;
            m.emissive.setHex(hovering ? 0x5a4210 : (m.userData.trayBaseEmissive ?? 0));
            m.emissiveIntensity = hovering ? 0.75 : (m.userData.trayBaseEmissiveIntensity ?? 1);
          });
        });
      }

      function handleTrayPull(f: HandFrame, hand: HandVisual, debug = trayDebug) {
        if (!trayGesture || !trayRig || !trayTarget) return;

        // grab 전에는 임시 레일의 +Z가 현재 사용자/카메라를 향하게 한다.
        // grab 순간부터는 방향을 잠가 손의 좌우·상하 움직임이 tray 경로를 바꾸지 못한다.
        if (!traySnapshot.grabbed && traySnapshot.state !== "COMPLETE") {
          camera.getWorldPosition(trayCameraLocal);
          stageGroup.worldToLocal(trayCameraLocal);
          trayCameraLocal.sub(trayRig.position).setY(0);
          if (trayCameraLocal.lengthSq() > 1e-6) {
            trayRig.rotation.y = Math.atan2(trayCameraLocal.x, trayCameraLocal.z);
          }
        }

        trayRig.updateWorldMatrix(true, true);
        trayTarget.getWorldPosition(trayWorld);
        worldToScreen(trayWorld, camera, trayScreen);
        const hovering = f.present && screenDist(hand.pinchScreen, trayScreen) <= TRAY_PULL.GRAB_RADIUS;
        traySnapshot = trayGesture.update(f, hovering);
        if (!debug) {
          S.coolTrayProgress = traySnapshot.progress;
          syncGodubapGame();
        }

        updateTrayHighlight(hovering || traySnapshot.grabbed);
        updateTrayDebugPanel(f, hovering);

        if (traySnapshot.state === "COMPLETE") {
          setHandHud("dropped", debug ? "TRAY PULL OK" : "채반을 꺼냈어요");
        }
        else if (traySnapshot.grabbed) setHandHud("holding", "잡은 채 손을 몸 쪽으로 당겨 주세요");
        else if (hovering) setHandHud("hover", "앞쪽 테두리에서 엄지와 검지를 붙이세요");
        else if (!f.present) setHandHud("idle", "손을 카메라에 비춰 주세요");
        else setHandHud("tracking", "노란 표시에 손을 가까이 대세요");
      }

      function handleRiceSpread(f: HandFrame, debug = riceSpreadDebug) {
        if (!riceGesture || !riceRig || !riceSurfaceGroup) return;

        const rawPalm = palmCenter(f);
        const palm = rawPalm ? toScreen(rawPalm, handFit) : riceSnapshot.palm;
        let onRice = false;
        const targetPoint = { x: 0.5, y: 0.5 };

        if (rawPalm && riceTargetWidth > 0 && riceTargetDepth > 0) {
          riceSurfaceGroup.updateWorldMatrix(true, true);
          riceSurfaceGroup.localToWorld(riceCenterWorld.set(0, riceTrayTop + 0.03, 0));
          riceSurfaceGroup.localToWorld(riceRightWorld.set(riceTargetWidth * 0.5, riceTrayTop + 0.03, 0));
          riceSurfaceGroup.localToWorld(riceFrontWorld.set(0, riceTrayTop + 0.03, riceTargetDepth * 0.5));
          worldToScreen(riceCenterWorld, camera, riceCenterScreen);
          worldToScreen(riceRightWorld, camera, riceRightScreen);
          worldToScreen(riceFrontWorld, camera, riceFrontScreen);

          // 회전·원근이 적용된 tray의 두 화면 basis를 풀어 target 내부 좌표를 구한다.
          const ax = riceRightScreen.x - riceCenterScreen.x;
          const ay = riceRightScreen.y - riceCenterScreen.y;
          const bx = riceFrontScreen.x - riceCenterScreen.x;
          const by = riceFrontScreen.y - riceCenterScreen.y;
          const px = palm.x - riceCenterScreen.x;
          const py = palm.y - riceCenterScreen.y;
          const det = ax * by - ay * bx;
          if (Math.abs(det) > 1e-6) {
            const localX = (px * by - py * bx) / det;
            const localZ = (ax * py - ay * px) / det;
            onRice = Math.abs(localX) <= 1 && Math.abs(localZ) <= 1;
            targetPoint.x = THREE.MathUtils.clamp((localX + 1) * 0.5, 0, 1);
            targetPoint.y = THREE.MathUtils.clamp((localZ + 1) * 0.5, 0, 1);
          }
        }

        riceSnapshot = riceGesture.update({
          present: f.present && rawPalm !== null,
          onRice,
          palm,
          targetPoint,
        });
        if (!debug) {
          S.coolRiceProgress = riceSnapshot.progress;
          syncGodubapGame();
        }
        if (riceSnapshot.justSpread) riceSpreadPulseUntil = performance.now() + 420;
        updateRiceZones();
        updateRiceDebugPanel(f);

        if (riceSnapshot.state === "COMPLETE") {
          setHandHud("dropped", debug ? "RICE SPREAD OK" : "고두밥을 골고루 펼쳤어요");
        }
        else if (riceSnapshot.state === "SPREADING") {
          setHandHud("holding", debug ? "SPREAD! · 다른 영역도 넓게 쓸어주세요" : "다른 부분도 골고루 펼쳐주세요");
        }
        else if (riceSnapshot.onRice) setHandHud("hover", "손바닥으로 고두밥 표면을 넓게 쓸어주세요");
        else if (!f.present) setHandHud("idle", "손을 카메라에 비춰 주세요");
        else setHandHud("tracking", "채반 위 고두밥에 손바닥을 올려주세요");
      }

      live.onHand = (f, hand) => {
        if (riceSpreadDebug && S.godubap === GB_LAST) {
          handleRiceSpread(f);
          return;
        }
        // 이 spike는 냉각 production progression과 분리한다. debug에서만 부채질 대신 실행된다.
        if (trayDebug && S.godubap === GB_LAST) {
          handleTrayPull(f, hand);
          return;
        }
        if (productionCooling && S.godubap === GB_LAST) {
          if (S.coolingPhase === "TRAY_PULL") {
            handleTrayPull(f, hand, false);
            return;
          }
          if (S.coolingPhase === "RICE_SPREAD") {
            handleRiceSpread(f, false);
            return;
          }
          if (S.coolingPhase === "QUIZ") {
            setHandHud("idle", "장인의 질문에 답해주세요");
            return;
          }
          if (S.coolingPhase === "COMPLETE") return;
          // FAN만 아래 기존 FanGesture 경로로 보낸다.
        }

        // ── 세미 — 그릇에 손을 넣고 둥글게 휘저어 쌀을 헹군다 ──────────────
        if (rinseActive()) {
          const turns = stir.update(f);
          S.rinsePartial = stir.partial;
          if (turns) {
            S.rinseTurns = Math.min(REQUIRED_RINSE_TURNS, S.rinseTurns + turns);
            if (S.rinseTurns >= REQUIRED_RINSE_TURNS) {
              // 다 헹궜으면 그대로 물에 담가 둔다 (침수)
              stir.reset();
              S.rinsePartial = 0;
              S.godubap = 1;
              S.soakAt = performance.now();
              syncGodubap();
              return;
            }
          }
          // 막대는 매 프레임 갱신한다 — 한 바퀴 돌 때만 움직이면 멈춘 것처럼 보인다
          syncGodubapGame();
          if (!f.present) setHandHud("idle", "손을 카메라에 비춰 주세요");
          else
            setHandHud(
              "tracking",
              `그릇 안에서 손을 둥글게 돌려 주세요 · ${S.rinseTurns}/${REQUIRED_RINSE_TURNS}바퀴`
            );
          return;
        }

        if (!coolingActive()) {
          if (!f.present) setHandHud("idle", "손을 카메라에 비춰 주세요");
          return;
        }

        const gained = fan.update(f);
        if (gained) {
          S.coolFans = Math.min(REQUIRED_FANS, S.coolFans + gained);
          fanPulse = 1;
          syncGodubapGame();
          // 냉각④ 완료 — tray와 펼쳐진 rice는 그대로 두고 손 추적만 쉰다.
          if (S.coolFans >= REQUIRED_FANS && !S.coolDone) {
            S.coolDone = true;
            S.coolingPhase = "COMPLETE";
            fan.reset();
            S.godubap = GB_N; // 다 식었으니 고두밥 완성
            handTracker?.setPaused(true);
            syncGodubap();
            setHandHud("dropped", "고두밥이 충분히 식었어요!");
          }
          return;
        }

        if (!f.present) setHandHud("idle", "손을 카메라에 비춰 주세요");
        else setHandHud("tracking", `손을 좌우로 흔들어 식혀 주세요 · ${S.coolFans}/${REQUIRED_FANS}`);
      };
    }

    /* --- 14 · 밑술 치대기 기술 검증 (?kneadDebug=1 전용) --- */
    function buildKneadDebug() {
      const platformTop = addPlatform();
      frame3D(platformTop + 0.18, 0.7, 0.62);

      const JAR_HEIGHT = 0.24;
      const JAR_TOP_RADIUS = 0.125;
      const MASH_RADIUS = 0.105;
      const MASH_START_HEIGHT = 0.028;
      const MASH_FINAL_HEIGHT = 0.014;
      const MASH_BOTTOM_Y = JAR_HEIGHT - 0.052;

      const jarRig = new THREE.Group();
      jarRig.position.set(0, platformTop, 0);
      stageGroup.add(jarRig);

      // 대형 후보 GLB 대신 mobile spike용 open primitive 항아리를 사용한다.
      const jarMaterial = new THREE.MeshStandardMaterial({
        color: 0x50372a,
        roughness: 0.78,
        metalness: 0.04,
        side: THREE.DoubleSide,
      });
      const jarBody = new THREE.Mesh(
        new THREE.CylinderGeometry(JAR_TOP_RADIUS, 0.098, JAR_HEIGHT, 48, 1, true),
        jarMaterial
      );
      jarBody.position.y = JAR_HEIGHT * 0.5;
      jarBody.castShadow = jarBody.receiveShadow = true;
      jarRig.add(jarBody);

      const jarBase = new THREE.Mesh(
        new THREE.CylinderGeometry(0.098, 0.098, 0.018, 48),
        jarMaterial
      );
      jarBase.position.y = 0.009;
      jarBase.castShadow = jarBase.receiveShadow = true;
      jarRig.add(jarBase);

      const jarLip = new THREE.Mesh(
        new THREE.TorusGeometry(JAR_TOP_RADIUS, 0.012, 12, 48).rotateX(Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: 0x34241d, roughness: 0.66 })
      );
      jarLip.position.y = JAR_HEIGHT;
      jarLip.castShadow = true;
      jarRig.add(jarLip);

      const mashTexturePath = recipe.godubapRicePlane?.texture;
      const mashTexture = mashTexturePath
        ? new THREE.TextureLoader().load(
            mashTexturePath,
            undefined,
            undefined,
            (error) => console.warn("knead mash texture 로드 실패:", mashTexturePath, error)
          )
        : null;
      if (mashTexture) {
        mashTexture.colorSpace = THREE.SRGBColorSpace;
        mashTexture.wrapS = THREE.MirroredRepeatWrapping;
        mashTexture.wrapT = THREE.MirroredRepeatWrapping;
        mashTexture.repeat.set(2.4, 2.4);
      }
      const mashMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(MASH_RADIUS, MASH_RADIUS * 0.98, MASH_START_HEIGHT, 48),
        new THREE.MeshStandardMaterial({
          color: 0xc8b894,
          map: mashTexture,
          roughness: 0.96,
        })
      );
      mashMesh.castShadow = mashMesh.receiveShadow = true;
      jarRig.add(mashMesh);

      const targetMaterial = new THREE.MeshBasicMaterial({
        color: 0x52d8ff,
        transparent: true,
        opacity: 0.72,
        side: THREE.DoubleSide,
        depthTest: false,
      });
      const targetOutline = new THREE.Mesh(
        new THREE.RingGeometry(MASH_RADIUS * 0.96, MASH_RADIUS * KNEAD.TARGET_PADDING, 48)
          .rotateX(-Math.PI / 2),
        targetMaterial
      );
      targetOutline.position.y = MASH_BOTTOM_Y + MASH_START_HEIGHT + 0.006;
      targetOutline.renderOrder = 9;
      jarRig.add(targetOutline);

      const kneadGesture = new KneadGesture();
      const emptyKneadSnapshot = (): KneadSnapshot => ({
        state: "WAIT_OPEN",
        pose: "TRANSITION",
        onMash: false,
        handRatio: 0,
        fingertipMeanDistance: 0,
        palmScale: 0,
        count: 0,
        progress: 0,
        justKneaded: false,
      });
      let kneadSnapshot = emptyKneadSnapshot();
      let kneadPulse = 0;
      let feedbackUntil = -Infinity;

      const mashCenterWorld = new THREE.Vector3();
      const mashRightWorld = new THREE.Vector3();
      const mashFrontWorld = new THREE.Vector3();
      const mashCenterScreen = { x: 0.5, y: 0.5 };
      const mashRightScreen = { x: 0.5, y: 0.5 };
      const mashFrontScreen = { x: 0.5, y: 0.5 };

      const setKneadText = (id: string, value: string) => {
        const element = $(id);
        if (element) element.textContent = value;
      };

      function applyMashVisual() {
        const progress = kneadSnapshot.progress;
        const height = THREE.MathUtils.lerp(MASH_START_HEIGHT, MASH_FINAL_HEIGHT, progress);
        const spread = THREE.MathUtils.lerp(0.9, 1, progress) + kneadPulse * 0.035;
        mashMesh.scale.set(spread, height / MASH_START_HEIGHT, spread);
        mashMesh.position.y = MASH_BOTTOM_Y + height * 0.5 + kneadPulse * 0.002;
        targetOutline.position.y = MASH_BOTTOM_Y + height + 0.006;
      }

      function updateKneadPanel(frame: HandFrame | null, palm: { x: number; y: number }) {
        if (!kneadDebug) return;
        setKneadText("#knead-debug-hand", frame?.present ? "FOUND" : "LOST");
        setKneadText("#knead-debug-on", kneadSnapshot.onMash ? "YES" : "NO");
        setKneadText("#knead-debug-palm-x", palm.x.toFixed(3));
        setKneadText("#knead-debug-palm-y", palm.y.toFixed(3));
        setKneadText("#knead-debug-ratio", kneadSnapshot.handRatio.toFixed(3));
        setKneadText("#knead-debug-pose", kneadSnapshot.pose);
        setKneadText("#knead-debug-state", kneadSnapshot.state);
        setKneadText(
          "#knead-debug-count",
          `${kneadSnapshot.count} / ${KNEAD.TARGET_KNEAD_COUNT}`
        );
        setKneadText("#knead-debug-progress", `${Math.round(kneadSnapshot.progress * 100)}%`);
        setKneadText("#knead-debug-tip-distance", kneadSnapshot.fingertipMeanDistance.toFixed(4));
        setKneadText("#knead-debug-palm-scale", kneadSnapshot.palmScale.toFixed(4));
        $("#knead-debug-ok")?.classList.toggle("visible", kneadSnapshot.state === "COMPLETE");

        const feedback = $("#knead-debug-feedback");
        if (feedback) {
          feedback.textContent = performance.now() < feedbackUntil
            ? "KNEAD!"
            : kneadSnapshot.pose === "CLOSED"
              ? "SQUEEZE"
              : kneadSnapshot.pose === "OPEN"
                ? "OPEN"
                : "TRANSITION";
        }

        const marker = $("#knead-debug-palm-marker") as HTMLElement | null;
        if (marker) {
          marker.style.left = `${palm.x * 100}%`;
          marker.style.top = `${palm.y * 100}%`;
          marker.classList.toggle("visible", frame?.present === true);
        }
      }

      resetKneadInteraction = () => {
        kneadGesture.reset();
        kneadSnapshot = emptyKneadSnapshot();
        kneadPulse = 0;
        feedbackUntil = -Infinity;
        targetMaterial.color.setHex(0x52d8ff);
        targetMaterial.opacity = 0.72;
        applyMashVisual();
        updateKneadPanel(null, { x: 0.5, y: 0.5 });
        $("#knead-debug-palm-marker")?.classList.remove("visible");
        setHandHud("tracking", "항아리 위에서 손을 펴고 오므린 뒤 다시 펴주세요");
      };

      const resetButton = $("#knead-debug-reset") as HTMLButtonElement | null;
      if (resetButton) resetButton.onclick = resetKneadInteraction;
      resetKneadInteraction();

      live.onHand = (frame) => {
        const rawPalm = palmCenter(frame);
        const palm = rawPalm ? toScreen(rawPalm, handFit) : { x: 0.5, y: 0.5 };
        let onMash = false;

        if (rawPalm) {
          const mashSurfaceY = targetOutline.position.y;
          jarRig.updateWorldMatrix(true, true);
          jarRig.localToWorld(mashCenterWorld.set(0, mashSurfaceY, 0));
          jarRig.localToWorld(mashRightWorld.set(MASH_RADIUS, mashSurfaceY, 0));
          jarRig.localToWorld(mashFrontWorld.set(0, mashSurfaceY, MASH_RADIUS));
          worldToScreen(mashCenterWorld, camera, mashCenterScreen);
          worldToScreen(mashRightWorld, camera, mashRightScreen);
          worldToScreen(mashFrontWorld, camera, mashFrontScreen);

          const ax = mashRightScreen.x - mashCenterScreen.x;
          const ay = mashRightScreen.y - mashCenterScreen.y;
          const bx = mashFrontScreen.x - mashCenterScreen.x;
          const by = mashFrontScreen.y - mashCenterScreen.y;
          const px = palm.x - mashCenterScreen.x;
          const py = palm.y - mashCenterScreen.y;
          const det = ax * by - ay * bx;
          if (Math.abs(det) > 1e-6) {
            const localX = (px * by - py * bx) / det;
            const localZ = (ax * py - ay * px) / det;
            onMash = localX * localX + localZ * localZ <= KNEAD.TARGET_PADDING ** 2;
          }
        }

        kneadSnapshot = kneadGesture.update(frame, onMash);
        targetMaterial.color.setHex(onMash ? 0x69d98a : 0x52d8ff);
        targetMaterial.opacity = onMash ? 0.95 : 0.72;
        if (kneadSnapshot.justKneaded) {
          kneadPulse = 1;
          feedbackUntil = performance.now() + 450;
        }
        applyMashVisual();
        updateKneadPanel(frame, palm);

        if (kneadSnapshot.state === "COMPLETE") setHandHud("dropped", "KNEAD OK");
        else if (!frame.present) setHandHud("idle", "손을 카메라에 비춰 주세요");
        else if (!onMash) setHandHud("tracking", "손바닥을 항아리 안 술덧 위로 옮겨주세요");
        else if (kneadSnapshot.justKneaded) setHandHud("dropped", "KNEAD!");
        else if (kneadSnapshot.pose === "CLOSED") setHandHud("holding", "SQUEEZE · 다시 손을 펴주세요");
        else if (kneadSnapshot.pose === "OPEN") setHandHud("hover", "OPEN · 손을 오므려주세요");
        else setHandHud("tracking", "손 자세를 안정적으로 유지해주세요");
      };

      live.tick = (_t, dt) => {
        kneadPulse = Math.max(0, kneadPulse - dt * 4.5);
        applyMashVisual();
        const feedback = $("#knead-debug-feedback");
        if (feedback && performance.now() >= feedbackUntil && feedback.textContent === "KNEAD!") {
          feedback.textContent = kneadSnapshot.pose;
        }
      };
    }

    /* --- 14 · 발효 --- */
    function buildMitsulMix() {
      const platformTop = addPlatform();
      frame3D(platformTop + 0.2, 0.76, 0.64);

      const JAR_SCALE = 0.17;
      const PICK_RADIUS = 0.13;
      const POUR_TARGET_RADIUS = 0.16;
      const POUR_TILT_RAD = THREE.MathUtils.degToRad(38);
      const POUR_DURATION_MS = 1200;
      const PHASES = ["RICE", "NURUK", "WATER", "KNEAD", "COMPLETE"] as const;
      type MixPhase = (typeof PHASES)[number];
      type PourPhase = "RICE" | "NURUK" | "WATER";
      type PourActor = { phase: PourPhase; label: string; node: THREE.Group; home: THREE.Vector3 };

      const jarRig = new THREE.Group();
      jarRig.position.set(0, platformTop, 0);
      stageGroup.add(jarRig);

      let jarReady = false;
      let jarHeight = 0.28;
      let jarWidth = 0.24;
      const jarGltf = LOADED[MITSUL_JAR_ID];
      if (jarGltf?.scene) {
        const jarModel = skinnedClone(jarGltf.scene) as THREE.Object3D;
        jarModel.scale.setScalar(JAR_SCALE);
        jarModel.traverse((object: THREE.Object3D) => {
          const mesh = object as THREE.Mesh;
          if (!mesh.isMesh) return;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          if (Array.isArray(mesh.material)) mesh.material = mesh.material.map((material) => material.clone());
          else if (mesh.material) mesh.material = mesh.material.clone();
        });
        const bounds = new THREE.Box3().setFromObject(jarModel);
        const center = bounds.getCenter(new THREE.Vector3());
        const size = bounds.getSize(new THREE.Vector3());
        jarModel.position.set(-center.x, -bounds.min.y, -center.z);
        jarRig.add(jarModel);
        jarHeight = size.y;
        jarWidth = Math.max(size.x, size.z);
        jarReady = true;
      } else {
        const fallback = new THREE.Mesh(
          new THREE.CylinderGeometry(0.12, 0.095, jarHeight, 40, 1, true),
          new THREE.MeshStandardMaterial({ color: 0x4b3024, roughness: 0.82, side: THREE.DoubleSide })
        );
        fallback.position.y = jarHeight * 0.5;
        fallback.castShadow = fallback.receiveShadow = true;
        jarRig.add(fallback);
      }

      const mashBottomY = Math.max(0.05, jarHeight - 0.058);
      const mashRadius = Math.min(0.09, jarWidth * 0.31);
      const mashStartHeight = 0.032;
      const mashFinalHeight = 0.016;
      const riceTexturePath = recipe.godubapRicePlane?.texture;
      const riceTexture = riceTexturePath ? new THREE.TextureLoader().load(riceTexturePath) : null;
      if (riceTexture) {
        riceTexture.colorSpace = THREE.SRGBColorSpace;
        riceTexture.wrapS = THREE.MirroredRepeatWrapping;
        riceTexture.wrapT = THREE.MirroredRepeatWrapping;
        riceTexture.repeat.set(2.2, 2.2);
      }
      const mashMaterial = new THREE.MeshStandardMaterial({ color: 0xeadfc4, map: riceTexture, roughness: 0.96 });
      const mash = new THREE.Mesh(
        new THREE.CylinderGeometry(mashRadius, mashRadius * 0.98, mashStartHeight, 48),
        mashMaterial
      );
      mash.position.y = mashBottomY + mashStartHeight * 0.5;
      mash.castShadow = mash.receiveShadow = true;
      mash.visible = false;
      jarRig.add(mash);

      const nurukPositions: number[] = [];
      for (let i = 0; i < 60; i++) {
        const angle = i * 2.399963;
        const radius = mashRadius * 0.88 * Math.sqrt((i + 0.5) / 60);
        nurukPositions.push(Math.cos(angle) * radius, mashBottomY + mashStartHeight + 0.004, Math.sin(angle) * radius);
      }
      const nurukGeometry = new THREE.BufferGeometry();
      nurukGeometry.setAttribute("position", new THREE.Float32BufferAttribute(nurukPositions, 3));
      const nurukMaterial = new THREE.PointsMaterial({ color: 0xb88a4d, size: 0.007, transparent: true });
      const nurukLayer = new THREE.Points(nurukGeometry, nurukMaterial);
      nurukLayer.visible = false;
      jarRig.add(nurukLayer);

      const liquidMaterial = new THREE.MeshPhysicalMaterial({
        color: 0xb8d2cf, transparent: true, opacity: 0.42, roughness: 0.2,
        transmission: 0.18, depthWrite: false,
      });
      const liquid = new THREE.Mesh(
        new THREE.CircleGeometry(mashRadius * 0.98, 48).rotateX(-Math.PI / 2),
        liquidMaterial
      );
      liquid.position.y = mashBottomY + mashStartHeight + 0.008;
      liquid.visible = false;
      jarRig.add(liquid);

      const targetOutline = new THREE.Mesh(
        new THREE.RingGeometry(mashRadius, mashRadius * KNEAD.TARGET_PADDING, 48).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({
          color: 0xe8c07a, transparent: true, opacity: 0.72,
          side: THREE.DoubleSide, depthTest: false,
        })
      );
      targetOutline.position.y = liquid.position.y + 0.006;
      targetOutline.renderOrder = 9;
      targetOutline.visible = false;
      jarRig.add(targetOutline);

      const actors: PourActor[] = [];
      const addActor = (phase: PourPhase, label: string, node: THREE.Group, home: THREE.Vector3) => {
        node.position.copy(home);
        node.userData.baseRotation = node.rotation.clone();
        stageGroup.add(node);
        actors.push({ phase, label, node, home });
      };

      const trayActor = new THREE.Group();
      const trayGltf = LOADED[DEBUG_TRAY_ID];
      if (trayGltf?.scene) {
        const trayModel = skinnedClone(trayGltf.scene) as THREE.Object3D;
        trayModel.traverse((object: THREE.Object3D) => {
          const mesh = object as THREE.Mesh;
          if (!mesh.isMesh) return;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          if (Array.isArray(mesh.material)) mesh.material = mesh.material.map((material) => material.clone());
          else if (mesh.material) mesh.material = mesh.material.clone();
        });
        const box = new THREE.Box3().setFromObject(trayModel);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        trayModel.position.set(-center.x, -box.min.y, -center.z);
        trayActor.add(trayModel);
        const riceSource = new THREE.Mesh(
          new THREE.BoxGeometry(size.x * 0.94, 0.014, size.z * 0.94),
          new THREE.MeshStandardMaterial({ color: 0xeee5cf, map: riceTexture, roughness: 0.96 })
        );
        riceSource.position.y = size.y + 0.009;
        riceSource.castShadow = riceSource.receiveShadow = true;
        riceSource.name = "mitsul-rice-source";
        trayActor.add(riceSource);
      }
      addActor("RICE", "식힌 고두밥", trayActor, new THREE.Vector3(-0.27, platformTop + 0.055, 0.08));

      const nurukActor = new THREE.Group();
      const bowl = new THREE.Mesh(
        new THREE.CylinderGeometry(0.072, 0.055, 0.045, 32, 1, true),
        new THREE.MeshStandardMaterial({ color: 0x8c623d, roughness: 0.9, side: THREE.DoubleSide })
      );
      bowl.position.y = 0.0225;
      bowl.castShadow = bowl.receiveShadow = true;
      nurukActor.add(bowl);
      const nurukTexturePath = INGREDIENTS.find((ingredient) => ingredient.id === "nuruk")?.texture;
      const nurukTexture = nurukTexturePath ? new THREE.TextureLoader().load(nurukTexturePath) : null;
      if (nurukTexture) nurukTexture.colorSpace = THREE.SRGBColorSpace;
      const nurukTop = new THREE.Mesh(
        new THREE.CircleGeometry(0.058, 32).rotateX(-Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: 0xc29b63, map: nurukTexture, roughness: 1 })
      );
      nurukTop.position.y = 0.046;
      nurukActor.add(nurukTop);
      addActor("NURUK", "누룩", nurukActor, new THREE.Vector3(0.27, platformTop + 0.03, 0.06));

      const waterActor = new THREE.Group();
      const waterDef = MODELS.find((model) => model.id === "water_jar");
      const waterModel = waterDef ? spawnModel(waterDef) : null;
      if (waterModel) waterActor.add(waterModel);
      else {
        const fallbackWater = new THREE.Mesh(
          new THREE.CylinderGeometry(0.045, 0.055, 0.13, 32),
          new THREE.MeshStandardMaterial({ color: 0x7c6950, roughness: 0.86 })
        );
        fallbackWater.position.y = 0.065;
        waterActor.add(fallbackWater);
      }
      addActor("WATER", "물 항아리", waterActor, new THREE.Vector3(0.27, platformTop + 0.03, 0.06));

      const streamPositions = new Float32Array(30 * 3);
      const streamGeometry = new THREE.BufferGeometry();
      streamGeometry.setAttribute("position", new THREE.BufferAttribute(streamPositions, 3));
      const streamMaterial = new THREE.PointsMaterial({
        color: 0xeadfc4, size: 0.008, transparent: true, opacity: 0.92, depthWrite: false,
      });
      const stream = new THREE.Points(streamGeometry, streamMaterial);
      stream.visible = false;
      stageGroup.add(stream);

      const kneadGesture = new KneadGesture();
      const emptyKneadSnapshot = (): KneadSnapshot => ({
        state: "WAIT_OPEN", pose: "TRANSITION", onMash: false, handRatio: 0,
        fingertipMeanDistance: 0, palmScale: 0, count: 0, progress: 0, justKneaded: false,
      });
      let kneadSnapshot = emptyKneadSnapshot();
      let held: PourActor | null = null;
      let heldDepth = 1;
      let pouring = false;
      let lastPourAt = performance.now();
      let streamTime = 0;
      let kneadPulse = 0;
      const actorWorld = new THREE.Vector3();
      const actorScreen = { x: 0.5, y: 0.5 };
      const followTarget = new THREE.Vector3();
      const jarOpeningWorld = new THREE.Vector3();
      const jarOpeningScreen = { x: 0.5, y: 0.5 };
      const mashRightWorld = new THREE.Vector3();
      const mashFrontWorld = new THREE.Vector3();
      const mashRightScreen = { x: 0.5, y: 0.5 };
      const mashFrontScreen = { x: 0.5, y: 0.5 };

      const phaseIndex = (phase: MixPhase) => PHASES.indexOf(phase);
      const activeActor = () => actors.find((actor) => actor.phase === S.mitsulPhase) ?? null;
      const setMixDebug = (id: string, value: string) => {
        const element = $(id);
        if (element) element.textContent = value;
      };

      function syncActorVisibility() {
        actors.forEach((actor) => { actor.node.visible = actor.phase === S.mitsulPhase; });
      }

      function applyMixVisual() {
        const phase = S.mitsulPhase as MixPhase;
        const index = phaseIndex(phase);
        const pour = S.mitsulPourProgress;
        mash.visible = index > 0 || (phase === "RICE" && pour > 0);
        nurukLayer.visible = index > 1 || (phase === "NURUK" && pour > 0);
        liquid.visible = index > 2 || (phase === "WATER" && pour > 0);
        const riceAmount = index > 0 ? 1 : phase === "RICE" ? pour : 0;
        const nurukAmount = index > 1 ? 1 : phase === "NURUK" ? pour : 0;
        const waterAmount = index > 2 ? 1 : phase === "WATER" ? pour : 0;
        const riceAmountScale = THREE.MathUtils.lerp(0.72, 1, riceAmount);
        nurukMaterial.opacity = THREE.MathUtils.lerp(0.18, 1, nurukAmount);
        liquid.scale.setScalar(THREE.MathUtils.lerp(0.55, 1, waterAmount));
        liquidMaterial.opacity = THREE.MathUtils.lerp(0.12, 0.42, waterAmount);

        const kneadProgress = phase === "COMPLETE" ? 1 : phase === "KNEAD" ? kneadSnapshot.progress : 0;
        const height = THREE.MathUtils.lerp(mashStartHeight, mashFinalHeight, kneadProgress);
        const spread = riceAmountScale * THREE.MathUtils.lerp(0.94, 1.04, kneadProgress) + kneadPulse * 0.025;
        mash.scale.set(spread, height / mashStartHeight, spread);
        mash.position.y = mashBottomY + height * 0.5 + kneadPulse * 0.002;
        liquid.position.y = mashBottomY + height + 0.004 + waterAmount * 0.008;
        nurukLayer.position.y = height - mashStartHeight;
        targetOutline.position.y = liquid.position.y + 0.006;
        mashMaterial.color.setHex(kneadProgress >= 1 ? 0xd2bd91 : 0xeadfc4);

        const riceSource = trayActor.getObjectByName("mitsul-rice-source");
        if (riceSource) {
          const remaining = phase === "RICE" ? 1 - pour : index > 0 ? 0 : 1;
          const footprint = Math.sqrt(Math.max(0.01, remaining));
          riceSource.scale.set(footprint, Math.max(0.08, remaining), footprint);
          riceSource.visible = remaining > 0.02;
        }
      }

      function updateMixPanel(frame: HandFrame | null, nearJar = false, tilt = 0, onMash = false) {
        if (!mitsulMixDebug) return;
        const index = phaseIndex(S.mitsulPhase as MixPhase);
        setMixDebug("#mitsul-debug-hand", frame?.present ? "FOUND" : "LOST");
        setMixDebug("#mitsul-debug-phase", S.mitsulPhase);
        setMixDebug("#mitsul-debug-grab", held ? "YES" : "NO");
        setMixDebug("#mitsul-debug-target", nearJar ? "IN" : "OUT");
        setMixDebug("#mitsul-debug-tilt", `${THREE.MathUtils.radToDeg(tilt).toFixed(0)}°`);
        setMixDebug("#mitsul-debug-pour", `${Math.round(S.mitsulPourProgress * 100)}%`);
        setMixDebug("#mitsul-debug-knead", `${S.mitsulKneadCount} / ${KNEAD.TARGET_KNEAD_COUNT}`);
        setMixDebug("#mitsul-debug-on-mash", onMash ? "YES" : "NO");
        setMixDebug("#mitsul-debug-jar", jarReady ? "READY" : "MISSING");
        setMixDebug("#mitsul-debug-rice", index > 0 ? "DONE" : index === 0 && S.mitsulPourProgress > 0 ? "POURING" : "WAIT");
        setMixDebug("#mitsul-debug-nuruk", index > 1 ? "DONE" : index === 1 && S.mitsulPourProgress > 0 ? "POURING" : "WAIT");
        setMixDebug("#mitsul-debug-water", index > 2 ? "DONE" : index === 2 && S.mitsulPourProgress > 0 ? "POURING" : "WAIT");
        $("#mitsul-debug-ok")?.classList.toggle("visible", S.mitsulDone);
      }

      function returnHeldHome() {
        if (!held) return;
        held.node.position.copy(held.home);
        held.node.rotation.copy(held.node.userData.baseRotation as THREE.Euler);
        held = null;
        pouring = false;
        stream.visible = false;
      }

      function advancePhase() {
        const next = PHASES[Math.min(PHASES.length - 1, phaseIndex(S.mitsulPhase as MixPhase) + 1)];
        returnHeldHome();
        S.mitsulPhase = next;
        S.mitsulPourProgress = 0;
        if (next === "KNEAD") {
          kneadGesture.reset();
          kneadSnapshot = emptyKneadSnapshot();
          targetOutline.visible = mitsulMixDebug;
        }
        syncActorVisibility();
        applyMixVisual();
        syncMitsulMixUi();
        updateMixPanel(null);
      }

      resetMitsulMixInteraction = () => {
        returnHeldHome();
        kneadGesture.reset();
        kneadSnapshot = emptyKneadSnapshot();
        S.mitsulPhase = "RICE";
        S.mitsulPourProgress = 0;
        S.mitsulKneadCount = 0;
        S.mitsulDone = false;
        kneadPulse = 0;
        targetOutline.visible = false;
        handTracker?.setPaused(false);
        syncActorVisibility();
        applyMixVisual();
        syncMitsulMixUi();
        updateMixPanel(null);
        setHandHud("tracking", "식힌 고두밥 채반을 집어 항아리에 부어주세요");
      };

      const resetButton = $("#mitsul-debug-reset") as HTMLButtonElement | null;
      if (resetButton) resetButton.onclick = resetMitsulMixInteraction;
      resetMitsulMixInteraction();

      live.onHand = (frame, hand) => {
        const now = performance.now();
        const phase = S.mitsulPhase as MixPhase;
        jarRig.updateWorldMatrix(true, true);
        jarRig.localToWorld(jarOpeningWorld.set(0, liquid.position.y, 0));
        worldToScreen(jarOpeningWorld, camera, jarOpeningScreen);

        if (phase === "KNEAD" || phase === "COMPLETE") {
          const rawPalm = palmCenter(frame);
          const palm = rawPalm ? toScreen(rawPalm, handFit) : { x: 0.5, y: 0.5 };
          let onMash = false;
          if (rawPalm) {
            jarRig.localToWorld(mashRightWorld.set(mashRadius, liquid.position.y, 0));
            jarRig.localToWorld(mashFrontWorld.set(0, liquid.position.y, mashRadius));
            worldToScreen(mashRightWorld, camera, mashRightScreen);
            worldToScreen(mashFrontWorld, camera, mashFrontScreen);
            const ax = mashRightScreen.x - jarOpeningScreen.x;
            const ay = mashRightScreen.y - jarOpeningScreen.y;
            const bx = mashFrontScreen.x - jarOpeningScreen.x;
            const by = mashFrontScreen.y - jarOpeningScreen.y;
            const px = palm.x - jarOpeningScreen.x;
            const py = palm.y - jarOpeningScreen.y;
            const det = ax * by - ay * bx;
            if (Math.abs(det) > 1e-6) {
              const localX = (px * by - py * bx) / det;
              const localZ = (ax * py - ay * px) / det;
              onMash = localX * localX + localZ * localZ <= KNEAD.TARGET_PADDING ** 2;
            }
          }
          if (phase === "KNEAD") {
            kneadSnapshot = kneadGesture.update(frame, onMash);
            S.mitsulKneadCount = kneadSnapshot.count;
            if (kneadSnapshot.justKneaded) kneadPulse = 1;
            if (kneadSnapshot.state === "COMPLETE") {
              S.mitsulPhase = "COMPLETE";
              S.mitsulDone = true;
              targetOutline.visible = false;
              handTracker?.setPaused(true);
            }
            applyMixVisual();
            syncMitsulMixUi();
            updateMixPanel(frame, false, 0, onMash);
            if (S.mitsulDone) setHandHud("dropped", "재료가 골고루 섞였어요 · 혼합 완료");
            else if (!frame.present) setHandHud("idle", "손을 카메라에 비춰 주세요");
            else if (!onMash) setHandHud("tracking", "손바닥을 항아리 속 재료 위에 올려주세요");
            else if (kneadSnapshot.justKneaded) setHandHud("dropped", `치대기 ${kneadSnapshot.count}/${KNEAD.TARGET_KNEAD_COUNT}`);
            else if (kneadSnapshot.pose === "CLOSED") setHandHud("holding", "손을 다시 펼쳐 한 번을 완성하세요");
            else setHandHud("hover", "손을 오므렸다 다시 펼쳐 치대주세요");
          }
          return;
        }

        const current = activeActor();
        if (!current) return;
        if (!frame.present) {
          returnHeldHome();
          updateMixPanel(frame);
          setHandHud("idle", "손을 카메라에 비춰 주세요");
          return;
        }

        const pinch = hand.pinchScreen;
        const wrist = toScreen(frame.landmarks[0], handFit);
        const middle = toScreen(frame.landmarks[9], handFit);
        const signedTilt = Math.atan2(middle.x - wrist.x, -(middle.y - wrist.y));
        const tilt = Math.min(Math.PI / 2, Math.abs(signedTilt));

        if (held) {
          screenToWorld(pinch.x, pinch.y, heldDepth, camera, followTarget);
          stageGroup.worldToLocal(followTarget);
          held.node.position.lerp(followTarget, 0.48);
          held.node.rotation.z = THREE.MathUtils.lerp(held.node.rotation.z, signedTilt, 0.24);
          const nearJar = screenDist(pinch, jarOpeningScreen) <= POUR_TARGET_RADIUS;
          pouring = frame.pinching && nearJar && tilt >= POUR_TILT_RAD;
          if (pouring) {
            const elapsed = Math.min(80, Math.max(0, now - lastPourAt));
            S.mitsulPourProgress = Math.min(1, S.mitsulPourProgress + elapsed / POUR_DURATION_MS);
            stream.visible = true;
            streamMaterial.color.setHex(phase === "RICE" ? 0xeadfc4 : phase === "NURUK" ? 0xb88a4d : 0x7fc8dd);
            if (S.mitsulPourProgress >= 1) {
              advancePhase();
              return;
            }
          } else stream.visible = false;
          lastPourAt = now;
          applyMixVisual();
          syncMitsulMixUi();
          updateMixPanel(frame, nearJar, tilt);
          if (frame.justReleased) {
            returnHeldHome();
            setHandHud("tracking", `${current.label}을(를) 다시 집어주세요`);
          } else if (!nearJar) setHandHud("holding", `${current.label}을(를) 항아리 입구로 옮겨주세요`);
          else if (tilt < POUR_TILT_RAD) setHandHud("holding", "항아리 위에서 손을 기울여 부어주세요");
          else setHandHud("dropped", `${current.label} 붓는 중… ${Math.round(S.mitsulPourProgress * 100)}%`);
          return;
        }

        current.node.getWorldPosition(actorWorld);
        worldToScreen(actorWorld, camera, actorScreen);
        const hovering = screenDist(pinch, actorScreen) <= PICK_RADIUS;
        if (hovering && frame.justPinched) {
          held = current;
          heldDepth = camera.getWorldPosition(handOrigin).distanceTo(actorWorld);
          lastPourAt = now;
          setHandHud("holding", `${current.label}을(를) 집었어요`);
        } else {
          setHandHud(hovering ? "hover" : "tracking", hovering
            ? `${current.label} · 엄지와 검지를 붙여 집으세요`
            : `${current.label} 위로 손을 옮겨주세요`);
        }
        updateMixPanel(frame, false, tilt);
      };

      live.tick = (_time, dt) => {
        kneadPulse = Math.max(0, kneadPulse - dt * 4.5);
        applyMixVisual();
        if (!pouring || !held) {
          stream.visible = false;
          return;
        }
        streamTime += dt;
        held.node.getWorldPosition(actorWorld);
        stageGroup.worldToLocal(actorWorld);
        jarRig.localToWorld(jarOpeningWorld.set(0, liquid.position.y, 0));
        stageGroup.worldToLocal(jarOpeningWorld);
        for (let i = 0; i < 30; i++) {
          const p = (streamTime * 1.8 + i / 30) % 1;
          const offset = i * 3;
          streamPositions[offset] = THREE.MathUtils.lerp(actorWorld.x, jarOpeningWorld.x, p) + Math.sin(i * 9.1) * 0.006 * (1 - p);
          streamPositions[offset + 1] = THREE.MathUtils.lerp(actorWorld.y, jarOpeningWorld.y, p) + Math.sin(Math.PI * p) * 0.045;
          streamPositions[offset + 2] = THREE.MathUtils.lerp(actorWorld.z, jarOpeningWorld.z, p) + Math.cos(i * 7.3) * 0.006 * (1 - p);
        }
        (streamGeometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      };
    }

    function buildFerment() {
      const platformTop = addPlatform();
      frame3D(platformTop, 0.64, 0.5);

      // 혼합(fstage 0) 단계 — 냉각에서 이어지는 '채반 위 고두밥'
      const cooled = makeCooledRice(platformTop);
      cooled.visible = false;
      stageGroup.add(cooled);

      // 1차발효(fstage 1)부터 등장하는 발효 항아리
      const jar = new THREE.Group();
      const jarDef = MODELS.find((m) => m.step === "ferment");
      if (jarDef) {
        const node = spawnModel(jarDef);
        if (node) {
          const g = new THREE.Group();
          g.position.set(0, platformTop + jarDef.y, 0);
          g.add(node);
          jar.add(g);
        }
      }
      jar.visible = false;
      stageGroup.add(jar);

      // 후발효(마지막 단계) 발효 애니메이션 — 물방울·열
      const bubbles = makeParticles(180, {
        color: 0xfff6dd, size: 0.009, opacity: 0, speed: 0.5,
        radius: 0.1, baseY: 0.06, height: 0.2, taper: 0.2,
      });
      stageGroup.add(bubbles);
      live.particles.push(bubbles);
      const heat = new THREE.PointLight(0xff8a4a, 0, 1.2);
      heat.position.set(0, 0.2, 0);
      stageGroup.add(heat);

      const F_LAST_I = FERMENT_STEPS.length - 1;
      fermentShowStage = () => {
        cooled.visible = S.fstage === 0;   // 혼합에서만 채반+고두밥
        jar.visible = S.fstage >= 1;       // 1차발효부터 항아리
      };
      fermentShowStage();

      live.tick = () => {
        const active = S.fstage >= F_LAST_I; // 후발효에서만 실제 발효 진행
        const fill = 0.06 + (S.ferment / 100) * 0.16;
        const hot = THREE.MathUtils.clamp((S.temp - 24) / 10, 0, 1);
        const bo = (bubbles.userData as any).opt;
        bo.speed = active ? 0.25 + hot * 0.9 : 0;
        bo.baseY = 0.06;
        bo.height = fill + 0.05;
        bubbles.material.opacity += ((active ? 0.35 + hot * 0.45 : 0) - bubbles.material.opacity) * 0.1;
        heat.intensity += ((active ? hot * 1.4 : 0) - heat.intensity) * 0.06;
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

      // 출고 단계에 나타나는 완성 제품 모델 (Nyangi.glb). 파일이 없으면 임시 병이 그대로 보인다.
      let shipModel: THREE.Object3D | null = null;
      if (FINISH_MODEL) {
        const node = spawnModel(FINISH_MODEL);
        if (node) {
          const g = new THREE.Group();
          g.position.set(0, platformTop + FINISH_MODEL.y, 0);
          g.add(node);
          g.visible = false;
          stageGroup.add(g);
          shipModel = g;
        }
      }
      const SHIP_AT = PRESS_STEPS.length - 1; // '출고' 인덱스
      finishShowShip = () => {
        const shipped = S.press >= SHIP_AT;      // 출고 단계에 도달했나
        if (shipModel) shipModel.visible = shipped;
        bottle.visible = shipModel ? !shipped : true; // 제품이 뜨면 임시 병은 숨긴다
      };
      finishShowShip();

      const sparks = makeParticles(90, {
        color: 0xffe9b8, size: 0.011, opacity: 0.75, speed: 0.2,
        radius: 0.22, baseY: contentY + 0.05, height: 0.45, taper: -0.3,
      });
      stageGroup.add(sparks);
      live.particles.push(sparks);

      live.tick = () => {
        bottle.rotation.y += 0.006;
        if (shipModel) shipModel.rotation.y += 0.006;
      };
    }

    function buildStageFor(step: typeof S.step) {
      clearStage();
      if (!S.placed) return;
      if (step === "ingredient") buildIngredients();
      else if (step === "godubap") buildGodubap();
      else if (step === "ferment") {
        if (kneadDebug) buildKneadDebug();
        else if (productionMitsulMix) buildMitsulMix();
        else buildFerment();
      }
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
          // camera-access 가 있으면 ARCore 가 쓰는 카메라 이미지를 그대로 받아 손을 인식한다.
          // 이게 평면 인식(hit-test)과 손 인식을 한 세션에서 같이 하는 유일한 길이다.
          optionalFeatures: ["dom-overlay", "camera-access"],
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

      // 기기가 camera-access 를 내줬다면 실제 AR 안에서 손까지 쓸 수 있다.
      // (안 내주면 평면 인식만 되는 기존 AR 그대로 — 손은 아래 카메라 모드로 따로 쓴다)
      if (xrSession!.enabledFeatures?.includes("camera-access")) {
        void startHandsInAr();
      }

      xrSession!.addEventListener("end", () => {
        if (productionCooling) resetCoolingInteraction?.();
        if (kneadDebug) resetKneadInteraction?.();
        if (productionMitsulMix) resetMitsulMixInteraction?.();
        S.xr = false;
        S.hand = false;
        uiRoot!.classList.remove("hands-on");
        handTracker?.dispose();
        handTracker = null;
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
    const handOrigin = new THREE.Vector3(); // 손까지의 거리 계산용 임시 벡터
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    function fallbackHit() {
      raycaster.setFromCamera(new THREE.Vector2(0, -0.15), camera);
      const p = new THREE.Vector3();
      return raycaster.ray.intersectPlane(groundPlane, p) ? p : null;
    }

    /* =====================================================================
     * 3.5 손 모드 — 카메라 영상 + MediaPipe 손 인식
     *
     * WebXR 세션 중에는 ARCore 가 카메라를 독점해 getUserMedia 를 함께 쓸 수 없다.
     * 그래서 손 모드는 WebXR 대신 쓰는 별도 경로다 — 평면 인식은 없고,
     * 무대를 카메라 앞 고정 위치에 자동으로 놓는다.
     * ===================================================================*/
    let handTracker: HandTracker | null = null;
    const handVisual = new HandVisual();
    // 영상이 화면에 cover 로 잘리는 것을 보정하는 값 — 매 프레임 화면 크기로 다시 잰다
    let handFit: CoverFit = { scaleX: 1, scaleY: 1, offX: 0, offY: 0 };
    // AR 모드에서 XR 카메라 이미지를 내려받는 도구 (camera-access 를 받았을 때만 만든다)
    let xrFeed: XrCameraFeed | null = null;
    let lastDetectAt = 0;
    /**
     * AR 모드 손 검출 간격(ms). 카메라 이미지를 GPU 에서 내려받는 비용이 있어
     * 매 프레임 하면 3D 가 눈에 띄게 느려진다. 이 정도면 집는 조작에 충분하다.
     */
    const AR_DETECT_MS = 60;

    // 손 상태 표시는 단계마다 하나씩 있다 (원료·고두밥). 전부 같이 갱신한다.
    function setHandHud(state: "idle" | "tracking" | "hover" | "holding" | "dropped", text: string) {
      $$(".hand-hud").forEach((hud) => ((hud as HTMLElement).dataset.state = state));
      $$(".hand-hud .hand-hud-msg").forEach((msg) => (msg.textContent = text));
    }

    /** 실제 AR 세션 안에서 손 인식을 켠다 (camera-access 를 받은 기기) */
    async function startHandsInAr() {
      if (handTracker) return;
      const tracker = new HandTracker(); // 영상은 XR 이 준다 — 카메라를 직접 열지 않는다
      try {
        await tracker.load();
      } catch (e) {
        tracker.dispose();
        console.warn("[ar] 손 인식을 켜지 못했습니다 —", e);
        return; // 평면 인식만 되는 기존 AR 로 계속 간다
      }
      handTracker = tracker;
      xrFeed = new XrCameraFeed();
      void handVisual.loadModel(); // 손 모델은 늦게 와도 되므로 기다리지 않는다
      S.hand = true;
      uiRoot!.classList.add("hands-on");
      // 빠른 tray test가 이미 godubap으로 넘어간 뒤 로딩을 마쳐도 손 추적을 켠다.
      handTracker.setPaused(!HAND_STEPS.has(S.step));
      setHandHud("idle", "손을 카메라에 비춰 주세요");
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

      if (!productionMitsulMix && S.step === "ferment" && S.fstage >= FERMENT_STEPS.length - 1 && S.ferment < 100) {
        const dist = Math.abs(S.temp - OPTIMAL_C);
        // 25℃에서 약 17초에 완주. 너무 빨리 끝나면 온도를 조절해 본 효과를 느끼기 어렵다.
        const rate = THREE.MathUtils.clamp(1 - dist / 9, 0.12, 1) * 6;
        S.ferment = Math.min(100, S.ferment + rate * dt);
        S.tempLog.push(S.temp);
        onFermentTick();
      }

      // 손 갱신은 3D 갱신보다 먼저 — 이번 프레임의 손 위치를 보고 물건이 따라와야 한다
      if (S.hand && handTracker && xrFeed && frame) {
        const xrCam = (frame as any).getViewerPose?.(localSpace)?.views?.[0]?.camera;
        if (xrCam) {
          const now = performance.now();

          if (now - lastDetectAt >= AR_DETECT_MS) {
            lastDetectAt = now;
            const tex = renderer.xr.getCameraTexture(xrCam);
            if (tex) {
              const shot = xrFeed.capture(renderer, tex as any, xrCam.width, xrCam.height);
              if (shot) handTracker.detect(shot, now);
            }
          }
          handFit = coverFit(xrCam.width, xrCam.height, canvas!.clientWidth, canvas!.clientHeight);
        }

        const f = handTracker.latest;
        // 무대까지의 거리 — 오클루더를 그 앞에 놓고, 집어 든 물건 거리의 기준으로도 쓴다
        const stageAt = camera.getWorldPosition(handOrigin).distanceTo(anchor.position);
        handVisual.update(f, camera, handFit, Math.max(stageAt, 0.2));
        // 손이 사라진 프레임도 그대로 넘긴다 — 잡고 있던 물건을 놓아야 하기 때문
        live.onHand?.(f, handVisual);
        handTracker.consumeEdges();
      } else if (!S.hand) {
        handVisual.hide();
      }

      live.mixers.forEach((m) => m.update(dt));
      if (live.tick) live.tick(t, dt);
      live.particles.forEach((p) => updateParticles(p, dt));
      if (!S.xr) controls.update();

      // 레이어 순서대로 쌓아 올린다.
      //   L0  카메라 영상 — WebXR 이 캔버스 뒤에 깔아 준다 (바닥·책상)
      //   L1  AR 에셋     — 아래 scene
      //   L2+ 손          — 그림자 → 장갑 손 → 집는 고리 (handVisual.render 안에서)
      renderer.clear();
      renderer.render(scene, camera);
      if (S.hand) handVisual.render(renderer, camera);
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
        say("카메라를 켜면 바닥을 인식해 양조장을 놓고, 손으로 재료를 집을 수 있어요.");
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
        if (skipToMitsulMix) {
          // 공간 배치까지 정상 수행한 뒤 밑술 혼합의 첫 재료부터 시작한다.
          S.fstage = 0;
          S.ferment = 0;
          S.mitsulPhase = "RICE";
          S.mitsulPourProgress = 0;
          S.mitsulKneadCount = 0;
          S.mitsulDone = false;
          setStep("ferment");
          syncMitsulMixUi();
        } else if (skipToKnead) {
          // 평면 배치와 anchor는 그대로 거친 뒤 knead spike만 독립 실행한다.
          S.fstage = 0;
          S.ferment = 0;
          setStep("ferment");
        } else if (skipToRiceSpread) {
          S.godubap = GB_LAST;
          S.rinseTurns = 0;
          S.rinsePartial = 0;
          S.soakAt = 0;
          S.quizDone = true;
          S.coolDone = false;
          S.coolFans = 0;
          setStep("godubap");
          $("#quiz")?.classList.add("hidden");
          syncGodubap();
        } else if (skipToCooling) {
          // 공간 배치까지만 정상 수행한 뒤 tray pull에 필요한 냉각 상태만 준비한다.
          S.godubap = GB_LAST;
          S.rinseTurns = 0;
          S.rinsePartial = 0;
          S.soakAt = 0;
          S.quizDone = true;
          S.coolDone = false;
          S.coolFans = 0;
          setStep("godubap");
          $("#quiz")?.classList.add("hidden");
          syncGodubap();
        } else {
          setStep("ingredient");
        }
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
        b.dataset.id = ing.id; // 손으로 담았을 때 이 카드를 찾아 눌린 상태로 맞춘다
        b.setAttribute("aria-pressed", "false");
        // 배경 크기·정렬은 CSS에서 잡는다. 여기서 cover 를 주면 투명 PNG가 잘리고
        // .chip 의 배경색이 테두리처럼 비쳐 보인다.
        b.innerHTML = `<span class="chip" style="background-image:url('${ing.texture}')"></span>${ing.name}`;
        b.onclick = () => {
          // 평면 놓기 → 원료 화면으로 넘어온 그 탭이 카드로 새어 들어오는 유령 클릭 방지.
          if (performance.now() - enteredIngredientAt < 500) return;
          const had = S.selected.has(ing.id);
          if (had) S.selected.delete(ing.id);
          else S.selected.add(ing.id);
          b.setAttribute("aria-pressed", String(S.selected.has(ing.id)));
          // 방금 새로 담은 재료를 넘겨, 부재료면 그 향을 장인이 짚어준다.
          syncIngredient(had ? undefined : ing, true);
        };
        grid.appendChild(b);
      });
    }
    function syncIngredient(justAdded?: (typeof INGREDIENTS)[number], interacted = false) {
      const needed = INGREDIENTS.filter((i) => i.essential && !S.selected.has(i.id));
      const extras = INGREDIENTS.filter((i) => !i.essential && S.selected.has(i.id));
      const b = $("#btn-ingredient") as HTMLButtonElement | null;
      if (!b) return;
      b.disabled = needed.length > 0;
      b.textContent = needed.length
        ? `주원료 ${ESS_N - needed.length}/${ESS_N} 선택`
        : extras.length
          ? `주원료 ${ESS_N}종 · 부재료 ${extras.length}종`
          : `주원료 ${ESS_N}개 선택 완료`;
      // 부팅·초기화 때는 인트로 안내문을 유지하고, 사용자가 재료를 만졌을 때만 멘트를 바꾼다.
      if (!interacted) return;
      if (justAdded && !justAdded.essential) {
        coach("#msg-ingredient", justAdded.flavorNote ?? "부재료를 더하면 향이 한결 깊어진다네.");
      } else if (needed.length) {
        coach("#msg-ingredient", `${ESS_NAMES}이 주원료라네. ${needed.map((i) => i.name).join("·")}을(를) 마저 담아보게.`);
      } else {
        coach(
          "#msg-ingredient",
          (extras.length ? "좋아, 주원료에 부재료까지 갖췄네. " : "좋아, 주원료가 다 모였네. ") + recipe.ingredientsReady
        );
      }
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
          if (i === GB_LAST) {
            if (productionCooling) {
              if (S.coolingPhase === "QUIZ" && !S.quizDone) $("#quiz")?.classList.remove("hidden");
            } else if (!S.quizDone) {
              // 독립 debug flow는 기존 quiz 재표시 동작을 유지한다.
              $("#quiz")?.classList.remove("hidden");
            }
            return;
          }
          S.godubap = i + 1;
          if (productionCooling && S.godubap === GB_LAST) resetCoolingInteraction?.();
          syncGodubap();
        };
        pills.appendChild(b);
      });
    }
    /**
     * 고두밥 단계 진행 막대 — 헹구기·불리기·식히기가 같은 자리를 나눠 쓴다.
     * 손으로 할 일이 있는 국면에서만 나타난다.
     */
    function syncGodubapGame() {
      let pct = 0;
      let text = "";
      let done = false;

      if (rinseActive()) {
        const prog = (S.rinseTurns + S.rinsePartial) / REQUIRED_RINSE_TURNS;
        pct = Math.round(Math.min(1, prog) * 100);
        text =
          S.rinseTurns === 0
            ? "그릇 안에서 손을 둥글게 돌려 쌀을 헹구세요"
            : `헹구는 중 · ${S.rinseTurns}/${REQUIRED_RINSE_TURNS}바퀴`;
      } else if (soakActive()) {
        const soaked = S.soakAt ? performance.now() - S.soakAt : 0;
        pct = Math.round(Math.min(1, soaked / SOAK_MS) * 100);
        done = pct >= 100;
        text = done ? "쌀이 다 불었어요" : "물에 담근 채로 잠시 기다려요";
      } else if ((skipToCooling || skipToRiceSpread) && S.godubap === GB_LAST) {
        // 빠른 링크에서는 production fan UI/count를 tray test와 함께 노출하지 않는다.
        $("#godubap-game")?.classList.add("hidden");
        return;
      } else if (productionCooling && S.godubap >= GB_LAST) {
        if (S.coolingPhase === "TRAY_PULL") {
          pct = Math.round(S.coolTrayProgress * 100);
          text = "채반을 잡고 앞으로 당겨 꺼내세요";
        } else if (S.coolingPhase === "RICE_SPREAD") {
          pct = Math.round(S.coolRiceProgress * 100);
          text = "고두밥을 채반 위에 골고루 펼쳐주세요";
        } else if (S.coolingPhase === "FAN") {
          pct = Math.round((S.coolFans / REQUIRED_FANS) * 100);
          text = S.coolFans === 0
            ? "손을 좌우로 흔들어 고두밥을 식혀주세요"
            : `식히는 중 · ${S.coolFans}/${REQUIRED_FANS}번`;
        } else if (S.coolingPhase === "COMPLETE") {
          pct = 100;
          done = true;
          text = "고두밥이 충분히 식었어요!";
        } else {
          $("#godubap-game")?.classList.add("hidden");
          return;
        }
      } else if (S.hand && S.godubap === GB_LAST && S.quizDone && !S.coolDone) {
        pct = Math.round((S.coolFans / REQUIRED_FANS) * 100);
        text =
          S.coolFans === 0
            ? "손을 좌우로 흔들어 부채질하세요"
            : `식히는 중 · ${S.coolFans}/${REQUIRED_FANS}번`;
      } else {
        $("#godubap-game")?.classList.add("hidden");
        return;
      }

      $("#godubap-game")?.classList.remove("hidden");
      const bar = $("#bar-godubap") as HTMLElement | null;
      if (bar) bar.style.width = `${pct}%`;
      const pctEl = $("#godubap-pct");
      if (pctEl) pctEl.textContent = `${pct}%`;
      const label = $("#godubap-game-label");
      if (label) {
        label.textContent = text;
        (label as HTMLElement).dataset.state = done ? "ok" : "warn";
      }
    }

    function syncGodubap() {
      godubapShowStage?.(); // 현재 하위 단계에 맞춰 무대 모델(그릇/솥/채반)을 갈아 끼운다
      $$("#pills .pill").forEach((p, i) => {
        // 완료 표시(✓)는 CSS가 점 안에 그리므로 여기서는 이름만 둔다
        (p as HTMLElement).dataset.state = i < S.godubap ? "done" : i === S.godubap ? "now" : "todo";
        p.textContent = GODUBAP_STEPS[i].name;
      });
      const hint = $("#godubap-hint");
      if (hint) {
        if (productionCooling && S.godubap >= GB_LAST) {
          hint.textContent = S.coolingPhase === "TRAY_PULL"
            ? "채반을 잡고 앞으로 당겨 꺼내주세요"
            : S.coolingPhase === "RICE_SPREAD"
              ? "고두밥을 채반 위에 골고루 펼쳐주세요"
              : S.coolingPhase === "QUIZ"
                ? "장인의 질문에 답해주세요"
                : S.coolingPhase === "FAN"
                  ? "손을 좌우로 흔들어 고두밥을 식혀주세요"
                  : "고두밥이 충분히 식었어요!";
        } else {
          hint.textContent = skipToRiceSpread && S.godubap === GB_LAST
            ? "채반 위 여러 영역을 손바닥으로 넓게 쓸어주세요"
            : skipToCooling && S.godubap === GB_LAST
              ? "노란 표시를 pinch한 뒤 손을 몸 쪽으로 당겨주세요"
            : S.godubap >= GB_N
            ? "고두밥이 완성됐어요. 아래 버튼으로 이어가세요."
            : S.godubap === GB_LAST
              ? !S.quizDone
                ? "장인의 질문에 먼저 답해주세요"
                : "손을 좌우로 흔들어 고두밥을 식혀주세요"
              : rinseActive()
                ? "손을 둥글게 돌려 쌀을 헹궈주세요"
                : soakActive()
                  ? "쌀이 물을 머금는 동안 잠시 기다려요"
                  : "";
        }
      }
      const cur = GODUBAP_STEPS[Math.min(S.godubap, GB_LAST)];
      const cap = $("#cap-godubap");
      if (cap) {
        if (productionCooling && S.godubap >= GB_LAST) {
          cap.textContent = S.coolingPhase === "TRAY_PULL"
            ? "냉각① · 채반 꺼내기"
            : S.coolingPhase === "RICE_SPREAD"
              ? "냉각② · 고두밥 펼치기"
              : S.coolingPhase === "QUIZ"
                ? "냉각③ · 장인의 질문"
                : S.coolingPhase === "FAN"
                  ? "냉각④ · 부채질로 식히기"
                  : "고두밥 완성 · 채반에서 충분히 식었어요";
        } else {
          cap.textContent = skipToRiceSpread && S.godubap === GB_LAST
            ? "냉각② Rice Spread Debug"
            : skipToCooling && S.godubap === GB_LAST
              ? "냉각① Metal Tray Pull Debug"
            : S.godubap >= GB_N
            ? "고두밥 완성 · 채반에서 차게 식었어요"
            : S.godubap === GB_LAST && S.quizDone
              ? "아직 뜨거워요 · 손으로 부쳐 식혀 주세요"
              : cur.caption;
        }
      }
      if (productionCooling && S.godubap >= GB_LAST) {
        $("#quiz")?.classList.toggle("hidden", S.coolingPhase !== "QUIZ" || S.quizDone);
      } else if (S.godubap === GB_LAST && !S.quizDone) {
        // 독립 debug flow의 기존 quiz 동작은 유지한다.
        $("#quiz")?.classList.remove("hidden");
      }
      syncGodubapGame();
      const b = $("#btn-godubap") as HTMLButtonElement | null;
      if (b) {
        // 아직 이를 때도 눌리게 두고, 대신 눌렀을 때 무엇을 해야 하는지 알려준다
        const ready = S.godubap >= GB_N;
        b.classList.toggle("waiting", !ready);
        b.textContent = productionCooling && S.godubap >= GB_LAST && !ready
          ? S.coolingPhase === "TRAY_PULL"
            ? "채반을 꺼내는 중…"
            : S.coolingPhase === "RICE_SPREAD"
              ? "고두밥을 펼치는 중…"
              : S.coolingPhase === "QUIZ"
                ? "장인의 질문에 답해주세요"
                : "고두밥을 식히는 중…"
          : ready
          ? "누룩 섞고 항아리에 담기"
          : skipToRiceSpread && S.godubap === GB_LAST
            ? "Rice spread 기술 검증 중"
            : skipToCooling && S.godubap === GB_LAST
              ? "Tray pull 기술 검증 중"
            : S.godubap === GB_LAST && S.quizDone
            ? "손을 좌우로 흔들어 식혀 주세요"
            : "공정을 순서대로 진행하세요";
      }
    }
    // 퀴즈 문항·선택지는 레시피에서 온다. (술마다 문구가 달라져도 그대로 동작)
    const quizQ = $("#quiz-q");
    if (quizQ) quizQ.textContent = recipe.quiz.question;
    const quizChoices = $("#quiz-choices");
    if (quizChoices) {
      quizChoices.innerHTML = "";
      recipe.quiz.choices.forEach((choice) => {
        const c = document.createElement("button");
        c.className = "choice";
        c.textContent = choice.text;
        c.onclick = () => {
          c.classList.add(choice.correct ? "ok" : "no");
          if (choice.correct) {
            S.quizDone = true;
            setTimeout(() => {
              $("#quiz")?.classList.add("hidden");
              if (productionCooling && S.coolingPhase === "QUIZ") {
                startCoolingFan?.();
              } else {
                // 독립 debug/기존 fallback 흐름을 보존한다.
                if (!S.hand) S.godubap = GB_N;
                syncGodubap();
              }
            }, 900);
          } else {
            setTimeout(() => c.classList.remove("no"), 900);
          }
        };
        quizChoices.appendChild(c);
      });
    }
    /** 아직 넘어갈 수 없는 버튼을 눌렀을 때 화면 가운데에 띄우는 안내창 */
    function showNotice(message: string) {
      const msg = $("#notice-msg");
      if (msg) msg.textContent = message;
      $("#notice")?.classList.add("open");
    }
    const btnCloseNotice = $("#btn-close-notice");
    if (btnCloseNotice)
      (btnCloseNotice as HTMLElement).onclick = () => $("#notice")?.classList.remove("open");

    const btnGodubap = $("#btn-godubap");
    if (btnGodubap)
      (btnGodubap as HTMLElement).onclick = () => {
        if (btnGodubap.classList.contains("waiting")) {
          showNotice(
            S.godubap === GB_LAST
              ? !S.quizDone
                ? "장인의 질문에 먼저 답해 주세요."
                : "고두밥이 아직 뜨겁습니다. 손을 좌우로 흔들어 식혀 주세요."
              : "위쪽 타임라인에서 단계를 차례로 눌러 고두밥을 지어 주세요.",
          );
          return;
        }
        // 발효는 '혼합'부터 탭으로 진행 — 항아리·자동 발효는 후발효에서만 켜진다.
        S.fstage = 0;
        S.mitsulPhase = "RICE";
        S.mitsulPourProgress = 0;
        S.mitsulKneadCount = 0;
        S.mitsulDone = false;
        S.ferment = 0;
        setStep("ferment");
        onFermentTick();
        syncFermentPhase();
      };

    /* --- 14 · 발효 --- */
    const tempInput = $("#temp") as HTMLInputElement | null;
    if (tempInput) {
      tempInput.oninput = () => {
        S.temp = +tempInput.value;
        syncTemp();
      };
    }
    function tempLabel(v: number) {
      // 최적 온도(OPTIMAL_C)를 기준으로 한 상대 구간. 원래 25℃ 기준(−4~+1 알맞음)을 일반화했다.
      if (v < OPTIMAL_C - 4) return "조금 낮음";
      if (v <= OPTIMAL_C + 1) return "알맞음";
      if (v <= OPTIMAL_C + 4) return "조금 높음";
      return "너무 높음";
    }
    /** 최적 온도에서 얼마나 벗어났는지 — 색과 속도 표시에 함께 쓴다 */
    function tempState(): "ok" | "warn" | "bad" {
      const off = Math.abs(S.temp - OPTIMAL_C);
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
      if (S.temp > OPTIMAL_C + 1) m.textContent = "온도가 높아 발효가 너무 빠르네. 항아리 환경을 조금 낮춰보게.";
      else if (S.temp < OPTIMAL_C - 4) m.textContent = "너무 서늘하면 효모가 잠들어 버린다네. 조금만 올려보게.";
      else m.textContent = `${OPTIMAL_C - 1}~${OPTIMAL_C + 1}℃, 딱 좋구먼. 이대로 두면 곱게 익겠네.`;
    }
    /* 담금·발효 타임라인 핀 — 탭을 눌러 혼합 → 1차발효 → 덧술 순으로 넘어간다.
       마지막 '후발효'에 이르면 항아리가 나타나고 시간(온도 조절)으로 자동 발효된다. */
    const F_LAST = FERMENT_STEPS.length - 1; // 후발효 인덱스
    const fpills = $("#ferment-pills");
    if (fpills) {
      fpills.innerHTML = "";
      FERMENT_STEPS.forEach((st, i) => {
        const b = document.createElement("button");
        b.className = "pill";
        b.dataset.idx = String(i);
        b.textContent = st.name;
        b.onclick = () => {
          if (productionMitsulMix) return;
          if (i !== S.fstage) return;   // 지금 켜진 단계만 누를 수 있다
          if (i >= F_LAST) return;       // 후발효는 클릭이 아니라 발효로 완료된다
          S.fstage = i + 1;
          syncFermentPhase();
        };
        fpills.appendChild(b);
      });
    }
    function syncMitsulMixUi() {
      if (!productionMitsulMix) return;
      const phaseOrder = ["RICE", "NURUK", "WATER", "KNEAD", "COMPLETE"] as const;
      const phase = S.mitsulPhase;
      const phaseIndex = phaseOrder.indexOf(phase);
      const currentProgress = phase === "KNEAD"
        ? S.mitsulKneadCount / KNEAD.TARGET_KNEAD_COUNT
        : phase === "COMPLETE"
          ? 1
          : S.mitsulPourProgress;
      const overall = phase === "COMPLETE" ? 1 : (phaseIndex + currentProgress) / 4;
      const labels = {
        RICE: "식힌 고두밥을 항아리에 부어주세요",
        NURUK: "누룩 그릇을 집어 항아리에 부어주세요",
        WATER: "물 항아리를 집어 기울여 부어주세요",
        KNEAD: `손으로 치대며 버무리기 · ${S.mitsulKneadCount}/${KNEAD.TARGET_KNEAD_COUNT}`,
        COMPLETE: "재료가 골고루 섞였어요 · 혼합 완료",
      } satisfies Record<typeof phase, string>;
      const captions = {
        RICE: "밑술 — 일양 · 넓게 식힌 고두밥을 항아리에 담아요",
        NURUK: "밑술 — 일양 · 누룩을 넣어 발효의 씨앗을 더해요",
        WATER: "밑술 — 일양 · 물을 부어 고두밥과 누룩을 적셔요",
        KNEAD: "밑술 — 일양 · 손으로 치대며 재료를 고루 버무려요",
        COMPLETE: "밑술 — 일양 · 혼합 완료",
      } satisfies Record<typeof phase, string>;

      $("#ferment-game")?.classList.add("hidden");
      $("#btn-ferment")?.classList.add("hidden");
      $("#mitsul-mix-game")?.classList.remove("hidden");
      $$("#ferment-pills .pill").forEach((pill, index) => {
        (pill as HTMLElement).dataset.state = index === 0 ? (S.mitsulDone ? "done" : "now") : "todo";
      });
      const hint = $("#ferment-hint");
      if (hint) hint.textContent = S.mitsulDone ? "혼합까지만 구현된 production 검증입니다" : "고두밥 → 누룩 → 물 → 치대기 순서로 진행해요";
      const caption = $("#cap-ferment");
      if (caption) caption.textContent = captions[phase];
      const label = $("#mitsul-mix-label");
      if (label) label.textContent = labels[phase];
      const pct = $("#mitsul-mix-pct");
      if (pct) pct.textContent = `${Math.round(overall * 100)}%`;
      const bar = $("#bar-mitsul-mix") as HTMLElement | null;
      if (bar) bar.style.width = `${overall * 100}%`;
      const button = $("#btn-mitsul-mix") as HTMLButtonElement | null;
      if (button) {
        button.disabled = true;
        button.classList.toggle("complete", S.mitsulDone);
        button.textContent = S.mitsulDone ? "혼합 완료" : labels[phase];
      }
    }
    // 후발효(fstage 3)에서만 온도 게임·항아리 자동 발효가 돈다. 그 전엔 탭으로만 진행.
    function syncFermentPhase() {
      if (productionMitsulMix) {
        syncMitsulMixUi();
        return;
      }
      fermentShowStage?.(); // 혼합=채반+고두밥 / 1차발효~=항아리
      $$("#ferment-pills .pill").forEach((p, i) => {
        (p as HTMLElement).dataset.state = i < S.fstage ? "done" : i === S.fstage ? "now" : "todo";
      });
      const active = S.fstage >= F_LAST; // 후발효 진행 중
      $("#ferment-game")?.classList.toggle("hidden", !active);
      $("#btn-ferment")?.classList.toggle("hidden", !active);
      const hint = $("#ferment-hint");
      if (hint)
        hint.textContent = active
          ? "항아리에 담근 뒤로는 시간이 익혀 줍니다 · 온도만 맞춰주세요"
          : "";
      if (active) onFermentTick();       // 후발효: 일차·막대·버튼 갱신
      else {
        const cap = $("#cap-ferment");
        if (cap) cap.textContent = FERMENT_STEPS[S.fstage].caption; // 혼합/1차발효/덧술 설명
      }
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
      const day = Math.min(30, 1 + Math.floor(S.ferment / 3.4));
      const cap = $("#cap-ferment");
      if (cap)
        cap.textContent =
          S.ferment >= 100
            ? "완전발효 끝 · 맑은 술이 떠올랐어요"
            : `후발효 ${day}일차 · ${S.ferment < 40 ? "맑은 술이 서서히 떠올라요" : S.ferment < 80 ? "산도·당도가 자리를 잡아가요" : "기포가 잦아들며 곱게 익어요"}`;
      const b = $("#btn-ferment") as HTMLButtonElement | null;
      if (b) {
        b.disabled = S.ferment < 100;
        b.textContent = S.ferment < 100 ? "삼십여 일, 후발효가 무르익는 중…" : "발효 완료 · 마무리 공정으로";
      }
    }
    const btnFerment = $("#btn-ferment");
    if (btnFerment)
      (btnFerment as HTMLElement).onclick = () => {
        // 완성 공정 walkthrough를 처음부터 보여주기 위해 상태를 초기화한다.
        S.press = 0;
        uiRoot!.classList.remove("shipped");
        setStep("done");
        syncPress();
      };

    /* --- 15 · 완성 공정 (압착·여과 → 저온숙성 → 출고) --- */
    const ppills = $("#press-pills");
    if (ppills) {
      ppills.innerHTML = "";
      PRESS_STEPS.forEach((st, i) => {
        const b = document.createElement("button");
        b.className = "pill";
        b.dataset.idx = String(i);
        b.textContent = st.name;
        b.onclick = () => {
          if (i !== S.press) return; // 지금 켜진 단계만 누를 수 있다
          S.press = i + 1;
          syncPress();
        };
        ppills.appendChild(b);
      });
    }
    function syncPress() {
      finishShowShip?.(); // 출고 단계에 도달하면 완성 제품(Nyangi)이 나타난다
      $$("#press-pills .pill").forEach((p, i) => {
        (p as HTMLElement).dataset.state = i < S.press ? "done" : i === S.press ? "now" : "todo";
      });
      const done = S.press >= PRESS_STEPS.length;
      const cur = PRESS_STEPS[Math.min(S.press, PRESS_STEPS.length - 1)];
      const cap = $("#cap-finishing");
      if (cap) cap.textContent = done ? "씻기부터 출고까지 예순 날 넘게, 냥이탁주가 완성됐어요" : cur.caption;
      const hint = $("#finishing-hint");
      if (hint) hint.textContent = done ? "마지막 공정까지 마쳤어요. 완성된 술을 만나보세요." : "";
      const b = $("#btn-finishing") as HTMLButtonElement | null;
      if (b) {
        b.classList.toggle("waiting", !done);
        b.textContent = done ? "완성된 냥이탁주 만나기" : "공정을 순서대로 진행하세요";
      }
    }
    const btnFinishing = $("#btn-finishing");
    if (btnFinishing)
      (btnFinishing as HTMLElement).onclick = () => {
        if (btnFinishing.classList.contains("waiting")) {
          showNotice("위쪽 타임라인에서 단계를 차례로 눌러 마지막 공정을 마쳐 주세요.");
          return;
        }
        uiRoot!.classList.add("shipped");
        // 축하 화면은 한지 배경 — 이때만 헤더를 밝은 톤으로 바꾼다.
        document.documentElement.dataset.arStep = "done";
        // 여기까지 왔으면 양조를 끝낸 것 — 이 술을 도감에 담는다
        markObtained(recipe.drinkId);
      };

    /* --- 리포트 --- */
    const btnReport = $("#btn-report");
    if (btnReport) {
      (btnReport as HTMLElement).onclick = () => {
        const avg = S.tempLog.length ? S.tempLog.reduce((a, b) => a + b, 0) / S.tempLog.length : S.temp;
        const score = Math.round(THREE.MathUtils.clamp(100 - Math.abs(avg - OPTIMAL_C) * 7, 40, 99));
        const notes = recipe.report.notes;
        const extra = INGREDIENTS.find((i) => !i.essential && S.selected.has(i.id));
        const body = $("#report-body");
        if (body)
          body.innerHTML = `
            <dt>제조 방식</dt><dd>${recipe.report.method}</dd>
            <dt>사용한 원료</dt><dd>${[...S.selected].map((id) => INGREDIENTS.find((i) => i.id === id)!.name).join(" · ")}</dd>
            <dt>평균 발효 온도</dt><dd>${avg.toFixed(1)}℃</dd>
            ${(recipe.report.extraRows ?? []).map((r) => `<dt>${r.label}</dt><dd>${r.value}</dd>`).join("")}
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
        S.rinseTurns = 0;
        S.rinsePartial = 0;
        S.soakAt = 0;
        S.coolFans = 0;
        S.coolDone = false;
        S.coolingPhase = "TRAY_PULL";
        S.coolTrayProgress = 0;
        S.coolRiceProgress = 0;
        S.quizDone = false;
        S.temp = 27;
        S.ferment = 0;
        S.fstage = 0;
        S.mitsulPhase = "RICE";
        S.mitsulPourProgress = 0;
        S.mitsulKneadCount = 0;
        S.mitsulDone = false;
        S.press = 0;
        S.tempLog = [];
        uiRoot!.classList.remove("shipped");
        $$(".card").forEach((c) => c.setAttribute("aria-pressed", "false"));
        $("#quiz")?.classList.add("hidden");
        $$("#quiz .choice").forEach((c) => c.classList.remove("ok", "no"));
        if (tempInput) tempInput.value = "27";
        syncTemp();
        syncIngredient();
        syncGodubap();
        onFermentTick();
        syncFermentPhase();
        syncPress();
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
    syncFermentPhase();
    syncPress();
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
      handTracker?.dispose();
      xrFeed?.dispose();
      handVisual.dispose();
      controls.dispose();
      renderer.dispose();
      delete document.documentElement.dataset.arStep;
    };
    // recipe 가 바뀌면 씬·UI를 새 술로 다시 초기화한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipe]);

  return (
    <div ref={rootRef} className="ar-ui" data-step="place">
      <canvas ref={canvasRef} id="gl" />
      {/* 냉각 단계 가장자리 어둡게(비네트) — .cooling 일 때만 보인다 */}
      <div className="vignette" />

      {/* ?trayDebug=1 전용 — production flow에서는 CSS로 완전히 숨긴다 */}
      <aside className="tray-debug-panel" aria-label="Tray pull debug values">
        <div className="tray-debug-title">COOLING① · TRAY PULL</div>
        <div>HAND <b id="tray-debug-hand">LOST</b></div>
        <div>PINCH <b id="tray-debug-pinch">OPEN</b></div>
        <div>TARGET <b id="tray-debug-target">NONE</b></div>
        <div>GRAB <b id="tray-debug-grab">NO</b></div>
        <div>START SPAN <b id="tray-debug-start">—</b></div>
        <div>CURRENT SPAN <b id="tray-debug-current">0.0000</b></div>
        <div>SPAN RATIO <b id="tray-debug-ratio">1.000</b></div>
        <div>PULL PROGRESS <b id="tray-debug-progress">0%</b></div>
        <div>STATE <b id="tray-debug-state">IDLE</b></div>
        <strong id="tray-debug-ok">TRAY PULL OK</strong>
        <button type="button" id="tray-debug-reset">RESET TRAY</button>
      </aside>

      {/* ?riceSpreadDebug=1 전용 */}
      <aside className="rice-debug-panel" aria-label="Rice spread debug values">
        <div className="rice-debug-title">COOLING② · RICE SPREAD</div>
        <div>HAND <b id="rice-debug-hand">LOST</b></div>
        <div>ON RICE <b id="rice-debug-on">NO</b></div>
        <div>PALM X <b id="rice-debug-palm-x">0.500</b></div>
        <div>PALM Y <b id="rice-debug-palm-y">0.500</b></div>
        <div>MOVE DIST <b id="rice-debug-move">0.000</b></div>
        <div>CURRENT ZONE <b id="rice-debug-zone">—</b></div>
        <div>COVERAGE <b id="rice-debug-coverage">0 / 12</b></div>
        <div>ZONE COVERAGE <b id="rice-debug-zone-coverage">0,0,0 / 0,0,0</b></div>
        <div>SPREAD PROGRESS <b id="rice-debug-progress">0%</b></div>
        <div>STATE <b id="rice-debug-state">IDLE</b></div>
        <div>TRAY MODEL <b id="rice-debug-tray-model">LOADING</b></div>
        <div>TRAY VISIBLE <b id="rice-debug-tray-visible">NO</b></div>
        <div>RICE <b id="rice-debug-rice-ready">MISSING</b></div>
        <div>GRID <b id="rice-debug-grid-ready">MISSING</b></div>
        <div>TRAY POS <b id="rice-debug-tray-pos">—</b></div>
        <em id="rice-debug-spread">SPREAD!</em>
        <strong id="rice-debug-ok">RICE SPREAD OK</strong>
        <button type="button" id="rice-debug-reset">RESET RICE</button>
      </aside>
      <i id="rice-debug-palm-marker" aria-hidden="true" />

      {/* ?kneadDebug=1 전용 — production 밑술과 분리된 hand gesture spike */}
      <aside className="knead-debug-panel" aria-label="Knead gesture debug values">
        <div className="knead-debug-title">MITSUL② · KNEAD GESTURE</div>
        <div>HAND <b id="knead-debug-hand">LOST</b></div>
        <div>ON MASH <b id="knead-debug-on">NO</b></div>
        <div>PALM X <b id="knead-debug-palm-x">0.500</b></div>
        <div>PALM Y <b id="knead-debug-palm-y">0.500</b></div>
        <div>HAND RATIO <b id="knead-debug-ratio">0.000</b></div>
        <div>POSE <b id="knead-debug-pose">TRANSITION</b></div>
        <div>GESTURE STATE <b id="knead-debug-state">WAIT_OPEN</b></div>
        <div>KNEAD COUNT <b id="knead-debug-count">0 / 6</b></div>
        <div>KNEAD PROGRESS <b id="knead-debug-progress">0%</b></div>
        <div>TIP MEAN DIST <b id="knead-debug-tip-distance">0.0000</b></div>
        <div>PALM SCALE <b id="knead-debug-palm-scale">0.0000</b></div>
        <em id="knead-debug-feedback">TRANSITION</em>
        <strong id="knead-debug-ok">KNEAD OK</strong>
        <button type="button" id="knead-debug-reset">RESET KNEAD</button>
      </aside>
      <i id="knead-debug-palm-marker" aria-hidden="true" />

      {/* ?mitsulMixDebug=1 전용 — production 혼합 장면의 순서/판정 확인 */}
      <aside className="mitsul-debug-panel" aria-label="Mitsul mix debug values">
        <div className="mitsul-debug-title">MITSUL② · PRODUCTION MIX</div>
        <div>HAND <b id="mitsul-debug-hand">LOST</b></div>
        <div>PHASE <b id="mitsul-debug-phase">RICE</b></div>
        <div>JAR MODEL <b id="mitsul-debug-jar">LOADING</b></div>
        <div>GRAB <b id="mitsul-debug-grab">NO</b></div>
        <div>JAR TARGET <b id="mitsul-debug-target">OUT</b></div>
        <div>ON MASH <b id="mitsul-debug-on-mash">NO</b></div>
        <div>TILT <b id="mitsul-debug-tilt">0°</b></div>
        <div>POUR <b id="mitsul-debug-pour">0%</b></div>
        <div>RICE <b id="mitsul-debug-rice">WAIT</b></div>
        <div>NURUK <b id="mitsul-debug-nuruk">WAIT</b></div>
        <div>WATER <b id="mitsul-debug-water">WAIT</b></div>
        <div>KNEAD <b id="mitsul-debug-knead">0 / 6</b></div>
        <strong id="mitsul-debug-ok">MIX COMPLETE</strong>
        <button type="button" id="mitsul-debug-reset">RESET MIX</button>
      </aside>

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
              <div className="msg" id="msg-ingredient">{recipe.intro}</div>
            </div>
          </div>
        </div>
        <div className="fill" />
        <div className="dock">
          <div className="hand-hud" data-state="idle">
            <i className="lamp" />
            <span className="hand-hud-msg">손을 카메라에 비춰 주세요</span>
          </div>
          <div className="grid" id="grid" />
          <button className="cta" id="btn-ingredient" disabled>주원료 선택</button>
        </div>
      </div>

      {/* 13 · 고두밥 */}
      <div className="panel-step" id="p-godubap">
        <div className="steps" id="pills" />
        <div className="steps-hint" id="godubap-hint"></div>
        <div className="fill">
          <div className="caption" id="cap-godubap">{recipe.godubapSteps[0]?.caption}</div>
        </div>
        <div className="dock">
          <div className="hand-hud" data-state="idle">
            <i className="lamp" />
            <span className="hand-hud-msg">손을 카메라에 비춰 주세요</span>
          </div>
          {/* 헹구기·불리기·식히기가 나눠 쓰는 진행 막대 */}
          <div id="godubap-game" className="hidden">
            <div className="ferment-row">
              <span className="ferment-rate" id="godubap-game-label" data-state="warn">
                그릇 안에서 손을 둥글게 돌려 쌀을 헹구세요
              </span>
              <span className="ferment-pct" id="godubap-pct">0%</span>
            </div>
            <div className="bar"><i id="bar-godubap" /></div>
          </div>
          <div id="quiz" className="hidden">
            <div className="coach">
              <div className="avatar" />
              <div style={{ flex: 1 }}>
                <div className="who">술도가 장인</div>
                <div className="msg" id="quiz-q">{recipe.quiz.question}</div>
                <div className="choices" id="quiz-choices" />
              </div>
            </div>
          </div>
          <button className="cta waiting" id="btn-godubap">공정을 순서대로 진행하세요</button>
        </div>
      </div>

      {/* 14 · 발효 */}
      <div className="panel-step" id="p-ferment">
        <div className="steps" id="ferment-pills" />
        <div className="steps-hint" id="ferment-hint"></div>
        <div className="fill">
          <div className="caption" id="cap-ferment">{recipe.fermentSteps[0]?.caption}</div>
        </div>
        <div className="dock">
          <div className="hand-hud" data-state="idle">
            <i className="lamp" />
            <span className="hand-hud-msg">손을 카메라에 비춰 주세요</span>
          </div>
          <div id="mitsul-mix-game" className="hidden">
            <div className="ferment-row">
              <span className="ferment-rate" id="mitsul-mix-label">식힌 고두밥을 항아리에 부어주세요</span>
              <span className="ferment-pct" id="mitsul-mix-pct">0%</span>
            </div>
            <div className="bar"><i id="bar-mitsul-mix" /></div>
            <button className="cta" id="btn-mitsul-mix" disabled>식힌 고두밥을 항아리에 부어주세요</button>
          </div>
          <div id="ferment-game" className="hidden">
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
          </div>
          <button className="cta hidden" id="btn-ferment" disabled>발효가 무르익는 중…</button>
        </div>
      </div>

      {/* 15 · 완성 공정 (압착·여과 → 저온숙성 → 출고) */}
      <div className="panel-step" id="p-finishing">
        <div className="steps" id="press-pills" />
        <div className="steps-hint" id="finishing-hint"></div>
        <div className="fill">
          <div className="caption" id="cap-finishing">{recipe.pressSteps[0]?.caption}</div>
        </div>
        <div className="dock">
          <button className="cta waiting" id="btn-finishing">공정을 순서대로 진행하세요</button>
        </div>
      </div>

      {/* 16 · 완성 */}
      <div id="finish">
        <img className="finish-drink" src={recipe.finish.image} alt={recipe.finish.alt} />
        <h1>{recipe.name}<br />양조 체험 완료!</h1>
        <p>{recipe.finish.note}</p>
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

      {/* 안내 알림 — 아직 진행할 수 없는 버튼을 눌렀을 때 */}
      <div id="notice">
        <div className="sheet">
          <p id="notice-msg" />
          <button className="cta" id="btn-close-notice">알겠어요</button>
        </div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: styles }} />
    </div>
  );
}
