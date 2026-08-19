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
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { clone as skinnedClone } from "three/addons/utils/SkeletonUtils.js";
import type { Recipe, ModelDef, ArStep } from "@/lib/brewery/types";
import { HandTracker } from "@/lib/hand/handTracker";
import { HandVisual, coverFit, screenDist, screenToWorld, worldToScreen, type CoverFit } from "@/lib/hand/handVisual";
import type { HandFrame } from "@/lib/hand/types";
import { FanGesture } from "@/lib/hand/fanGesture";
import { StirGesture } from "@/lib/hand/stirGesture";
import { markObtained } from "@/lib/dex";
import { XrCameraFeed } from "@/lib/hand/xrCameraFeed";
import { styles } from "@/components/arBreweryStyles";
import { rinseActive, soakActive, coolingActive, createBreweryState, arStepForDocument, resetSelectedIngredients, getIngredientSelectionState
  ,getIngredientButtonText, isIngredientSelectionComplete, getIngredientCoachText
 } from "@/lib/brewery/state";
import { REQUIRED_FANS, REQUIRED_RINSE_TURNS, SOAK_MS, platformContentY } from "@/lib/brewery/constants";
import { shouldTrackHand } from "@/lib/hand/handStep";
import { setDepthDebug } from "@/lib/ar/debug";

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
    
    const setDepthDebugText = (text: string) => {
      setDepthDebug(uiRoot, text);
    };

    const $ = <T extends Element = HTMLElement>(s: string) =>
      uiRoot.querySelector(s) as T | null;
    const $$ = (s: string) => Array.from(uiRoot.querySelectorAll(s));

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

    const S = createBreweryState();
    /**
     * 받침대 상판 위에 물건을 올릴 때 띄우는 높이(m).
     * 모든 모델이 이 하나의 기준을 쓴다 — 모델마다 기준이 달라지면
     * 어떤 건 허공에 뜨고 어떤 건 상판(또는 실제 탁자) 속에 파묻힌다.
     */

    // 원료 단계에 막 들어온 시각 — 화면 전환 직후 밀려오는 '유령 클릭'을 걸러내는 데 쓴다.
    let enteredIngredientAt = 0;
    // 고두밥 하위 단계가 바뀔 때 무대 모델을 갈아 끼우는 함수(buildGodubap 이 채운다)
    let godubapShowStage: (() => void) | null = null;
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

    /** 지금이 물에 불리는 중인가 (침수) — 손은 필요 없고 시간만 흐르면 된다 */

    function resetIngredientSelection() {
      enteredIngredientAt = performance.now();
      resetSelectedIngredients(S.selected);
      resetIngredientUi();
      syncIngredient(); // 버튼 "주원료 0/N" 로 초기화 (interacted=false → 멘트는 인트로 유지)
    }

    /** 손으로 조작하는 단계 — 원료(집기)와 고두밥(부채질) */

    function setStep(next: typeof S.step) {
      S.step = next;
      uiRoot!.dataset.step = next;
      // 손을 쓰는 단계에서만 검출을 돌린다. 나머지 단계까지 MediaPipe 를 계속 굴리면
      // GPU 를 나눠 쓰느라 발효·완성 연출이 버벅인다.
      handTracker?.setPaused(!shouldTrackHand(next));
      // 완료 화면은 한지 배경이라 헤더도 함께 밝아져야 한다.
      // 다만 'done'의 앞 국면(압착~출고 완성 공정 walkthrough)은 AR 카메라를 그대로 두므로,
      // 헤더도 카메라 톤을 유지한다. 한지 축하 화면(.shipped)일 때만 밝은 헤더로 바꾼다.
      document.documentElement.dataset.arStep = arStepForDocument(next);
      // 원료 단계에 들어올 때마다 선택을 깨끗이 비워 '1개 선택된 채 시작'을 막는다.
      if (next === "ingredient") resetIngredientSelection();
      buildStageFor(next);
      const needed = [
        ...MODELS.filter((m) => m.step === "common" || m.step === next),
        ...(next === "godubap" ? GODUBAP_MODELS : []),
        ...(next === "done" && FINISH_MODEL ? [FINISH_MODEL] : []),
      ].filter((m) => !LOADED[m.id]);
      if (needed.length) {
        void Promise.all(needed.map(loadModel)).then(() => {
          if (S.step === next) buildStageFor(next);
        });
      }
    }

    function resetIngredientUi() {
      $$("#grid .card").forEach((c) =>
        c.setAttribute("aria-pressed", "false")
      );

      const msg = $("#msg-ingredient");

      if (msg) {
        msg.textContent = recipe.intro;
      }
    }


    /* =========================================================
    * TEMP DEBUG — 출고 직전으로 바로 이동
    * 나중에 삭제
    * ======================================================= */
    function debugSkipToBeforeShip() {
      S.placed = true;
      anchor.visible = true;

      // 마지막 출고 단계의 바로 앞(저온숙성)으로 이동한다.
      S.press = Math.max(0, PRESS_STEPS.length - 2);
      uiRoot!.classList.remove("shipped");
      delete uiRoot!.dataset.shipSequence;
      setStep("done");
      syncPress();

      console.log(
        "[DEBUG] 출고 직전으로 이동",
        `finishStep=${S.press}`,
        `stepId=${PRESS_STEPS[S.press]?.id ?? "unknown"}`
      );
    }

    /* =====================================================================
     * 1. 렌더러 / 씬
     * ===================================================================*/
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.9; //임시로 1.05에서 내림
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.xr.enabled = true;
    // 손을 두 번째 패스로 덧그리므로 자동 클리어를 끄고 직접 관리한다
    renderer.autoClear = false;

    const scene = new THREE.Scene();
    
    /* ─────────────────────────────────────
     * PBR 환경광
     * GLB의 metalness / roughness 재질이
     * 단순 조명만 받을 때 플라스틱처럼 보이는 문제를 완화
     * ───────────────────────────────────── */
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const roomEnvironment = new RoomEnvironment();

    const envMap = pmremGenerator.fromScene(
      roomEnvironment,
      0.04
    ).texture;

    scene.environment = envMap;
    scene.environmentIntensity = 0.45;

    roomEnvironment.dispose();
    pmremGenerator.dispose();

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

    scene.add(new THREE.HemisphereLight(0xf2eee5, 0x5a5147, 0.55)); //0xdfe8e0, 0x1b2118, 1.15
    const keyLight = new THREE.DirectionalLight(0xfff4e8, 0.85); //0xfff2d8, 1.9
    keyLight.position.set(0.8, 1.5, 1.0);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);

    keyLight.shadow.bias = -0.00015;
    keyLight.shadow.normalBias = 0.02;

    keyLight.shadow.camera.near = 0.1;
    keyLight.shadow.camera.far = 6;
    keyLight.shadow.camera.left = -1.2;
    keyLight.shadow.camera.right = 1.2;
    keyLight.shadow.camera.top = 1.2;
    keyLight.shadow.camera.bottom = -1.2;
    scene.add(keyLight);
    const rim = new THREE.PointLight(0xffd8b5, 0.35, 3); //0xc2452f, 2.2, 3
    rim.position.set(-0.6, 0.8, -0.4);
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
    const LOADING: Partial<Record<string, Promise<void>>> = {};
    const gltfLoader = new GLTFLoader();

    function loadModel(m: ModelDef): Promise<void> {
      if (LOADED[m.id]) return Promise.resolve();
      const pending = LOADING[m.id];
      if (pending) return pending;
      LOADING[m.id] = gltfLoader.loadAsync(m.file)
        .then((gltf) => { LOADED[m.id] = gltf; })
        .catch((e: any) => {
          console.warn("모델 로드 실패:", m.id, m.file, e?.message);
        });
      return LOADING[m.id]!;
    }

    async function preloadModels() {
      // 첫 화면에 꼭 필요한 받침대·원료만 기다린다. 92MB 후발효 모델까지
      // Promise.all로 묶던 것이 AR 시작 전체를 지연시키던 주원인이었다.
      const initial = MODELS.filter(
        (m) => m.id === "low_wooden_bench" || m.step === "ingredient"
      );
      await Promise.all(initial.map(loadModel));
    }

    async function preloadRemainingModels() {
      const all = [...MODELS, ...GODUBAP_MODELS, ...(FINISH_MODEL ? [FINISH_MODEL] : [])];
      const rest = all
        .filter((m, i) => all.findIndex((x) => x.id === m.id) === i && !LOADED[m.id])
        // 가장 큰 Closed_jar는 마지막에 받아 앞 단계 자산의 네트워크를 막지 않게 한다.
        .sort((a, b) => Number(a.id === "closed_jar") - Number(b.id === "closed_jar"));
      for (const model of rest) await loadModel(model);
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
      const defs = MODELS.filter((m) => m.step === step && !m.processSteps?.length);
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
      onHand: ((frame: HandFrame, hand: HandVisual, interactionCamera: THREE.Camera) => void) | null;
      cleanup: (() => void)[];
    } = { particles: [], mixers: [], models: [], tick: null, onHand: null, cleanup: [] };

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
      live.cleanup.forEach((dispose) => dispose());
      live.cleanup.length = 0;
      live.tick = null;
      live.onHand = null;
      godubapShowStage = null;
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
      /** 가상 rigged hand가 안정적으로 보일 때만 pinch 기반 조작을 허용한다. */
      const HAND_GRAB_ENABLED = true;

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

      live.onHand = (f, hand, interactionCamera) => {
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

        if (!HAND_GRAB_ENABLED) {
          dropHeld();
          setHover(null);
          setHandHud("tracking", "손 가림 확인 중 · 원료는 아래 카드를 눌러 선택해 주세요");
          return;
        }

        const pinch = hand.pinchScreen;

        // 1) 들고 있는 중 — 손끝을 따라오게 하고, 펴면 놓는다
        if (held) {
          const ud = held.userData as any;
          // 화면상 손끝을 따라간다. 거리는 집었을 때 그대로 — 크기가 들쭉날쭉하지 않게.
          screenToWorld(pinch.x, pinch.y, heldDepth, interactionCamera, grabTarget);
          stageGroup.worldToLocal(grabTarget);
          held.position.lerp(grabTarget, 0.5);

          stageGroup.localToWorld(basketWorld.copy(basketLocal));
          worldToScreen(basketWorld, interactionCamera, basketScreen);
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
          worldToScreen(nodeWorld, interactionCamera, nodeScreen);
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
          heldDepth = interactionCamera.getWorldPosition(handOrigin).distanceTo(nodeWorld);
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
          const on = show.has(id);
          groups.forEach((g) => (g.visible = on));
        });
        const dark = cur?.dark === true;
        if (!dark) coolT = 0;
        uiRoot!.classList.toggle("cooling", dark); // 가장자리 비네트
      };
      godubapShowStage();

      live.tick = (t, dt) => {
        const cur = GODUBAP_STEPS[S.godubap];

        // 침수 — 담가 두고 기다리면 다 분다. 손으로 할 일은 없다.
        if (soakActive(S.hand, S.godubap)) {
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
        const cooling = cur?.dark === true && coolingActive(S.hand, S.godubap, GB_LAST, S.quizDone, S.coolDone);
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

      live.onHand = (f) => {
        // ── 세미 — 그릇에 손을 넣고 둥글게 휘저어 쌀을 헹군다 ──────────────
        if (rinseActive(S.hand, S.godubap, S.rinseTurns, REQUIRED_RINSE_TURNS)) {
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

        if (coolingActive(S.hand, S.godubap, GB_LAST, S.quizDone, S.coolDone)) {
          if (!f.present) setHandHud("idle", "손을 카메라에 비춰 주세요");
          return;
        }

        const gained = fan.update(f);
        if (gained) {
          S.coolFans = Math.min(REQUIRED_FANS, S.coolFans + gained);
          fanPulse = 1;
          syncGodubapGame();
          // 다 식히면 그때 장인이 질문을 던진다
          if (S.coolFans >= REQUIRED_FANS && !S.coolDone) {
            S.coolDone = true;
            fan.reset();
            S.godubap = GB_N; // 다 식었으니 고두밥 완성
            syncGodubap();
          }
          return;
        }

        if (!f.present) setHandHud("idle", "손을 카메라에 비춰 주세요");
        else setHandHud("tracking", `손을 좌우로 흔들어 식혀 주세요 · ${S.coolFans}/${REQUIRED_FANS}`);
      };
    }

    /* --- 14 · 발효 --- */
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

      // 표에 지정된 발효 세부 공정 모델. 현재 타임라인 id와 일치할 때만 보인다.
      const fermentProcessModels = MODELS
        .filter((m) => m.step === "ferment" && m.processSteps?.length)
        .map((def) => {
          const group = new THREE.Group();
          const node = spawnModel(def);
          group.position.set(0, platformTop + def.y, 0);
          if (def.id === "wooden_spatula") {
            group.position.x = 0.08;
            group.rotation.z = -0.72;
          }
          if (node) group.add(node);
          group.visible = false;
          stageGroup.add(group);
          return { def, group };
        });

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
        const processId = FERMENT_STEPS[Math.min(S.fstage, F_LAST_I)]?.id;
        cooled.visible = S.fstage === 0;   // 혼합에서만 채반+고두밥
        // 후발효에는 밀봉 항아리가 대신 등장한다.
        jar.visible = S.fstage >= 1 && processId !== "post";
        fermentProcessModels.forEach(({ def, group }) => {
          group.visible = Boolean(processId && def.processSteps?.includes(processId));
        });
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
      
      // ── 완성 병 등장 연출 상태 ──
      let shipRevealT = 0;
      let shipRestY = 0;
      let shipHapticSent = false;
      let shipUiDoneSent = false;

      // 출고 연출은 짧고 선명하게 끝낸다. 이전 3.8초 시퀀스는 병이 이미
      // 준비된 뒤에도 UI를 오래 잠가 모바일에서 로딩처럼 느껴졌다.
      const SHIP_SETTLE_END = 0.12;
      const SHIP_REVEAL_END = 0.72;
      const SHIP_BOUNCE_END = 1.02;
      const SHIP_CELEBRATE_END = 1.25;
      const SHIP_RESULT_END = 2.05;
      const SHIP_READY_AT = 2.2;

      const setShipSequence = (phase?: "settling" | "reveal" | "celebrate" | "result" | "ready") => {
        if (phase) {
          // render loop에서 같은 dataset을 계속 쓰면 매 프레임 CSS 재계산이
          // 발생한다. 실제 단계가 바뀔 때만 DOM을 갱신한다.
          if (uiRoot!.dataset.shipSequence !== phase) uiRoot!.dataset.shipSequence = phase;
        } else if (uiRoot!.dataset.shipSequence) {
          delete uiRoot!.dataset.shipSequence;
        }
      };

      // 완성 병 뒤쪽의 따뜻한 보상광
      const shipGlow = new THREE.PointLight(
        0xffc98a,
        0,
        1.2
      );

      shipGlow.position.set(0, platformTop + 0.16, 0);
      stageGroup.add(shipGlow);
      

      /* ─────────────────────────────────────
       * Contact Shadow
       * 병이 실제 바닥에 닿아 있다는 느낌
       * 병 크기에 따라 0.17을 조절하여 그림자를 조절한다.
       * ───────────────────────────────────── */
      const contactShadow = new THREE.Mesh(
        new THREE.CircleGeometry(0.17, 48),
        new THREE.ShadowMaterial({
          color: 0x000000,
          opacity: 0.28,
        })
      );
      contactShadow.rotation.x = -Math.PI / 2;
      /*
       * 정확히 표면과 겹치면 z-fighting이 생길 수 있으므로
       * 1mm 정도 위에 둔다.
       */
      contactShadow.position.set(0, contentY + 0.001, 0);
      contactShadow.receiveShadow = true;
      stageGroup.add(contactShadow);

      placeModelsForStep("done", stageGroup, platformTop);
      const finishProcessModels = MODELS
        .filter((m) => m.step === "done" && m.processSteps?.length)
        .map((def) => {
          const group = new THREE.Group();
          const node = spawnModel(def);
          group.position.set(0, platformTop + def.y, 0);
          if (node) group.add(node);
          group.visible = false;
          stageGroup.add(group);
          return { def, group };
        });

      /* ── 압착·여과: receiving_jar 수위 인터랙션 ──────────────────
       * Interaction_Collider는 렌더링하지 않고 raycast/손 위치 판정에만
       * 사용한다. 아래로 짜는 동작량을 ClearWine_Surface의 local Y로
       * 변환하여 항아리 안의 맑은 술이 차오르게 한다.
       */
      const pressIndex = PRESS_STEPS.findIndex((step) => step.id === "press");
      const pressEntry = finishProcessModels.find(({ def }) => def.id === "press_jar");
      let pressSurface: THREE.Object3D | null = null;
      let pressCollider: THREE.Object3D | null = null;
      let pressFill = 0;
      let pressFillTarget = 0;
      let pressSurfaceEmptyY = 0;
      let pressSurfaceFullY = 0;
      let pressDragging = false;
      let pressPointerId: number | null = null;
      let pressLastPointerY = 0;
      let pressLastHandY: number | null = null;

      if (pressEntry) {
        pressEntry.group.traverse((object) => {
          if (object.name === "ClearWine_Surface") {
            pressSurface = object;
            object.visible = true;
            pressSurfaceEmptyY = object.position.y;
            // GLB의 액체 표면은 빈 수위(0.28)에 배치되어 있고 콜라이더는
            // 입구 높이(0.85)에 있다. 입구 바로 아래까지만 상승시킨다.
            pressSurfaceFullY = pressSurfaceEmptyY + 0.44;
          } else if (object.name === "Interaction_Collider") {
            pressCollider = object;
            object.visible = false;
          } else if (object.name === "Jar_Outer" || object.name === "Jar_Inner" || object.name === "Jar_body") {
            object.visible = true;
          }
        });
      }

      const pressStream = new THREE.Mesh(
        new THREE.CylinderGeometry(0.004, 0.007, 0.17, 12),
        new THREE.MeshPhysicalMaterial({
          color: 0xf3e4bd,
          transparent: true,
          opacity: 0,
          roughness: 0.18,
          transmission: 0.28,
          depthWrite: false,
        })
      );
      pressStream.position.set(0, contentY + 0.31, 0);
      pressStream.visible = false;
      stageGroup.add(pressStream);

      const pressRaycaster = new THREE.Raycaster();
      const pressPointerNdc = new THREE.Vector2();
      // useEffect 진입부에서 null 검사를 마친 캔버스를 비동기 콜백에서도
      // non-null DOM 요소로 유지한다.
      const pressCanvas = canvasRef.current!;
      const pointerHitsPressCollider = (clientX: number, clientY: number) => {
        if (!pressCollider || S.press !== pressIndex || !pressEntry?.group.visible) return false;
        const rect = pressCanvas.getBoundingClientRect();
        pressPointerNdc.set(
          ((clientX - rect.left) / rect.width) * 2 - 1,
          -((clientY - rect.top) / rect.height) * 2 + 1
        );
        const viewCamera = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
        pressRaycaster.setFromCamera(pressPointerNdc, viewCamera);
        return pressRaycaster.intersectObject(pressCollider, true).length > 0;
      };
      const addPressFill = (screenDeltaY: number) => {
        if (screenDeltaY <= 0) return;
        pressFillTarget = THREE.MathUtils.clamp(pressFillTarget + screenDeltaY * 0.0045, 0, 1);
        pressStream.visible = true;
        (pressStream.material as THREE.MeshPhysicalMaterial).opacity = 0.68;
        navigator.vibrate?.(8);
      };
      const onPressPointerDown = (event: PointerEvent) => {
        if (!pointerHitsPressCollider(event.clientX, event.clientY)) return;
        pressDragging = true;
        pressPointerId = event.pointerId;
        pressLastPointerY = event.clientY;
        pressCanvas.setPointerCapture?.(event.pointerId);
        event.preventDefault();
      };
      const onPressPointerMove = (event: PointerEvent) => {
        if (!pressDragging || event.pointerId !== pressPointerId) return;
        addPressFill(event.clientY - pressLastPointerY);
        pressLastPointerY = event.clientY;
        event.preventDefault();
      };
      const endPressPointer = (event: PointerEvent) => {
        if (event.pointerId !== pressPointerId) return;
        pressDragging = false;
        pressPointerId = null;
        pressCanvas.releasePointerCapture?.(event.pointerId);
      };
      pressCanvas.addEventListener("pointerdown", onPressPointerDown, { passive: false });
      pressCanvas.addEventListener("pointermove", onPressPointerMove, { passive: false });
      pressCanvas.addEventListener("pointerup", endPressPointer);
      pressCanvas.addEventListener("pointercancel", endPressPointer);
      live.cleanup.push(() => {
        pressCanvas.removeEventListener("pointerdown", onPressPointerDown);
        pressCanvas.removeEventListener("pointermove", onPressPointerMove);
        pressCanvas.removeEventListener("pointerup", endPressPointer);
        pressCanvas.removeEventListener("pointercancel", endPressPointer);
      });

      const handlePressHand = (frame: HandFrame, hand: HandVisual, interactionCamera: THREE.Camera) => {
        if (!pressCollider || !pressEntry?.group.visible || !frame.present) {
          pressLastHandY = null;
          return;
        }
        const colliderWorld = new THREE.Vector3();
        const colliderScreen = { x: 0.5, y: 0.5 };
        pressCollider.getWorldPosition(colliderWorld);
        worldToScreen(colliderWorld, interactionCamera, colliderScreen);
        const pinch = hand.pinchScreen;
        const overMouth = screenDist(pinch, colliderScreen) < 0.18;
        if (overMouth && (frame.pinching || frame.justPinched)) {
          if (pressLastHandY !== null) addPressFill((pinch.y - pressLastHandY) * pressCanvas.clientHeight);
          pressLastHandY = pinch.y;
          setHandHud("holding", "아래로 천천히 짜서 맑은 술을 받아주세요");
        } else {
          pressLastHandY = null;
          setHandHud(overMouth ? "hover" : "tracking", overMouth ? "엄지와 검지를 모아 아래로 짜주세요" : "항아리 입구로 손을 옮겨주세요");
        }
      };

      /* ── 저온숙성: 항아리를 손으로 감싸 냉장고 안에 넣는다 ────────────
       * 공정용 GLB를 단순 전시하는 대신, 화면에서 보이는 손의 pinch 위치로
       * 항아리를 집고 목표 영역에 놓게 한다. 깊이는 집은 순간에 고정해
       * MediaPipe z 노이즈 때문에 크기가 출렁이지 않도록 한다.
       */
      const agingIndex = PRESS_STEPS.findIndex((step) => step.id === "aging");
      const chamberEntry = finishProcessModels.find(({ def }) => def.id === "cold_storage_chamber");
      const closedJarDef = MODELS.find((def) => def.id === "closed_jar");
      const agingJar = new THREE.Group();
      const agingJarNode = closedJarDef ? spawnModel(closedJarDef) : null;
      const chamberCameraInStage = new THREE.Vector3();
      if (agingJarNode) agingJar.add(agingJarNode);
      agingJar.visible = false;
      stageGroup.add(agingJar);

      // 냉장고와 충분히 떨어진 전경에서 시작한다. 정적 공정 모델의
      // Closed_jar는 아래 finishShowShip에서 숨기므로 항아리가 안쪽에
      // 하나 더 겹쳐 보이지 않는다.
      const jarHome = new THREE.Vector3(-0.16, contentY + 0.002, 0.285);
      const jarTarget = new THREE.Vector3(0, contentY + 0.012, -0.085);
      agingJar.position.copy(jarHome);

      if (chamberEntry) {
        // 원본 GLB의 정면 축이 무대 카메라와 반대여서 열린 문 대신 뒷판이
        // 보였다. 정면을 사용자 쪽으로 돌리고 레퍼런스처럼 주 오브젝트가
        // 되도록 충분히 키워 뒤쪽에 배치한다.
        chamberEntry.group.position.set(0, contentY + 0.002, -0.14);
        // Blender 기준 열린 면은 로컬 -X 방향이다. 아래 tick에서 이 축을
        // 고정 각도가 아니라 실제 XR 카메라 쪽으로 계속 맞춘다.
        chamberEntry.group.rotation.y = 0;
        chamberEntry.group.scale.setScalar(1.62);
      }

      const coldTarget = new THREE.Mesh(
        new THREE.RingGeometry(0.072, 0.081, 56),
        new THREE.MeshBasicMaterial({
          color: 0x8bdcff,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
          toneMapped: false,
        })
      );
      coldTarget.rotation.x = -Math.PI / 2;
      coldTarget.position.set(jarTarget.x, contentY + 0.006, jarTarget.z);
      coldTarget.visible = false;
      stageGroup.add(coldTarget);

      const coldGlow = new THREE.PointLight(0x73cfff, 0, 0.72);
      coldGlow.position.set(jarTarget.x, contentY + 0.17, jarTarget.z);
      stageGroup.add(coldGlow);

      const guidePoints = [
        new THREE.Vector3(jarHome.x, contentY + 0.01, jarHome.z),
        new THREE.Vector3(-0.08, contentY + 0.018, 0.06),
        new THREE.Vector3(-0.035, contentY + 0.018, -0.015),
        new THREE.Vector3(jarTarget.x, contentY + 0.018, jarTarget.z),
      ];
      const guideCurve = new THREE.CatmullRomCurve3(guidePoints);
      const guide = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(guideCurve.getPoints(30)),
        new THREE.LineDashedMaterial({
          color: 0xb9ecff,
          transparent: true,
          opacity: 0,
          dashSize: 0.018,
          gapSize: 0.012,
          depthWrite: false,
        })
      );
      guide.computeLineDistances();
      guide.visible = false;
      stageGroup.add(guide);

      type AgingPhase = "idle" | "ready" | "holding" | "snapping" | "aging" | "complete";
      let agingPhase: AgingPhase = "idle";
      let agingT = 0;
      let agingHapticSent = false;
      let agingCompleted = false;
      let heldJarDepth = 1;
      const agingGrabTarget = new THREE.Vector3();
      const jarWorld = new THREE.Vector3();
      const targetWorld = new THREE.Vector3();
      const jarScreen = { x: 0.5, y: 0.5 };
      const targetScreen = { x: 0.5, y: 0.5 };

      const setAgingCopy = (caption: string, hint = "") => {
        const cap = $("#cap-finishing");
        if (cap) cap.textContent = caption;
        const hintNode = $("#finishing-hint");
        if (hintNode) hintNode.textContent = hint;
      };

      const resetAgingInteraction = () => {
        agingPhase = "ready";
        agingT = 0;
        agingHapticSent = false;
        agingCompleted = false;
        agingJar.position.copy(jarHome);
        agingJar.scale.setScalar(1);
        agingJar.visible = Boolean(agingJarNode);
        coldTarget.visible = true;
        guide.visible = true;
        (coldTarget.material as THREE.MeshBasicMaterial).opacity = 0.72;
        (guide.material as THREE.LineDashedMaterial).opacity = 0.72;
        coldGlow.intensity = 0.38;
        setAgingCopy("숙성 항아리를 손으로 감싸 안쪽에 넣어주세요", "엄지와 검지를 모아 항아리를 집고 · 빛나는 자리에서 펴세요");
      };

      live.onHand = (frame, hand, interactionCamera) => {
        if (S.press === pressIndex) {
          handlePressHand(frame, hand, interactionCamera);
          return;
        }
        if (S.press !== agingIndex || agingPhase === "aging" || agingPhase === "snapping" || agingPhase === "complete") return;
        if (!frame.present) {
          if (agingPhase === "holding") agingPhase = "ready";
          setHandHud("idle", "손을 카메라에 비춰 항아리를 감싸 주세요");
          return;
        }

        const pinch = hand.pinchScreen;
        agingJar.getWorldPosition(jarWorld);
        coldTarget.getWorldPosition(targetWorld);
        worldToScreen(jarWorld, interactionCamera, jarScreen);
        worldToScreen(targetWorld, interactionCamera, targetScreen);

        if (agingPhase === "holding") {
          screenToWorld(pinch.x, pinch.y, heldJarDepth, interactionCamera, agingGrabTarget);
          stageGroup.worldToLocal(agingGrabTarget);
          agingJar.position.lerp(agingGrabTarget, 0.46);
          const overTarget = screenDist(pinch, targetScreen) < 0.17;
          setHandHud("holding", overTarget ? "여기에서 손을 펴 놓아주세요" : "빛나는 자리까지 항아리를 옮겨주세요");
          if (frame.justReleased) {
            if (overTarget) {
              agingPhase = "snapping";
              agingT = 0;
              setAgingCopy("항아리가 냉장고 안에 자리 잡고 있어요", "낮은 온도에서 천천히 숙성합니다");
              navigator.vibrate?.(28);
            } else {
              agingPhase = "ready";
              setHandHud("tracking", "조금 더 안쪽의 빛나는 자리에 놓아주세요");
            }
          }
          return;
        }

        const nearJar = screenDist(pinch, jarScreen) < 0.15;
        setHandHud(nearJar ? "hover" : "tracking", nearJar ? "엄지와 검지를 모아 항아리를 집으세요" : "항아리 가까이 손을 가져가세요");
        if (nearJar && frame.justPinched) {
          agingPhase = "holding";
          heldJarDepth = Math.max(0.45, interactionCamera.position.distanceTo(jarWorld));
          navigator.vibrate?.(16);
        }
      };
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
      const shipMaterials: THREE.Material[] = [];
      if (FINISH_MODEL) {
        const node = spawnModel(FINISH_MODEL);
        if (node) {
          /* GLB 전체에 shadow 적용 */
          node.traverse((obj) => {
            if (!(obj instanceof THREE.Mesh)) return;

            obj.castShadow = true;
            obj.receiveShadow = true;

            const source = Array.isArray(obj.material) ? obj.material : [obj.material];
            const cloned = source.map((mat) => {
              const copy = mat.clone();
              copy.transparent = true;
              copy.opacity = 0;
              copy.needsUpdate = true;
              shipMaterials.push(copy);
              return copy;
            });
            obj.material = Array.isArray(obj.material) ? cloned : cloned[0];
          });

          const g = new THREE.Group();
          g.position.set(0, platformTop + FINISH_MODEL.y, 0);
          g.add(node);
          g.visible = false;
          stageGroup.add(g);
          shipModel = g;
          
          // 완성 병이 최종적으로 자리잡을 높이 저장
          shipRestY = g.position.y;
        }
      }

      // 레퍼런스의 여러 겹 붓결 링. 단순 RingGeometry 대신 투명 UI 텍스처를
      // 바닥에 눕혀 실제 테이블의 결은 살리고, 빛만 포개지도록 한다.
      const glowRingTexture = new THREE.TextureLoader().load("/ar/ui/shipping-glow-ring.png");
      glowRingTexture.colorSpace = THREE.SRGBColorSpace;
      const glowRingGeometry = new THREE.PlaneGeometry(0.34, 0.34);
      const glowRings = Array.from({ length: 4 }, (_, i) => {
        const ring = new THREE.Mesh(
          glowRingGeometry,
          new THREE.MeshBasicMaterial({
            map: glowRingTexture,
            color: 0xffe0ad,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
            toneMapped: false,
          })
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = contentY + 0.0035 + i * 0.00012;
        ring.scale.setScalar(0.12);
        ring.visible = false;
        stageGroup.add(ring);
        return ring;
      });

      const hideGlowRings = () => glowRings.forEach((ring) => {
        ring.visible = false;
        ring.scale.setScalar(0.12);
        (ring.material as THREE.MeshBasicMaterial).opacity = 0;
      });

      // 중심에서 시간차로 태어나 바깥으로 갈수록 흐려지는 다중 파동.
      const updateGlowWaves = (time: number, oneShot: boolean) => {
        const period = oneShot ? 1 : 2.55;
        glowRings.forEach((ring, i) => {
          const delay = i * 0.14;
          const rawAge = oneShot
            ? (time - delay) / (1 - delay)
            : ((time / period - i / glowRings.length) % 1 + 1) % 1;
          const age = THREE.MathUtils.clamp(rawAge, 0, 1);
          const born = THREE.MathUtils.smoothstep(age, 0, 0.14);
          const fade = Math.pow(1 - age, 1.65);
          ring.visible = rawAge >= 0 && rawAge < 1;
          ring.scale.setScalar(THREE.MathUtils.lerp(0.16, 1.03, 1 - Math.pow(1 - age, 2)));
          (ring.material as THREE.MeshBasicMaterial).opacity = born * fade * (oneShot ? 0.48 : 0.29);
          ring.rotation.z = time * (0.055 + i * 0.008);
        });
      };

      // 핑크는 출고 순간에만: 작은 발바닥 세 개를 병 주변에 조용히 띄운다.
      const pawTexture = new THREE.TextureLoader().load("/ar/ui/paw-pink.png");
      pawTexture.colorSpace = THREE.SRGBColorSpace;
      const paws = [
        [-0.09, 0.12, 0.018],
        [0.095, 0.16, 0.012],
        [-0.065, 0.22, -0.005],
      ].map(([x, y, z]) => {
        const material = new THREE.SpriteMaterial({
          map: pawTexture,
          color: 0xffb0c0,
          transparent: true,
          opacity: 0,
          depthWrite: false,
        });
        const sprite = new THREE.Sprite(material);
        sprite.position.set(x, contentY + y, z);
        sprite.scale.set(0.045, 0.038, 1);
        sprite.visible = false;
        stageGroup.add(sprite);
        return sprite;
      });

      const sparkleTexture = new THREE.TextureLoader().load("/ar/ui/shipping-sparkle.png");
      sparkleTexture.colorSpace = THREE.SRGBColorSpace;
      const sparkleDefs = [
        [-0.08, contentY + 0.08, 0.02, 0.025],
        [0.07, contentY + 0.12, 0.01, 0.018],
        [-0.04, contentY + 0.2, -0.01, 0.021],
        [0.1, contentY + 0.23, 0.02, 0.015],
        [0, contentY + 0.29, 0, 0.022],
        [-0.12, contentY + 0.16, -0.02, 0.016],
      ] as const;
      const sparkles = sparkleDefs.map(([x, y, z, size], i) => {
        const material = new THREE.SpriteMaterial({
          map: sparkleTexture,
          color: 0xfff1d1,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
          rotation: i % 2 ? Math.PI / 4 : 0,
        });
        const sprite = new THREE.Sprite(material);
        sprite.position.set(x, y, z);
        sprite.scale.set(size, size, 1);
        sprite.userData.baseSize = size;
        sprite.visible = false;
        stageGroup.add(sprite);
        return sprite;
      });

      type ShipPhase = "hidden" | "revealing" | "complete";
      let shipPhase: ShipPhase = "hidden";
      const cameraInStage = new THREE.Vector3();

      const SHIP_AT = PRESS_STEPS.length - 1; // '출고' 인덱스
      finishShowShip = () => {
        const shipped = S.press >= SHIP_AT;
        const processId = PRESS_STEPS[Math.min(S.press, SHIP_AT)]?.id;
        finishProcessModels.forEach(({ def, group }) => {
          // 저온숙성 항아리는 agingJar 하나만 사용한다. 동일 GLB의 정적
          // 복제본까지 켜면 시작부터 창고 안에도 항아리가 보인다.
          group.visible = def.id !== "closed_jar" && !shipped && Boolean(processId && def.processSteps?.includes(processId));
        });

        const inAging = S.press === agingIndex;
        const inPress = S.press === pressIndex;
        if (!inPress) {
          pressDragging = false;
          pressLastHandY = null;
          pressStream.visible = false;
        }
        if (inAging && agingPhase === "idle") resetAgingInteraction();
        if (!inAging) {
          agingPhase = "idle";
          agingJar.visible = false;
          coldTarget.visible = false;
          guide.visible = false;
          coldGlow.intensity = 0;
        }

        if (shipModel) {
          // 출고 단계 진입
          if (shipped && !shipModel.visible) {
            shipModel.visible = true;
            shipPhase = "revealing";

            // 등장 애니메이션 시작
            shipRevealT = 0;
            shipHapticSent = false;
            shipUiDoneSent = false;
            setShipSequence("settling");

            // 0.4초 뒤, 조금 작고 위쪽에서 나타난다.
            shipModel.scale.setScalar(0.86);
            shipModel.position.y = shipRestY + 0.045;
            shipMaterials.forEach((material) => {
              material.opacity = 0;
            });
            glowRings.forEach((ring) => { ring.visible = true; });
            paws.forEach((paw) => { paw.visible = false; });

            // 빛도 처음에는 꺼져 있음
            shipGlow.intensity = 0;
          }

          // 출고 전
          if (!shipped) {
            shipModel.visible = false;
            shipPhase = "hidden";
            setShipSequence();

            shipModel.scale.setScalar(1);
            shipModel.position.y = shipRestY;

            shipGlow.intensity = 0;
            hideGlowRings();
            sparkles.forEach((sparkle) => {
              sparkle.visible = false;
              (sparkle.material as THREE.SpriteMaterial).opacity = 0;
            });
            paws.forEach((paw) => { paw.visible = false; });
          }
        }

        // 출고 전에는 공정별 GLB만, 출고에는 실제 병(없으면 임시 병)만 보인다.
        bottle.visible = !shipModel && shipped;
      };
      finishShowShip();
     
      /*
      const sparks = makeParticles(90, {
        color: 0xffe9b8, size: 0.011, opacity: 0.75, speed: 0.2,
        radius: 0.22, baseY: contentY + 0.05, height: 0.45, taper: -0.3,
      });
      stageGroup.add(sparks);
      live.particles.push(sparks);
      */
      
      live.tick = (_t, dt) => {
        if (S.press === pressIndex && pressSurface && pressEntry?.group.visible) {
          pressFill += (pressFillTarget - pressFill) * Math.min(1, dt * 7.5);
          pressSurface.position.y = THREE.MathUtils.lerp(pressSurfaceEmptyY, pressSurfaceFullY, pressFill);
          if (pressStream.visible) {
            const material = pressStream.material as THREE.MeshPhysicalMaterial;
            material.opacity = Math.max(0, material.opacity - dt * 1.7);
            pressStream.scale.x = pressStream.scale.z = 0.82 + Math.sin(_t * 18) * 0.12;
            if (material.opacity <= 0.02) pressStream.visible = false;
          }
        }
        if (chamberEntry?.group.visible) {
          const viewCamera = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
          viewCamera.getWorldPosition(chamberCameraInStage);
          stageGroup.worldToLocal(chamberCameraInStage);

          const dx = chamberCameraInStage.x - chamberEntry.group.position.x;
          const dz = chamberCameraInStage.z - chamberEntry.group.position.z;
          // Ry(yaw)로 변환된 로컬 -X가 (dx, dz)를 향하도록 한다.
          chamberEntry.group.rotation.y = Math.atan2(dz, -dx);
        }

        if (S.press === agingIndex && agingPhase !== "idle") {
          const pulse = 0.62 + Math.sin(_t * 3.2) * 0.18;
          (coldTarget.material as THREE.MeshBasicMaterial).opacity = pulse;
          (guide.material as THREE.LineDashedMaterial).dashOffset = -_t * 0.055;
          (guide.material as THREE.LineDashedMaterial).opacity = agingPhase === "holding" ? 0.92 : 0.62;
          coldTarget.scale.setScalar(1 + Math.sin(_t * 3.2) * 0.07);

          if (agingPhase === "ready") {
            agingJar.position.lerp(jarHome, 0.1);
          } else if (agingPhase === "snapping") {
            agingT += dt;
            agingJar.position.lerp(jarTarget, Math.min(1, dt * 8.5));
            agingJar.scale.lerp(new THREE.Vector3(0.94, 0.94, 0.94), Math.min(1, dt * 7));
            coldGlow.intensity += (1.35 - coldGlow.intensity) * Math.min(1, dt * 8);
            if (agingJar.position.distanceTo(jarTarget) < 0.008 || agingT > 0.75) {
              agingJar.position.copy(jarTarget);
              agingJar.scale.setScalar(0.94);
              agingPhase = "aging";
              agingT = 0;
              setAgingCopy("낮은 온도에서 천천히 숙성합니다", "1개월의 시간이 빠르게 흐르고 있어요");
            }
          } else if (agingPhase === "aging") {
            agingT += dt;
            const progress = THREE.MathUtils.clamp(agingT / 3.2, 0, 1);
            coldGlow.intensity = 0.88 + Math.sin(_t * 2.6) * 0.16;
            agingJar.position.y = jarTarget.y + Math.sin(_t * 1.8) * 0.002;
            const cap = $("#cap-finishing");
            if (cap) cap.textContent = progress < 0.92
              ? `저온숙성 중 · ${Math.max(1, Math.round(progress * 30))}일차`
              : "맛과 향이 천천히 안정되고 있어요";
            if (progress >= 1 && !agingCompleted) {
              agingCompleted = true;
              agingPhase = "complete";
              coldGlow.intensity = 1.5;
              setAgingCopy("1개월 후 · 저온숙성이 완료되었습니다", "부드러운 향과 균형 잡힌 맛이 완성됐어요");
              if (!agingHapticSent) {
                agingHapticSent = true;
                navigator.vibrate?.([32, 45, 42]);
              }
              window.setTimeout(() => {
                if (S.press !== agingIndex) return;
                S.press = Math.min(S.press + 1, PRESS_STEPS.length - 1);
                syncPress();
              }, 1100);
            }
          }
        }

        if (!shipModel || shipPhase === "hidden") return;

        const viewCamera = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
        viewCamera.getWorldPosition(cameraInStage);
        stageGroup.worldToLocal(cameraInStage);
        // GLB의 정면(+Z), 즉 '냥이탁주 9' 라벨이 항상 사용자 시선을 향한다.
        shipModel.rotation.y = Math.atan2(
          cameraInStage.x - shipModel.position.x,
          cameraInStage.z - shipModel.position.z
        );

        if (shipPhase === "revealing") {
          shipRevealT += dt;
          const t = shipRevealT;

          // 아주 짧게 한 프레임 이상 안정화한 뒤 곧바로 병을 보여준다.
          if (t < SHIP_SETTLE_END) {
            setShipSequence("settling");
            shipModel.scale.setScalar(0.86);
            shipModel.position.y = shipRestY + 0.045;
            shipMaterials.forEach((material) => { material.opacity = 0; });
          } else {
            // scale 0.86→1, opacity 0→1로 빠르게 나타나 가볍게 착지한다.
            const reveal = THREE.MathUtils.clamp(
              (t - SHIP_SETTLE_END) / (SHIP_REVEAL_END - SHIP_SETTLE_END),
              0,
              1,
            );
            const eased = 1 - Math.pow(1 - reveal, 3);
            setShipSequence(
              t < SHIP_REVEAL_END ? "reveal"
                : t < SHIP_CELEBRATE_END ? "celebrate"
                  : t < SHIP_RESULT_END ? "result"
                    : "ready",
            );
            shipModel.scale.setScalar(THREE.MathUtils.lerp(0.86, 1, eased));
            shipModel.position.y = THREE.MathUtils.lerp(shipRestY + 0.045, shipRestY, eased);
            shipMaterials.forEach((material) => { material.opacity = eased; });
          }

          // 짧은 착지 bounce. 햅틱은 정확히 한 번만 울린다.
          if (t >= SHIP_REVEAL_END && t < SHIP_BOUNCE_END) {
            const bounceT = (t - SHIP_REVEAL_END) / (SHIP_BOUNCE_END - SHIP_REVEAL_END);
            shipModel.scale.setScalar(1 + Math.sin(bounceT * Math.PI) * 0.055 * (1 - bounceT * 0.35));
            if (!shipHapticSent) {
              shipHapticSent = true;
              navigator.vibrate?.(32);
            }
          }

          // 병 등장과 겹쳐 warm glow, 발바닥, sparkle을 시작한다.
          const fx = THREE.MathUtils.clamp((t - 0.82) / 0.68, 0, 1);
          if (fx > 0) {
            glowRings.forEach((ring) => { ring.visible = true; });
            sparkles.forEach((sparkle) => { sparkle.visible = true; });
            paws.forEach((paw) => { paw.visible = true; });
            updateGlowWaves(fx, true);
            shipGlow.intensity = Math.sin(fx * Math.PI) * 0.72;
            sparkles.forEach((sparkle, i) => {
              const material = sparkle.material as THREE.SpriteMaterial;
              const localFx = THREE.MathUtils.clamp((fx - i * 0.07) / 0.58, 0, 1);
              material.opacity = Math.sin(localFx * Math.PI) * 0.92;
              const size = sparkle.userData.baseSize as number;
              const animatedSize = size * (0.72 + localFx * 0.58);
              sparkle.scale.set(animatedSize, animatedSize, 1);
            });
            paws.forEach((paw, i) => {
              const material = paw.material as THREE.SpriteMaterial;
              material.opacity = THREE.MathUtils.clamp((fx - i * 0.16) * 2.2, 0, 0.82);
            });
          }

          // 최초 축하 파동이 끝난 뒤에도 결과 UI가 뜰 때까지 잔광을 끊지 않는다.
          if (t >= 1.5) {
            shipGlow.intensity = 0.18 + Math.max(0, Math.sin(t * 1.45)) * 0.08;
            updateGlowWaves(t, false);
            sparkles.forEach((sparkle, i) => {
              sparkle.visible = true;
              const material = sparkle.material as THREE.SpriteMaterial;
              material.opacity = 0.24 + Math.max(0, Math.sin(t * 2.5 + i * 1.7)) * 0.34;
            });
            paws.forEach((paw) => {
              paw.visible = true;
              (paw.material as THREE.SpriteMaterial).opacity = 0.82;
            });
          }

          // 약 2.2초에 결과 카드 조작을 허용한다. 상태 갱신은 한 번만 수행한다.
          if (t >= SHIP_READY_AT && !shipUiDoneSent) {
            shipUiDoneSent = true;
            shipModel.scale.setScalar(1);
            shipModel.position.y = shipRestY;
            shipMaterials.forEach((material) => { material.opacity = 1; });
            shipGlow.intensity = 0.16;
            shipPhase = "complete";
            S.press = PRESS_STEPS.length;
            syncPress();
          }
        } else if (shipPhase === "complete") {
          shipModel.scale.setScalar(1);
          sparkles.forEach((sparkle, i) => {
            const material = sparkle.material as THREE.SpriteMaterial;
            sparkle.visible = true;
            const twinkle = 0.26 + Math.max(0, Math.sin(_t * 2.4 + i * 1.7)) * 0.38;
            material.opacity += (twinkle - material.opacity) * 0.08;
            const baseSize = sparkle.userData.baseSize as number;
            const pulseSize = baseSize * (1.05 + Math.max(0, Math.sin(_t * 2.4 + i * 1.7)) * 0.28);
            sparkle.scale.set(pulseSize, pulseSize, 1);
          });
          paws.forEach((paw, i) => {
            paw.visible = true;
            const material = paw.material as THREE.SpriteMaterial;
            material.opacity += (0.82 - material.opacity) * 0.05;
            paw.position.y += Math.sin(_t * 1.8 + i) * 0.00008;
          });
          shipGlow.intensity = 0.16 + Math.max(0, Math.sin(_t * 1.35)) * 0.1;
          updateGlowWaves(_t, false);
        }
      };
    }

    function buildStageFor(step: typeof S.step) {
      clearStage();
      if (!S.placed) return;
      if (step === "ingredient") buildIngredients();
      else if (step === "godubap") buildGodubap();
      else if (step === "ferment") buildFerment();
      else if (step === "done") buildFinish();
      // 환경 occlusion은 three r185의 WebXRDepthSensing pass가 renderer.render()
      // 앞에서 자동으로 depth buffer에 기록한다. material별 shader patch는 필요 없다.
    }

    /* =====================================================================
     * 3. WebXR
     * ===================================================================*/
    let xrSession: XRSession | null = null;
    let hitTestSource: XRHitTestSource | null = null;
    let localSpace: XRReferenceSpace | null = null;
    type XRAnchorLike = { anchorSpace: XRSpace; delete?: () => void };
    type AnchorHitResult = XRHitTestResult & { createAnchor?: () => Promise<XRAnchorLike> };
    let latestHitResult: AnchorHitResult | null = null;
    let xrWorldAnchor: XRAnchorLike | null = null;
    const anchorTargetPosition = new THREE.Vector3();
    
    let arSupported = false;
    let surfaceReady = false;



    /* =========================================================
     * WebXR Real Depth 테스트 (별)
     * ======================================================= */

    type XRDepthInfoLike = {
      width: number;
      height: number;

      getDepthInMeters?: (
        x: number,
        y: number
      ) => number;
    };

    let depthSupported = false;
    let depthLogged = false;

    /**
     * 마지막으로 확인된 화면 중앙 실제 거리.
     * 디버그용.
     */
    let lastRealDepth = 0;

    // 이번 XR frame에서 얻은 실제 환경 depth 정보 (별)
    let currentDepthInfo: XRDepthInfoLike | null = null;


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
          
          optionalFeatures: ["dom-overlay", "camera-access", "depth-sensing", "anchors"], //(별)
          depthSensing: {
            // three r185는 XRWebGLBinding의 GPU depth texture를 렌더 패스에
            // 직접 합성한다. CPU fallback은 그 내장 경로에서 처리되지 않는다.
            usagePreference: ["gpu-optimized"],
            dataFormatPreference: ["float32", "luminance-alpha"]
          },
          
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
      
      //(별)
      const sessionAny =
        xrSession as any;

      depthSupported =
        sessionAny.enabledFeatures?.includes(
          "depth-sensing"
        ) === true;

      console.log(
        "[AR DEPTH] 지원 여부:",
        depthSupported
      );

      setDepthDebugText(
        depthSupported
          ? "DEPTH: supported ✓"
          : "DEPTH: unsupported ✕"
      );

      if (depthSupported) {
        console.log(
          "[AR DEPTH] usage:",
          sessionAny.depthUsage
        );

        console.log(
          "[AR DEPTH] format:",
          sessionAny.depthDataFormat
        );

        console.log(
          "[AR DEPTH] type:",
          sessionAny.depthType
        );

        setDepthDebugText(
          `DEPTH: supported ✓
      TYPE: ${sessionAny.depthType ?? "unknown"}`
        );
      }
      //(별)까지 추가


      controls.enabled = false;
      floor.visible = false;

      renderer.xr.setReferenceSpaceType("local");
      await renderer.xr.setSession(xrSession as any);
      // render loop에서 정확히 한 번 갱신한다. 여러 render pass가 서로 다른
      // XR pose를 쓰며 모델이 미끄러져 보이는 현상을 차단한다.
      renderer.xr.cameraAutoUpdate = false;
      const viewerSpace = await xrSession!.requestReferenceSpace("viewer");
      localSpace = await xrSession!.requestReferenceSpace("local");
      hitTestSource = await (xrSession as any).requestHitTestSource({ space: viewerSpace });

      // 기기가 camera-access 를 내줬다면 실제 AR 안에서 손까지 쓸 수 있다.
      // (안 내주면 평면 인식만 되는 기존 AR 그대로 — 손은 아래 카메라 모드로 따로 쓴다)
      if (xrSession!.enabledFeatures?.includes("camera-access")) {
        void startHandsInAr();
      }

      xrSession!.addEventListener("end", () => {
        S.xr = false;
        S.hand = false;
        uiRoot!.classList.remove("hands-on");
        handTracker?.dispose();
        handTracker = null;
        xrSession = null;
        renderer.xr.cameraAutoUpdate = true;
        hitTestSource = null;
        latestHitResult = null;
        xrWorldAnchor?.delete?.();
        xrWorldAnchor = null;
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
    handVisual.attachTo();
    // 영상이 화면에 cover 로 잘리는 것을 보정하는 값 — 매 프레임 화면 크기로 다시 잰다
    let handFit: CoverFit = { scaleX: 1, scaleY: 1, offX: 0, offY: 0 };
    // AR 모드에서 XR 카메라 이미지를 내려받는 도구 (camera-access 를 받았을 때만 만든다)
    let xrFeed: XrCameraFeed | null = null;
    let lastDetectAt = 0;
    /**
     * AR 모드 손 검출 간격(ms). 카메라 이미지를 GPU 에서 내려받는 비용이 있어
     * 매 프레임 하면 3D 가 눈에 띄게 느려진다. 이 정도면 집는 조작에 충분하다.
     */
    // 120ms + segmentation EMA caused the screen-space mask to visibly trail the
    // live camera. The model is only ~0.6MB, so keep the capture cadence near 14Hz.
    const AR_DETECT_MS = 72;

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
      handTracker.setPaused(S.step !== "ingredient");
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
            latestHitResult = results[0] as AnchorHitResult;
            const pose = latestHitResult.getPose(localSpace);
            if (pose) {
              reticle.matrix.fromArray(pose.transform.matrix);
              found = true;
            }
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

      // 지원 기기에서는 배치 순간 만든 WebXR Anchor의 보정 pose를 따라간다.
      // ARCore의 작은 추적 노이즈가 그대로 보이지 않도록 위치만 부드럽게 반영하고,
      // 양조장은 항상 수직을 유지하기 위해 기기별 anchor 회전은 적용하지 않는다.
      if (frame && xrWorldAnchor && localSpace && S.placed) {
        const anchorPose = frame.getPose(xrWorldAnchor.anchorSpace, localSpace);
        if (anchorPose) {
          const p = anchorPose.transform.position;
          anchorTargetPosition.set(p.x, p.y, p.z);
          anchor.position.lerp(anchorTargetPosition, 0.32);
        }
      }

      if (S.step === "ferment" && S.fstage >= FERMENT_STEPS.length - 1 && S.ferment < 100) {
        const dist = Math.abs(S.temp - OPTIMAL_C);
        // 25℃에서 약 17초에 완주. 너무 빨리 끝나면 온도를 조절해 본 효과를 느끼기 어렵다.
        const rate = THREE.MathUtils.clamp(1 - dist / 9, 0.12, 1) * 6;
        S.ferment = Math.min(100, S.ferment + rate * dt);
        S.tempLog.push(S.temp);
        onFermentTick();
      }


      /* =========================================================
      * REAL WORLD DEPTH PROBE
      * 화면 중앙 픽셀의 실제 환경 거리를 확인한다. (별)
      * =======================================================

      if (
        depthSupported &&
        frame &&
        localSpace
      ) {
        const xrFrame = frame as any;

        const pose =
          xrFrame.getViewerPose?.(
            localSpace
          );

        const view =
          pose?.views?.[0];

        if (
          view &&
          typeof xrFrame.getDepthInformation ===
            "function"
        ) {
          try {
            const depthInfo =
              xrFrame.getDepthInformation(
                view
              ) as XRDepthInfoLike | null;

            currentDepthInfo = depthInfo;
            
            if (
              depthInfo &&
              typeof depthInfo.getDepthInMeters ===
                "function"
            ) {
              const meters =
                depthInfo.getDepthInMeters(
                  0.5,
                  0.5
                );

              if (
                Number.isFinite(meters) &&
                meters > 0
              ) {
                lastRealDepth = meters;

                setDepthDebugText(
                  `DEPTH: supported ✓\nCENTER: ${meters.toFixed(3)} m`
                );

                if (!depthLogged) {
                  depthLogged = true;

                  console.log(
                    "[AR DEPTH] REAL DEPTH OK",
                    {
                      meters,
                      width: depthInfo.width,
                      height: depthInfo.height,
                    }
                  );
                }
              }
            }
          } catch (e) {
            if (!depthLogged) {
              console.warn(
                "[AR DEPTH] depth read failed",
                e
              );
            }
          }
        }
      }*/




      // renderer.render()가 내부에서 사용하는 실제 XR 카메라를 먼저 갱신한다.
      // 앱의 기본 PerspectiveCamera로 screenToWorld를 하면 기기 pose/projection이
      // 빠져 손 마스크가 보이는 손과 어긋난다.
      let handCamera: THREE.Camera = camera;
      if (S.xr && renderer.xr.isPresenting) {
        renderer.xr.updateCamera(camera);
        handCamera = renderer.xr.getCamera().cameras[0] ?? camera;
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
              if (shot) {
                handTracker.detect(shot, now);
              }
            }
          }
          handFit = coverFit(xrCam.width, xrCam.height, canvas!.clientWidth, canvas!.clientHeight);
        }

        const f = handTracker.latest;


        /* ★ 실제 손 위치의 real-world depth 측정 (별)
        if (
          f.present &&
          currentDepthInfo?.getDepthInMeters
        ) {
          const px = THREE.MathUtils.clamp(
            f.pinchPoint.x,
            0,
            1
          );

          const py = THREE.MathUtils.clamp(
            f.pinchPoint.y,
            0,
            1
          );

          //(별)
          const offsets = [
            [0, 0],

            [-0.04, 0],
            [0.04, 0],

            [0, -0.04],
            [0, 0.04],

            [-0.04, -0.04],
            [0.04, -0.04],

            [-0.04, 0.04],
            [0.04, 0.04],
          ];

          const samples: number[] = [];

          for (const [ox, oy] of offsets) {
            const sx = THREE.MathUtils.clamp(
              px + ox,
              0,
              1
            );

            const sy = THREE.MathUtils.clamp(
              py + oy,
              0,
              1
            );

            const d =
              currentDepthInfo.getDepthInMeters(
                sx,
                sy
              );

            if (
              Number.isFinite(d) &&
              d > 0
            ) {
              samples.push(d);
            }
          }

          // 가까운 값부터 정렬
          samples.sort((a, b) => a - b);

          if (samples.length > 0) {
            // 전체 샘플 중 가까운 쪽 25%만 사용
            const nearCount = Math.max(
              1,
              Math.floor(samples.length * 0.25)
            );

            const nearSamples =
              samples.slice(0, nearCount);

            // 가까운 값들 중 중앙값 사용
            const mid =
              Math.floor(nearSamples.length / 2);

            const handDepth =
              nearSamples[mid];

            console.log(
              "[AR DEPTH] HAND:",
              handDepth.toFixed(3),
              "m"
            );

            setDepthDebugText(
              `DEPTH: supported ✓
          CENTER: ${lastRealDepth.toFixed(3)} m
          HAND: ${handDepth.toFixed(3)} m
          SAMPLES: ${samples.length}`
            );
          }
        }*/



        // 무대까지의 거리 — 오클루더를 그 앞에 놓고, 집어 든 물건 거리의 기준으로도 쓴다
        const stageAt = handCamera.getWorldPosition(handOrigin).distanceTo(anchor.position);
        handVisual.update(f, handCamera, handFit, Math.max(stageAt, 0.2));
        // 손이 사라진 프레임도 그대로 넘긴다 — 잡고 있던 물건을 놓아야 하기 때문
        live.onHand?.(f, handVisual, handCamera);
        handTracker.consumeEdges();
      } else if (!S.hand) {
        handVisual.hide();
      }

      live.mixers.forEach((m) => m.update(dt));
      if (live.tick) live.tick(t, dt);
      live.particles.forEach((p) => updateParticles(p, dt));
      if (!S.xr) controls.update();

      // 손 depth occluder, AR 콘텐츠, 커서를 같은 XR camera pose로 한 번만 그린다.
      // 렌더 순서는 HandVisual의 renderOrder(-1000 / 1000)가 정한다.
      renderer.clear();
      renderer.render(scene, camera);
      handVisual.renderOverlay(renderer, camera);
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

    /**
     * 선택한 배치 크기를 공용 앵커에 반영한다.
     *
     * 기존 책상 배율 0.55는 모든 공정 모델을 한꺼번에 절반 크기로 줄여,
     * AR 시작 직후 모델이 축소된 것처럼 보였다. 책상 위에서도 실제 물체와
     * 비교 가능한 크기를 유지하도록 0.82까지만 줄인다.
     */
    function applySurfaceScale() {
      const placementScale = S.surface === "table" ? 0.82 : 1;
      anchor.scale.setScalar(placementScale);
      anchor.updateMatrixWorld(true);
    }
    // 이전 단계나 빠른 디버그 진입에서 남은 앵커 배율 없이 항상 현재 선택값으로 시작한다.
    applySurfaceScale();

    $$(".seg button").forEach((btn) => {
      (btn as HTMLElement).onclick = () => {
        $$(".seg button").forEach((b) => b.setAttribute("aria-pressed", "false"));
        btn.setAttribute("aria-pressed", "true");
        S.surface = (btn as HTMLElement).dataset.surface as typeof S.surface;
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
        if (S.xr && latestHitResult?.createAnchor) {
          void latestHitResult.createAnchor().then((created) => {
            xrWorldAnchor?.delete?.();
            xrWorldAnchor = created;
          }).catch(() => {
            // anchors 미지원 또는 생성 실패 시 최초 hit-test 위치 고정을 그대로 쓴다.
          });
        }
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
      const { needed, extras } = getIngredientSelectionState(
        INGREDIENTS,
        S.selected,
      );
      const b = $("#btn-ingredient") as HTMLButtonElement | null;
      if (!b) return;
      b.disabled = !isIngredientSelectionComplete(needed.length,);
      b.textContent = getIngredientButtonText(
        ESS_N,
        needed.length,
        extras.length,
      );
      // 부팅·초기화 때는 인트로 안내문을 유지하고, 사용자가 재료를 만졌을 때만 멘트를 바꾼다.
      if (!interacted) return;
      coach("#msg-ingredient", 
        getIngredientCoachText(
          justAdded,
          needed,
          extras.length,
          ESS_NAMES,
          recipe.ingredientsReady,
        ),
      );
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
            // 질문에 답하기 전이면 다시 띄워 주고, 답했으면 부채질이 남았다
            if (!S.quizDone) $("#quiz")?.classList.remove("hidden");
            return;
          }
          S.godubap = i + 1;
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

      if (rinseActive(S.hand, S.godubap, S.rinseTurns, REQUIRED_RINSE_TURNS)) {
        const prog = (S.rinseTurns + S.rinsePartial) / REQUIRED_RINSE_TURNS;
        pct = Math.round(Math.min(1, prog) * 100);
        text =
          S.rinseTurns === 0
            ? "그릇 안에서 손을 둥글게 돌려 쌀을 헹구세요"
            : `헹구는 중 · ${S.rinseTurns}/${REQUIRED_RINSE_TURNS}바퀴`;
      } else if (soakActive(S.hand, S.godubap)) {
        const soaked = S.soakAt ? performance.now() - S.soakAt : 0;
        pct = Math.round(Math.min(1, soaked / SOAK_MS) * 100);
        done = pct >= 100;
        text = done ? "쌀이 다 불었어요" : "물에 담근 채로 잠시 기다려요";
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
        hint.textContent =
          S.godubap >= GB_N
            ? "고두밥이 완성됐어요. 아래 버튼으로 이어가세요."
            : S.godubap === GB_LAST
              ? !S.quizDone
                ? "장인의 질문에 먼저 답해주세요"
                : "손을 좌우로 흔들어 고두밥을 식혀주세요"
              : rinseActive(S.hand, S.godubap, S.rinseTurns, REQUIRED_RINSE_TURNS)
                ? "손을 둥글게 돌려 쌀을 헹궈주세요"
                : soakActive(S.hand, S.godubap)
                  ? "쌀이 물을 머금는 동안 잠시 기다려요"
                  : "";
      }
      const cur = GODUBAP_STEPS[Math.min(S.godubap, GB_LAST)];
      const cap = $("#cap-godubap");
      if (cap)
        cap.textContent =
          S.godubap >= GB_N
            ? "고두밥 완성 · 채반에서 차게 식었어요"
            : S.godubap === GB_LAST && S.quizDone
              ? "아직 뜨거워요 · 손으로 부쳐 식혀 주세요"
              : cur.caption;
      // 냉각에 들어오면 장인이 먼저 묻는다
      if (S.godubap === GB_LAST && !S.quizDone) $("#quiz")?.classList.remove("hidden");
      syncGodubapGame();
      const b = $("#btn-godubap") as HTMLButtonElement | null;
      if (b) {
        // 아직 이를 때도 눌리게 두고, 대신 눌렀을 때 무엇을 해야 하는지 알려준다
        const ready = S.godubap >= GB_N;
        b.classList.toggle("waiting", !ready);
        b.textContent = ready
          ? "누룩 섞고 항아리에 담기"
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
              // 답을 했으니 이제 식힐 차례다. 손을 못 쓰는 기기에서는 바로 완성으로 넘긴다.
              if (!S.hand) S.godubap = GB_N;
              syncGodubap();
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
      (btnCloseNotice as HTMLElement).onclick = () => {
        $("#notice")?.classList.remove("open");
        // 촬영 완료 알림의 확인 버튼은 알림뿐 아니라 촬영 모드도 닫는다.
        uiRoot.classList.remove("ship-capture");
      };

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
          if (i !== S.fstage) return;   // 지금 켜진 단계만 누를 수 있다
          if (i >= F_LAST) return;       // 후발효는 클릭이 아니라 발효로 완료된다
          S.fstage = i + 1;
          syncFermentPhase();
        };
        fpills.appendChild(b);
      });
    }
    // 후발효(fstage 3)에서만 온도 게임·항아리 자동 발효가 돈다. 그 전엔 탭으로만 진행.
    function syncFermentPhase() {
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
          if (i === PRESS_STEPS.length - 1) {
            return;
          }
          if (PRESS_STEPS[i]?.id === "aging") {
            // TEMP DEBUG: 저온숙성 타임라인을 누르면 실제 항아리 배치
            // 인터랙션을 기다리지 않고 곧바로 출고 단계로 진행한다.
            S.press = i + 1;
            syncPress();
            return;
          }
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
      const shipping = S.press === PRESS_STEPS.length - 1;
      const cur = PRESS_STEPS[Math.min(S.press, PRESS_STEPS.length - 1)];
      // 완성 공정 중 손이 필요한 것은 저온숙성뿐이다. 해당 단계에서만
      // MediaPipe를 깨우고, 출고 연출에서는 다시 멈춰 렌더링 여유를 확보한다.
      handTracker?.setPaused(cur?.id !== "aging" && cur?.id !== "press");
      const cap = $("#cap-finishing");
      if (cap) {
        cap.textContent = done
          ? "양조가 완료되었습니다!"
          : shipping
            ? "냥이탁주 라벨이 정면을 향하며 완성 병이 나타나고 있어요"
            : cur.caption;
      }
      const hint = $("#finishing-hint");
      if (hint) {
        hint.textContent = done
          ? "🐾 냥이탁주가 세상에 나갈 준비를 마쳤어요"
          : shipping
            ? ""
            : "";
      }
      const b = $("#btn-finishing") as HTMLButtonElement | null;
      if (b) {
        b.classList.toggle("waiting", !done);
        b.classList.toggle("shipping", shipping || done);
        b.textContent = done
          ? "🐾 나의 술 확인하기"
          : shipping
            ? "완성 병 등장 중…"
            : "공정을 순서대로 진행하세요";
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

    const btnShipAgain = $("#btn-ship-again");
    if (btnShipAgain) {
      (btnShipAgain as HTMLButtonElement).onclick = () => {
        S.press = PRESS_STEPS.length - 1;
        delete uiRoot.dataset.shipSequence;
        uiRoot.classList.remove("ship-capture");
        buildStageFor("done");
        syncPress();
      };
    }

    const btnShipInfo = $("#btn-ship-info");
    if (btnShipInfo) {
      (btnShipInfo as HTMLButtonElement).onclick = async () => {
        const button = btnShipInfo as HTMLButtonElement;
        if (button.disabled) return;

        button.disabled = true;
        button.setAttribute("aria-busy", "true");
        button.textContent = "정보 화면 여는 중…";
        markObtained(recipe.drinkId);

        // immersive-ar가 살아 있는 채로 다음 페이지를 동시에 로드하면
        // Android Chrome에서 카메라·WebGL·GLB 메모리가 겹쳐 탭이 종료될 수 있다.
        // 라우팅 전에 XR과 GPU 컨텍스트를 끝낸다. Android Chrome은 XR 종료
        // 직후 내부 라우팅을 실행하면 AR 화면 복원 과정에서 이동을 되돌릴 수
        // 있으므로, 브라우저가 일반 탭으로 돌아온 다음 상세 URL로 확정 이동한다.
        renderer.setAnimationLoop(null);
        if (xrSession) {
          const session = xrSession;
          try {
            await session.end();
          } catch (error) {
            console.warn("AR 세션 종료 실패:", error);
          }
        }

        renderer.dispose();
        renderer.forceContextLoss();

        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => {
            window.setTimeout(resolve, 140);
          }));
        });

        window.location.replace(`/drink/${encodeURIComponent(recipe.drinkId)}`);
      };
    }

    const closeShipCapture = () => uiRoot.classList.remove("ship-capture");
    const btnShipCapture = $("#btn-ship-capture");
    if (btnShipCapture) (btnShipCapture as HTMLButtonElement).onclick = () => {
      uiRoot.classList.remove("capture-sticker-off");
      const stickerToggle = $("#btn-capture-sticker");
      stickerToggle?.setAttribute("aria-pressed", "true");
      uiRoot.classList.add("ship-capture");
    };
    const btnCaptureCancel = $("#btn-capture-cancel");
    if (btnCaptureCancel) (btnCaptureCancel as HTMLButtonElement).onclick = closeShipCapture;

    const btnCaptureSticker = $("#btn-capture-sticker");
    if (btnCaptureSticker) {
      (btnCaptureSticker as HTMLButtonElement).onclick = () => {
        const next = btnCaptureSticker.getAttribute("aria-pressed") !== "true";
        btnCaptureSticker.setAttribute("aria-pressed", String(next));
        uiRoot.classList.toggle("capture-sticker-off", !next);
      };
    }

    const btnCaptureShot = $("#btn-capture-shot");
    if (btnCaptureShot) {
      (btnCaptureShot as HTMLButtonElement).onclick = async () => {
        const shutter = btnCaptureShot as HTMLButtonElement;
        shutter.classList.remove("is-capturing");
        void shutter.offsetWidth;
        shutter.classList.add("is-capturing");
        navigator.vibrate?.(28);

        // 픽셀 읽기와 PNG 합성은 메인 스레드를 잠시 점유한다. 먼저 셔터의
        // 눌림 상태를 실제 화면에 그린 뒤 캡처를 시작해야 터치가 즉시 보인다.
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => {
            window.setTimeout(resolve, 120);
          }));
        });
        shutter.classList.remove("is-capturing");
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        showNotice("촬영했어요. 이미지를 저장하고 있어요…");

        const frameElement = $(".capture-frame") as HTMLElement | null;
        const frameRect = frameElement?.getBoundingClientRect();
        const viewRect = canvas.getBoundingClientRect();
        const scale = Math.min(1.5, window.devicePixelRatio || 1);
        const cropX = Math.max(0, (frameRect?.left ?? viewRect.left) - viewRect.left);
        const cropY = Math.max(0, (frameRect?.top ?? viewRect.top) - viewRect.top);
        const cropW = Math.min(viewRect.width - cropX, frameRect?.width ?? viewRect.width);
        const cropH = Math.min(viewRect.height - cropY, frameRect?.height ?? viewRect.height);
        const output = document.createElement("canvas");
        output.width = Math.max(1, Math.round(cropW * scale));
        output.height = Math.max(1, Math.round(cropH * scale));
        const ctx = output.getContext("2d");

        if (!ctx) {
          showNotice("촬영 이미지를 만들지 못했어요. 잠시 후 다시 시도해 주세요.");
          return;
        }

        const drawCover = (source: CanvasImageSource, sourceW: number, sourceH: number) => {
          const sourceRatio = sourceW / sourceH;
          const viewRatio = viewRect.width / viewRect.height;
          let sx = 0, sy = 0, sw = sourceW, sh = sourceH;
          if (sourceRatio > viewRatio) {
            sw = sourceH * viewRatio;
            sx = (sourceW - sw) / 2;
          } else {
            sh = sourceW / viewRatio;
            sy = (sourceH - sh) / 2;
          }
          ctx.drawImage(source, sx + cropX * sw / viewRect.width, sy + cropY * sh / viewRect.height,
            cropW * sw / viewRect.width, cropH * sh / viewRect.height, 0, 0, output.width, output.height);
        };

        const cameraFrame = xrFeed?.latestCanvas;
        if (cameraFrame) drawCover(cameraFrame, cameraFrame.width, cameraFrame.height);
        else {
          ctx.fillStyle = "#24170f";
          ctx.fillRect(0, 0, output.width, output.height);
        }

        // XR compositor 화면은 canvas.drawImage로 복사할 수 없다. 현재 XR
        // 카메라의 행렬을 일반 카메라에 복제해 가상 장면만 별도로 렌더한다.
        // 렌더 타깃은 화면 캔버스 전체 해상도 대신 최대 720px로 제한해 셔터
        // 뒤의 긴 GPU readback과 PNG 인코딩 지연을 줄인다.
        try {
          const targetWidth = Math.max(1, Math.min(720, Math.round(viewRect.width * scale)));
          const targetHeight = Math.max(1, Math.round(targetWidth * viewRect.height / viewRect.width));
          const target = new THREE.WebGLRenderTarget(targetWidth, targetHeight, {
            format: THREE.RGBAFormat,
            type: THREE.UnsignedByteType,
            depthBuffer: true,
          });
          target.texture.colorSpace = THREE.SRGBColorSpace;
          const pixels = new Uint8Array(targetWidth * targetHeight * 4);
          const virtualLayer = document.createElement("canvas");
          virtualLayer.width = targetWidth;
          virtualLayer.height = targetHeight;
          const virtualCtx = virtualLayer.getContext("2d");
          const previousTarget = renderer.getRenderTarget();
          const wasXrEnabled = renderer.xr.enabled;
          const previousClear = renderer.getClearColor(new THREE.Color()).clone();
          const previousAlpha = renderer.getClearAlpha();
          const xrCamera = renderer.xr.getCamera();
          const sourceCamera = xrCamera.cameras[0] ?? camera;
          const renderCamera = new THREE.PerspectiveCamera();
          renderCamera.matrixAutoUpdate = false;
          renderCamera.matrixWorld.copy(sourceCamera.matrixWorld);
          renderCamera.matrixWorldInverse.copy(sourceCamera.matrixWorldInverse);
          renderCamera.projectionMatrix.copy(sourceCamera.projectionMatrix);
          renderCamera.projectionMatrixInverse.copy(sourceCamera.projectionMatrixInverse);
          renderCamera.near = sourceCamera.near;
          renderCamera.far = sourceCamera.far;
          renderCamera.layers.mask = sourceCamera.layers.mask;

          type AsyncPixelReader = (
            renderTarget: THREE.WebGLRenderTarget,
            x: number,
            y: number,
            width: number,
            height: number,
            buffer: Uint8Array,
          ) => Promise<Uint8Array>;
          const asyncPixelReader = (renderer as THREE.WebGLRenderer & {
            readRenderTargetPixelsAsync?: AsyncPixelReader;
          }).readRenderTargetPixelsAsync;
          let pixelRead: Promise<Uint8Array> | null = null;

          try {
            renderer.xr.enabled = false;
            renderer.setRenderTarget(target);
            renderer.setClearColor(0x000000, 0);
            renderer.clear(true, true, true);
            renderer.render(scene, renderCamera);
            if (asyncPixelReader) {
              pixelRead = asyncPixelReader.call(
                renderer, target, 0, 0, targetWidth, targetHeight, pixels,
              );
            } else {
              renderer.readRenderTargetPixels(target, 0, 0, targetWidth, targetHeight, pixels);
            }
          } finally {
            renderer.setRenderTarget(previousTarget);
            renderer.setClearColor(previousClear, previousAlpha);
            renderer.xr.enabled = wasXrEnabled;
          }
          if (pixelRead) await pixelRead;

          if (virtualCtx) {
            const image = virtualCtx.createImageData(targetWidth, targetHeight);
            const rowSize = targetWidth * 4;
            // WebGL 원점은 왼쪽 아래이므로 Canvas 좌표계에 맞춰 수직 반전한다.
            for (let y = 0; y < targetHeight; y += 1) {
              const sourceStart = (targetHeight - 1 - y) * rowSize;
              image.data.set(pixels.subarray(sourceStart, sourceStart + rowSize), y * rowSize);
            }
            virtualCtx.putImageData(image, 0, 0);
            ctx.drawImage(virtualLayer,
              cropX * targetWidth / viewRect.width, cropY * targetHeight / viewRect.height,
              cropW * targetWidth / viewRect.width, cropH * targetHeight / viewRect.height,
              0, 0, output.width, output.height);
          }
          target.dispose();
        } catch (error) {
          console.warn("[AR capture] offscreen virtual layer unavailable", error);
        }

        if (!uiRoot.classList.contains("capture-sticker-off")) {
          const sticker = $(".capture-label-sticker") as HTMLImageElement | null;
          try {
            if (sticker && sticker.complete && sticker.naturalWidth > 0) {
            const w = output.width * .34;
            const h = w * sticker.naturalHeight / sticker.naturalWidth;
            ctx.save();
            ctx.translate(output.width * .76, output.height * .69);
            ctx.rotate(4 * Math.PI / 180);
            ctx.drawImage(sticker, -w / 2, -h / 2, w, h);
            ctx.restore();
            }
          } catch (error) {
            console.warn("[AR capture] sticker unavailable", error);
          }
        }

        output.toBlob((blob) => {
          if (!blob || blob.size < 1024) {
            showNotice("이미지 저장에 실패했어요. 잠시 후 다시 촬영해 주세요.");
            return;
          }
          const filename = `nyangi-brew-${Date.now()}.jpg`;
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = filename;
          link.style.display = "none";
          document.body.appendChild(link);
          link.click();
          window.setTimeout(() => {
            link.remove();
            URL.revokeObjectURL(url);
          }, 2500);
          showNotice("촬영한 이미지를 갤러리 또는 다운로드 폴더에 저장했어요.");
        }, "image/jpeg", .92);
      };
    }

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
        S.quizDone = false;
        S.temp = 27;
        S.ferment = 0;
        S.fstage = 0;
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

    /* =========================================================
     * TEMP DEBUG — 출고 직전 이동 버튼 연결
     * 나중에 삭제
     * ======================================================= */
  
    const debugSkipBtn = $("#debug-skip-before-ship");

    if (debugSkipBtn) {
      (debugSkipBtn as HTMLButtonElement).onclick =
        debugSkipToBeforeShip;
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
        void preloadRemainingModels();
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

      {/* REAL DEPTH DEBUG */}
      <div
        id="depth-debug"
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          zIndex: 10000,
          padding: "8px 10px",
          borderRadius: 8,
          background: "rgba(0,0,0,.72)",
          color: "#7CFF9B",
          fontSize: 12,
          fontFamily: "monospace",
          lineHeight: 1.5,
          pointerEvents: "none",
          whiteSpace: "pre-line",
        }}
      >
        DEPTH: waiting...
      </div>


      {/* TEMP DEBUG — 개발 완료 후 삭제 */}
      <button
          id="debug-skip-before-ship"
        type="button"
        style={{
          position: "absolute",
          top: 80,
          right: 12,
          zIndex: 9999,
          padding: "8px 12px",
          borderRadius: 8,
          border: "1px solid rgba(255,255,255,0.4)",
          background: "rgba(0,0,0,0.7)",
          color: "#fff",
          fontSize: 11,
          fontWeight: 700,
        }}
      >
          DEV · 출고 직전
      </button>


      {/* 냉각 단계 가장자리 어둡게(비네트) — .cooling 일 때만 보인다 */}
      <div className="vignette" />

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

        <div className="ship-story" aria-live="polite">
          <section className="ship-result-card" aria-label="완성된 냥이탁주 결과">
            <div className="ship-card-crest" aria-hidden="true">
              <img src="/ar/ui/shipping-crest-jar.png" alt="" />
            </div>
            <h2>양조가 <em>완료</em>되었습니다!</h2>
            <p className="ship-card-note">누룩이 만든 은은한 단맛과 발효 향</p>
            <button id="btn-ship-again" className="ship-row" type="button">
              <img className="ship-row-icon" src="/ar/ui/shipping-drink-set.png" alt="" aria-hidden="true" />
              <b>냥이탁주 다시 빚기</b><i>›</i>
            </button>
            <div className="ship-save-row">
              <span className="ship-result-thumb">
                <img src={recipe.finish.image} alt="완성된 냥이탁주 결과 미리보기" />
              </span>
              <span><b>결과 이미지 저장</b><small>완성된 병과 양조 결과를 기록해요</small></span>
              <button id="btn-ship-capture" type="button">촬영하기</button>
            </div>
            <button id="btn-ship-info" className="ship-primary" type="button">
              <img src="/ar/ui/paw-pink.png" alt="" aria-hidden="true" />
              완성된 냥이탁주 정보 보기
            </button>
          </section>
        </div>
      </div>

      <div className="ship-capture-ui" aria-label="결과 이미지 촬영">
        <header><strong>결과 이미지 촬영</strong></header>
        <div className="capture-frame">
          <span className="corner tl" /><span className="corner tr" />
          <span className="corner bl" /><span className="corner br" />
          <img className="capture-label-sticker" src="/ar/ui/shipping-label-sticker.png" alt="냥이탁주 결과 스티커" />
        </div>
        <p>프레임 안의 병·라벨·양조 결과가 한 장에 촬영돼요</p>
        <footer>
          <button id="btn-capture-cancel" type="button">취소</button>
          <button id="btn-capture-shot" className="capture-shutter" type="button" aria-label="촬영">
            <img src="/ar/ui/paw-pink.png" alt="" aria-hidden="true" />
          </button>
          <button id="btn-capture-sticker" type="button" aria-pressed="true">스티커 포함</button>
        </footer>
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
