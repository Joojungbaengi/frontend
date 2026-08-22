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
import { TRAY_PULL, TrayPullGesture, type TrayPullSnapshot } from "@/lib/hand/trayPullGesture";
import { markObtained } from "@/lib/dex";
import { XrCameraFeed } from "@/lib/hand/xrCameraFeed";
import { styles } from "@/components/arBreweryStyles";
import { shouldTrackHand } from "@/lib/hand/handStep";
import { CurledGrabGesture } from "@/lib/hand/curledGrabGesture";
import {
  createVisualHandBox,
  createVisualHandEllipsoid,
  setVisualHandBoxMatrix,
  type VisualHandCollider,
  type VisualHandCollisionSpace,
} from "@/lib/hand/visualCollision";

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
    /** 침수 상태로 기다리는 시간 */
    const SOAK_MS = 4500;

    const S = {
      step: "place" as "place" | ArStep,
      surface: "floor" as "floor" | "table",
      placed: false,
      selected: new Set<string>(),
      godubap: 0,
      rinseTurns: 0,
      rinsePartial: 0,
      soakAt: 0,
      coolFans: 0,
      coolDone: false,
      quizDone: false,
      temp: OPTIMAL_C,
      ferment: 0,
      fstage: 0,
      mashTrayDone: new Set<string>(),
      press: 0,
      tempLog: [] as number[],
      xr: false,
      hand: false,
      isInitializing: true,
    };
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
    // 후발효 원형 게이지의 일수·진행 눈금을 다시 그리는 함수(buildFerment 가 채운다)
    let fermentUpdateGauge: ((progress: number, day: number) => void) | null = null;
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
      return S.hand && S.godubap === GB_LAST && S.quizDone && !S.coolDone;
    }

    function resetIngredientSelection() {
      enteredIngredientAt = performance.now();
      S.selected.clear();
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
      document.documentElement.dataset.arStep = next === "done" ? "ferment" : next;
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
    * TEMP DEBUG — 압착·여과 직전의 후발효 완료 화면으로 이동
    * 나중에 삭제
    * ======================================================= */
    async function debugSkipToBeforePress() {
      S.placed = true;
      anchor.visible = true;

      // 압착·여과로 바로 건너뛰지 않고 후발효가 100% 완료된 화면을 보여준다.
      // 사용자가 기존 CTA를 누르면 정상 흐름을 통해 압착·여과로 넘어간다.
      const postFermentIndex = Math.max(0, FERMENT_STEPS.length - 1);
      S.fstage = postFermentIndex;
      S.ferment = 100;
      S.press = 0;
      uiRoot!.classList.remove("shipped");
      delete uiRoot!.dataset.shipSequence;
      setStep("ferment");
      syncFermentPhase();

      // 초기 로딩 중 DEV 버튼을 눌러도 빈 무대가 만들어지지 않도록
      // 후발효 항아리에 필요한 모델을 받은 뒤 현재 무대를 한 번 더 구성한다.
      const debugModels = MODELS.filter(
        (model) => model.id === "low_wooden_bench" || model.step === "ferment"
      );
      await Promise.all(debugModels.map(loadModel));
      if (S.step === "ferment" && S.fstage === postFermentIndex && S.ferment === 100) {
        buildStageFor("ferment");
        syncFermentPhase();
      }

      console.log(
        "[DEBUG] 후발효 완료 화면으로 이동",
        `fermentStep=${S.fstage}`,
        `stepId=${FERMENT_STEPS[S.fstage]?.id ?? "unknown"}`,
        `progress=${S.ferment}`
      );
    }

    /** TEMP DEBUG — 덧술1 바로 전 단계로 이동 */
    async function debugSkipToBeforeFirstMash() {
      S.placed = true;
      anchor.visible = true;
      const firstMashIndex = FERMENT_STEPS.findIndex((step) => step.id === "mash1");
      const beforeFirstMashIndex = Math.max(0, firstMashIndex - 1);
      S.fstage = beforeFirstMashIndex;
      S.ferment = 0;
      S.mashTrayDone.clear();
      setStep("ferment");

      // 초기 로딩 중에도 발효 무대가 비지 않도록 필요한 모델을 먼저 받는다.
      const debugModels = MODELS.filter(
        (model) => model.id === "low_wooden_bench" || model.step === "ferment"
      );
      await Promise.all(debugModels.map(loadModel));
      if (S.step === "ferment" && S.fstage === beforeFirstMashIndex) {
        buildStageFor("ferment");
        syncFermentPhase();
      }

      console.log(
        "[DEBUG] 덧술1 직전으로 이동",
        `fermentStep=${S.fstage}`,
        `stepId=${FERMENT_STEPS[S.fstage]?.id ?? "unknown"}`
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
    const visualHandColliders: VisualHandCollider[] = [];
    const visualHandCollision: VisualHandCollisionSpace = {
      root: stageGroup,
      colliders: visualHandColliders,
    };
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
      visualHandColliders.length = 0;
      live.cleanup.forEach((dispose) => dispose());
      live.cleanup.length = 0;
      live.tick = null;
      live.onHand = null;
      godubapShowStage = null;
      finishShowShip = null;
      fermentShowStage = null;
      fermentUpdateGauge = null;
      // 단계 전환 뒤 이전 장면의 화면 효과가 남지 않도록 모두 초기화한다.
      uiRoot!.classList.remove("cooling", "aging-focus", "aging-complete");
    }

    
    /** 받침대를 놓고 그 "상판 y좌표"를 돌려준다. y=0 이 곧 인식된 바닥면이다. */
    function addPlatform(): number {
      const gltf = LOADED["low_wooden_bench"];

      if (gltf) {
        const root = skinnedClone(gltf.scene) as THREE.Object3D;
        root.userData.isLowWoodenBench = true;
        root.scale.setScalar(0.5);
        root.traverse((o: any) => {
          if (o.isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
            // GLB의 원본 bounds가 압착 무대 카메라와 맞지 않아 받침대가
            // 화면 안에서도 간헐적으로 culled되는 것을 방지한다.
            o.frustumCulled = false;
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

        // 인터랙션 hit 영역과 분리된 시각 전용 받침대 충돌 박스.
        // 모델의 실제 삼각형 대신 로드 시 한 번 구한 bounds만 사용한다.
        visualHandColliders.push(createVisualHandBox(
          [raw.min.x, 0, raw.min.z],
          [raw.max.x, raw.max.y - raw.min.y, raw.max.z],
          0.004,
        ));

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
      fallbackMesh.userData.isLowWoodenBench = true;
      fallbackMesh.castShadow = true;
      fallbackMesh.receiveShadow = true;
      stageGroup.add(fallbackMesh);
      visualHandColliders.push(createVisualHandBox(
        [-0.38, 0, -0.38],
        [0.38, thickness, 0.38],
        0.004,
      ));
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

      live.onHand = (f) => {
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

        if (coolingActive()) {
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

      // 덧술 1·2에서 새 고두밥 채반을 항아리 뒤에서 몸 쪽으로 꺼낸다.
      // 각 덧술의 완료 상태는 step id별로 따로 보관한다.
      const mashTrayGesture = new TrayPullGesture();
      const emptyMashTraySnapshot = (): TrayPullSnapshot => ({
        state: "IDLE", grabbed: false, startSpan: null,
        currentSpan: 0, spanRatio: 1, progress: 0,
      });
      let mashTraySnapshot = emptyMashTraySnapshot();
      let mashTrayVisualProgress = 0;
      let activeMashId: string | null = null;
      let mashTrayCompletionAnnounced = false;
      let mashTrayDirectionLocked = false;
      let mashTrayPhase: "pulling" | "extracted" | "carrying" | "snapping" | "placed" = "pulling";
      let mashTrayHeldDepth = 0.65;
      let mashCoachStartedAt: number | null = null;
      let mashCoachLineIndex = -1;
      const MASH_MASTER_LINES = [
        "먼저 채반부터 꺼내 보게.",
        "식힌 고두밥을 항아리에 넣어 보게.",
        "덧술에 쓸 새 고두밥이라네.",
        "이제 정제수를 서두르지 말고 천천히 부어 보게.",
        "고두밥과 술덧이 잘 어우러지도록 도와주게.",
        "나무 주걱을 단단히 잡고 8자 모양으로 저어 보게.",
        "서두르지 말고, 구석구석 천천히 골고루 섞어 보게.",
        "좋아, 덧술이 완성되었네. 고두밥과 술덧이 고루 잘 섞였군.",
      ];
      const setMashMasterLine = (index: number) => {
        const nextIndex = THREE.MathUtils.clamp(index, 0, MASH_MASTER_LINES.length - 1);
        if (mashCoachLineIndex === nextIndex) return;
        mashCoachLineIndex = nextIndex;
        const message = $("#msg-ferment");
        if (message) message.textContent = MASH_MASTER_LINES[nextIndex];
      };

      // 다단식 랙과 당기는 Metal_Tray가 같은 무대 기준점을 공유한다.
      const mashRackPosition = new THREE.Vector3(0.3, platformTop + 0.032, -0.25);
      // 중앙 보정 오류를 고치기 전 화면에서 맞췄던 높이를 그대로 재현한다.
      // 당시 root.position 잔여값 때문에 실제 메시는 약 0.44m 낮게 보였다.
      const mashTrayShelfY = 0.28;
      // 랙 GLB에 포함된 고정 트레이와 완전히 겹치지 않도록, 손으로 꺼낼
      // 독립 Metal_Tray의 앞 테두리를 선반 밖으로 살짝 돌출시킨다.
      const mashTrayRestZ = 0.15;
      const mashTrayRig = new THREE.Group();
      mashTrayRig.position.copy(mashRackPosition);
      const mashTrayMover = new THREE.Group();
      // 나무 상판 아래에 묻히지 않도록 랙의 첫 사용 선반 높이에 올린다.
      mashTrayMover.position.set(0, mashTrayShelfY, mashTrayRestZ);
      mashTrayRig.add(mashTrayMover);
      stageGroup.add(mashTrayRig);

      const mashTrayDef = MODELS.find((model) => model.id === "mash_metal_tray");
      const mashTrayNode = mashTrayDef ? spawnModel(mashTrayDef) : null;
      const mashTrayModelPivot = new THREE.Group();
      mashTrayMover.add(mashTrayModelPivot);
      let mashTrayDepth = 0.18;
      let mashTrayHeight = 0.05;
      if (mashTrayNode) {
        // spawnModel이 중앙 정렬한 root 자체를 다시 scale/rotate하면 root.position은
        // 그대로 남아 모델 중심과 잡기 링이 갈라진다. 별도 pivot에 변환을 적용해
        // 중앙 보정 위치와 실제 메시가 항상 같은 비율·회전으로 움직이게 한다.
        mashTrayModelPivot.add(mashTrayNode);
        mashTrayModelPivot.scale.setScalar(0.35);
        mashTrayModelPivot.updateWorldMatrix(true, true);
        let size = new THREE.Box3().setFromObject(mashTrayModelPivot).getSize(new THREE.Vector3());
        // +Z 방향 끝의 변을 잡게 되므로, 그 변의 길이(X)가 항상 짧은 쪽이
        // 되도록 긴 축을 Z에 맞춘다. 즉 긴 변이 아니라 짧은 변 중앙에서 당긴다.
        if (size.x > size.z) {
          mashTrayModelPivot.rotation.y = Math.PI / 2;
          mashTrayModelPivot.updateWorldMatrix(true, true);
          size = new THREE.Box3().setFromObject(mashTrayModelPivot).getSize(new THREE.Vector3());
        }
        mashTrayDepth = Math.max(0.12, size.z);
        mashTrayHeight = Math.max(0.03, size.y);
      }

      const mashTrayTarget = new THREE.Group();
      mashTrayTarget.position.set(0, mashTrayHeight + 0.018, mashTrayDepth * 0.42);
      const targetRing = new THREE.Mesh(
        new THREE.RingGeometry(0.022, 0.034, 28).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({
          color: 0xffd45f, transparent: true, opacity: 0.88,
          side: THREE.DoubleSide, depthWrite: false,
        })
      );
      targetRing.renderOrder = 8;
      mashTrayTarget.add(targetRing);
      mashTrayMover.add(mashTrayTarget);
      mashTrayRig.visible = false;

      // jar_body 입구 오른쪽 위의 최종 배치 자세. 오른쪽 끝은 높고 항아리 쪽
      // 가장자리는 낮게 기울여, 고두밥을 바로 부을 수 있는 모습으로 고정한다.
      const mashTrayDropPosition = new THREE.Vector3(0.28, platformTop + 0.285, 0.3);
      const mashTrayDropQuaternion = new THREE.Quaternion().setFromEuler(
        // 긴 축을 따라 기울여 짧은 끝부분이 항아리 쪽으로 내려가게 한다.
        new THREE.Euler(-0.58, 0.08, 0.12),
      );
      const mashTrayDropTarget = new THREE.Group();
      mashTrayDropTarget.position.copy(mashTrayDropPosition);
      mashTrayDropTarget.quaternion.copy(mashTrayDropQuaternion);
      const mashTrayDropGuideTexture = new THREE.TextureLoader().load(
        "/ar/ui/mash-tray-drop-guide.jpg",
      );
      mashTrayDropGuideTexture.colorSpace = THREE.SRGBColorSpace;
      const mashTrayDropRing = new THREE.Mesh(
        new THREE.PlaneGeometry(0.36, 0.24).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({
          map: mashTrayDropGuideTexture,
          color: 0xffd45f,
          transparent: true,
          opacity: 0.72,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      mashTrayDropRing.renderOrder = 8;
      mashTrayDropTarget.add(mashTrayDropRing);
      mashTrayDropTarget.visible = false;
      stageGroup.add(mashTrayDropTarget);

      const resetMashTray = (stepId: string) => {
        activeMashId = stepId;
        mashTrayRig.add(mashTrayMover);
        mashTrayGesture.reset();
        mashTraySnapshot = emptyMashTraySnapshot();
        mashTrayVisualProgress = S.mashTrayDone.has(stepId) ? 1 : 0;
        mashTrayMover.position.z = mashTrayRestZ + mashTrayVisualProgress * TRAY_PULL.TRAY_PULL_DISTANCE;
        mashTrayMover.position.x = 0;
        mashTrayMover.position.y = mashTrayShelfY;
        mashTrayMover.quaternion.identity();
        mashTrayPhase = S.mashTrayDone.has(stepId) ? "placed" : "pulling";
        if (mashTrayPhase === "placed") {
          stageGroup.attach(mashTrayMover);
          mashTrayMover.position.copy(mashTrayDropPosition);
          mashTrayMover.quaternion.copy(mashTrayDropQuaternion);
        }
        mashTrayDropTarget.visible = false;
        mashTrayCompletionAnnounced = S.mashTrayDone.has(stepId);
        mashTrayDirectionLocked = false;
        mashCoachStartedAt = null;
        mashCoachLineIndex = -1;
        setMashMasterLine(S.mashTrayDone.has(stepId) ? 1 : 0);
      };

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
      const mashWaterMaterials: THREE.ShaderMaterial[] = [];
      const fermentProcessModels = MODELS
        .filter((m) => m.step === "ferment" && m.processSteps?.length)
        // 움직이는 Metal_Tray는 mashTrayMover가 별도로 소유한다.
        .filter((m) => m.id !== "mash_metal_tray")
        .map((def) => {
          const group = new THREE.Group();
          const node = spawnModel(def);
          group.position.set(0, platformTop + def.y, 0);
          if (def.id === "wooden_spatula") {
            group.position.x = -0.34;
            group.rotation.z = -0.72;
          }
          if (def.id === "mash_tray_rack") {
            // 화면 오른쪽(+x), 사용자에게서 먼 쪽(-z)에 배치한다. 직전 크기
            // (1.59 * 1.3)에서 다시 50% 키우고 Y축 90도 회전은 유지한다.
            group.position.copy(mashRackPosition);
            group.scale.setScalar(1.59 * 1.3 * 1.5);
            group.rotation.y = Math.PI / 2;
          }
          if (def.id === "mash_water_spout_jar") {
            // 큰 랙의 반대편에 두고 주구가 중앙 작업 공간을 향하게 한다.
            group.position.set(-0.2, platformTop + def.y, 0);
            group.rotation.y = -Math.PI / 4;

            // GLB 내부에 물 메시가 없으므로 항아리 입구 안쪽에 얇은 원형 수면만
            // 넣는다. 그룹의 로컬 좌표라 덧술 무대와 회전을 그대로 따른다.
            const waterMaterial = new THREE.ShaderMaterial({
              uniforms: {
                uTime: { value: 0 },
                uDeepColor: { value: new THREE.Color(0x3d91a5) },
                uShallowColor: { value: new THREE.Color(0xd5f4f2) },
              },
              vertexShader: /* glsl */ `
                uniform float uTime;
                varying vec2 vWaterPosition;
                varying vec3 vWorldPosition;

                void main() {
                  vec3 p = position;
                  float waveA = sin(p.x * 72.0 + uTime * 1.35) * 0.00075;
                  float waveB = sin(p.z * 91.0 - uTime * 1.05) * 0.00055;
                  p.y += waveA + waveB;
                  vWaterPosition = p.xz;
                  vec4 world = modelMatrix * vec4(p, 1.0);
                  vWorldPosition = world.xyz;
                  gl_Position = projectionMatrix * viewMatrix * world;
                }
              `,
              fragmentShader: /* glsl */ `
                uniform float uTime;
                uniform vec3 uDeepColor;
                uniform vec3 uShallowColor;
                varying vec2 vWaterPosition;
                varying vec3 vWorldPosition;

                void main() {
                  float phaseA = vWaterPosition.x * 72.0 + uTime * 1.35;
                  float phaseB = vWaterPosition.y * 91.0 - uTime * 1.05;
                  float slopeX = cos(phaseA) * 0.054;
                  float slopeZ = cos(phaseB) * 0.050;
                  vec3 rippleNormal = normalize(vec3(-slopeX, 1.0, -slopeZ));
                  vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
                  float facing = clamp(dot(rippleNormal, viewDirection), 0.0, 1.0);
                  float fresnel = pow(1.0 - facing, 2.4);

                  vec3 lightDirection = normalize(vec3(-0.35, 0.82, 0.46));
                  vec3 halfDirection = normalize(lightDirection + viewDirection);
                  float sparkle = pow(max(dot(rippleNormal, halfDirection), 0.0), 72.0);
                  float shimmer = 0.5 + 0.5 * sin(
                    vWaterPosition.x * 128.0 + vWaterPosition.y * 103.0 + uTime * 1.8
                  );

                  vec3 waterColor = mix(uDeepColor, uShallowColor, 0.55 + fresnel * 0.34);
                  waterColor += sparkle * (0.34 + shimmer * 0.18);
                  float alpha = 0.22 + fresnel * 0.34 + sparkle * 0.10;
                  gl_FragColor = vec4(waterColor, min(alpha, 0.68));
                }
              `,
              transparent: true,
              depthWrite: false,
              side: THREE.DoubleSide,
            });
            mashWaterMaterials.push(waterMaterial);
            const waterSurface = new THREE.Mesh(
              new THREE.CircleGeometry(0.056, 48).rotateX(-Math.PI / 2),
              waterMaterial,
            );
            // 림보다 안쪽에 내려 놓아 원형 판이 아니라 담긴 수면처럼 보이게 한다.
            waterSurface.position.y = 0.08;
            waterSurface.renderOrder = 4;
            group.add(waterSurface);
          }
          if (def.id === "mash_jar_body") {
            // 덧술 재료를 받을 항아리는 중앙에서 사용자 쪽(+Z)으로 당긴다.
            group.position.set(0, platformTop + def.y, 0.12);
          }
          if (node) group.add(node);
          group.visible = false;
          stageGroup.add(group);
          return { def, group };
        });

      // Closed_jar 자체 형상을 살짝 키운 후면 셸. 별도 원형 링이 아니라 실제
      // 몸통과 뚜껑 윤곽을 그대로 따라가므로 바깥 실루엣에만 얇은 역광이 남는다.
      const closedJarProcess = fermentProcessModels.find(({ def }) => def.id === "closed_jar");
      const mashRackProcess = fermentProcessModels.find(({ def }) => def.id === "mash_tray_rack");
      const jarGlowShellMaterial = new THREE.MeshBasicMaterial({
        color: 0xffa85c,
        transparent: true,
        opacity: 0,
        side: THREE.BackSide,
        depthTest: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      const jarGlowShell = closedJarProcess?.group.clone(true) ?? null;
      if (jarGlowShell) {
        jarGlowShell.scale.setScalar(1.018);
        jarGlowShell.visible = false;
        jarGlowShell.renderOrder = 2;
        jarGlowShell.traverse((object) => {
          if (!(object as THREE.Mesh).isMesh) return;
          const mesh = object as THREE.Mesh;
          mesh.material = jarGlowShellMaterial;
          mesh.castShadow = false;
          mesh.receiveShadow = false;
        });
        stageGroup.add(jarGlowShell);
      }

      // 후발효(마지막 단계) 발효 애니메이션 — 은은한 온기만 남긴다.
      // 기존 흰색 입자는 모바일에서 네모난 연기처럼 보여 제거했다.
      const heat = new THREE.PointLight(0xffa96a, 0, 0.46, 2);
      heat.position.set(0, 0.2, 0);
      stageGroup.add(heat);

      const makeEffectTexture = (kind: "halo" | "smoke" | "bubble") => {
        const effectCanvas = document.createElement("canvas");
        effectCanvas.width = 256;
        effectCanvas.height = 256;
        const ctx = effectCanvas.getContext("2d")!;
        if (kind === "bubble") {
          const gradient = ctx.createLinearGradient(64, 48, 196, 208);
          gradient.addColorStop(0, "rgba(255,248,224,0.92)");
          gradient.addColorStop(0.48, "rgba(246,183,103,0.72)");
          gradient.addColorStop(1, "rgba(255,239,205,0.2)");
          ctx.strokeStyle = gradient;
          ctx.lineWidth = 12;
          ctx.beginPath();
          ctx.arc(128, 128, 91, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = "rgba(255,255,255,0.72)";
          ctx.beginPath();
          ctx.arc(91, 84, 13, 0, Math.PI * 2);
          ctx.fill();
        } else if (kind === "smoke") {
          // 여러 주파수의 value noise를 겹쳐 구름처럼 밀도가 끊기는 연기 텍스처를 만든다.
          const fract = (value: number) => value - Math.floor(value);
          const hash = (x: number, y: number) =>
            fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453123);
          const noise = (x: number, y: number) => {
            const ix = Math.floor(x);
            const iy = Math.floor(y);
            const fx = x - ix;
            const fy = y - iy;
            const sx = fx * fx * (3 - 2 * fx);
            const sy = fy * fy * (3 - 2 * fy);
            const top = THREE.MathUtils.lerp(hash(ix, iy), hash(ix + 1, iy), sx);
            const bottom = THREE.MathUtils.lerp(hash(ix, iy + 1), hash(ix + 1, iy + 1), sx);
            return THREE.MathUtils.lerp(top, bottom, sy);
          };
          const image = ctx.createImageData(256, 256);
          for (let py = 0; py < 256; py++) {
            const v = py / 255;
            const verticalFade = Math.pow(Math.sin(Math.PI * v), 0.62);
            // 위쪽으로 갈수록 폭이 넓어지고 중심이 좌우로 휘어진다.
            const plumeWidth = THREE.MathUtils.lerp(0.62, 0.3, v);
            const centerDrift = Math.sin(v * 8.2 + 0.7) * 0.1 + Math.sin(v * 17.3) * 0.035;
            for (let px = 0; px < 256; px++) {
              const u = (px / 255) * 2 - 1 - centerDrift;
              const edge = THREE.MathUtils.clamp(1 - Math.abs(u) / plumeWidth, 0, 1);
              const cloud =
                noise(px / 54, py / 58) * 0.5 +
                noise(px / 25 + 7.3, py / 28 + 2.1) * 0.3 +
                noise(px / 11 + 3.7, py / 13 + 9.2) * 0.2;
              const brokenEdge = THREE.MathUtils.smoothstep(edge * cloud, 0.1, 0.52);
              const alpha = Math.round(178 * verticalFade * brokenEdge * (0.52 + cloud * 0.48));
              const offset = (py * 256 + px) * 4;
              // 중심은 따뜻하고 바깥은 회갈색에 가까운 연기색이다.
              image.data[offset] = 242;
              image.data[offset + 1] = 220;
              image.data[offset + 2] = 194;
              image.data[offset + 3] = alpha;
            }
          }
          ctx.putImageData(image, 0, 0);
        } else {
          const gradient = ctx.createRadialGradient(128, 128, 12, 128, 128, 124);
          gradient.addColorStop(0, "rgba(255,174,82,0.22)");
          gradient.addColorStop(0.45, "rgba(255,174,82,0.38)");
          gradient.addColorStop(0.68, "rgba(255,177,85,0.72)");
          gradient.addColorStop(0.86, "rgba(255,199,123,0.3)");
          gradient.addColorStop(1, "rgba(255,167,73,0)");
          ctx.fillStyle = gradient;
          ctx.fillRect(0, 0, 256, 256);
        }
        const texture = new THREE.CanvasTexture(effectCanvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.generateMipmaps = false;
        return texture;
      };

      // 항아리 뒤의 타원형 후광. 중심은 항아리가 가리고 외곽만 보인다.
      const haloTexture = makeEffectTexture("halo");
      const haloMaterial = new THREE.SpriteMaterial({
        map: haloTexture,
        color: 0xffb264,
        transparent: true,
        opacity: 0,
        depthTest: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      const jarHalo = new THREE.Sprite(haloMaterial);
      jarHalo.scale.set(0.3, 0.34, 1);
      jarHalo.visible = false;
      stageGroup.add(jarHalo);

      // 연기와 기포는 카메라에서 보이는 항아리 좌우 실루엣에만 배치한다.
      const smokeTexture = makeEffectTexture("smoke");
      const smokeSprites = Array.from({ length: 12 }, (_, i) => {
        const material = new THREE.SpriteMaterial({
          map: smokeTexture,
          color: 0xffead6,
          transparent: true,
          opacity: 0,
          depthTest: true,
          depthWrite: false,
          toneMapped: false,
        });
        const sprite = new THREE.Sprite(material);
        const size = 0.052 + (i % 4) * 0.008;
        sprite.scale.set(size, size * 1.85, 1);
        sprite.userData.phase = i * 0.73;
        sprite.userData.side = i % 2 ? 1 : -1;
        sprite.visible = false;
        stageGroup.add(sprite);
        return sprite;
      });

      const bubbleTexture = makeEffectTexture("bubble");
      const bubbleSprites = Array.from({ length: 18 }, (_, i) => {
        const material = new THREE.SpriteMaterial({
          map: bubbleTexture,
          color: 0xffd7a0,
          transparent: true,
          opacity: 0,
          depthTest: true,
          depthWrite: false,
          toneMapped: false,
        });
        const sprite = new THREE.Sprite(material);
        const size = 0.009 + (i % 4) * 0.003;
        sprite.scale.set(size, size, 1);
        sprite.userData.phase = i * 0.47;
        sprite.userData.side = i % 2 ? 1 : -1;
        sprite.visible = false;
        stageGroup.add(sprite);
        return sprite;
      });
      live.cleanup.push(() => {
        haloTexture.dispose();
        smokeTexture.dispose();
        bubbleTexture.dispose();
        haloMaterial.dispose();
        jarGlowShellMaterial.dispose();
        smokeSprites.forEach((sprite) => (sprite.material as THREE.SpriteMaterial).dispose());
        bubbleSprites.forEach((sprite) => (sprite.material as THREE.SpriteMaterial).dispose());
      });

      // DOM 위에 떠 있던 게이지를 3D 평면으로 옮긴다. 투명 평면이 항아리보다
      // 뒤에 있으므로 깊이 테스트를 통해 항아리가 원의 아래쪽을 자연스럽게 가린다.
      const gaugeCanvas = document.createElement("canvas");
      gaugeCanvas.width = 512;
      gaugeCanvas.height = 512;
      const gaugeContext = gaugeCanvas.getContext("2d");
      const gaugeTexture = new THREE.CanvasTexture(gaugeCanvas);
      gaugeTexture.colorSpace = THREE.SRGBColorSpace;
      gaugeTexture.minFilter = THREE.LinearFilter;
      gaugeTexture.magFilter = THREE.LinearFilter;
      gaugeTexture.generateMipmaps = false;
      const gaugeMaterial = new THREE.MeshBasicMaterial({
        map: gaugeTexture,
        transparent: true,
        depthTest: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      const gauge = new THREE.Mesh(new THREE.PlaneGeometry(0.378, 0.378), gaugeMaterial);
      gauge.position.set(0, platformTop + 0.34, -0.075);
      gauge.visible = false;
      gauge.renderOrder = 1;
      stageGroup.add(gauge);
      live.cleanup.push(() => gaugeTexture.dispose());

      let lastGaugeTick = -1;
      let lastGaugeDay = -1;
      fermentUpdateGauge = (progress, day) => {
        if (!gaugeContext) return;
        const ctx = gaugeContext;
        const center = 256;
        const innerRadius = 205;
        const outerRadius = 232;
        const ticks = 120;
        const completedTicks = Math.round((THREE.MathUtils.clamp(progress, 0, 100) / 100) * ticks);
        // 같은 눈금과 일수라면 텍스처를 다시 그리지 않아 모바일 GPU 업로드를 줄인다.
        if (completedTicks === lastGaugeTick && day === lastGaugeDay) return;
        lastGaugeTick = completedTicks;
        lastGaugeDay = day;
        ctx.clearRect(0, 0, gaugeCanvas.width, gaugeCanvas.height);

        // 어두운 반투명 원판은 카메라 배경 위에서도 글자를 읽히게 한다.
        const shade = ctx.createRadialGradient(center, center, 34, center, center, 222);
        shade.addColorStop(0, "rgba(24,18,12,0.54)");
        shade.addColorStop(0.72, "rgba(24,18,12,0.43)");
        shade.addColorStop(1, "rgba(24,18,12,0.16)");
        ctx.fillStyle = shade;
        ctx.beginPath();
        ctx.arc(center, center, 222, 0, Math.PI * 2);
        ctx.fill();

        // 모든 눈금은 원 둘레에서 중심을 향하도록 방사형으로 그린다.
        ctx.lineCap = "round";
        for (let i = 0; i < ticks; i++) {
          const angle = -Math.PI / 2 + (i / ticks) * Math.PI * 2;
          const major = i % 10 === 0;
          const tickInner = innerRadius - (major ? 7 : 0);
          ctx.beginPath();
          ctx.moveTo(center + Math.cos(angle) * outerRadius, center + Math.sin(angle) * outerRadius);
          ctx.lineTo(center + Math.cos(angle) * tickInner, center + Math.sin(angle) * tickInner);
          ctx.lineWidth = major ? 3.2 : 2;
          ctx.strokeStyle = i < completedTicks ? "rgba(246,198,128,0.98)" : "rgba(239,218,184,0.28)";
          ctx.stroke();
        }

        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#f8e8c9";
        ctx.shadowColor = "rgba(0,0,0,0.8)";
        ctx.shadowBlur = 10;
        ctx.font = "700 76px serif";
        ctx.fillText(`${day}일차`, center, 225);
        ctx.fillStyle = "rgba(248,232,201,0.78)";
        ctx.font = "32px sans-serif";
        ctx.fillText("30일 동안 천천히", center, 302);
        ctx.fillText("익어가요", center, 344);
        ctx.shadowBlur = 0;
        gaugeTexture.needsUpdate = true;
      };

      const F_LAST_I = FERMENT_STEPS.length - 1;
      fermentShowStage = () => {
        const processId = FERMENT_STEPS[Math.min(S.fstage, F_LAST_I)]?.id;
        const mashStage = processId?.startsWith("mash") === true;
        if (mashStage && processId && activeMashId !== processId) resetMashTray(processId);
        if (!mashStage) activeMashId = null;
        cooled.visible = S.fstage === 0;   // 혼합에서만 채반+고두밥
        // 후발효에는 밀봉 항아리가 대신 등장한다.
        jar.visible = S.fstage >= 1 && processId !== "post" && !mashStage;
        fermentProcessModels.forEach(({ def, group }) => {
          group.visible = Boolean(processId && def.processSteps?.includes(processId));
        });
        mashTrayRig.visible = mashStage;
        // 꺼낸 뒤 stageGroup으로 분리된 경우에도 현재 덧술 단계에서만 보인다.
        mashTrayMover.visible = mashStage;
        if (!mashStage) mashTrayDropTarget.visible = false;
        const mashTrayPlaceGuide = $("#mash-tray-place-guide");
        mashTrayPlaceGuide?.classList.toggle(
          "hidden",
          !mashStage || mashTrayPhase === "pulling" || mashTrayPhase === "placed",
        );
        gauge.visible = S.fstage >= F_LAST_I;
        if (gauge.visible) {
          const day = Math.min(30, 1 + Math.floor(S.ferment / 3.4));
          fermentUpdateGauge?.(S.ferment, day);
        }
      };
      fermentShowStage();

      const effectCenter = new THREE.Vector3(0, platformTop + 0.14, 0);
      const localCamera = new THREE.Vector3();
      const viewDirection = new THREE.Vector3();
      const viewRight = new THREE.Vector3();
      const effectPosition = new THREE.Vector3();
      live.tick = (time) => {
        const active = S.fstage >= F_LAST_I; // 후발효에서만 실제 발효 진행
        mashWaterMaterials.forEach((material) => {
          material.uniforms.uTime.value = time;
        });
        if (mashTrayRig.visible) {
          targetRing.visible = mashTrayPhase === "pulling";
          if (mashTrayPhase === "pulling") {
            mashTrayVisualProgress += (mashTraySnapshot.progress - mashTrayVisualProgress) * 0.18;
            mashTrayMover.position.z = mashTrayRestZ + mashTrayVisualProgress * TRAY_PULL.TRAY_PULL_DISTANCE;
          } else if (mashTrayPhase === "snapping") {
            mashTrayMover.position.lerp(mashTrayDropPosition, 0.2);
            mashTrayMover.quaternion.slerp(mashTrayDropQuaternion, 0.2);
            if (mashTrayMover.position.distanceTo(mashTrayDropPosition) < 0.004) {
              mashTrayMover.position.copy(mashTrayDropPosition);
              mashTrayMover.quaternion.copy(mashTrayDropQuaternion);
              mashTrayPhase = "placed";
              if (activeMashId) S.mashTrayDone.add(activeMashId);
              if (!mashTrayCompletionAnnounced) {
                mashTrayCompletionAnnounced = true;
                navigator.vibrate?.(28);
                syncFermentPhase();
              }
            }
          }
          (targetRing.material as THREE.MeshBasicMaterial).opacity =
            0.62 + Math.sin(time * 4.5) * 0.22;
          const targetRingMaterial = targetRing.material as THREE.MeshBasicMaterial;
          targetRingMaterial.color.setHex(
            mashTraySnapshot.grabbed
              ? 0x62e89a // 초록: 트레이 잡기 성공
              : mashTraySnapshot.state === "HOVER"
                ? 0x65d9ff // 하늘색: 잡을 수 있는 위치
                : 0xffd45f, // 노랑: 손을 가져갈 위치
          );
          targetRing.scale.setScalar(1 + mashTraySnapshot.progress * 0.32);
          (mashTrayDropRing.material as THREE.MeshBasicMaterial).opacity =
            0.5 + Math.sin(time * 3.8) * 0.2;

          // 현재 구현에서 손으로 판별할 수 있는 세부 동작은 채반 꺼내기까지다.
          // 완료 뒤에는 장인의 다음 작업 안내를 일정 간격으로 순환시켜,
          // 고두밥 투입 → 물 붓기 → 8자 젓기 순서를 놓치지 않게 한다.
          const trayDone = Boolean(activeMashId && S.mashTrayDone.has(activeMashId));
          if (!trayDone) {
            mashCoachStartedAt = null;
            setMashMasterLine(0);
          } else {
            if (mashCoachStartedAt === null) mashCoachStartedAt = time;
            const guidedIndex = 1 + Math.floor((time - mashCoachStartedAt) / 4.2);
            setMashMasterLine(guidedIndex);
          }
          $("#mash-tray-place-guide")?.classList.toggle(
            "hidden",
            mashTrayPhase === "pulling" || mashTrayPhase === "placed",
          );
        }
        gauge.visible = active;
        if (active) gauge.quaternion.copy(camera.quaternion);
        jarHalo.visible = active;
        if (jarGlowShell) jarGlowShell.visible = active;
        smokeSprites.forEach((sprite) => { sprite.visible = active; });
        bubbleSprites.forEach((sprite) => { sprite.visible = active; });

        if (active) {
          camera.getWorldPosition(localCamera);
          stageGroup.worldToLocal(localCamera);
          viewDirection.copy(localCamera).sub(effectCenter);
          viewDirection.y = 0;
          if (viewDirection.lengthSq() < 0.0001) viewDirection.set(0, 0, 1);
          viewDirection.normalize();
          viewRight.set(viewDirection.z, 0, -viewDirection.x).normalize();

          const progress = THREE.MathUtils.clamp(S.ferment / 100, 0, 1);
          const growing = THREE.MathUtils.smoothstep(progress, 0, 0.82);
          const completion = THREE.MathUtils.smoothstep(progress, 0.9, 1);
          const pulse = 0.86 + Math.sin(time * 2.2) * 0.14;
          const glowStrength = (0.18 + growing * 0.58 + completion * 0.14) * pulse;

          jarHalo.position.copy(effectCenter).addScaledVector(viewDirection, -0.024);
          jarHalo.quaternion.copy(camera.quaternion);
          haloMaterial.opacity = glowStrength * 0.78;
          // 딱딱한 외곽선은 거의 지우고, 실제 역광의 미세한 가장자리만 남긴다.
          jarGlowShellMaterial.opacity = Math.min(0.085, glowStrength * 0.09);

          // 실제 광원도 사용자 반대편·뚜껑 높이에 두어 앞면 전체가 아니라
          // 항아리 위쪽과 외곽에서 빛이 새는 역광 방향을 만든다.
          heat.position.copy(effectCenter)
            .addScaledVector(viewDirection, -0.16);
          heat.position.y = platformTop + 0.25;

          smokeSprites.forEach((sprite, i) => {
            const phase = (time * (0.075 + (i % 3) * 0.012) + sprite.userData.phase) % 1;
            const side = sprite.userData.side as number;
            const radius = 0.097 + (i % 4) * 0.007;
            const drift = Math.sin(time * 0.7 + i * 1.13) * 0.009;
            effectPosition.copy(effectCenter)
              .addScaledVector(viewRight, side * (radius + drift))
              .addScaledVector(viewDirection, -0.016 - (i % 2) * 0.004);
            // 뚜껑과 바디가 만나는 이음새에서 시작해 위쪽으로만 짧게 피어난다.
            effectPosition.y = platformTop + 0.19 + phase * 0.145;
            sprite.position.copy(effectPosition);
            sprite.quaternion.copy(camera.quaternion);
            const fade = Math.pow(Math.sin(Math.PI * phase), 1.25);
            (sprite.material as THREE.SpriteMaterial).opacity = fade * (0.13 + growing * 0.3) * (1 - completion * 0.22);
          });

          bubbleSprites.forEach((sprite, i) => {
            const phase = (time * (0.1 + (i % 4) * 0.012) + sprite.userData.phase) % 1;
            const side = sprite.userData.side as number;
            const radius = 0.102 + (i % 5) * 0.008;
            effectPosition.copy(effectCenter)
              .addScaledVector(viewRight, side * radius)
              .addScaledVector(viewDirection, 0.014);
            effectPosition.y = platformTop + 0.045 + phase * 0.205;
            sprite.position.copy(effectPosition);
            sprite.quaternion.copy(camera.quaternion);
            const fade = Math.sin(Math.PI * phase);
            const bubbleStrength = (0.12 + growing * 0.7) * (1 - completion * 0.88);
            (sprite.material as THREE.SpriteMaterial).opacity = fade * bubbleStrength;
          });
        }
        const hot = THREE.MathUtils.clamp((S.temp - 24) / 10, 0, 1);
        heat.intensity += ((active ? hot * 1.4 : 0) - heat.intensity) * 0.06;
      };

      const trayWorld = new THREE.Vector3();
      const trayCameraLocal = new THREE.Vector3();
      const trayCameraWorld = new THREE.Vector3();
      const trayCarryTarget = new THREE.Vector3();
      const trayGrabOffset = new THREE.Vector3();
      const trayScreen = { x: 0.5, y: 0.5 };
      live.onHand = (frame, hand, interactionCamera) => {
        const processId = FERMENT_STEPS[Math.min(S.fstage, F_LAST_I)]?.id;
        if (!processId?.startsWith("mash") || !mashTrayRig.visible) return;
        if (mashTrayPhase === "placed" || S.mashTrayDone.has(processId)) {
          setHandHud("dropped", "채반을 놓았어요 · 이제 고두밥을 항아리에 넣어 주세요");
          return;
        }
        if (mashTrayPhase === "snapping") {
          setHandHud("dropped", "채반을 항아리 옆에 내려놓고 있어요");
          return;
        }

        const beginTrayCarry = () => {
          mashTrayMover.getWorldPosition(trayWorld);
          interactionCamera.getWorldPosition(trayCameraWorld);
          mashTrayHeldDepth = Math.max(0.35, trayCameraWorld.distanceTo(trayWorld));
          stageGroup.attach(mashTrayMover);
          screenToWorld(
            hand.pinchScreen.x,
            hand.pinchScreen.y,
            mashTrayHeldDepth,
            interactionCamera,
            trayCarryTarget,
          );
          stageGroup.worldToLocal(trayCarryTarget);
          trayGrabOffset.copy(mashTrayMover.position).sub(trayCarryTarget);
          mashTrayPhase = "carrying";
          mashTrayDropTarget.visible = true;
        };

        if (mashTrayPhase === "carrying") {
          if (!frame.present) {
            mashTrayPhase = "extracted";
            setHandHud("idle", "손이 놓였어요 · 채반을 다시 잡아 주세요");
            return;
          }
          screenToWorld(
            hand.pinchScreen.x,
            hand.pinchScreen.y,
            mashTrayHeldDepth,
            interactionCamera,
            trayCarryTarget,
          );
          stageGroup.worldToLocal(trayCarryTarget);
          trayCarryTarget.add(trayGrabOffset);
          trayCarryTarget.y = THREE.MathUtils.clamp(
            trayCarryTarget.y,
            platformTop + 0.055,
            platformTop + 0.95,
          );
          mashTrayMover.position.lerp(trayCarryTarget, 0.48);

          const dropDistance = Math.hypot(
            mashTrayMover.position.x - mashTrayDropPosition.x,
            mashTrayMover.position.z - mashTrayDropPosition.z,
          );
          const overDropTarget = dropDistance <= 0.13;
          (mashTrayDropRing.material as THREE.MeshBasicMaterial).color.setHex(
            overDropTarget ? 0x78e39b : 0xffd45f,
          );
          if (frame.justReleased) {
            if (overDropTarget) {
              mashTrayPhase = "snapping";
              mashTrayDropTarget.visible = false;
              setHandHud("dropped", "좋아, 항아리 옆에 채반을 놓아 보게");
            } else {
              mashTrayPhase = "extracted";
              setHandHud("tracking", "채반을 다시 잡아 노란 자리에 놓아 주세요");
            }
            return;
          }
          setHandHud(
            "holding",
            overDropTarget
              ? "여기에서 손가락을 펴 채반을 놓으세요"
              : "채반을 항아리 옆의 노란 자리로 옮기세요",
          );
          return;
        }

        if (mashTrayPhase === "extracted") {
          (mashTrayDropRing.material as THREE.MeshBasicMaterial).color.setHex(0xffd45f);
          mashTrayMover.getWorldPosition(trayWorld);
          worldToScreen(trayWorld, interactionCamera, trayScreen);
          const nearExtractedTray = frame.present &&
            screenDist(hand.pinchScreen, trayScreen) <= 0.12;
          if (nearExtractedTray && frame.justPinched) beginTrayCarry();
          else if (!frame.present) setHandHud("idle", "손을 카메라에 비춰 주세요");
          else setHandHud(
            nearExtractedTray ? "hover" : "tracking",
            nearExtractedTray
              ? "엄지와 검지를 붙여 채반을 다시 잡으세요"
              : "꺼낸 채반 가까이 손을 가져가세요",
          );
          return;
        }

        // 단계 진입 후 첫 유효 프레임에서만 +Z 레일을 카메라 쪽으로 맞춘다.
        // 이후에는 pinch 전에도 다시 회전시키지 않아 AR pose의 작은 흔들림으로
        // 채반 전체가 계속 돌아가는 현상을 막는다.
        if (!mashTrayDirectionLocked) {
          interactionCamera.getWorldPosition(trayCameraLocal);
          stageGroup.worldToLocal(trayCameraLocal);
          trayCameraLocal.sub(mashTrayRig.position).setY(0);
          if (trayCameraLocal.lengthSq() > 1e-6) {
            const facing = Math.atan2(trayCameraLocal.x, trayCameraLocal.z);
            mashTrayRig.rotation.y = facing;
            if (mashRackProcess) mashRackProcess.group.rotation.y = facing + Math.PI / 2;
            mashTrayDirectionLocked = true;
          }
        }

        // ar_chaerin_test의 검증 코드처럼 투영 직전에 전체 부모 행렬을 갱신한다.
        // XR pose와 랙 회전이 바뀐 프레임에도 표시 원과 실제 hit 좌표가 일치한다.
        mashTrayRig.updateWorldMatrix(true, true);
        mashTrayTarget.getWorldPosition(trayWorld);
        worldToScreen(trayWorld, interactionCamera, trayScreen);
        const hovering = frame.present &&
          screenDist(hand.pinchScreen, trayScreen) <= TRAY_PULL.GRAB_RADIUS;
        mashTraySnapshot = mashTrayGesture.update(frame, hovering);

        if (mashTraySnapshot.state === "COMPLETE") {
          mashTrayVisualProgress = 1;
          beginTrayCarry();
          setHandHud("holding", "꺼낸 채반을 항아리 옆의 노란 자리로 옮기세요");
        } else if (mashTraySnapshot.grabbed) {
          setHandHud("holding", "트레이 잡기 성공 · 손가락을 붙인 채 몸 쪽으로 당기세요");
        } else if (hovering) {
          setHandHud(
            "hover",
            frame.pinching
              ? "집기 인식됨 · 잠시 그대로 유지하세요"
              : "하늘색 표시에서 엄지와 검지를 붙이세요",
          );
        } else if (!frame.present) {
          setHandHud("idle", "손을 카메라에 비춰 주세요");
        } else {
          setHandHud(
            "tracking",
            frame.pinching
              ? "빨간 손 표시는 집기 인식이에요 · 노란 원 안으로 옮기세요"
              : "채반 앞쪽의 노란 표시에 손을 가까이 대세요",
          );
        }
      };
    }

    /* --- 15 · 완성 --- */
    function buildFinish() {
      const platformTop = addPlatform();
      const contentY = platformTop + 0.03;
      const finishBench = stageGroup.children.find((child) => child.userData.isLowWoodenBench);
      const forceShowFinishBench = () => {
        if (!finishBench) return;
        finishBench.visible = true;
        // 압착·여과에서도 다른 공정과 같은 테이블과 배치 좌표를 유지한다.
        // 단계 전환 중 바뀔 수 있는 가시성만 복원한다.
        finishBench.traverse((object) => {
          object.visible = true;
          object.layers.enableAll();
          if (!(object as THREE.Mesh).isMesh) return;
          const mesh = object as THREE.Mesh;
          mesh.frustumCulled = false;
          const materials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.Material[];
          materials.forEach((material) => {
            material.visible = true;
            material.colorWrite = true;
            material.depthWrite = true;
            if ("opacity" in material) material.opacity = 1;
            material.needsUpdate = true;
          });
        });
      };

      // ── 완성 병 등장 연출 상태 ──
      let shipRevealT = 0;
      let shipRestY = 0;
      let shipHapticSent = false;
      let shipUiDoneSent = false;

      // 출고 연출은 짧고 선명하게 끝낸다. 이전 3.8초 시퀀스는 병이 이미
      // 준비된 뒤에도 UI를 오래 잠가 모바일에서 로딩처럼 느껴졌다.
      const SHIP_SETTLE_END = 0;
      const SHIP_REVEAL_END = 0.3;
      const SHIP_BOUNCE_END = 0.48;
      const SHIP_CELEBRATE_END = 0.62;
      const SHIP_RESULT_END = 0.82;
      const SHIP_READY_AT = 0.9;

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

      /* ── 압착·여과: 항아리 수위 인터랙션 ─────────────────────────
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
      const PRESS_LIQUID_BOTTOM_Y = 0.2;
      const PRESS_LIQUID_FULL_Y = 0.4;
      const PRESS_LIQUID_RADIUS = 0.098;
      let pressSurfaceEmptyY = PRESS_LIQUID_BOTTOM_Y;
      let pressSurfaceFullY = PRESS_LIQUID_FULL_Y;
      let pressLiquidVolume: THREE.Mesh | null = null;
      let pressSplashRing: THREE.Mesh | null = null;
      let pressIntroPlayed = false;
      let pressIntroRemaining = 0;
      let pressDragging = false;
      let pressPointerId: number | null = null;
      let pressLastPointerY = 0;
      let pressLastHandY: number | null = null;
      let pressLastHapticAt = 0;

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

        // jar_body.glb 자체에 액체/입력 노드가 없어도 압착 이펙트가 동작하도록
        // 항아리 내부의 유백색 술 볼륨과 수면을 절차형 메시로 보완한다.
        const liquidMaterial = new THREE.MeshPhysicalMaterial({
          color: 0xead5a1,
          roughness: 0.28,
          metalness: 0,
          transmission: 0.08,
          transparent: true,
          opacity: 0.94,
          depthWrite: true,
          side: THREE.DoubleSide,
        });
        pressLiquidVolume = new THREE.Mesh(
          new THREE.CylinderGeometry(PRESS_LIQUID_RADIUS, PRESS_LIQUID_RADIUS * 0.9, 1, 48, 1, false),
          liquidMaterial,
        );
        pressLiquidVolume.position.y = PRESS_LIQUID_BOTTOM_Y;
        pressLiquidVolume.scale.y = 0.001;
        pressLiquidVolume.visible = false;
        pressLiquidVolume.renderOrder = 3;
        pressEntry.group.add(pressLiquidVolume);

        if (!pressSurface) {
          pressSurface = new THREE.Mesh(
            new THREE.CircleGeometry(PRESS_LIQUID_RADIUS, 64).rotateX(-Math.PI / 2),
            liquidMaterial.clone(),
          );
          pressSurface.position.y = pressSurfaceEmptyY;
          pressSurface.renderOrder = 4;
          pressEntry.group.add(pressSurface);
        }

        pressSplashRing = new THREE.Mesh(
          new THREE.RingGeometry(0.018, 0.042, 48).rotateX(-Math.PI / 2),
          new THREE.MeshBasicMaterial({
            color: 0xffefc8,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            side: THREE.DoubleSide,
          }),
        );
        pressSplashRing.position.y = pressSurfaceEmptyY + 0.001;
        pressSplashRing.renderOrder = 5;
        pressEntry.group.add(pressSplashRing);

        if (!pressCollider) {
          pressCollider = new THREE.Mesh(
            new THREE.CylinderGeometry(0.105, 0.115, 0.13, 24),
            new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
          );
          pressCollider.position.y = 0.255;
          pressEntry.group.add(pressCollider);
        }
      }

      const pressStreamUniforms = {
        uTime: { value: 0 },
        uOpacity: { value: 0.88 },
        uReveal: { value: 0 },
        uDrain: { value: 0 },
        uColor: { value: new THREE.Color(0xf2ddb0) },
      };
      let pressStreamHold = 0;
      const pressStream = new THREE.Mesh(
        new THREE.TubeGeometry(
          new THREE.CatmullRomCurve3([
            new THREE.Vector3(-0.0015, 0.088, 0),
            new THREE.Vector3(0.002, 0.038, 0.001),
            new THREE.Vector3(-0.001, -0.018, -0.001),
            new THREE.Vector3(0.0015, -0.088, 0),
          ]),
          28,
          0.0048,
          7,
          false,
        ),
        new THREE.ShaderMaterial({
          uniforms: pressStreamUniforms,
          vertexShader: /* glsl */ `
            varying float vStreamY;
            varying float vLight;
            void main() {
              vStreamY = clamp((position.y + 0.088) / 0.176, 0.0, 1.0);
              vec3 viewNormal = normalize(normalMatrix * normal);
              vLight = 0.72 + abs(viewNormal.x) * 0.28;
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `,
          fragmentShader: /* glsl */ `
            uniform float uOpacity;
            uniform float uReveal;
            uniform float uDrain;
            uniform vec3 uColor;
            varying float vStreamY;
            varying float vLight;
            void main() {
              // 시작: 위에서 아래로 나타나므로 아직 닿지 않은 하단을 투명하게 한다.
              float revealEdge = 0.95 - uReveal;
              float revealMask = smoothstep(revealEdge - 0.11, revealEdge + 0.11, vStreamY);
              // 종료: 위쪽부터 투명해지고 항아리에 가까운 하단이 마지막에 남는다.
              float drainEdge = 1.14 - uDrain * 1.22;
              float drainMask = 1.0 - smoothstep(drainEdge - 0.10, drainEdge + 0.10, vStreamY);
              float alpha = uOpacity * revealMask * drainMask;
              if (alpha < 0.012) discard;
              gl_FragColor = vec4(uColor * vLight, alpha);
            }
          `,
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
      );
      // 항아리 입구 바로 위까지 이어지는 가는 술줄기.
      pressStream.position.set(0, platformTop + 0.405, 0);
      pressStream.visible = false;
      stageGroup.add(pressStream);

      const PRESS_DROPLET_COUNT = 7;
      const pressDropletMaterial = new THREE.MeshBasicMaterial({
        color: 0xf2ddb0,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      // 7개의 개별 PhysicalMaterial 메시 대신 하나의 인스턴스 메시로 합쳐
      // 드로우콜과 투명 재질 연산을 줄인다.
      const pressDroplets = new THREE.InstancedMesh(
        new THREE.LatheGeometry([
          new THREE.Vector2(0, -0.011),
          new THREE.Vector2(0.0058, -0.009),
          new THREE.Vector2(0.0076, -0.003),
          new THREE.Vector2(0.0072, 0.004),
          new THREE.Vector2(0.0047, 0.011),
          new THREE.Vector2(0.0018, 0.017),
          new THREE.Vector2(0, 0.021),
        ], 16),
        pressDropletMaterial,
        PRESS_DROPLET_COUNT,
      );
      pressDroplets.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      pressDroplets.frustumCulled = false;
      pressDroplets.visible = false;
      stageGroup.add(pressDroplets);
      const pressDropletTransform = new THREE.Object3D();
      const pressDropletStates = Array.from({ length: PRESS_DROPLET_COUNT }, (_, i) => ({
        position: new THREE.Vector3(),
        scale: 0.44 + (i % 3) * 0.04,
        speed: 0.2 + (i % 3) * 0.045,
        alive: false,
      }));
      const syncPressDropletInstances = () => {
        pressDropletStates.forEach((state, i) => {
          pressDropletTransform.position.copy(state.position);
          const scale = state.alive ? state.scale : 0;
          pressDropletTransform.scale.setScalar(scale);
          pressDropletTransform.updateMatrix();
          pressDroplets.setMatrixAt(i, pressDropletTransform.matrix);
        });
        pressDroplets.instanceMatrix.needsUpdate = true;
      };
      syncPressDropletInstances();

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
        if (!pressStream.visible) pressStreamUniforms.uReveal.value = 0;
        pressStream.visible = true;
        pressStreamUniforms.uDrain.value = 0;
        pressStreamUniforms.uOpacity.value = 0.88;
        pressStreamHold = 0.38;
        pressDropletStates.forEach((droplet, i) => {
          droplet.alive = true;
          droplet.position.set(
            Math.sin(i * 2.17) * 0.014,
            platformTop + 0.31 + ((i * 0.037) % 0.2),
            Math.cos(i * 1.63) * 0.012,
          );
        });
        pressDropletMaterial.opacity = 0.9;
        pressDroplets.visible = true;
        syncPressDropletInstances();
        if (pressSplashRing) {
          pressSplashRing.scale.setScalar(0.55);
          (pressSplashRing.material as THREE.MeshBasicMaterial).opacity = 0.72;
        }
        const hapticNow = performance.now();
        if (hapticNow - pressLastHapticAt >= 120) {
          pressLastHapticAt = hapticNow;
          navigator.vibrate?.(8);
        }
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
      let chamberFacingLocked = false;
      const chamberEmissiveInstances: THREE.MeshStandardMaterial[] = [];
      let coldVolumeMaterial: THREE.MeshBasicMaterial | null = null;
      if (agingJarNode) {
        // 5MB가 넘는 항아리를 그림자 맵에 다시 그리면 모바일 회전 시 끊김이
        // 커진다. 저온숙성은 바닥 발광 UI로 접지를 표현하므로 그림자 패스를 뺀다.
        agingJarNode.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          object.castShadow = false;
          object.receiveShadow = false;
        });
        agingJar.add(agingJarNode);
      }
      agingJar.visible = false;
      stageGroup.add(agingJar);

      // 냉장고 앞 중앙의 전경에서 시작한다. 화면 왼쪽으로 치우치지 않아
      // 저온숙성 단계에 진입하자마자 항아리를 바로 확인할 수 있다.
      // Closed_jar는 아래 finishShowShip에서 숨기므로 항아리가 안쪽에
      // 하나 더 겹쳐 보이지 않는다.
      // 항아리의 대기 위치는 무대 중앙에 고정한다. 창고 회전/이동으로 바꾸지 않는다.
      const jarHome = new THREE.Vector3(0, contentY + 0.002, 0.16);
      const jarTarget = new THREE.Vector3(0, contentY + 0.012, -0.085);
      const coldZoneWorld = new THREE.Vector3();
      const jarInColdZone = new THREE.Vector3();
      agingJar.position.copy(jarHome);

      if (chamberEntry) {
        // 원본 GLB의 정면 축이 무대 카메라와 반대여서 열린 문 대신 뒷판이
        // 보였다. 정면을 사용자 쪽으로 돌리되, 화면을 덮지 않도록 사용자
        // 반대쪽으로 충분히 물리고 시야에 들어오는 크기로 조정한다.
        // 요청한 저온창고 깊이. 바닥 UI와 충돌 영역도 자식으로 함께 이동한다.
        // 바닥 UI와 충돌 영역은 chamberEntry의 자식이라 같은 거리만큼 함께 이동한다.
        chamberEntry.group.position.set(0, contentY + 0.002, -0.58);
        // Blender 기준 열린 면(-Y)은 glTF/Three.js 좌표에서 로컬 +Z다.
        // 첫 표시 프레임에서만 이 축을 실제 XR 카메라 쪽으로 맞춘다.
        chamberEntry.group.rotation.y = 0;
        chamberEntry.group.scale.setScalar(1.59);
        // 큰 창고 메시도 그림자 맵에 중복 렌더링하지 않는다. PointLight 대신
        // 재질 자체의 약한 청색 emissive와 발광 볼륨으로 내부 조명을 표현한다.
        // 원본 재질은 모델 캐시에 공유되므로 복제본에만 emissive를 적용한다.
        const chamberEmissiveMaterials = new Map<THREE.Material, THREE.Material>();
        const makeChamberEmissive = (source: THREE.Material) => {
          const cached = chamberEmissiveMaterials.get(source);
          if (cached) return cached;
          const material = source.clone();
          if (material instanceof THREE.MeshStandardMaterial) {
            material.emissive.setHex(0x1d6d91);
            material.emissiveIntensity = 0.68;
            chamberEmissiveInstances.push(material);
          }
          chamberEmissiveMaterials.set(source, material);
          return material;
        };
        chamberEntry.group.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          object.castShadow = false;
          object.receiveShadow = false;
          object.material = Array.isArray(object.material)
            ? object.material.map(makeChamberEmissive)
            : makeChamberEmissive(object.material);
        });

        coldVolumeMaterial = new THREE.MeshBasicMaterial({
          color: 0x56c8ff,
          transparent: true,
          opacity: 0.062,
          depthWrite: false,
          side: THREE.BackSide,
          blending: THREE.NormalBlending,
          toneMapped: false,
        });
        const coldVolume = new THREE.Mesh(
          new THREE.BoxGeometry(0.115, 0.105, 0.075),
          coldVolumeMaterial,
        );
        coldVolume.position.set(0, 0.065, 0.002);
        chamberEntry.group.add(coldVolume);
      }

      // 손 시각 모델용 저비용 충돌체. 창고의 열린 앞면(+Z)은 비워 두고
      // 바닥·천장·좌우 벽·뒤판만 5개의 얇은 박스로 근사한다.
      // grab/배치 판정에는 사용하지 않아 기존 인터랙션 좌표에 영향을 주지 않는다.
      const chamberVisualColliders = chamberEntry
        ? [
            createVisualHandBox([-0.085, 0, -0.06], [-0.0575, 0.145, 0.1], 0.004),
            createVisualHandBox([0.0575, 0, -0.06], [0.085, 0.145, 0.1], 0.004),
            createVisualHandBox([-0.085, 0, -0.06], [0.085, 0.145, -0.0375], 0.004),
            createVisualHandBox([-0.085, 0, -0.06], [0.085, 0.0125, 0.1], 0.004),
            createVisualHandBox([-0.085, 0.1175, -0.06], [0.085, 0.145, 0.1], 0.004),
          ]
        : [];
      chamberVisualColliders.forEach((collider) => {
        collider.enabled = false;
        visualHandColliders.push(collider);
      });
      const syncChamberVisualColliders = () => {
        if (!chamberEntry) return;
        // 창고가 처음 배치되거나 최초 방향 고정이 일어난 프레임에만 갱신한다.
        chamberEntry.group.updateMatrix();
        chamberVisualColliders.forEach((collider) => {
          setVisualHandBoxMatrix(collider, chamberEntry.group.matrix);
        });
      };
      syncChamberVisualColliders();

      // 움직이는 숙성 항아리는 몸통과 뚜껑을 두 타원체로 근사한다.
      // 실제 grab 좌표와는 분리되어 손 모델의 관통만 시각적으로 막는다.
      const agingJarVisualColliders = agingJarNode
        ? [
            createVisualHandEllipsoid([0, 0.115, 0], [0.092, 0.12, 0.092], 0.009),
            createVisualHandEllipsoid([0, 0.225, 0], [0.1, 0.038, 0.1], 0.009),
          ]
        : [];
      agingJarVisualColliders.forEach((collider) => {
        collider.enabled = false;
        visualHandColliders.push(collider);
      });
      const syncAgingJarVisualColliders = () => {
        agingJar.updateMatrix();
        agingJarVisualColliders.forEach((collider) => {
          setVisualHandBoxMatrix(collider, agingJar.matrix);
        });
      };
      syncAgingJarVisualColliders();

      // 냉장고와 함께 회전하는 바닥 목표 영역. 별도 충돌 GLB 대신 이 그룹의
      // 로컬 좌표를 보이지 않는 박스 영역으로 사용한다.
      const coldZoneAnchor = new THREE.Group();
      // 실제 창고 바닥 중심에 맞춰 UI와 충돌 영역을 함께 6mm 오른쪽으로 이동한다.
      coldZoneAnchor.position.set(0.007, 0.006, 0.034);
      (chamberEntry?.group ?? stageGroup).add(coldZoneAnchor);

      const coldTargetTexture = new THREE.TextureLoader().load("/ar/ui/aging-floor-target-v2.png");
      coldTargetTexture.colorSpace = THREE.SRGBColorSpace;
      coldTargetTexture.minFilter = THREE.LinearFilter;
      coldTargetTexture.magFilter = THREE.LinearFilter;
      coldTargetTexture.generateMipmaps = false;
      const coldTarget = new THREE.Mesh(
        // 항아리와 문구는 아래에 유지하고 외곽을 위쪽으로 2배 연장한 UI 비율을 따른다.
        new THREE.PlaneGeometry(0.224, 0.322),
        new THREE.MeshBasicMaterial({
          map: coldTargetTexture,
          color: 0xffffff,
          transparent: true,
          opacity: 0.82,
          alphaTest: 0.05,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -3,
          polygonOffsetUnits: -3,
          blending: THREE.AdditiveBlending,
          side: THREE.FrontSide,
          toneMapped: false,
        })
      );
      coldTarget.rotation.x = -Math.PI / 2;
      // GLB 바닥과 거의 같은 높이면 깊이 버퍼에 묻힌다. 충돌 영역은
      // anchor에 그대로 두고 시각 평면만 약 1.2cm 위로 띄운다.
      coldTarget.position.set(0, 0.012, 0);
      coldTarget.renderOrder = 12;
      coldTarget.visible = false;
      coldZoneAnchor.add(coldTarget);

      // 항아리가 놓인 뒤에는 직사각형 목표 대신 원형 링과 방사형 눈금으로
      // 안정적으로 안착했음을 보여준다.
      const placedIndicator = new THREE.Group();
      placedIndicator.position.y = 0.0145;
      const placedRing = new THREE.Mesh(
        new THREE.RingGeometry(0.06, 0.064, 64),
        new THREE.MeshBasicMaterial({
          color: 0x56c8ee,
          transparent: true,
          opacity: 0.78,
          depthWrite: false,
          blending: THREE.NormalBlending,
          side: THREE.DoubleSide,
          toneMapped: false,
        }),
      );
      placedRing.rotation.x = -Math.PI / 2;
      placedRing.renderOrder = 14;
      placedIndicator.add(placedRing);

      const placedInnerRing = new THREE.Mesh(
        new THREE.RingGeometry(0.053, 0.0555, 64),
        new THREE.MeshBasicMaterial({
          color: 0x6fd6ff,
          transparent: true,
          opacity: 0.42,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
          toneMapped: false,
        }),
      );
      placedInnerRing.rotation.x = -Math.PI / 2;
      placedInnerRing.renderOrder = 14;
      placedIndicator.add(placedInnerRing);

      const tickPoints: THREE.Vector3[] = [];
      for (let i = 0; i < 16; i += 1) {
        const angle = i / 16 * Math.PI * 2;
        const inner = 0.069;
        const outer = i % 4 === 0 ? 0.079 : 0.075;
        tickPoints.push(
          new THREE.Vector3(Math.cos(angle) * inner, 0, Math.sin(angle) * inner),
          new THREE.Vector3(Math.cos(angle) * outer, 0, Math.sin(angle) * outer),
        );
      }
      const placedTicks = new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints(tickPoints),
        new THREE.LineBasicMaterial({
          color: 0xb9efff,
          transparent: true,
          opacity: 0.76,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }),
      );
      placedTicks.renderOrder = 14;
      placedIndicator.add(placedTicks);

      // 실시간 shadow map을 추가하지 않고도 항아리가 바닥에 붙어 보이게 하는
      // 저비용 접지 그림자. 모바일에서 추가 광원/그림자 패스가 생기지 않는다.
      const contactShadowCanvas = document.createElement("canvas");
      contactShadowCanvas.width = contactShadowCanvas.height = 128;
      const contactShadowContext = contactShadowCanvas.getContext("2d");
      if (contactShadowContext) {
        const gradient = contactShadowContext.createRadialGradient(64, 64, 4, 64, 64, 62);
        gradient.addColorStop(0, "rgba(0,8,18,0.72)");
        gradient.addColorStop(0.48, "rgba(0,8,18,0.42)");
        gradient.addColorStop(1, "rgba(0,8,18,0)");
        contactShadowContext.fillStyle = gradient;
        contactShadowContext.fillRect(0, 0, 128, 128);
      }
      const contactShadowTexture = new THREE.CanvasTexture(contactShadowCanvas);
      const agingContactShadow = new THREE.Mesh(
        new THREE.PlaneGeometry(0.22, 0.17),
        new THREE.MeshBasicMaterial({
          map: contactShadowTexture,
          transparent: true,
          opacity: 0.8,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      agingContactShadow.rotation.x = -Math.PI / 2;
      agingContactShadow.position.y = 0.013;
      agingContactShadow.renderOrder = 13;
      agingContactShadow.visible = false;
      coldZoneAnchor.add(agingContactShadow);
      placedIndicator.visible = false;
      coldZoneAnchor.add(placedIndicator);

      // 바닥 UI 전체를 덮는 보이지 않는 3D 충돌 박스. 항아리 중심이 들어오는 즉시
      // 손의 펼침 여부와 관계없이 안착시킨다.
      const coldZoneHalfSize = new THREE.Vector3(0.12, 0.22, 0.17);
      const coldZoneBounds = new THREE.Box3(
        coldZoneHalfSize.clone().multiplyScalar(-1),
        coldZoneHalfSize.clone(),
      );
      const syncJarTargetToColdZone = () => {
        coldZoneAnchor.getWorldPosition(coldZoneWorld);
        stageGroup.worldToLocal(coldZoneWorld);
        jarTarget.copy(coldZoneWorld);
        jarTarget.y = contentY + 0.012;
      };
      chamberEntry?.group.updateMatrixWorld(true);
      syncJarTargetToColdZone();

      // 안착 지점의 강조광도 실제 조명 없이 바닥 Plane의 additive 발광으로
      // 표현한다. 따라서 저온숙성 장면에는 추가 PointLight 계산이 전혀 없다.
      const coldFloorGlowMaterial = new THREE.MeshBasicMaterial({
        color: 0x73cfff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      const coldFloorGlow = new THREE.Mesh(
        new THREE.CircleGeometry(0.09, 40),
        coldFloorGlowMaterial,
      );
      coldFloorGlow.rotation.x = -Math.PI / 2;
      coldFloorGlow.position.y = 0.003;
      coldFloorGlow.renderOrder = 11;
      coldFloorGlow.visible = false;
      coldZoneAnchor.add(coldFloorGlow);

      type AgingPhase = "idle" | "ready" | "holding" | "snapping" | "aging" | "complete";
      let agingPhase: AgingPhase = "idle";
      let agingT = 0;
      let agingHapticSent = false;
      let agingCompleted = false;
      let heldJarDepth = 1;
      const agingGrabGesture = new CurledGrabGesture();
      const agingGrabTarget = new THREE.Vector3();
      const agingGrabOffset = new THREE.Vector3();
      const agingPalmStage = new THREE.Vector3();
      const agingCameraWorld = new THREE.Vector3();
      const jarWorld = new THREE.Vector3();
      const jarGripWorld = new THREE.Vector3();
      const targetWorld = new THREE.Vector3();
      const jarScreen = { x: 0.5, y: 0.5 };
      const jarGripScreen = { x: 0.5, y: 0.5 };
      const targetScreen = { x: 0.5, y: 0.5 };

      const setAgingCopy = (caption: string, hint = "") => {
        const cap = $("#cap-finishing");
        if (cap) cap.textContent = caption;
        const hintNode = $("#finishing-hint");
        if (hintNode) hintNode.textContent = hint;
      };

      const setAgingHandDebug = (text: string) => {
        const node = $("#aging-hand-debug");
        if (node) node.textContent = text;
      };

      const agingCompleteScreen = $(".aging-complete-screen") as HTMLElement | null;
      const advanceFromAgingComplete = (event: PointerEvent) => {
        if (agingPhase !== "complete" || S.press !== agingIndex) return;
        event.preventDefault();
        uiRoot!.classList.remove("aging-complete");
        S.press = Math.min(S.press + 1, PRESS_STEPS.length - 1);
        syncPress();
      };
      agingCompleteScreen?.addEventListener("pointerup", advanceFromAgingComplete);
      live.cleanup.push(() => {
        agingCompleteScreen?.removeEventListener("pointerup", advanceFromAgingComplete);
      });

      const beginAgingSnap = () => {
        agingGrabGesture.reset();
        agingPhase = "snapping";
        agingT = 0;
        // 목표 영역에 안착한 뒤에는 손 판정이 더 필요하지 않다. 완료 연출과
        // 출고 전환 동안 카메라 readback/MediaPipe 추론을 즉시 멈춘다.
        handTracker?.setPaused(true);
        handVisual.hide();
        coldTarget.visible = false;
        placedIndicator.visible = true;
        agingContactShadow.visible = true;
        chamberEmissiveInstances.forEach((material) => {
          material.emissiveIntensity = 1.05;
        });
        if (coldVolumeMaterial) coldVolumeMaterial.opacity = 0.115;
        setHandHud("dropped", "항아리가 빛나는 자리에 놓였습니다");
        setAgingCopy("항아리가 냉장고 안에 자리 잡고 있어요", "낮은 온도에서 천천히 숙성합니다");
        navigator.vibrate?.(28);
      };

      const resetAgingInteraction = () => {
        arDetectMs = IDLE_AGING_DETECT_MS;
        uiRoot!.classList.remove("aging-focus", "aging-complete");
        agingPhase = "ready";
        agingT = 0;
        agingHapticSent = false;
        agingCompleted = false;
        agingGrabGesture.reset();
        agingJar.position.copy(jarHome);
        agingJar.scale.setScalar(1);
        syncAgingJarVisualColliders();
        agingJar.visible = Boolean(agingJarNode);
        coldTarget.visible = true;
        coldTarget.scale.setScalar(1);
        placedIndicator.visible = false;
        agingContactShadow.visible = false;
        chamberEmissiveInstances.forEach((material) => {
          material.emissiveIntensity = 0.68;
        });
        if (coldVolumeMaterial) coldVolumeMaterial.opacity = 0.062;
        coldFloorGlow.visible = true;
        coldFloorGlow.scale.setScalar(1);
        coldFloorGlowMaterial.opacity = 0.14;
        (coldTarget.material as THREE.MeshBasicMaterial).opacity = 0.82;
        setAgingCopy("숙성 항아리를 손으로 감싸 안쪽에 넣어주세요", "손가락 전체를 구부려 항아리를 감싸고 · 빛나는 자리에서 펴세요");
      };

      live.onHand = (frame, hand, interactionCamera) => {
        if (S.press === pressIndex) {
          arDetectMs = ACTIVE_AR_DETECT_MS;
          handlePressHand(frame, hand, interactionCamera);
          return;
        }
        if (S.press !== agingIndex) {
          arDetectMs = ACTIVE_AR_DETECT_MS;
          setAgingHandDebug("AGING HAND · 대기 중");
          return;
        }
        if (agingPhase === "aging" || agingPhase === "snapping" || agingPhase === "complete") {
          arDetectMs = IDLE_AGING_DETECT_MS;
          return;
        }
        if (!frame.present) {
          arDetectMs = agingPhase === "holding" ? ACTIVE_AR_DETECT_MS : IDLE_AGING_DETECT_MS;
          if (agingPhase === "holding") {
            const missingGrab = agingGrabGesture.update(frame, true);
            if (missingGrab.justReleased) agingPhase = "ready";
          }
          setHandHud("idle", "손을 카메라에 비춰 항아리를 감싸 주세요");
          setAgingHandDebug(`AGING HAND · 손 없음\nphase ${agingPhase}`);
          return;
        }

        const palm = hand.palmScreen;
        agingJar.getWorldPosition(jarWorld);
        // 항아리 몸통 하단의 인터랙션 전용 영역. 시각 충돌체와 분리해
        // 새끼손가락이 아래쪽을 감싼 경우에만 grab을 시작한다.
        jarGripWorld.set(0, 0.035, 0);
        agingJar.localToWorld(jarGripWorld);
        coldZoneAnchor.getWorldPosition(targetWorld);
        worldToScreen(jarWorld, interactionCamera, jarScreen);
        worldToScreen(jarGripWorld, interactionCamera, jarGripScreen);
        worldToScreen(targetWorld, interactionCamera, targetScreen);
        // 항아리가 화면에서 크게 보이므로 중심점만 재면 가장자리에 댄 손을 놓친다.
        const nearJar = screenDist(palm, jarScreen) < 0.28;
        const pinky = hand.jointScreen[20];
        const pinkyDx = (pinky.x - jarGripScreen.x) / 0.18;
        const pinkyDy = (pinky.y - jarGripScreen.y) / 0.14;
        const pinkyInGrabZone = pinkyDx * pinkyDx + pinkyDy * pinkyDy <= 1;
        const grab = agingGrabGesture.update(
          frame,
          agingPhase === "holding" || (nearJar && pinkyInGrabZone),
        );

        if (agingPhase === "holding") {
          arDetectMs = ACTIVE_AR_DETECT_MS;
          screenToWorld(palm.x, palm.y, heldJarDepth, interactionCamera, agingGrabTarget);
          stageGroup.worldToLocal(agingGrabTarget);
          agingGrabTarget.add(agingGrabOffset);
          // 손 검출 자체가 72ms 간격이므로 여기서 다시 보간하면 항아리가 계속 뒤처진다.
          // 손 모델과 항아리를 같은 검출 표본의 위치에 즉시 맞춘다.
          agingJar.position.copy(agingGrabTarget);
          syncAgingJarVisualColliders();
          agingJar.getWorldPosition(jarInColdZone);
          coldZoneAnchor.worldToLocal(jarInColdZone);
          const overTarget = coldZoneBounds.containsPoint(jarInColdZone);
          setAgingHandDebug(
            `AGING HAND · ${grab.active ? "GRABBED" : "OPEN"}\n` +
            `curl ${grab.score.toFixed(2)} · target ${overTarget ? "IN" : "OUT"}\n` +
            `box x ${jarInColdZone.x.toFixed(3)} · y ${jarInColdZone.y.toFixed(3)} · z ${jarInColdZone.z.toFixed(3)}`,
          );
          setHandHud("holding", overTarget ? "여기에서 손을 펴 놓아주세요" : "빛나는 자리까지 항아리를 옮겨주세요");
          if (overTarget) {
            beginAgingSnap();
            return;
          }
          if (grab.justReleased) {
            agingPhase = "ready";
            arDetectMs = IDLE_AGING_DETECT_MS;
            setHandHud("tracking", "조금 더 안쪽의 빛나는 자리에 놓아주세요");
          }
          return;
        }

        arDetectMs = nearJar ? ACTIVE_AR_DETECT_MS : IDLE_AGING_DETECT_MS;
        setAgingHandDebug(
          `AGING HAND · ${nearJar ? "NEAR" : "FAR"}\n` +
          `curl ${grab.score.toFixed(2)} · pinky ${pinkyInGrabZone ? "IN" : "OUT"}\n` +
          `distance ${screenDist(palm, jarScreen).toFixed(3)} / 0.280`,
        );
        setHandHud(
          nearJar ? "hover" : "tracking",
          nearJar
            ? pinkyInGrabZone
              ? "새끼손가락을 댄 채 손가락 전체로 감싸세요"
              : "새끼손가락을 항아리 아래쪽에 대주세요"
            : "항아리 가까이 손을 가져가세요",
        );
        if (nearJar && pinkyInGrabZone && grab.justGrabbed) {
          agingPhase = "holding";
          arDetectMs = ACTIVE_AR_DETECT_MS;
          interactionCamera.getWorldPosition(agingCameraWorld);
          heldJarDepth = Math.max(0.45, agingCameraWorld.distanceTo(jarWorld));
          screenToWorld(palm.x, palm.y, heldJarDepth, interactionCamera, agingPalmStage);
          stageGroup.worldToLocal(agingPalmStage);
          agingGrabOffset.copy(agingJar.position).sub(agingPalmStage);
          // 검출 시 손바닥이 이미 항아리 안에 겹쳐 있어도 그 관통 위치를
          // 그대로 보존하지 않는다. 항아리 반지름 바깥의 접촉 거리로 맞춰
          // 손바닥/손가락 외곽에 항아리가 붙은 상태로 이동시킨다.
          if (agingGrabOffset.lengthSq() < 1e-6) {
            agingGrabOffset.set(0.14, 0, 0);
          } else {
            agingGrabOffset.normalize().multiplyScalar(0.14);
          }
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

            // 출고 전환 순간 고용량 병 GLB를 shadow map에 다시 그리지 않는다.
            // 바닥 발광 링이 접지감을 담당하므로 모바일 전환 프레임을 우선한다.
            obj.castShadow = false;
            obj.receiveShadow = false;

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
        agingJarVisualColliders.forEach((collider) => {
          collider.enabled = inAging;
        });
        chamberVisualColliders.forEach((collider) => {
          collider.enabled = inAging;
        });
        const inPress = S.press === pressIndex;
        const pressModelReady = Boolean(pressEntry && LOADED[pressEntry.def.id]);
        if (inPress && pressModelReady && !pressIntroPlayed) {
          // 압착 단계에 들어오자마자 짧은 시범 흐름을 보여줘 이펙트와
          // 조작 방향을 인지시킨다. 이후에는 손/드래그 입력이 수위를 이어 올린다.
          pressIntroPlayed = true;
          pressIntroRemaining = 1.8;
          addPressFill(10);
        }
        // 압착·여과도 다른 완성 공정과 동일한 테이블 인스턴스와 위치를 쓴다.
        // 별도 복제본을 만들면 단계 진입 시 테이블이 다른 위치로 튀어 보인다.
        forceShowFinishBench();
        if (!inPress) {
          pressIntroPlayed = false;
          pressIntroRemaining = 0;
          pressDragging = false;
          pressLastHandY = null;
          pressStream.visible = false;
          pressDropletStates.forEach((droplet) => { droplet.alive = false; });
          pressDroplets.visible = false;
          if (pressSplashRing) {
            (pressSplashRing.material as THREE.MeshBasicMaterial).opacity = 0;
          }
        }
        if (inAging && agingPhase === "idle") {
          chamberFacingLocked = false;
          resetAgingInteraction();
        }
        if (!inAging) {
          chamberFacingLocked = false;
          agingPhase = "idle";
          agingJar.visible = false;
          coldTarget.visible = false;
          placedIndicator.visible = false;
          coldFloorGlow.visible = false;
          coldFloorGlowMaterial.opacity = 0;
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

            // 한두 프레임만 안정화한 뒤, 조금 작고 위쪽에서 빠르게 나타난다.
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
          if (pressIntroRemaining > 0) {
            pressIntroRemaining = Math.max(0, pressIntroRemaining - dt);
            pressFillTarget = THREE.MathUtils.clamp(pressFillTarget + dt * 0.09, 0, 1);
            pressStream.visible = true;
            pressStreamHold = 0.24;
            pressStreamUniforms.uOpacity.value = 0.88;
          }
          pressFill += (pressFillTarget - pressFill) * Math.min(1, dt * 7.5);
          const liquidHeight = THREE.MathUtils.lerp(
            0.001,
            pressSurfaceFullY - PRESS_LIQUID_BOTTOM_Y,
            pressFill,
          );
          const surfaceY = THREE.MathUtils.lerp(pressSurfaceEmptyY, pressSurfaceFullY, pressFill);
          pressSurface.position.y = surfaceY;
          // 수위가 오르는 동안 반경까지 맥동하면 항아리 자체가 흔들리는 것처럼
          // 보이므로 수면 크기는 고정하고 Y축 이동만 적용한다.
          pressSurface.scale.set(1, 1, 1);
          if (pressLiquidVolume) {
            pressLiquidVolume.visible = pressFill > 0.003;
            pressLiquidVolume.scale.y = liquidHeight;
            pressLiquidVolume.position.y = PRESS_LIQUID_BOTTOM_Y + liquidHeight * 0.5;
          }
          if (pressSplashRing) {
            pressSplashRing.position.y = surfaceY + 0.0015;
            pressSplashRing.scale.x += (1.7 - pressSplashRing.scale.x) * Math.min(1, dt * 5.5);
            pressSplashRing.scale.z = pressSplashRing.scale.x;
            const splashMaterial = pressSplashRing.material as THREE.MeshBasicMaterial;
            splashMaterial.opacity = Math.max(0, splashMaterial.opacity - dt * 1.9);
          }
          if (pressStream.visible) {
            pressStreamUniforms.uTime.value = _t;
            pressStreamUniforms.uReveal.value = Math.min(
              1,
              pressStreamUniforms.uReveal.value + dt * 4.2,
            );
            pressStreamHold = Math.max(0, pressStreamHold - dt);
            if (pressStreamHold <= 0) {
              pressStreamUniforms.uDrain.value = Math.min(
                1,
                pressStreamUniforms.uDrain.value + dt * 2.1,
              );
            }
            pressStream.scale.x = 0.88 + Math.sin(_t * 15) * 0.08;
            pressStream.scale.z = 0.84 + Math.sin(_t * 17 + 0.8) * 0.07;
            pressStream.position.x = Math.sin(_t * 7.5) * 0.0018;
            if (pressStreamUniforms.uDrain.value >= 1) pressStream.visible = false;
          }
          if (pressDroplets.visible) {
            pressDropletMaterial.opacity = Math.max(0, pressDropletMaterial.opacity - dt * 1.55);
            let anyDropletAlive = false;
            pressDropletStates.forEach((droplet) => {
              if (!droplet.alive) return;
              droplet.position.y -= dt * droplet.speed;
              if (droplet.position.y <= platformTop + 0.285 || pressDropletMaterial.opacity <= 0.02) {
                droplet.alive = false;
              } else {
                anyDropletAlive = true;
              }
            });
            if (anyDropletAlive) syncPressDropletInstances();
            else pressDroplets.visible = false;
          }
        }
        if (chamberEntry?.group.visible && !chamberFacingLocked) {
          const viewCamera = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
          viewCamera.getWorldPosition(chamberCameraInStage);
          stageGroup.worldToLocal(chamberCameraInStage);

          const dx = chamberCameraInStage.x - chamberEntry.group.position.x;
          const dz = chamberCameraInStage.z - chamberEntry.group.position.z;
          // Ry(yaw)로 변환된 로컬 +Z가 (dx, dz)를 향하도록 한다.
          chamberEntry.group.rotation.y = Math.atan2(dx, dz);
          chamberEntry.group.updateMatrixWorld(true);
          syncChamberVisualColliders();
          syncJarTargetToColdZone();
          chamberFacingLocked = true;
        }

        if (S.press === agingIndex && agingPhase !== "idle") {
          if (placedIndicator.visible) {
            const placedPulse = 0.62 + Math.sin(_t * 3.4) * 0.1;
            (placedRing.material as THREE.MeshBasicMaterial).opacity = 0.48 + placedPulse * 0.28;
            (placedInnerRing.material as THREE.MeshBasicMaterial).opacity = 0.3 + placedPulse * 0.22;
            (placedTicks.material as THREE.LineBasicMaterial).opacity = 0.36 + placedPulse * 0.3;
            placedIndicator.scale.setScalar(1 + Math.sin(_t * 3.4) * 0.035);
            (agingContactShadow.material as THREE.MeshBasicMaterial).opacity = 0.72 + placedPulse * 0.12;
          }

          if (agingPhase === "ready") {
            agingJar.position.lerp(jarHome, 0.1);
            syncAgingJarVisualColliders();
          } else if (agingPhase === "snapping") {
            agingT += dt;
            agingJar.position.lerp(jarTarget, Math.min(1, dt * 8.5));
            agingJar.scale.lerp(new THREE.Vector3(0.94, 0.94, 0.94), Math.min(1, dt * 7));
            syncAgingJarVisualColliders();
            coldFloorGlowMaterial.opacity += (0.72 - coldFloorGlowMaterial.opacity) * Math.min(1, dt * 8);
            coldFloorGlow.scale.setScalar(1.02 + Math.sin(_t * 5.2) * 0.035);
            if (agingJar.position.distanceTo(jarTarget) < 0.008 || agingT > 0.75) {
              agingJar.position.copy(jarTarget);
              agingJar.scale.setScalar(0.94);
              syncAgingJarVisualColliders();
              agingPhase = "aging";
              agingT = 0;
              uiRoot!.classList.add("aging-focus");
              setAgingCopy("효모를 잠재워 깔끔하고 깊은 맛으로 변합니다.");
            }
          } else if (agingPhase === "aging") {
            agingT += dt;
            const progress = THREE.MathUtils.clamp(agingT / 3.2, 0, 1);
            chamberEmissiveInstances.forEach((material) => {
              material.emissiveIntensity = 1.05 + Math.sin(_t * 2.2) * 0.12;
            });
            if (coldVolumeMaterial) coldVolumeMaterial.opacity = 0.105 + Math.sin(_t * 2.2) * 0.018;
            coldFloorGlowMaterial.opacity = 0.5 + Math.sin(_t * 2.6) * 0.1;
            coldFloorGlow.scale.setScalar(1.04 + Math.sin(_t * 2.6) * 0.025);
            agingJar.position.y = jarTarget.y + Math.sin(_t * 1.8) * 0.002;
            syncAgingJarVisualColliders();
            if (progress >= 1 && !agingCompleted) {
              agingCompleted = true;
              agingPhase = "complete";
              coldFloorGlowMaterial.opacity = 0.82;
              coldFloorGlow.scale.setScalar(1.08);
              uiRoot!.classList.remove("aging-focus");
              uiRoot!.classList.add("aging-complete");
              // 검은 완료 화면에서는 손 입력이 필요 없다. 출고 단계의 첫 프레임까지
              // 카메라 readback/MediaPipe 추론을 즉시 멈춰 전환 여유를 확보한다.
              handTracker?.setPaused(true);
              handVisual.hide();
              setAgingCopy("");
              if (!agingHapticSent) {
                agingHapticSent = true;
                navigator.vibrate?.([32, 45, 42]);
              }
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
          const fx = THREE.MathUtils.clamp((t - 0.48) / 0.5, 0, 1);
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
          if (t >= 0.92) {
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
          
          optionalFeatures: ["dom-overlay", "camera-access", "anchors"],
          
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
    handVisual.attachTo(scene);
    // 영상이 화면에 cover 로 잘리는 것을 보정하는 값 — 매 프레임 화면 크기로 다시 잰다
    let handFit: CoverFit = { scaleX: 1, scaleY: 1, offX: 0, offY: 0 };
    // AR 모드에서 XR 카메라 이미지를 내려받는 도구 (camera-access 를 받았을 때만 만든다)
    let xrFeed: XrCameraFeed | null = null;
    let lastDetectAt = 0;
    /**
     * AR 모드 손 검출 간격(ms). 카메라 이미지를 GPU 에서 내려받는 비용이 있어
     * 매 프레임 하면 3D 가 눈에 띄게 느려진다. 이 정도면 집는 조작에 충분하다.
     */
    // 항아리를 잡는 동안만 반응성을 높이고, 탐색 중에는 추론 빈도를 낮춰
    // 카메라 회전과 3D 렌더링에 GPU 시간을 더 배분한다.
    const ACTIVE_AR_DETECT_MS = 72;
    const IDLE_AGING_DETECT_MS = 132;
    let arDetectMs = ACTIVE_AR_DETECT_MS;

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
        // 온도 조절 없이 약 17초 동안 일정한 속도로 후발효를 진행한다.
        const rate = 6;
        S.ferment = Math.min(100, S.ferment + rate * dt);
        S.tempLog.push(S.temp);
        onFermentTick();
      }




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
        let handSampleUpdated = false;
        const xrCam = (frame as any).getViewerPose?.(localSpace)?.views?.[0]?.camera;
        if (xrCam) {
          const now = performance.now();

          if (now - lastDetectAt >= arDetectMs) {
            lastDetectAt = now;
            const tex = renderer.xr.getCameraTexture(xrCam);
            if (tex) {
              const shot = xrFeed.capture(renderer, tex as any, xrCam.width, xrCam.height);
              if (shot) {
                handTracker.detect(shot, now);
                handSampleUpdated = true;
              }
            }
          }
          handFit = coverFit(xrCam.width, xrCam.height, canvas!.clientWidth, canvas!.clientHeight);
        }

        const f = handTracker.latest;



        // 무대까지의 거리 — 오클루더를 그 앞에 놓고, 집어 든 물건 거리의 기준으로도 쓴다
        const stageAt = handCamera.getWorldPosition(handOrigin).distanceTo(anchor.position);
        handVisual.update(f, handCamera, handFit, Math.max(stageAt, 0.2), visualHandCollision);
        // 손이 사라진 프레임도 그대로 넘긴다 — 잡고 있던 물건을 놓아야 하기 때문
        // 항아리 충돌 판정과 월드/화면 좌표 변환은 새 손 검출 결과가 생긴
        // 프레임에서만 수행한다. 같은 결과를 60fps로 반복 계산할 필요가 없다.
        if (handSampleUpdated) {
          live.onHand?.(f, handVisual, handCamera);
          handTracker.consumeEdges();
        }
      } else if (!S.hand) {
        handVisual.hide();
      }

      live.mixers.forEach((m) => m.update(dt));
      if (live.tick) live.tick(t, dt);
      live.particles.forEach((p) => updateParticles(p, dt));
      if (!S.xr) controls.update();

      // AR 콘텐츠와 손 모델은 같은 Scene/깊이 버퍼에서 한 번에 렌더링한다.
      // 이후 깊이의 영향을 받지 않아야 하는 조작 커서만 가벼운 별도 패스로 그린다.
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
          (extras.length ? "좋아, 주원료에 부재료까지 갖췄네. " : "좋아, 주원료가 다 모였네. ") + recipe.ingredientsReady,
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
        b.dataset.stepId = st.id;
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
              : rinseActive()
                ? "손을 둥글게 돌려 쌀을 헹궈주세요"
                : soakActive()
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
        S.mashTrayDone.clear();
        setStep("ferment");
        onFermentTick();
        syncFermentPhase();
      };

    /* --- 14 · 발효 --- */
    /* 담금·발효 타임라인 핀 — 탭을 눌러 혼합 → 1차발효 → 덧술 순으로 넘어간다.
       마지막 '후발효'에 이르면 항아리가 나타나고 시간에 따라 자동 발효된다. */
    const F_LAST = FERMENT_STEPS.length - 1; // 후발효 인덱스
    const fpills = $("#ferment-pills");
    if (fpills) {
      fpills.innerHTML = "";
      FERMENT_STEPS.forEach((st, i) => {
        const b = document.createElement("button");
        b.className = "pill";
        b.dataset.idx = String(i);
        b.dataset.stepId = st.id;
        b.textContent = st.name;
        b.onclick = () => {
          if (i !== S.fstage) return;   // 지금 켜진 단계만 누를 수 있다
          if (i >= F_LAST) return;       // 후발효는 클릭이 아니라 발효로 완료된다
          if (S.hand && st.id.startsWith("mash") && !S.mashTrayDone.has(st.id)) {
            showNotice("채반 앞쪽을 잡고 몸 쪽으로 당겨 먼저 꺼내 주세요.");
            return;
          }
          S.fstage = i + 1;
          syncFermentPhase();
        };
        fpills.appendChild(b);
      });
    }
    // 후발효(fstage 3)에서만 항아리 자동 발효가 돈다. 그 전엔 탭으로만 진행.
    function syncFermentPhase() {
      fermentShowStage?.(); // 혼합=채반+고두밥 / 1차발효~=항아리
      $$("#ferment-pills .pill").forEach((p, i) => {
        (p as HTMLElement).dataset.state = i < S.fstage ? "done" : i === S.fstage ? "now" : "todo";
      });
      const active = S.fstage >= F_LAST; // 후발효 진행 중
      const current = FERMENT_STEPS[Math.min(S.fstage, F_LAST)];
      $("#mash2-skip")?.classList.toggle("hidden", active || current?.id !== "mash2");
      const mashActive = current?.id.startsWith("mash") === true;
      $("#ferment-game")?.classList.toggle("hidden", !active && !mashActive);
      $("#btn-ferment")?.classList.toggle("hidden", !active);
      if (active) onFermentTick();       // 후발효: 일차·원형 게이지·버튼 갱신
      else {
        const cap = $("#cap-ferment");
        if (cap) {
          cap.textContent = current.id === "mash2"
            ? "술덧을 한 차례 더 넣어주세요"
            : current.id.startsWith("mash") && !S.mashTrayDone.has(current.id)
              ? `${current.name} · 채반을 잡고 몸 쪽으로 당겨 꺼내세요`
              : current.caption;
        }
      }
    }
    function onFermentTick() {
      const day = Math.min(30, 1 + Math.floor(S.ferment / 3.4));
      fermentUpdateGauge?.(S.ferment, day);
      const cap = $("#cap-ferment");
      if (cap) cap.textContent = "";
      const masterMessage = $("#msg-ferment");
      if (masterMessage)
        masterMessage.textContent =
          S.ferment >= 100
            ? "후발효가 완료되었습니다"
            : S.ferment < 40
              ? "밀봉된 항아리 안에서 천천히 익어가요"
              : S.ferment < 80
                ? "향과 탄산감이 차분히 자리 잡고 있어요"
                : "기포가 잦아들며 풍미가 깊어지고 있어요";
      const b = $("#btn-ferment") as HTMLButtonElement | null;
      if (b) {
        b.disabled = S.ferment < 100;
        b.textContent = S.ferment < 100 ? "삼십여 일, 후발효가 무르익는 중…" : "잘 익은 술을 걸러낼게요";
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
        // 단계별 아이콘 CSS가 정확한 공정에 적용되도록 id를 DOM에 노출한다.
        b.dataset.stepId = st.id;
        b.textContent = st.name;
        b.onclick = () => {
          if (i !== S.press) return; // 지금 켜진 단계만 누를 수 있다
          if (i === PRESS_STEPS.length - 1) {
            return;
          }
          if (PRESS_STEPS[i]?.id === "aging") {
            // 후발효는 항아리 배치와 30일 연출이 끝난 뒤 자동 진행된다.
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
      // 압착·여과의 짜기 동작과 저온숙성의 항아리 옮기기에서 손 입력을 사용한다.
      // 출고 연출에서는 다시 멈춰 렌더링 여유를 확보한다.
      handTracker?.setPaused(cur?.id !== "press" && cur?.id !== "aging");
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
        S.temp = OPTIMAL_C;
        S.ferment = 0;
        S.fstage = 0;
        S.mashTrayDone.clear();
        S.press = 0;
        S.tempLog = [];
        uiRoot!.classList.remove("shipped");
        $$(".card").forEach((c) => c.setAttribute("aria-pressed", "false"));
        $("#quiz")?.classList.add("hidden");
        $$("#quiz .choice").forEach((c) => c.classList.remove("ok", "no"));
        syncIngredient();
        syncGodubap();
        onFermentTick();
        syncFermentPhase();
        syncPress();
        setStep("ingredient");
      };
    }

    /* =========================================================
     * TEMP DEBUG — 압착·여과 직전 이동 버튼 연결
     * 나중에 삭제
     * ======================================================= */
  
    const debugSkipBtn = $("#debug-skip-before-press");

    if (debugSkipBtn) {
      (debugSkipBtn as HTMLButtonElement).onclick =
        debugSkipToBeforePress;
    }

    const debugSkipBeforeFirstMashBtn = $("#debug-skip-before-first-mash");

    if (debugSkipBeforeFirstMashBtn) {
      (debugSkipBeforeFirstMashBtn as HTMLButtonElement).onclick =
        debugSkipToBeforeFirstMash;
    }

    const mash2SkipBtn = $("#btn-skip-mash2");
    if (mash2SkipBtn) {
      (mash2SkipBtn as HTMLButtonElement).onclick = () => {
        if (FERMENT_STEPS[S.fstage]?.id !== "mash2") return;
        S.mashTrayDone.add("mash2");
        S.fstage = Math.min(F_LAST, S.fstage + 1);
        setHandHud("dropped", "덧술2 과정을 건너뛰었어요");
        syncFermentPhase();
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

      <div id="mash2-skip" className="mash2-skip hidden">
        <button id="btn-skip-mash2" type="button">
          <span>같은 과정 건너뛰기</span>
          <strong aria-hidden="true">»</strong>
        </button>
        <p>덧술 1과 같은 과정이에요</p>
      </div>

      {/* TEMP DEBUG — 개발 완료 후 삭제 */}
      <button
        id="debug-skip-before-press"
        type="button"
        style={{
          position: "absolute",
          top: 174,
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
        DEV · 압착·여과 직전
      </button>

      <button
        id="debug-skip-before-first-mash"
        type="button"
        style={{
          position: "absolute",
          top: 218,
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
        DEV · 덧술1 직전
      </button>

      <pre
        id="aging-hand-debug"
        aria-live="polite"
        style={{
          position: "absolute",
          top: 262,
          right: 12,
          zIndex: 9999,
          minWidth: 190,
          margin: 0,
          padding: "8px 10px",
          borderRadius: 8,
          border: "1px solid rgba(141,225,255,0.5)",
          background: "rgba(0,12,20,0.78)",
          color: "#b9efff",
          fontSize: 10,
          lineHeight: 1.45,
          fontFamily: "monospace",
          pointerEvents: "none",
          whiteSpace: "pre-wrap",
        }}
      >
        AGING HAND · 대기 중
      </pre>


      {/* 냉각 단계 가장자리 어둡게(비네트) — .cooling 일 때만 보인다 */}
      <div className="vignette" />

      {/* 저온숙성 완료 뒤 출고로 넘어가기 전의 독립 전환 화면 */}
      <div className="aging-complete-screen" role="status" aria-live="polite">
        <span>1개월 후</span>
        <strong>저온숙성이<br />완료되었습니다</strong>
        <small>화면을 터치해 계속하기</small>
      </div>

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
        <div className="fill">
          <div className="caption" id="cap-ferment">{recipe.fermentSteps[0]?.caption}</div>
        </div>
        <div className="dock">
          <div id="mash-tray-place-guide" className="mash-tray-place-guide hidden" aria-live="polite">
            <img src="/ar/ui/mash-tray-place-card.jpg" alt="채반을 바닥 가이드 위에 내려놓는 모습" />
            <div>
              <strong>바닥 가이드 위에<br />채반을 놓아주세요</strong>
              <span>모서리가 초록색이 되면 배치 완료</span>
            </div>
          </div>
          <div className="hand-hud" data-state="idle">
            <span className="lamp" />
            <span className="hand-hud-msg">손을 카메라에 비춰 주세요</span>
          </div>
          <div id="ferment-game" className="hidden">
            <div className="coach" id="coach-ferment">
              <div className="avatar" />
              <div>
                <div className="who">술도가 장인</div>
                <div className="msg" id="msg-ferment" aria-live="polite">밀봉된 항아리 안에서 천천히 익어가요</div>
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
