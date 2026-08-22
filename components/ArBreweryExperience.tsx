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
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { clone as skinnedClone } from "three/addons/utils/SkeletonUtils.js";
import type { Recipe, ModelDef, ArStep, Ingredient } from "@/lib/brewery/types";
import { HandTracker } from "@/lib/hand/handTracker";
import { HandVisual, coverFit, screenDist, screenToWorld, toScreen, worldToScreen, type CoverFit } from "@/lib/hand/handVisual";
import type { HandFrame } from "@/lib/hand/types";
import { FanGesture } from "@/lib/hand/fanGesture";
import { StirGesture } from "@/lib/hand/stirGesture";
import { TRAY_PULL, TrayPullGesture, type TrayPullSnapshot } from "@/lib/hand/trayPullGesture";
import { ShakeGesture } from "@/lib/hand/shakeGesture";
import {
  RICE_SPREAD,
  RiceSpreadGesture,
  palmCenter,
  type RiceSpreadSnapshot,
} from "@/lib/hand/riceSpreadGesture";
import { KNEAD, KneadGesture, kneadHandMetric, type KneadSnapshot } from "@/lib/hand/kneadGesture";
import { markObtained } from "@/lib/dex";
import { XrCameraFeed } from "@/lib/hand/xrCameraFeed";
import { styles } from "@/components/arBreweryStyles";
import { shouldTrackHand } from "@/lib/hand/handStep";
import { CurledGrabGesture } from "@/lib/hand/curledGrabGesture";

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
    const mitsulFermentDebug = query.get("mitsulFermentDebug") === "1";
    const skipToCooling = trayDebug && query.get("skipTo") === "cooling";
    const skipToRiceSpread = riceSpreadDebug && query.get("skipTo") === "riceSpread";
    const skipToKnead = kneadDebug && query.get("skipTo") === "knead";
    const skipToMitsulMix = mitsulMixDebug && query.get("skipTo") === "mitsulMix";
    const skipToMitsulFerment = mitsulFermentDebug && query.get("skipTo") === "mitsulFerment";
    /** debug query가 없을 때는 검증된 냉각①~④를 실제 공정으로 사용한다. */
    const productionCooling = !trayDebug && !riceSpreadDebug;
    const productionMitsulMix = mitsulMixDebug || (!trayDebug && !riceSpreadDebug && !kneadDebug);
    uiRoot.classList.toggle("tray-debug", trayDebug);
    uiRoot.classList.toggle("rice-spread-debug", riceSpreadDebug);
    uiRoot.classList.toggle("knead-debug", kneadDebug);
    uiRoot.classList.toggle("mitsul-mix-debug", mitsulMixDebug);
    uiRoot.classList.toggle("mitsul-ferment-debug", mitsulFermentDebug);

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
    /** 덧술이 시작되는 발효 하위 단계. 여기서부터 무대가 밑술에서 덧술로 넘어간다. */
    const MASH_FIRST_STAGE = 2;

    // 완성 공정 타임라인 — 발효가 끝난 뒤 손으로 마무리하는 단계들(클릭해 진행).
    const PRESS_STEPS = recipe.pressSteps;

    /** 고두밥을 다 식히는 데 필요한 부채질 횟수 */
    const REQUIRED_FANS = 5;
    /** 쌀을 다 헹구는 데 필요한 휘젓기 바퀴 수 */
    const REQUIRED_RINSE_TURNS = 3;
    /** 침수 상태로 기다리는 시간 */
    const SOAK_MS = 4500;
    /** 소쿠리를 털어 물을 다 빼는 데 필요한 횟수 */
    const REQUIRED_SHAKES = 6;
    /**
     * 한 국면을 끝낸 뒤 다음으로 자동으로 넘어가기까지 두는 여유.
     * "다 됐다"를 눈으로 확인할 틈은 줘야 넘어간 걸 알아챈다.
     */
    const STAGE_HOLD_MS = 1800;
    /** 탈수만은 조금 더 오래 보여준다 — 물이 빠진 소쿠리를 확인할 틈이 필요하다 */
    const DRAIN_HOLD_MS = 3600;
    /** 뚜껑을 덮고 김이 오르는 시간 — 다 차면 냉각으로 넘어간다 */
    const STEAM_MS = 7000;
    /** 재료 하나를 다 붓는 데 걸리는 시간 */
    const POUR_MS = 1300;

    /** 원료 고르기 무대에 3D 그릇으로 놓이는 주원료들 */
    const PROP_INGREDIENTS = recipe.ingredients.filter((i) => i.prop);
    /** 그릇 모델도 다른 모델과 같은 방식으로 미리 받아 둔다 */
    const PROP_MODELS: ModelDef[] = PROP_INGREDIENTS.map((i) => ({
      id: `prop_${i.id}`,
      file: i.prop!.file,
      step: "ingredient",
      height: i.prop!.height,
      y: 0.03,
      scaleFactor: i.prop!.scaleFactor,
    }));
    const BASIN_MODEL = recipe.ingredientBasin;

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
      coolingPhase: "TRAY_PULL" as "TRAY_PULL" | "RICE_SPREAD" | "QUIZ" | "FAN" | "COMPLETE",
      coolTrayProgress: 0,
      coolRiceProgress: 0,
      /** 냉각④ 부채질까지 끝나 고두밥 냉각이 완료됐는가 */
      coolDone: false,
      /** 세미를 다 끝낸 시각 — 여기서 잠깐 쉬었다가 침수로 넘어간다 */
      rinseDoneAt: 0,
      /** 탈수 — 소쿠리를 턴 횟수와 물이 빠진 정도(0~1) */
      shakes: 0,
      drain: 0,
      drainDoneAt: 0,
      /** 증자 — 뚜껑을 덮은 시각 (0이면 아직 안 덮었다) */
      lidAt: 0,
      quizDone: false,
      temp: OPTIMAL_C,
      ferment: 0,
      fstage: 0,
      mashTrayDone: new Set<string>(),
      mitsulPhase: "RICE" as "RICE" | "NURUK" | "WATER" | "KNEAD" | "COMPLETE",
      mitsulPourProgress: 0,
      mitsulRiceScoops: 0,
      mitsulKneadCount: 0,
      mitsulDone: false,
      mitsulFermentPhase: "LID" as "LID" | "TEMPERATURE" | "FERMENTING" | "COMPLETE",
      mitsulLidSnapped: false,
      mitsulFermentProgress: 0,
      mitsulFermentDay: 0,
      mitsulFermentDone: false,
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

    // 고두밥 하위 단계가 바뀔 때 무대 모델을 갈아 끼우는 함수(buildGodubap 이 채운다)
    let godubapShowStage: (() => void) | null = null;
    let resetCoolingInteraction: (() => void) | null = null;
    let startCoolingFan: (() => void) | null = null;
    let resetKneadInteraction: (() => void) | null = null;
    let resetMitsulMixInteraction: (() => void) | null = null;
    let resetMitsulFermentInteraction: (() => void) | null = null;
    let startMitsulFermentation: (() => void) | null = null;
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

    /** 다 헹구고 "이제 담가 둔다"로 넘어가기 전의 짧은 여유 */
    function rinseSettling() {
      return S.hand && S.godubap === 0 && S.rinseTurns >= REQUIRED_RINSE_TURNS;
    }

    /** 지금이 물에 불리는 중인가 (침수) — 손은 필요 없고 시간만 흐르면 된다 */
    function soakActive() {
      return S.hand && S.godubap === 1;
    }

    /** 지금이 소쿠리를 털어 물을 빼야 하는가 (탈수) */
    function drainActive() {
      return S.hand && S.godubap === 2 && S.shakes < REQUIRED_SHAKES;
    }

    /** 다 털고 증자로 넘어가기 전의 짧은 여유 */
    function drainSettling() {
      return S.hand && S.godubap === 2 && S.shakes >= REQUIRED_SHAKES;
    }

    /** 지금이 뚜껑을 덮어야 하는가 (증자) */
    function steamingStep() {
      return S.godubap === 3;
    }

    function coolingActive() {
      return S.hand && S.godubap === GB_LAST && S.coolingPhase === "FAN" && S.quizDone && !S.coolDone;
    }

    function resetIngredientSelection() {
      S.selected.clear();
      resetIngredientUi();
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
        ...(next === "ingredient" ? [...(BASIN_MODEL ? [BASIN_MODEL] : []), ...PROP_MODELS] : []),
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

    /** TEMP DEBUG — 후발효 바로 전 단계로 이동 */
    async function debugSkipToBeforePostFermentation() {
      S.placed = true;
      anchor.visible = true;
      S.fstage = Math.max(0, FERMENT_STEPS.length - 2);
      S.ferment = 0;
      setStep("ferment");

      // 초기 로딩 중에도 발효 무대가 비지 않도록 필요한 모델을 먼저 받는다.
      const debugModels = MODELS.filter(
        (model) => model.id === "low_wooden_bench" || model.step === "ferment"
      );
      await Promise.all(debugModels.map(loadModel));
      if (S.step === "ferment" && S.fstage === Math.max(0, FERMENT_STEPS.length - 2)) {
        buildStageFor("ferment");
        syncFermentPhase();
      }

      console.log(
        "[DEBUG] 후발효 직전으로 이동",
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
    const DEBUG_TRAY_ID = "__tray_pull_debug";
    const DEBUG_TRAY_FILE = "/ar/3d-assets/metal_tray.glb";
    const MITSUL_JAR_ID = "__mitsul_jar_body";
    const MITSUL_JAR_FILE = "/ar/3d-assets/jar_body_optimized.glb";
    const MITSUL_LID_ID = "__mitsul_jar_lid";
    const MITSUL_LID_FILE = "/ar/3d-assets/jar_lid_optimized.glb";

    // 3D 에셋은 Draco 로 압축해 두었다 (원료~증자 기준 6.6MB → 0.6MB).
    // 디코더는 scripts/copy-draco.mjs 가 dev·build 때 public/draco/ 에 넣어 둔다.
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath("/draco/");
    dracoLoader.preload();
    gltfLoader.setDRACOLoader(dracoLoader);

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
      const initial = [
        ...MODELS.filter((m) => m.id === "low_wooden_bench" || m.step === "ingredient"),
        ...(BASIN_MODEL ? [BASIN_MODEL] : []),
        ...PROP_MODELS,
      ];
      await Promise.all(initial.map(loadModel));
    }

    /**
     * 레시피에 없는 별도 에셋 — 냉각 채반과 밑술 항아리.
     * 해당 단계를 켰을 때만 받는다.
     */
    async function preloadExtraModels() {
      const extras: Promise<unknown>[] = [];
      const load = (id: string, file: string, what: string) =>
        gltfLoader.loadAsync(file)
          .then((gltf) => { LOADED[id] = gltf; })
          .catch((e: unknown) => console.warn(
            `${what} 로드 실패:`, file, e instanceof Error ? e.message : e
          ));
      if (trayDebug || riceSpreadDebug || productionCooling) {
        extras.push(load(DEBUG_TRAY_ID, DEBUG_TRAY_FILE, "냉각 채반"));
      }
      if (productionMitsulMix) {
        extras.push(load(MITSUL_JAR_ID, MITSUL_JAR_FILE, "밑술 항아리"));
        extras.push(load(MITSUL_LID_ID, MITSUL_LID_FILE, "밑술 항아리 뚜껑"));
      }
      await Promise.all(extras);
    }

    async function preloadRemainingModels() {
      const all = [
        ...MODELS,
        ...(BASIN_MODEL ? [BASIN_MODEL] : []),
        ...PROP_MODELS,
        ...GODUBAP_MODELS,
        ...(FINISH_MODEL ? [FINISH_MODEL] : []),
      ];
      const rest = all
        .filter((m, i) => all.findIndex((x) => x.id === m.id) === i && !LOADED[m.id])
        // 가장 큰 Closed_jar는 마지막에 받아 앞 단계 자산의 네트워크를 막지 않게 한다.
        .sort((a, b) => Number(a.id === "closed_jar") - Number(b.id === "closed_jar"));
      for (const model of rest) await loadModel(model);
    }

    /**
     * 그릇 모델에 **미리 담겨 있는 내용물**을 찾아낸다.
     *
     * 쌀이 수북이 담긴 채로 만들어진 그릇이 여럿이라, 이걸 걷어내지 않으면
     * 우리가 코드로 그리는 물·쌀알이 그 속에 파묻혀 아무것도 안 보인다.
     * 붓고 난 그릇을 비워 보이게 하는 데에도 같은 목록을 쓴다.
     *
     * 기준은 두 가지다 — GPU 인스턴싱으로 흩뿌려 둔 알갱이, 그리고 그릇 위쪽
     * 절반에만 떠 있는(=담긴 것일 수밖에 없는) 메시.
     */
    function vesselContents(root: THREE.Object3D): THREE.Object3D[] {
      const box = new THREE.Box3().setFromObject(root);
      const midY = (box.min.y + box.max.y) / 2;
      const partBox = new THREE.Box3();
      const found: THREE.Object3D[] = [];
      root.traverse((o: any) => {
        if (!o.isMesh) return;
        if (o.isInstancedMesh) {
          found.push(o);
          return;
        }
        partBox.setFromObject(o);
        if (partBox.min.y > midY) found.push(o);
      });
      return found;
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

      // 미리 담겨 있는 내용물은 크기는 원본 그대로 두고(정규화가 흔들리지 않게) 보이기만 끈다.
      if (def.hollow) vesselContents(root).forEach((o) => (o.visible = false));

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
      platformNode = null;
      live.cleanup.forEach((dispose) => dispose());
      live.cleanup.length = 0;
      live.tick = null;
      live.onHand = null;
      godubapShowStage = null;
      resetCoolingInteraction = null;
      startCoolingFan = null;
      resetKneadInteraction = null;
      resetMitsulMixInteraction = null;
      resetMitsulFermentInteraction = null;
      startMitsulFermentation = null;
      finishShowShip = null;
      fermentShowStage = null;
      fermentUpdateGauge = null;
      // 단계 전환 뒤 이전 장면의 화면 효과가 남지 않도록 모두 초기화한다.
      uiRoot!.classList.remove("cooling", "aging-focus", "aging-complete");
      uiRoot!.classList.remove("cooling"); // 냉각 비네트는 무대가 바뀌면 끈다
      uiRoot!.classList.remove("mitsul-no-hands");
    }

    
    /**
     * 직전에 놓은 받침대.
     * 증자처럼 받침대를 치우고 바닥에 화덕을 놓는 국면에서 통째로 감추는 데 쓴다.
     */
    let platformNode: THREE.Object3D | null = null;

    /** 받침대를 감추거나 되살린다 */
    function setPlatformVisible(on: boolean) {
      if (platformNode) platformNode.visible = on;
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
        platformNode = root;


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
      platformNode = fallbackMesh;
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

    /**
     * 3D 무대에 띄우는 이름표.
     * 후발효 일수 게이지와 같은 방식 — 캔버스에 그려 평면에 입히고, 늘 화면을 마주보게 한다.
     */
    function makeLabelPlane(text: string, worldHeight: number): THREE.Mesh {
      const FONT = "700 72px serif";
      const PAD = 26;
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      // 글자 수에 맞춰 캔버스를 잡는다. 고정 폭에 그리면 긴 이름이 잘리거나
      // 짧은 이름이 여백만 잔뜩 차지해 글자가 작아 보인다.
      let textW = 200;
      if (ctx) {
        ctx.font = FONT;
        textW = Math.ceil(ctx.measureText(text).width);
      }
      canvas.width = textW + PAD * 2;
      canvas.height = 120;
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = FONT;
        // 어두운 무대에서도 읽히도록 글자 뒤에 그늘을 깐다
        ctx.shadowColor = "rgba(20,12,6,0.95)";
        ctx.shadowBlur = 18;
        ctx.fillStyle = "rgba(24,16,8,0.9)";
        ctx.fillText(text, canvas.width / 2, 64);
        ctx.shadowBlur = 8;
        ctx.fillStyle = "#f8efdb";
        ctx.fillText(text, canvas.width / 2, 60);
      }
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(worldHeight * (canvas.width / canvas.height), worldHeight),
        new THREE.MeshBasicMaterial({
          map: texture, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
        })
      );
      // 재료나 담금 그릇에 가리지 않고 늘 읽혀야 한다
      mesh.material.depthTest = false;
      mesh.renderOrder = 30;
      live.cleanup.push(() => texture.dispose());
      return mesh;
    }

    /* --- 12 · 원료 --- */
    let ingredientNodes: THREE.Group[] = [];

    /**
     * 원료 고르기.
     *
     * 가운데 큰 담금 그릇을 두고, 그 둘레에 재료 그릇을 놓는다.
     * 그릇을 엄지와 검지로 집어 그릇 위로 가져가면 기울어지며 내용물이 쏟아지고,
     * 담금 그릇 안에 그만큼 쌓인다.
     * 누룩은 덩어리라 붓지 않는다 — 그릇 안에 갖다 넣기만 하면 된다.
     */
    function buildIngredients() {
      const nameOf = (id: string) => INGREDIENTS.find((i) => i.id === id)?.name ?? "재료";

      const platformTop = addPlatform();       // 실제 상판 높이를 받음
      placeModelsForStep("ingredient", stageGroup, platformTop);

      // 3D 모드에서는 정면에서 보면 항아리 옆에 놓인 재료가 서로 겹쳐 보인다.
      // 대각선 위에서 내려다보며, 세로 화면에 지름 0.7m 짜리 재료 원이 다 들어올
      // 만큼 물러선다. (AR은 실제 시점을 쓰므로 건드리지 않는다)
      frame3D(platformTop + 0.04, 1.34, 1.12);

      /* ── 가운데 담금 항아리 ─────────────────────────────────────────── */
      const basinBaseY = platformTop + (BASIN_MODEL?.y ?? 0.03);
      let basinH = 0.13;
      let basinR = 0.16;
      if (BASIN_MODEL) {
        const node = spawnModel(BASIN_MODEL);
        if (node) {
          const b = new THREE.Box3().setFromObject(node);
          basinH = b.max.y - b.min.y;
          basinR = Math.min(b.max.x - b.min.x, b.max.z - b.min.z) * 0.5;
          const g = new THREE.Group();
          g.position.set(0, basinBaseY, 0);
          g.add(node);
          stageGroup.add(g);
          live.models.push(g);
        }
      }
      /** 항아리 안쪽 바닥 / 아가리 / 내용물이 찰 수 있는 반경 */
      const basinFloorY = basinBaseY + basinH * 0.16;
      const basinRimY = basinBaseY + basinH * 0.94;
      const basinInnerR = basinR * 0.76;

      // 항아리에 쌓이는 내용물. 재료를 부을수록 높아지고, 섞인 색으로 바뀐다.
      const fillMat = new THREE.MeshStandardMaterial({ color: 0xefe6d6, roughness: 0.9 });
      const fill = new THREE.Mesh(
        new THREE.CylinderGeometry(basinInnerR, basinInnerR * 0.86, 1, 28, 1, false),
        fillMat
      );
      fill.visible = false;
      fill.receiveShadow = true;
      stageGroup.add(fill);
      const FILL_MAX_H = (basinRimY - basinFloorY) * 0.86;

      // 쏟아지는 알갱이·물방울. 어느 재료를 붓든 이 하나를 색만 바꿔 쓴다.
      const pour = makeParticles(160, {
        color: 0xf4ece0, size: 0.011, opacity: 0, speed: 2.2,
        radius: 0.032, baseY: 0, height: -0.2, taper: -0.5,
      });
      pour.visible = false;
      stageGroup.add(pour);
      live.particles.push(pour);

      // 물처럼 이어지는 재료는 알갱이만으로는 끊겨 보인다. 가는 물줄기를 함께 그린다.
      const streamMat = new THREE.MeshBasicMaterial({
        color: 0x9fd8ef, transparent: true, opacity: 0, depthWrite: false,
      });
      const stream = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.009, 1, 10, 1, true), streamMat);
      stream.visible = false;
      stageGroup.add(stream);

      /* ── 둘레에 놓는 재료 ───────────────────────────────────────────── */
      const textureLoader = new THREE.TextureLoader();
      const ringR = 0.30;                       // 담금 그릇을 둘러싸는 배치 반경
      // 앞뒤(z)는 조금 눌러 타원으로 놓는다. 세로 화면에서 앞쪽 재료가 아래로 멀리
      // 밀려나 하단 카드에 가리는 걸 막는다.
      const ringSquash = 0.72;
      const floatY = platformTop + 0.1;         // 그릇이 없는 부재료가 떠 있는 높이

      ingredientNodes = INGREDIENTS.map((ing, i) => {
        // 반 칸 돌려 놓아 정면 한가운데(카메라 바로 앞)를 비운다 — 거기 놓인 재료는
        // 항상 화면 맨 아래에 걸린다.
        const a = ((i + 0.5) / INGREDIENTS.length) * Math.PI * 2 - Math.PI / 2;
        const px = Math.cos(a) * ringR;
        const pz = Math.sin(a) * ringR * ringSquash;
        const g = new THREE.Group();
        const prop = ing.prop;

        // 그릇이 있는 주원료는 실제 모델을, 부재료는 예전처럼 텍스처 원판을 쓴다.
        let node: THREE.Object3D | null = null;
        if (prop) {
          node = spawnModel({
            id: `prop_${ing.id}`, file: prop.file, step: "ingredient",
            height: prop.height, y: 0, scaleFactor: prop.scaleFactor,
          });
        }

        const homeY = node ? platformTop + 0.03 : floatY;
        g.position.set(px, homeY, pz);

        // 재료의 실제 크기 — 이름표를 얼마나 위에 띄울지, 액체를 얼마나 채울지의 기준
        let propH = prop?.height ?? 0.1;
        let propW = 0.09;
        if (node) {
          const nb = new THREE.Box3().setFromObject(node);
          propH = nb.max.y - nb.min.y;
          propW = Math.min(nb.max.x - nb.min.x, nb.max.z - nb.min.z);
        }

        // 속이 비치는 통이면 안에 담긴 액체를 그려 넣는다. 부을수록 줄어든다.
        let liquid: THREE.Mesh | null = null;
        if (node && prop?.liquid) {
          const r = propW * 0.34;
          liquid = new THREE.Mesh(
            new THREE.CylinderGeometry(r, r, 1, 20, 1, false),
            new THREE.MeshStandardMaterial({
              color: prop.liquid.color, roughness: 0.15, metalness: 0,
              transparent: true, opacity: 0.85,
            })
          );
          (liquid.userData as any).full = propH * 0.6;
          (liquid.userData as any).baseY = propH * 0.05;
          g.add(liquid);
        }

        if (node) {
          g.rotation.y = (prop?.yaw ?? 0) - a;   // 아가리가 담금 그릇을 보게
          g.add(node);
        } else {
          const texture = textureLoader.load(
            ing.texture, undefined, undefined,
            (err) => console.warn("원료 텍스처 로드 실패:", ing.id, ing.texture, err)
          );
          texture.colorSpace = THREE.SRGBColorSpace;
          const mesh = new THREE.Mesh(
            new THREE.CircleGeometry(0.05, 40),
            new THREE.MeshBasicMaterial({
              map: texture, color: 0xffffff, side: THREE.DoubleSide, transparent: true,
            })
          );
          // 항상 카메라 정면을 보게 하는 빌보드
          mesh.onBeforeRender = (_r, _s, cam) => mesh.quaternion.copy(cam.quaternion);
          g.add(mesh);
        }

        // 무엇이 담긴 재료인지 위에 적어 둔다. 그릇 모양만으로는 알기 어렵다.
        const label = makeLabelPlane(prop?.label ?? ing.name, 0.05);
        (label.userData as any).lift = propH + 0.045;
        stageGroup.add(label);

        (g.userData as any) = {
          id: ing.id,
          ing: ing as Ingredient,
          prop,
          /** 붓는 재료인가 — 아니면 항아리에 넣기만 한다 */
          pours: prop?.pour === true,
          /** 담긴 정도 0(그대로) ~ 1(다 부었다) */
          poured: 0,
          /** 기울어진 정도 0~1 */
          tilt: 0,
          /**
           * 다 넣고 난 뒤의 뒷정리 상태.
           *   idle    평소
           *   vanish  다 넣은 자리에서 스르르 사라지는 중
           *   gone    무대에서 아주 빠졌다 (다시 나타나지 않는다)
           */
          state: "idle" as "idle" | "vanish" | "gone",
          /** 사라진 정도 0(보임) ~ 1(안 보임) */
          fade: 0,
          phase: i,
          hover: false,
          grabbed: false,
          liquid,
          label,
          home: new THREE.Vector3(px, homeY, pz),
          homeYaw: g.rotation.y,
        };
        stageGroup.add(g);
        return g;
      });

      /* ── 매 프레임 — 담기는 정도와 항아리 내용물 ────────────────────── */
      const mixColor = new THREE.Color();
      const tmpColor = new THREE.Color();
      const seat = new THREE.Vector3();
      /** 지금 붓고 있는 재료 (onHand 가 정하고 tick 이 진행시킨다) */
      let pouringNode: THREE.Group | null = null;
      /**
       * 지금 손에 들린 재료. onHand 가 잡고 놓지만, 다 부은 순간에는 tick 이
       * 손에서 놓아야 한다 — 빈 그릇이 손에 남아 있으면 사라질 수가 없다.
       */
      let held: THREE.Group | null = null;
      /**
       * 집은 순간의 카메라~재료 거리. 들고 다니는 동안 이 거리를 유지해야
       * 손 거리 추정이 흔들려도 재료 크기가 커졌다 작아졌다 하지 않는다.
       */
      let heldDepth = 1;
      const pourWorld = new THREE.Vector3();

      live.tick = (t, dt) => {
        let fillAmount = 0;
        let weight = 0;
        mixColor.setRGB(0, 0, 0);

        ingredientNodes.forEach((n) => {
          const ud = n.userData as any;
          const on = S.selected.has(ud.id);

          if (n === pouringNode) {
            // 붓는 중 — 시간에 비례해 차오른다
            ud.poured = Math.min(1, ud.poured + dt / (POUR_MS / 1000));
            if (ud.poured >= 1) {
              if (!on) {
                S.selected.add(ud.id);
                syncIngredient(INGREDIENTS.find((x) => x.id === ud.id), true);
              }
              setHandHud("dropped", `${nameOf(ud.id)}을(를) 다 부었어요`);
              pouringNode = null;
              // 다 부었으니 손에서 놓는다. 그래야 그 자리에서 사라질 수 있다.
              if (held === n) held = null;
              ud.grabbed = false;
            }
          } else if (on) {
            // 손을 놓쳐 담긴 것으로만 표시된 재료도 3D 가 따라온다
            ud.poured = THREE.MathUtils.lerp(ud.poured, 1, 0.12);
          } else if (ud.poured > 0.85 || !ud.pours) {
            // 담아 뒀던 걸 뺐다 — 도로 비운다.
            // 붓다 만 재료는 그대로 둔다. 다시 잡아 이어서 부을 수 있어야 하니까.
            ud.poured = THREE.MathUtils.lerp(ud.poured, 0, 0.15);
            if (ud.poured < 0.002) ud.poured = 0;
          }

          // 항아리 내용물 — 부은 만큼 쌓이고, 색은 재료 색을 섞는다.
          const share = (ud.prop?.fillAmount ?? 0.16) * ud.poured;
          if (share > 0) {
            fillAmount += share;
            tmpColor.setHex(ud.prop?.fillColor ?? ud.prop?.flowColor ?? 0xe4d9c4);
            mixColor.r += tmpColor.r * share;
            mixColor.g += tmpColor.g * share;
            mixColor.b += tmpColor.b * share;
            weight += share;
          }

          // 기울이기 — 붓는 동안만
          ud.tilt = THREE.MathUtils.lerp(ud.tilt, n === pouringNode ? 1 : 0, 0.18);

          // 다 넣은 재료는 그 자리에서 사라지고 그대로 무대에서 빠진다.
          // 제자리로 돌려놓으면 이미 담은 걸 또 담게 되고, 몇 가지를 넣었는지도
          // 헷갈린다. 담긴 것은 담금 그릇 안에만 남는다.
          if (ud.state === "idle" && ud.poured > 0.99 && !ud.grabbed) {
            ud.state = "vanish";
          }
          if (ud.state === "vanish") {
            ud.fade = Math.min(1, ud.fade + dt / 0.3);
            if (ud.fade >= 1) ud.state = "gone";
          }

          // 통에 담긴 액체는 부을수록 줄어든다
          if (ud.liquid) {
            const lq = ud.liquid as THREE.Mesh;
            const full = (lq.userData as any).full as number;
            const baseY = (lq.userData as any).baseY as number;
            const h = Math.max(0.0001, full * (1 - ud.poured));
            lq.scale.set(1, h, 1);
            lq.position.y = baseY + h / 2;
            lq.visible = ud.poured < 0.98;
          }
          // 이름표는 재료 위에 떠서 늘 화면을 마주본다
          if (ud.label) {
            const lb = ud.label as THREE.Mesh;
            lb.position.set(n.position.x, n.position.y + (lb.userData as any).lift, n.position.z);
            lb.quaternion.copy(camera.quaternion);
            lb.visible = n.visible && ud.fade < 0.5;
          }

          if (ud.grabbed) {
            // 위치는 onHand 가 정한다. 손에 들었다고 크게 부풀리지는 않는다 —
            // 갑자기 커지면 그릇이 아니라 다른 물건처럼 보인다.
            ud.vis = THREE.MathUtils.lerp(ud.vis ?? 1, 1, 0.22);
            n.scale.setScalar(ud.vis * (1 - ud.fade));
            return;
          }

          // 사라지는 동안에는 넣은 그 자리에 머문다
          if (ud.state === "idle") {
            seat.copy(ud.home);
            n.position.lerp(seat, 0.25);
            n.rotation.set(0, ud.homeYaw, 0);
          }

          const want = ud.hover ? 1.02 : 1;
          ud.vis = THREE.MathUtils.lerp(ud.vis ?? 1, want, 0.2);
          n.scale.setScalar(ud.vis * (1 - ud.fade));
          n.visible = ud.fade < 0.999;
        });

        // 항아리 안 내용물
        const h = Math.min(1, fillAmount) * FILL_MAX_H;
        fill.visible = h > 0.002;
        // 그릇은 위로 갈수록 넓어진다. 높이만 늘리면 다 채웠을 때 안쪽 벽에서
        // 떨어져 보이므로, 차오른 만큼 반지름도 함께 키워 둘레까지 닿게 한다.
        const spread = 1 + (h / FILL_MAX_H) * 0.3;
        fill.scale.set(spread, Math.max(h, 0.0001), spread);
        fill.position.set(0, basinFloorY + h / 2, 0);
        if (weight > 0) fillMat.color.copy(mixColor.multiplyScalar(1 / weight));

        // 쏟아지는 줄기 — 들고 있는 그릇의 주둥이에서 항아리 표면까지
        const pouringOn = !!pouringNode;
        let pouringLiquid = false;
        const opt = (pour.userData as any).opt;
        if (pouringNode) {
          const ud = pouringNode.userData as any;
          pouringNode.getWorldPosition(pourWorld);
          stageGroup.worldToLocal(pourWorld);
          // 내용물은 기울어진 그릇의 **주둥이**에서 나온다. 그릇 밑바닥에서
          // 새는 것처럼 보이지 않도록, 기운 방향으로 반 통만큼 나간 자리를 쓴다.
          const propH = ud.prop?.height ?? 0.1;
          const lip = tiltDir.lengthSq() > 1e-6 ? tiltDir : tiltAxis.set(0, 0, 1);
          const spoutY = pourWorld.y + propH * (0.18 + 0.3 * ud.tilt);
          const surfaceY = basinFloorY + h;
          const pourX = pourWorld.x + lip.x * propH * 0.5 * ud.tilt;
          const pourZ = pourWorld.z + lip.z * propH * 0.5 * ud.tilt;
          pour.position.set(pourX, spoutY, pourZ);
          opt.height = Math.min(-0.03, surfaceY - spoutY);
          (pour.material as THREE.PointsMaterial).color.setHex(ud.prop?.flowColor ?? 0xf4ece0);

          if (ud.prop?.flow === "liquid") {
            const len = Math.max(0.02, spoutY - surfaceY);
            pouringLiquid = true;
            stream.position.set(pourX, spoutY - len / 2, pourZ);
            stream.scale.set(1, len, 1);
            streamMat.color.setHex(ud.prop?.flowColor ?? 0x9fd8ef);
          }
        }
        pour.visible = true;
        const pourMat = pour.material as THREE.PointsMaterial;
        pourMat.opacity += ((pouringOn ? 0.95 : 0) - pourMat.opacity) * 0.25;
        if (pourMat.opacity < 0.02) pour.visible = false;
        streamMat.opacity += ((pouringLiquid ? 0.6 : 0) - streamMat.opacity) * 0.25;
        stream.visible = streamMat.opacity > 0.02;
      };

      /* ── 손으로 집어 담기 ──────────────────────────────────────────────
       * 무엇을 집었는지는 **화면 좌표**로 고른다. 손까지의 거리 추정은 흔들리는데,
       * 3D 거리로 고르면 화면에서는 재료 위에 손이 있는데도 안 집히는 일이 생긴다.
       * 화면 기준으로 고르면 사용자가 보는 것과 판정이 항상 일치한다.
       *
       */
      const basinLocal = new THREE.Vector3(0, (basinFloorY + basinRimY) / 2, 0);
      const basinWorld = new THREE.Vector3();
      const basinScreen = { x: 0.5, y: 0.5 };
      const nodeWorld = new THREE.Vector3();
      const nodeScreen = { x: 0.5, y: 0.5 };
      const grabTarget = new THREE.Vector3();
      const tiltAxis = new THREE.Vector3();
      const tiltDir = new THREE.Vector3();

      /** 화면에서 이 반경(0~1) 안에 있으면 집을 수 있다 */
      const PICK_R = 0.13;
      /** 그릇 위로 인정하는 반경 — 붓기는 넉넉하게 봐준다 */
      const DROP_R = 0.18;
      /**
       * 들고 있는 재료를 담금 그릇보다 이만큼 앞에 둔다(m).
       * 뒤쪽에 놓인 재료를 집어 그릇 위로 가져가면 그릇에 가려 안 보이는데,
       * 그러면 부어지고 있는지를 알 수가 없다. 손에 든 것은 언제나 그릇 앞에 온다.
       */
      const HELD_FRONT_MARGIN = 0.12;

      let hovered: THREE.Group | null = null;

      const setHover = (n: THREE.Group | null) => {
        if (hovered === n) return;
        if (hovered) (hovered.userData as any).hover = false;
        hovered = n;
        if (hovered) (hovered.userData as any).hover = true;
      };

      /** 손을 놓쳤거나 단계를 벗어날 때 — 들고 있던 것을 제자리로 돌린다 */
      const dropHeld = () => {
        pouringNode = null;
        if (!held) return;
        (held.userData as any).grabbed = false;
        held = null;
      };

      // 조명이 어둡거나 손이 화면 밖이면 인식이 안 잡힌다. 한참 못 잡으면
      // 손을 어떻게 비춰야 하는지 일러 준다.
      let lastSeenAt = performance.now();
      const LOST_HINT_MS = 6000;

      live.onHand = (f, hand, interactionCamera) => {
        if (!f.present) {
          dropHeld();
          setHover(null);
          setHandHud(
            "idle",
            performance.now() - lastSeenAt > LOST_HINT_MS
              ? "손이 안 보여요 · 밝은 곳에서 손바닥을 펴 비춰 주세요"
              : "손을 카메라에 비춰 주세요"
          );
          return;
        }
        lastSeenAt = performance.now();

        const grab = hand.pinchScreen;

        stageGroup.localToWorld(basinWorld.copy(basinLocal));
        worldToScreen(basinWorld, interactionCamera, basinScreen);
        const overBasin = screenDist(grab, basinScreen) < DROP_R;

        // 1) 들고 있는 중 — 손을 따라오게 하고, 그릇 위에서는 기울여 붓는다
        if (held) {
          const ud = held.userData as any;
          // 그릇보다 뒤에 놓이지 않도록 거리를 잘라 준다
          const basinDepth = interactionCamera.getWorldPosition(handOrigin).distanceTo(basinWorld);
          // 당기는 양을 거리에 비례시킨다 — 가까운 무대에서 물건이 갑자기 커지지 않게.
          const showDepth = Math.max(0.3, Math.min(heldDepth, basinDepth * (1 - HELD_FRONT_MARGIN)));
          screenToWorld(grab.x, grab.y, showDepth, interactionCamera, grabTarget);
          stageGroup.worldToLocal(grabTarget);
          held.position.lerp(grabTarget, 0.5);

          if (ud.pours && overBasin) {
            pouringNode = held;
            // 주둥이가 그릇 한가운데를 향하도록, 제자리에서 그릇 쪽으로 기운다.
            // 방향은 그 재료가 원래 놓여 있던 자리에서 뽑는다 — 손 위치로 정하면
            // 그릇 바로 위에 올렸을 때 방향이 0으로 무너져 엉뚱하게 쏟아진다.
            // 오른쪽에 놓인 재료는 왼쪽으로, 왼쪽 재료는 오른쪽으로 기울어
            // 그 손으로 붓는 것처럼 옆모습이 보인다.
            const home: THREE.Vector3 = ud.home;
            tiltDir.set(-home.x, 0, -home.z);
            if (tiltDir.lengthSq() < 1e-6) tiltDir.set(1, 0, 0);
            tiltDir.normalize();
            tiltAxis.set(tiltDir.z, 0, -tiltDir.x);
            held.quaternion.setFromAxisAngle(tiltAxis, 2.0 * ud.tilt);
            setHandHud("holding", `${nameOf(ud.id)}을(를) 붓는 중 · ${Math.round(ud.poured * 100)}%`);
          } else {
            if (pouringNode === held) pouringNode = null;
            held.quaternion.setFromAxisAngle(tiltAxis.set(1, 0, 0), 0);
            held.rotation.y = ud.homeYaw;
            setHandHud(
              "holding",
              ud.pours
                ? `${nameOf(ud.id)}을(를) 그릇 위로 가져가세요`
                : `${nameOf(ud.id)} · 그릇 안에서 손을 펴 놓으세요`
            );
          }

          if (f.justReleased) {
            const id: string = ud.id;
            if (!ud.pours && overBasin) {
              // 누룩은 붓지 않는다 — 그릇에 넣기만 하면 담긴 것으로 본다.
              // 덩어리가 그대로 그릇에 남으면 "담겼다"가 아니라 딴 물건이 하나 놓인 것처럼
              // 보이므로, 다른 재료와 똑같이 사라지며 그릇 내용물로만 녹아든다.
              S.selected.add(id);
              syncIngredient(INGREDIENTS.find((x) => x.id === id), true);
              ud.poured = 1;
              setHandHud("dropped", `${nameOf(id)}을(를) 그릇에 넣었어요`);
            } else if (ud.pours && ud.poured > 0.05 && ud.poured < 1) {
              setHandHud("tracking", `${nameOf(id)} · 조금 더 부어 주세요`);
            } else if (!overBasin) {
              setHandHud("tracking", `${nameOf(id)}을(를) 놓쳤어요 · 다시 잡아 보세요`);
            }
            dropHeld();
          }
          return;
        }

        // 2) 빈손 — 화면에서 가장 가까운 재료를 고른다
        let best: THREE.Group | null = null;
        let bestD = PICK_R;
        for (const n of ingredientNodes) {
          if ((n.userData as any).state !== "idle") continue; // 이미 담은 재료는 무대에 없다
          n.getWorldPosition(nodeWorld);
          worldToScreen(nodeWorld, interactionCamera, nodeScreen);
          const d = screenDist(grab, nodeScreen);
          if (d < bestD) {
            bestD = d;
            best = n;
          }
        }
        setHover(best);

        if (!best) {
          const left = INGREDIENTS.filter((i) => i.essential && !S.selected.has(i.id)).length;
          setHandHud("tracking", left ? "재료 위로 손을 옮겨 보세요" : "주원료가 다 모였어요 · 아래 버튼으로 이어가세요");
          return;
        }

        const id: string = (best.userData as any).id;

        // 3) 재료 위에서 엄지·검지를 붙이면 집어 든다
        if (f.justPinched) {
          const ud = best.userData as any;
          ud.grabbed = true;
          held = best;
          best.getWorldPosition(nodeWorld);
          heldDepth = interactionCamera.getWorldPosition(handOrigin).distanceTo(nodeWorld);
          setHandHud("holding", `${nameOf(id)}을(를) 잡았어요`);
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

    /**
     * 그릇·소쿠리·솥에 담기는 쌀알 무리.
     *
     * 낱알 모델을 수천 개 띄우면 폰에서 버틸 수 없어서, 저해상도 쌀알 하나를
     * InstancedMesh 로 복제한다. 물살을 따라 돌고(세미), 털면 튀어오르고(탈수),
     * 물을 먹으면 통통해진다(침수).
     */
    interface RiceField {
      mesh: THREE.InstancedMesh;
      /**
       * 담긴 그릇의 반경·바닥 높이를 바꾼다.
       * moundH 를 주면 그 높이만큼 봉긋한 더미의 **겉면**에 낱알을 얹는다 —
       * 시루처럼 가득 채워야 하는 자리는 속을 덩어리로 메우고 겉만 낱알로 덮는다.
       */
      place(x: number, y: number, z: number, radius: number, moundH?: number): void;
      /** swirl: 물살 세기 0~1, jolt: 털어서 튀는 세기 0~1, swell: 불은 정도 0~1 */
      update(t: number, dt: number, swirl: number, jolt: number, swell: number): void;
      setColor(color: THREE.Color): void;
    }
    /** 봉긋한 고두밥 더미의 옆모습 — 가운데가 제일 높고 가장자리에서 0이 된다 */
    function moundProfile(u: number) {
      return Math.cos(THREE.MathUtils.clamp(u, 0, 1) * Math.PI / 2);
    }
    function makeRiceField(count: number, color: THREE.Color, grainLen: number): RiceField {
      // 쌀알 한 톨 — 길쭉하게 눌러 놓은 저해상도 구
      const geo = new THREE.SphereGeometry(0.5, 6, 4);
      geo.scale(0.42, 0.42, 1);
      const mat = new THREE.MeshStandardMaterial({ color: color.clone(), roughness: 0.82, metalness: 0 });
      const mesh = new THREE.InstancedMesh(geo, mat, count);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;

      // 낱알마다 그릇 안 극좌표 한 자리씩 — 가운데가 두툼하게 쌓이도록 반경을 눌러 준다
      const rr = new Float32Array(count);
      const aa = new Float32Array(count);
      const hh = new Float32Array(count);
      const spin = new Float32Array(count);
      const phase = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        rr[i] = Math.sqrt(Math.random());
        aa[i] = Math.random() * Math.PI * 2;
        hh[i] = Math.random();
        spin[i] = Math.random() * Math.PI * 2;
        phase[i] = Math.random() * Math.PI * 2;
      }

      let cx = 0, cy = 0, cz = 0, radius = 0.1, mound = 0;
      let angleOffset = 0;
      const dummy = new THREE.Object3D();

      return {
        mesh,
        setColor(color: THREE.Color) {
          mat.color.copy(color);
        },
        place(x, y, z, r, moundH = 0) {
          cx = x; cy = y; cz = z; radius = r; mound = moundH;
        },
        update(t, dt, swirl, jolt, swell) {
          // 물살을 따라 도는 각도. 저을수록 빨라진다.
          angleOffset += (0.15 + swirl * 5.5) * dt;
          const scale = grainLen * (1 + swell * 0.45);
          for (let i = 0; i < count; i++) {
            const r = rr[i] * radius;
            const a = aa[i] + angleOffset * (0.55 + rr[i] * 0.9);
            // 물살이 셀수록 안쪽 낱알이 위로 말려 올라간다
            const lift = (0.25 + swirl * 1.6) * (1 - rr[i]) * radius * 0.24;
            const bounce = jolt * Math.abs(Math.sin(t * 22 + phase[i])) * radius * 0.3;
            // 더미 위에 얹을 때는 겉면에 딱 붙고, 그냥 담길 때는 바닥에 흩어진다
            const stack = mound > 0
              ? mound * moundProfile(rr[i]) + hh[i] * grainLen * 1.4
              : hh[i] * radius * 0.42;
            dummy.position.set(
              cx + Math.cos(a) * r,
              cy + stack + lift + bounce,
              cz + Math.sin(a) * r
            );
            dummy.rotation.set(spin[i] + t * swirl * 2, a, spin[i] * 0.5 + t * (swirl + jolt));
            dummy.scale.setScalar(scale);
            dummy.updateMatrix();
            mesh.setMatrixAt(i, dummy.matrix);
          }
          mesh.instanceMatrix.needsUpdate = true;
        },
      };
    }

    /* --- 13 · 고두밥 --- */
    /**
     * 고두밥 짓기 — 세미 → 침수 → 탈수 → 증자 → 냉각.
     *
     * 앞 네 단계는 손으로 하고, 다 하면 잠깐 여유를 둔 뒤 스스로 다음으로 넘어간다.
     *   세미  손을 둥글게 휘저어 헹군다. 물이 뿌옇게 흐려졌다가 다 헹구면 맑아진다.
     *   침수  담가 두고 기다리면 쌀알이 통통하게 분다.
     *   탈수  그릇이 소쿠리로 부드럽게 바뀐다. 소쿠리를 잡고 위아래로 털면 물이 튄다.
     *   증자  받침대를 치우고 바닥의 화덕에 시루를 올린다. 옆에 놓인 뚜껑을 덮으면 김이 오른다.
     */
    function buildGodubap() {
      const platformTop = addPlatform();
      placeCommonModels(stageGroup, platformTop);

      // 하위 단계별로 갈아 끼울 무대 모델을 미리 만들어 두고 보이기만 토글한다.
      const stage: Record<string, THREE.Object3D[]> = {};
      const drops: THREE.Object3D[] = [];    // 위에서 내려앉는 모션(보자기)
      const scatters: THREE.Object3D[] = []; // 흩뿌리는 모션(고두밥 쌀)
      let gTrayW = 0, gTrayD = 0;            // 채반 실측 (고두밥 평면 크기에 사용)

      /**
       * 그릇마다 "안에 담긴 것"이 앉을 높이와 반경 — 실측 높이·폭에 곱할 비율.
       * 모델마다 속이 파인 깊이가 달라서 하나의 비율로는 맞출 수가 없다.
       * (물이나 쌀이 그릇을 뚫고 나오거나 파묻히면 이 숫자만 손보면 된다)
       */
      const VESSEL_FIT: Record<string, { inner: number; rim: number; radius: number }> = {
        rice_bowl:     { inner: 0.26, rim: 0.70, radius: 0.78 },  // 비워 낸 이남박 (담겨 있던 쌀 높이만큼 위가 비어 있다)
        bamboo_basket: { inner: 0.46, rim: 0.94, radius: 0.66 },  // 얕은 소쿠리
        steamer_pot:   { inner: 0.66, rim: 0.96, radius: 0.58 },  // 시루 — 위에서 쌀이 보이게 높이 담는다
      };
      /** 그릇·소쿠리·솥의 실측값 — 물과 쌀을 어디에 담을지 정하는 데 쓴다 */
      const vessel: Record<string, { innerY: number; radius: number; rimY: number }> = {};
      let campFireTopY = 0;
      let lidGroup: THREE.Group | null = null;
      let basketGroup: THREE.Group | null = null;

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

          // 담는 그릇이면 안쪽 높이와 반경을 재 둔다 (물·쌀을 여기에 맞춘다)
          const fit = VESSEL_FIT[def.id];
          if (node && fit) {
            const b = new THREE.Box3().setFromObject(node);
            const h = b.max.y - b.min.y;
            const r = Math.min(b.max.x - b.min.x, b.max.z - b.min.z) * 0.5;
            vessel[def.id] = {
              innerY: g.position.y + h * fit.inner,
              rimY: g.position.y + h * fit.rim,
              radius: r * fit.radius,
            };
          }

          // 증자 — 받침대를 치우고 바닥(y=0)에 화덕을 놓는다.
          if (def.id === "camp_fire" && node) {
            const b = new THREE.Box3().setFromObject(node);
            campFireTopY = b.max.y - b.min.y;
            g.position.set(0, 0, 0);
          }
          if (def.id === "steamer_pot") {
            // 화덕 위에 얹는다 — 조금 파묻어야 불에 올린 것처럼 보인다.
            g.position.set(0, Math.max(0, campFireTopY - 0.022), 0);
            if (node && fit) {
              const b = new THREE.Box3().setFromObject(node);
              const h = b.max.y - b.min.y;
              const r = Math.min(b.max.x - b.min.x, b.max.z - b.min.z) * 0.5;
              vessel.steamer_pot = {
                innerY: g.position.y + h * fit.inner,
                rimY: g.position.y + h * fit.rim,
                radius: r * fit.radius,
              };
            }
          }
          if (def.id === "steamer_lid") {
            // 뚜껑은 화덕 바깥 바닥에 따로 놓인다 — 손으로 집어와 덮어야 한다.
            lidGroup = g;
            g.position.set(0.26, 0, 0.16);
          }
          if (def.id === "bamboo_basket") basketGroup = g;

          g.visible = false;
          stageGroup.add(g);
          groups.push(g);
        }
        stage[def.id] = groups;
      });

      /** 소쿠리 제자리 — 손으로 들었다 놓으면 여기로 돌아온다 */
      const basketHome = basketGroup
        ? (basketGroup as THREE.Group).position.clone()
        : new THREE.Vector3(0, platformTop + 0.03, 0);
      const lidHome = lidGroup ? (lidGroup as THREE.Group).position.clone() : new THREE.Vector3();
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

      /* ── 그릇 안의 물 ────────────────────────────────────────────────
       * 평면이 아니라 납작한 반구 돔(휘어진 면)이다. 침수에서 차오르고 탈수에서 빠진다.
       * 헹구는 동안에는 쌀뜨물처럼 뿌옇게 흐려졌다가, 다 헹구면 도로 맑아진다.
       */
      const bowlV = vessel.rice_bowl ?? { innerY: platformTop + 0.05, rimY: platformTop + 0.15, radius: 0.11 };
      const WATER_R = bowlV.radius;             // 물 반경 (그릇 실측)
      const DOME_FLATTEN = 0.44;                // 돔 납작 정도 (작을수록 평평, 클수록 봉긋)
      const waterMat = new THREE.MeshBasicMaterial({
        color: 0x5db4e6, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false,
      });
      const water = new THREE.Mesh(
        // 위쪽 반구(돔). thetaLength=π/2 → 가장자리(적도)에서 정수리까지 휘어진 면.
        new THREE.SphereGeometry(1, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2),
        waterMat
      );
      water.visible = false;
      stageGroup.add(water);
      let waterLevel = 0;
      /** 쌀뜨물 정도 0(맑음) ~ 1(뿌옇다) */
      let cloud = 0;
      const clearWater = new THREE.Color(0x5db4e6);
      const murkyWater = new THREE.Color(0xe4e0d2);

      // 물빠짐 물방울 — 소쿠리를 털 때 사방으로 튄다.
      const drip = makeParticles(80, {
        color: 0xcfe6ef, size: 0.012, opacity: 0, speed: 1.1,
        radius: WATER_R * 1.5, baseY: bowlV.rimY, height: -0.26, taper: -0.9,
      });
      stageGroup.add(drip);
      live.particles.push(drip);

      // 그릇 속 쌀 — 물에 잠겨 있다가 휘저으면 물살을 따라 돌고, 털면 튀어오른다.
      const RICE_PLAIN = new THREE.Color(0xf2ead9);   // 씻은 쌀
      const RICE_SOAKED = new THREE.Color(0xfdf8ec);  // 물을 먹어 뽀얘진 쌀
      const RICE_STEAMED = new THREE.Color(0xd8bb72); // 쪄서 누리끼리해진 고두밥
      const riceTint = new THREE.Color();
      // 낱알 크기는 실제(5mm)보다 굵게 잡는다. 폰 화면에서 실제 비율로 그리면
      // 알갱이가 아니라 잡티처럼 보여 "쌀이 움직인다"가 읽히지 않는다.
      const riceField = makeRiceField(1150, RICE_PLAIN, 0.0095);
      riceField.mesh.visible = false;
      stageGroup.add(riceField.mesh);
      stage["bowl_rice"] = [riceField.mesh];

      /* ── 시루에 안친 고두밥 ──────────────────────────────────────────
       * 냄비를 낱알로 바닥부터 채우면 폰이 못 버틴다. 속은 덩어리 하나로 메우고
       * 겉면에만 낱알을 얹어 "가득 찼다"로 보이게 한다.
       */
      const moundMat = new THREE.MeshStandardMaterial({ color: RICE_STEAMED, roughness: 0.95 });
      const steamedMound = new THREE.Mesh(new THREE.BufferGeometry(), moundMat);
      steamedMound.visible = false;
      stageGroup.add(steamedMound);
      /** 시루 안을 채운 고두밥 더미를 반경·높이에 맞춰 다시 빚는다 */
      let moundShape = { r: 0, h: 0 };
      function shapeSteamedMound(r: number, h: number) {
        if (Math.abs(moundShape.r - r) < 1e-4 && Math.abs(moundShape.h - h) < 1e-4) return;
        moundShape = { r, h };
        const pts: THREE.Vector2[] = [new THREE.Vector2(r, -h * 1.6)];
        for (let i = 12; i >= 0; i--) {
          const u = i / 12;
          pts.push(new THREE.Vector2(r * u, h * moundProfile(u)));
        }
        steamedMound.geometry.dispose();
        steamedMound.geometry = new THREE.LatheGeometry(pts, 40);
      }

      let coolT = 0; // 냉각 연출 진행 시간
      /** 한 번 부칠 때마다 1로 튀었다가 잦아든다 — 김이 훅 흩어지는 연출에 쓴다 */
      let fanPulse = 0;
      /** 소쿠리를 털 때마다 1로 튀었다가 잦아든다 — 물이 튀는 연출에 쓴다 */
      let shakePulse = 0;
      /** 그릇 → 소쿠리 전환 진행도 0~1 (탈수로 넘어갈 때 부드럽게 바꾼다) */
      let swap = 0;

      /* ── 손 판정기 ─────────────────────────────────────────────────── */
      const fan = new FanGesture();
      const stir = new StirGesture();
      const shake = new ShakeGesture();
      /** 소쿠리·뚜껑을 잡고 있나 (onHand 가 정하고 tick 이 위치를 그린다) */
      let heldBasket = false;
      let heldLid = false;
      let lidSettled = false;
      const heldTarget = new THREE.Vector3();

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
        // 탈수로 넘어오는 순간에는 그릇도 잠깐 남겨 두고 서서히 바꾼다.
        if (S.godubap === 2) {
          swap = 0;
          stage.rice_bowl?.forEach((g) => (g.visible = true));
        } else if (S.godubap < 2) {
          swap = 0;
        } else {
          swap = 1;
        }
        // 단계마다 무대에 놓인 것의 크기가 달라서 카메라도 같이 잡아 준다.
        // (AR 에서는 실제 시점을 쓰므로 frame3D 가 알아서 빠진다)
        //   세미~탈수  그릇 하나 + 손이 들어갈 여유
        //   증자       화덕·솥·옆에 놓인 뚜껑이 한 화면에 다 들어와야 한다
        //   냉각       채반을 가까이 — 원래 잡아 두었던 그대로
        if (S.godubap <= 2) frame3D(platformTop + 0.05, 1.05, 1.15);
        else if (S.godubap === GB_LAST) frame3D(platformTop, 0.58, 0.52);

        // 증자 — 받침대를 치우고 바닥의 화덕만 남긴다.
        const onFire = S.godubap === 3;
        setPlatformVisible(!onFire);
        if (onFire) {
          // 이 단계에 들어올 때마다 뚜껑은 화덕 바깥 제자리에서 다시 시작한다
          if (!lidSettled) {
            S.lidAt = 0;
            if (lidGroup) lidGroup.position.copy(lidHome);
          }
          heldLid = false;
          frame3D(campFireTopY + 0.02, 1.12, 1.24);
        } else {
          lidSettled = false;
          heldLid = false;
          heldBasket = false;
        }
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
        const now = performance.now();

        /* ── 단계 자동 전환 ─────────────────────────────────────────── */
        // 세미 — 다 헹궜으면 잠깐 보여 주고 침수로
        if (rinseSettling()) {
          if (!S.rinseDoneAt) S.rinseDoneAt = now;
          syncGodubapGame();
          if (now - S.rinseDoneAt >= STAGE_HOLD_MS) {
            S.godubap = 1;
            S.soakAt = now;
            syncGodubap();
          }
        }
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
          if (!S.soakAt) S.soakAt = now;
          syncGodubapGame();
          if (now - S.soakAt >= SOAK_MS) {
            S.godubap = 2; // 탈수 — 그릇이 소쿠리로 바뀐다
            syncGodubap();
          }
        }
        // 탈수 — 다 털었으면 잠깐 보여 주고 증자로
        if (drainSettling()) {
          if (!S.drainDoneAt) S.drainDoneAt = now;
          syncGodubapGame();
          if (now - S.drainDoneAt >= DRAIN_HOLD_MS) {
            S.godubap = 3;
            syncGodubap();
          }
        }
        // 증자 — 뚜껑을 덮고 김이 다 오르면 냉각으로
        if (steamingStep() && S.lidAt) {
          syncGodubapGame();
          if (now - S.lidAt >= STEAM_MS) {
            S.godubap = GB_LAST;
            syncGodubap();
          }
        }

        /* ── 그릇 → 소쿠리 부드러운 전환 ────────────────────────────── */
        if (S.godubap === 2) swap = Math.min(1, swap + dt / 0.7);
        const bowlG = stage.rice_bowl?.[0];
        if (bowlG && S.godubap === 2) {
          // 그릇은 가라앉으며 작아지고, 소쿠리는 올라오며 커진다
          const out = THREE.MathUtils.smoothstep(swap, 0, 1);
          bowlG.scale.setScalar(Math.max(0.001, 1 - out));
          bowlG.position.y = platformTop + 0.03 - out * 0.04;
          if (out >= 0.999) bowlG.visible = false;
          if (basketGroup) {
            basketGroup.scale.setScalar(0.6 + out * 0.4);
          }
        } else if (bowlG) {
          bowlG.scale.setScalar(1);
          bowlG.position.y = platformTop + 0.03;
          if (basketGroup) basketGroup.scale.setScalar(1);
        }

        /* ── 김 · 불빛 ─────────────────────────────────────────────── */
        const lidOn = steamingStep() && lidSettled;
        const steaming = cur?.steam === true && lidOn;
        const cooling = cur?.dark === true && coolingActive();
        const coolLeft = Math.max(0, 1 - S.coolFans / REQUIRED_FANS);
        fanPulse = Math.max(0, fanPulse - dt * 1.6);
        shakePulse = Math.max(0, shakePulse - dt * 2.4);

        // 화덕은 뚜껑을 덮기 전부터 벌겋다 — 불 위에 솥이 올라가 있으니까.
        const fireLit = steamingStep();
        const glowTarget = steaming ? 1.6 : fireLit ? 1.1 : cooling ? 0.5 * coolLeft : 0.05;
        glow.intensity += (glowTarget - glow.intensity) * 0.05;
        glow.position.y = fireLit ? campFireTopY * 0.8 : 0.2;

        const steamTarget = steaming ? 0.6 : cooling ? 0.5 * coolLeft : 0;
        steam.material.opacity += (steamTarget - steam.material.opacity) * 0.06;
        const sOpt = (steam.userData as any).opt;
        // 부친 순간에는 김이 빠르게 옆으로 퍼진다
        sOpt.speed = steaming ? 0.35 : cooling ? 0.2 + fanPulse * 0.9 : 0.15;
        sOpt.radius = steaming
          ? (vessel.steamer_pot?.radius ?? 0.09) + fanPulse * 0.12
          // 냉각에서는 고두밥 한가운데서 좁게 올라온다
          : cooling ? 0.05 + fanPulse * 0.1 : 0.1 + fanPulse * 0.12;
        sOpt.baseY = steaming
          ? (vessel.steamer_pot?.rimY ?? 0.2) + 0.02
          // 채반은 받침대 위로 한참 올라와 있다. 0.24 는 받침대 밑이라 김이 바닥에서 났다.
          : cooling ? platformTop + 0.135 : 0.24;

        /* ── 담는 그릇이 어디인가 ──────────────────────────────────── */
        // 세미·침수는 이남박, 탈수는 소쿠리, 증자는 시루.
        const activeId =
          S.godubap >= 3 ? "steamer_pot" : S.godubap === 2 ? "bamboo_basket" : "rice_bowl";
        const v = vessel[activeId] ?? bowlV;
        // 소쿠리는 손에 들려 움직인다 — 물과 쌀이 따라가야 한다.
        const holder = S.godubap === 2 ? basketGroup : null;
        const hx = holder ? holder.position.x : 0;
        const hy = holder ? holder.position.y - basketHome.y : 0;
        const hz = holder ? holder.position.z : 0;

        /* ── 물 ─────────────────────────────────────────────────────── */
        // 탈수에서는 털수록 줄고, 그 밖에는 단계에 적힌 값으로 찬다.
        const targetWater =
          S.godubap === 2 ? Math.max(0, 1 - S.drain) : S.godubap >= 3 ? 0 : cur?.water ?? 0;
        waterLevel += (targetWater - waterLevel) * 0.06;
        water.visible = waterLevel > 0.01 && S.godubap <= 2;
        const swirl = stir.speed;
        const jolt = Math.max(shake.intensity, shakePulse);

        // 헹구는 동안 쌀뜨물이 올라왔다가, 다 헹구면 도로 맑아진다.
        const wantCloud = rinseActive() ? Math.min(1, S.rinseTurns / REQUIRED_RINSE_TURNS + swirl * 0.4) : 0;
        cloud += (wantCloud - cloud) * (wantCloud > cloud ? 0.06 : 0.03);
        waterMat.color.copy(clearWater).lerp(murkyWater, cloud);
        waterMat.opacity = (0.6 + cloud * 0.3) * waterLevel;

        const wobble = (0.012 + swirl * 0.05 + jolt * 0.05) * waterLevel;
        const ripple = 1 + Math.sin(t * (2.2 + swirl * 6 + jolt * 10)) * wobble;
        water.position.set(hx, v.innerY + hy + (v.rimY - v.innerY) * waterLevel * 0.30, hz);
        water.rotation.y += (0.25 + swirl * 6) * dt;
        water.scale.set(
          v.radius * ripple,
          v.radius * DOME_FLATTEN * (1 + swirl * 0.12 + jolt * 0.2),
          v.radius * ripple
        );

        // 물방울 — 소쿠리를 털 때 사방으로 튄다
        const dOpt = (drip.userData as any).opt;
        dOpt.baseY = v.innerY + hy + 0.01;
        dOpt.radius = v.radius * (1.1 + jolt * 1.2);
        drip.position.set(hx, 0, hz);
        const dripping = S.godubap === 2 && waterLevel > 0.03 && jolt > 0.05;
        drip.material.opacity += ((dripping ? 0.95 : 0) - drip.material.opacity) * 0.18;

        /* ── 쌀 ─────────────────────────────────────────────────────── */
        // 침수에서 물을 먹고 통통하게 불면서 뽀얘진다.
        const swell =
          S.godubap === 0 ? 0 : S.godubap === 1 ? THREE.MathUtils.clamp((now - S.soakAt) / SOAK_MS, 0, 1) : 1;

        // 증자에서는 시루를 가득 채운 고두밥 더미 위에 낱알을 얹는다.
        const onMound = steamingStep();
        const moundR = v.radius * 1.32;
        const moundH = (v.rimY - v.innerY) * 0.85;
        steamedMound.visible = onMound;
        if (onMound) {
          shapeSteamedMound(moundR, moundH);
          steamedMound.position.set(hx, v.innerY + hy, hz);
        }

        if (riceField.mesh.visible) {
          riceField.setColor(
            onMound ? RICE_STEAMED : riceTint.copy(RICE_PLAIN).lerp(RICE_SOAKED, swell)
          );
          if (onMound) riceField.place(hx, v.innerY + hy, hz, moundR * 0.97, moundH);
          else riceField.place(hx, v.innerY + hy, hz, v.radius * 0.86);
          riceField.update(t, dt, swirl, S.godubap === 2 ? jolt : 0, swell);
        }

        /* ── 손에 들린 소쿠리·뚜껑 ─────────────────────────────────── */
        if (basketGroup && !heldBasket && S.godubap === 2) {
          basketGroup.position.lerp(basketHome, 0.18);
          // 털고 있으면 제자리에서도 함께 들썩인다
          basketGroup.position.y = basketHome.y + Math.sin(t * 22) * jolt * 0.012;
        }
        if (lidGroup && steamingStep()) {
          if (lidSettled && !heldLid) {
            heldTarget.set(0, vessel.steamer_pot?.rimY ?? campFireTopY, 0);
            lidGroup.position.lerp(heldTarget, 0.2);
            lidGroup.rotation.set(0, 0, 0);
          } else if (!heldLid) {
            lidGroup.position.lerp(lidHome, 0.2);
          }
        }

        /* ── 냉각 연출 — 보자기 내려앉기 + 고두밥 흩뿌리기 ─────────── */
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

      /* ── 손으로 하는 일 ──────────────────────────────────────────────
       * 세미는 둥글게 휘젓기(stirGesture), 탈수는 위아래로 털기(shakeGesture),
       * 냉각은 좌우로 부치기(fanGesture)가 각각 판정한다.
       * 증자에서는 뚜껑을 집어 솥 위에 놓는다.
       */
      const grabTarget = new THREE.Vector3();
      const nodeWorld = new THREE.Vector3();
      const nodeScreen = { x: 0.5, y: 0.5 };
      const potScreen = { x: 0.5, y: 0.5 };
      const potWorld = new THREE.Vector3();
      /** 화면에서 이 반경 안이면 잡을 수 있다 */
      const GRAB_R = 0.19;
      let heldDepth = 1;

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

      live.onHand = (f, hand, cam) => {
        const grab = hand.pinchScreen;
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
              // 다 헹궜다. 물이 맑아지는 걸 보여 준 뒤 tick 이 침수로 넘긴다.
              stir.reset();
              S.rinsePartial = 0;
              S.rinseDoneAt = performance.now();
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

        // ── 탈수 — 소쿠리를 잡고 위아래로 탁탁 턴다 ──────────────────────
        if (drainActive()) {
          if (!f.present) {
            heldBasket = false;
            shake.reset();
            setHandHud("idle", "손을 카메라에 비춰 주세요");
            return;
          }

          // 소쿠리를 집으면 손을 따라온다
          if (basketGroup) {
            basketGroup.getWorldPosition(nodeWorld);
            worldToScreen(nodeWorld, cam, nodeScreen);
            const near = screenDist(grab, nodeScreen) < GRAB_R;
            if (!heldBasket && near && f.justPinched) {
              heldBasket = true;
              heldDepth = cam.getWorldPosition(handOrigin).distanceTo(nodeWorld);
            }
            if (heldBasket && !f.pinching) heldBasket = false;
            if (heldBasket) {
              screenToWorld(grab.x, grab.y, heldDepth, cam, grabTarget);
              stageGroup.worldToLocal(grabTarget);
              // 아래로 크게 털면 소쿠리가 받침대를 뚫고 내려간다. 상판 아래로는 못 가게 막는다.
              grabTarget.y = Math.max(grabTarget.y, platformTop + 0.01);
              basketGroup.position.lerp(grabTarget, 0.45);
            }
          }

          // 손만 오므리고 흔들어도 세어 준다 — 잡기 판정에서 막히지 않게.
          const counted = heldBasket || f.pinching;
          const gained = counted ? shake.update(f) : 0;
          if (shake.downBeat && counted) shakePulse = 1;
          if (gained) {
            S.shakes = Math.min(REQUIRED_SHAKES, S.shakes + gained);
            S.drain = S.shakes / REQUIRED_SHAKES;
            if (S.shakes >= REQUIRED_SHAKES) {
              shake.reset();
              heldBasket = false;
              S.drainDoneAt = performance.now();
              syncGodubap();
              return;
            }
          }
          S.drain = Math.max(S.drain, S.shakes / REQUIRED_SHAKES);
          syncGodubapGame();
          setHandHud(
            heldBasket ? "holding" : counted ? "tracking" : "hover",
            heldBasket
              ? `소쿠리를 위아래로 털어 주세요 · ${S.shakes}/${REQUIRED_SHAKES}번`
              : "소쿠리를 집고 위아래로 털어 주세요"
          );
          return;
        }

        // ── 증자 — 옆에 놓인 뚜껑을 집어와 솥 위에 덮는다 ────────────────
        if (steamingStep()) {
          if (lidSettled) {
            setHandHud("dropped", "뚜껑을 덮었어요 · 김이 오르는 중");
            return;
          }
          if (!f.present || !lidGroup) {
            heldLid = false;
            setHandHud("idle", "손을 카메라에 비춰 주세요");
            return;
          }

          potWorld.set(0, vessel.steamer_pot?.rimY ?? campFireTopY, 0);
          stageGroup.localToWorld(potWorld);
          worldToScreen(potWorld, cam, potScreen);
          const overPot = screenDist(grab, potScreen) < 0.26;

          if (heldLid) {
            screenToWorld(grab.x, grab.y, heldDepth, cam, grabTarget);
            stageGroup.worldToLocal(grabTarget);
            lidGroup.position.lerp(grabTarget, 0.45);

            // 솥 위에 가져다 대기만 하면 알아서 덮인다.
            // 손을 펴는 걸 조건으로 걸면, 놓는 순간 손 모양이 흔들려 판정이 어긋나면서
            // 아무리 잘 펴도 안 닫히는 일이 생긴다.
            if (overPot) {
              heldLid = false;
              lidSettled = true;
              S.lidAt = performance.now();
              shakePulse = 0;
              syncGodubap();
              setHandHud("dropped", "뚜껑을 덮었어요 · 김이 오르는 중");
              return;
            }
            if (f.justReleased || !f.pinching) heldLid = false;
            setHandHud("holding", "뚜껑을 솥 위로 옮기세요");
            return;
          }

          lidGroup.getWorldPosition(nodeWorld);
          worldToScreen(nodeWorld, cam, nodeScreen);
          const nearLid = screenDist(grab, nodeScreen) < GRAB_R;
          if (nearLid && f.justPinched) {
            heldLid = true;
            heldDepth = cam.getWorldPosition(handOrigin).distanceTo(nodeWorld);
            setHandHud("holding", "뚜껑을 잡았어요");
            return;
          }
          setHandHud(nearLid ? "hover" : "tracking", nearLid ? "엄지와 검지를 붙여 뚜껑을 집으세요" : "뚜껑 가까이 손을 가져가세요");
          return;
        }

        // ── 그 밖(침수·전환 대기) — 손으로 할 일이 없다 ─────────────────
        if (rinseSettling() || soakActive() || drainSettling()) {
          setHandHud("tracking", rinseSettling() ? "다 헹궜어요" : soakActive() ? "쌀이 물을 머금는 중" : "물이 다 빠졌어요");
          return;
        }

        // ── 냉각 — 손을 좌우로 흔들어 부친다 ────────────────────────────
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
        kneadPulse = Math.max(0, kneadPulse - dt * 2.6);
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
      const POUR_TARGET_RADIUS = 0.23;
      const POUR_TILT_RAD = THREE.MathUtils.degToRad(38);
      const POUR_DURATION_MS = 1200;
      const REQUIRED_RICE_SCOOPS = 3;
      const PHASES = ["RICE", "NURUK", "WATER", "KNEAD", "COMPLETE"] as const;
      type MixPhase = (typeof PHASES)[number];
      type PourPhase = "NURUK" | "WATER";
      type PourActor = {
        phase: PourPhase;
        label: string;
        node: THREE.Group;
        home: THREE.Vector3;
        radius: number;
      };

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

      const lidRig = new THREE.Group();
      const lidHome = new THREE.Vector3(0.27, platformTop, -0.1);
      let lidReady = false;
      let lidHeight = 0.07;
      let lidRadius = 0.13;
      const lidGltf = LOADED[MITSUL_LID_ID];
      if (lidGltf?.scene) {
        const lidModel = skinnedClone(lidGltf.scene) as THREE.Object3D;
        lidModel.scale.setScalar(JAR_SCALE);
        lidModel.traverse((object: THREE.Object3D) => {
          const mesh = object as THREE.Mesh;
          if (!mesh.isMesh) return;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          if (Array.isArray(mesh.material)) mesh.material = mesh.material.map((material) => material.clone());
          else if (mesh.material) mesh.material = mesh.material.clone();
        });
        const bounds = new THREE.Box3().setFromObject(lidModel);
        const center = bounds.getCenter(new THREE.Vector3());
        const size = bounds.getSize(new THREE.Vector3());
        lidModel.position.set(-center.x, -bounds.min.y, -center.z);
        lidRig.add(lidModel);
        lidHeight = size.y;
        lidRadius = Math.max(size.x, size.z) * 0.5;
        lidReady = true;
      }
      lidRig.position.copy(lidHome);
      lidRig.visible = false;
      stageGroup.add(lidRig);

      const lidSnapY = platformTop + jarHeight - Math.min(0.025, lidHeight * 0.25);
      const lidTargetMarker = new THREE.Mesh(
        new THREE.RingGeometry(Math.max(0.03, mashRadius * 0.7), Math.max(0.04, mashRadius * 1.12), 40)
          .rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({
          color: 0x52d8ff, transparent: true, opacity: 0.72,
          side: THREE.DoubleSide, depthTest: false,
        })
      );
      lidTargetMarker.position.set(0, jarHeight + 0.012, 0);
      lidTargetMarker.renderOrder = 9;
      lidTargetMarker.visible = false;
      jarRig.add(lidTargetMarker);

      const fermentBubbles = makeParticles(42, {
        color: 0xf6dfae, size: 0.006, opacity: 0, speed: 0.16,
        radius: Math.max(0.08, jarWidth * 0.42),
        baseY: platformTop + jarHeight * 0.45,
        height: Math.max(0.12, jarHeight * 0.7),
        taper: 0.22,
      });
      fermentBubbles.visible = false;
      fermentBubbles.geometry.setDrawRange(0, 10);
      stageGroup.add(fermentBubbles);
      live.particles.push(fermentBubbles);
      const fermentGlow = new THREE.PointLight(0xe6a45f, 0, 0.75);
      fermentGlow.position.set(0, platformTop + jarHeight * 0.55, 0);
      stageGroup.add(fermentGlow);

      const actors: PourActor[] = [];
      const addActor = (phase: PourPhase, label: string, node: THREE.Group, home: THREE.Vector3) => {
        node.position.copy(home);
        node.userData.baseRotation = node.rotation.clone();
        stageGroup.add(node);
        const size = new THREE.Box3().setFromObject(node).getSize(new THREE.Vector3());
        actors.push({
          phase,
          label,
          node,
          home,
          radius: Math.max(size.x, size.z) * 0.5,
        });
      };

      const trayActor = new THREE.Group();
      const trayHome = new THREE.Vector3(-0.27, platformTop + 0.055, 0.08);
      let trayWidth = 0.18;
      let trayDepth = 0.3;
      let traySurfaceY = 0.04;
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
        trayWidth = size.x * 0.94;
        trayDepth = size.z * 0.94;
        traySurfaceY = size.y + 0.016;
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
      trayActor.position.copy(trayHome);
      stageGroup.add(trayActor);

      // RICE에서는 tray가 아니라 손에 붙는 작은 한 움큼만 움직인다.
      const riceClump = new THREE.Group();
      const clumpMaterial = new THREE.MeshStandardMaterial({ color: 0xeee5cf, map: riceTexture, roughness: 0.98 });
      const clumpParts = [
        { p: [-0.018, 0, 0], s: [0.032, 0.02, 0.027] },
        { p: [0.014, 0.002, 0.004], s: [0.03, 0.019, 0.026] },
        { p: [0, 0.006, -0.015], s: [0.028, 0.018, 0.025] },
      ];
      clumpParts.forEach(({ p, s }) => {
        const part = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), clumpMaterial);
        part.position.set(p[0], p[1], p[2]);
        part.scale.set(s[0], s[1], s[2]);
        part.castShadow = part.receiveShadow = true;
        riceClump.add(part);
      });
      riceClump.visible = false;
      stageGroup.add(riceClump);

      /** 물통 속에 담긴 물 — 부은 만큼 줄어든다 */
      let mitsulWaterLiquid: THREE.Mesh | null = null;
      let mitsulWaterFull = 0;
      let mitsulWaterBaseY = 0;

      const nurukActor = new THREE.Group();
      // 누룩은 재료 고르기에 놓이는 것과 같은 덩어리를 쓴다.
      // 단계마다 다른 누룩이 나오면 같은 재료라는 게 읽히지 않는다.
      const nurukProp = INGREDIENTS.find((ingredient) => ingredient.id === "nuruk")?.prop;
      const nurukNode = nurukProp
        ? spawnModel({
            id: "prop_nuruk", file: nurukProp.file, step: "ingredient",
            height: 0.09, y: 0, scaleFactor: nurukProp.scaleFactor,
          })
        : null;
      if (nurukNode) {
        nurukActor.add(nurukNode);
      } else {
        // 모델을 못 받았을 때를 위한 대체 — 누룩을 담은 그릇 모양
        const bowl = new THREE.Mesh(
          new THREE.CylinderGeometry(0.072, 0.055, 0.045, 32, 1, true),
          new THREE.MeshStandardMaterial({ color: 0x8c623d, roughness: 0.9, side: THREE.DoubleSide })
        );
        bowl.position.y = 0.0225;
        bowl.castShadow = bowl.receiveShadow = true;
        nurukActor.add(bowl);
        const nurukTop = new THREE.Mesh(
          new THREE.CircleGeometry(0.058, 32).rotateX(-Math.PI / 2),
          new THREE.MeshStandardMaterial({ color: 0xc29b63, roughness: 1 })
        );
        nurukTop.position.y = 0.046;
        nurukActor.add(nurukTop);
      }
      addActor("NURUK", "누룩", nurukActor, new THREE.Vector3(0.27, platformTop + 0.03, 0.06));

      const waterActor = new THREE.Group();
      // 물은 재료 고르기에 나오는 그 물통을 그대로 쓴다. 단계마다 다른 그릇이
      // 나오면 같은 재료라는 게 읽히지 않는다.
      const waterProp = INGREDIENTS.find((ingredient) => ingredient.id === "water")?.prop;
      const waterModel = waterProp
        ? spawnModel({
            id: "prop_water", file: waterProp.file, step: "ingredient",
            height: 0.17, y: 0, scaleFactor: waterProp.scaleFactor,
          })
        : null;
      if (waterModel) {
        waterActor.add(waterModel);
        // 통 속에 담긴 물 — 부을수록 줄어든다 (재료 고르기와 같은 방식)
        if (waterProp?.liquid) {
          const wb = new THREE.Box3().setFromObject(waterModel);
          const wh = wb.max.y - wb.min.y;
          const ww = Math.min(wb.max.x - wb.min.x, wb.max.z - wb.min.z);
          const r = ww * 0.34;
          mitsulWaterLiquid = new THREE.Mesh(
            new THREE.CylinderGeometry(r, r, 1, 20, 1, false),
            new THREE.MeshStandardMaterial({
              color: waterProp.liquid.color, roughness: 0.15, metalness: 0,
              transparent: true, opacity: 0.85,
            })
          );
          mitsulWaterFull = wh * 0.6;
          mitsulWaterBaseY = wh * 0.05;
          waterActor.add(mitsulWaterLiquid);
        }
      } else {
        const fallbackWater = new THREE.Mesh(
          new THREE.CylinderGeometry(0.045, 0.055, 0.13, 32),
          new THREE.MeshStandardMaterial({ color: 0x7c6950, roughness: 0.86 })
        );
        fallbackWater.position.y = 0.065;
        waterActor.add(fallbackWater);
      }
      addActor("WATER", "물통", waterActor, new THREE.Vector3(0.27, platformTop + 0.03, 0.06));

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
      let hasRiceScoop = false;
      let riceDropActive = false;
      let riceDropProgress = 0;
      let finishRiceAfterDrop = false;
      let riceClumpDepth = 1;
      let riceStablePose: "OPEN" | "CLOSED" | null = null;
      let riceCandidatePose: "OPEN" | "CLOSED" | null = null;
      let riceCandidateSince = 0;
      let riceLastSeenAt = -Infinity;
      let lidHeld = false;
      let lidHeldDepth = 1;
      let lidReturning = false;
      let fermentElapsed = 0;
      let lastFermentUiAt = -Infinity;
      const actorWorld = new THREE.Vector3();
      const actorScreen = { x: 0.5, y: 0.5 };
      const followTarget = new THREE.Vector3();
      const jarOpeningWorld = new THREE.Vector3();
      const jarOpeningLocal = new THREE.Vector3();
      const jarOpeningScreen = { x: 0.5, y: 0.5 };
      const mashCenterWorld = new THREE.Vector3();
      const mashCenterScreen = { x: 0.5, y: 0.5 };
      const trayCenterWorld = new THREE.Vector3();
      const trayRightWorld = new THREE.Vector3();
      const trayFrontWorld = new THREE.Vector3();
      const trayCenterScreen = { x: 0.5, y: 0.5 };
      const trayRightScreen = { x: 0.5, y: 0.5 };
      const trayFrontScreen = { x: 0.5, y: 0.5 };
      const lidWorld = new THREE.Vector3();
      const lidScreen = { x: 0.5, y: 0.5 };
      const mashRightWorld = new THREE.Vector3();
      const mashFrontWorld = new THREE.Vector3();
      const mashRightScreen = { x: 0.5, y: 0.5 };
      const mashFrontScreen = { x: 0.5, y: 0.5 };

      const phaseIndex = (phase: MixPhase) => PHASES.indexOf(phase);
      const activeActor = () => actors.find((actor) => actor.phase === S.mitsulPhase) ?? null;
      const riceMashColor = new THREE.Color(0xeadfc4);
      const nurukMashColor = new THREE.Color(0xc9ad78);
      const wetMashColor = new THREE.Color(0xc2ae86);
      const finalMashColor = new THREE.Color(0xbda274);
      const fermentedMashColor = new THREE.Color(0x9f8157);
      const mixedMashColor = new THREE.Color();
      const setMixDebug = (id: string, value: string) => {
        const element = $(id);
        if (element) element.textContent = value;
      };

      function syncActorVisibility() {
        trayActor.visible = S.mitsulPhase === "RICE";
        actors.forEach((actor) => { actor.node.visible = actor.phase === S.mitsulPhase; });
        lidRig.visible = S.mitsulDone;
        lidTargetMarker.visible = mitsulFermentDebug
          && S.mitsulDone
          && S.mitsulFermentPhase === "LID"
          && !S.mitsulLidSnapped;
      }

      function applyMixVisual() {
        const phase = S.mitsulPhase as MixPhase;
        const index = phaseIndex(phase);
        const pour = S.mitsulPourProgress;
        mash.visible = index > 0 || (phase === "RICE" && pour > 0);
        liquid.visible = index > 2 || (phase === "WATER" && pour > 0);
        const riceAmount = index > 0 ? 1 : phase === "RICE" ? pour : 0;
        const nurukAmount = index > 1 ? 1 : phase === "NURUK" ? pour : 0;
        const waterAmount = index > 2 ? 1 : phase === "WATER" ? pour : 0;
        // 통 속에 남은 물 — 부은 만큼 줄어든다
        if (mitsulWaterLiquid) {
          const left = Math.max(0.0001, mitsulWaterFull * (1 - waterAmount));
          mitsulWaterLiquid.scale.set(1, left, 1);
          mitsulWaterLiquid.position.y = mitsulWaterBaseY + left / 2;
          mitsulWaterLiquid.visible = waterAmount < 0.98;
        }
        const riceAmountScale = THREE.MathUtils.lerp(0.72, 1, riceAmount);
        liquid.scale.setScalar(THREE.MathUtils.lerp(0.55, 1, waterAmount));
        liquidMaterial.opacity = THREE.MathUtils.lerp(0.12, 0.42, waterAmount);

        const kneadProgress = phase === "COMPLETE" ? 1 : phase === "KNEAD" ? kneadSnapshot.progress : 0;
        const fermentationProgress = S.mitsulFermentProgress;
        const height = THREE.MathUtils.lerp(mashStartHeight, mashFinalHeight, kneadProgress);
        // 한 번 치댈 때마다 옆으로 퍼지면서 살짝 눌린다. 반응이 작으면
        // 손을 쥐었다 폈는데 아무 일도 안 일어난 것처럼 보인다.
        const spread = riceAmountScale * THREE.MathUtils.lerp(0.94, 1.04, kneadProgress) + kneadPulse * 0.085;
        mash.scale.set(spread, (height / mashStartHeight) * (1 - kneadPulse * 0.16), spread);
        mash.position.y = mashBottomY + height * 0.5 + kneadPulse * 0.006;
        liquid.position.y = mashBottomY + height + 0.004 + waterAmount * 0.008;
        targetOutline.position.y = liquid.position.y + 0.006;
        mixedMashColor.copy(riceMashColor)
          .lerp(nurukMashColor, nurukAmount)
          .lerp(wetMashColor, waterAmount * 0.58)
          .lerp(finalMashColor, kneadProgress)
          .lerp(fermentedMashColor, fermentationProgress * 0.72);
        mashMaterial.color.copy(mixedMashColor);
        mashMaterial.roughness = THREE.MathUtils.lerp(0.96, 0.88, waterAmount);
        mash.scale.y *= 1 + fermentationProgress * 0.08;

        const riceSource = trayActor.getObjectByName("mitsul-rice-source");
        if (riceSource) {
          const remaining = phase === "RICE" ? 1 - S.mitsulRiceScoops / REQUIRED_RICE_SCOOPS : index > 0 ? 0 : 1;
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
        setMixDebug("#mitsul-debug-grab", held || hasRiceScoop ? "YES" : "NO");
        setMixDebug("#mitsul-debug-target", nearJar ? "IN" : "OUT");
        setMixDebug("#mitsul-debug-tilt", `${THREE.MathUtils.radToDeg(tilt).toFixed(0)}°`);
        setMixDebug("#mitsul-debug-pour", `${Math.round(S.mitsulPourProgress * 100)}%`);
        setMixDebug("#mitsul-debug-has-scoop", hasRiceScoop ? "YES" : "NO");
        setMixDebug("#mitsul-debug-scoops", `${S.mitsulRiceScoops} / ${REQUIRED_RICE_SCOOPS}`);
        setMixDebug("#mitsul-debug-knead", `${S.mitsulKneadCount} / ${KNEAD.TARGET_KNEAD_COUNT}`);
        setMixDebug("#mitsul-debug-on-mash", onMash ? "YES" : "NO");
        setMixDebug("#mitsul-debug-jar", jarReady ? "READY" : "MISSING");
        setMixDebug("#mitsul-debug-rice", index > 0 ? "DONE" : index === 0 && S.mitsulPourProgress > 0 ? "POURING" : "WAIT");
        setMixDebug("#mitsul-debug-nuruk", index > 1 ? "DONE" : index === 1 && S.mitsulPourProgress > 0 ? "POURING" : "WAIT");
        setMixDebug("#mitsul-debug-water", index > 2 ? "DONE" : index === 2 && S.mitsulPourProgress > 0 ? "POURING" : "WAIT");
        $("#mitsul-debug-ok")?.classList.toggle("visible", S.mitsulDone);
      }

      function updateFermentPanel() {
        if (!mitsulFermentDebug) return;
        setMixDebug("#mitsul-ferment-debug-phase", S.mitsulFermentPhase);
        setMixDebug(
          "#mitsul-ferment-debug-lid",
          S.mitsulLidSnapped ? "SNAPPED" : lidHeld ? "GRABBED" : "FREE"
        );
        setMixDebug("#mitsul-ferment-debug-temp", `${S.temp}℃`);
        setMixDebug("#mitsul-ferment-debug-day", `${S.mitsulFermentDay} / 3`);
        setMixDebug("#mitsul-ferment-debug-progress", `${Math.round(S.mitsulFermentProgress * 100)}%`);
        const bubbleLevel = S.mitsulFermentPhase === "FERMENTING"
          ? Math.max(1, Math.ceil(S.mitsulFermentProgress * 3))
          : S.mitsulFermentDone ? 1 : 0;
        setMixDebug("#mitsul-ferment-debug-bubbles", String(bubbleLevel));
        $("#mitsul-ferment-debug-ok")?.classList.toggle("visible", S.mitsulFermentDone);
      }

      function inProjectedArea(
        point: { x: number; y: number },
        center: { x: number; y: number },
        right: { x: number; y: number },
        front: { x: number; y: number },
        padding = 1
      ) {
        const ax = right.x - center.x;
        const ay = right.y - center.y;
        const bx = front.x - center.x;
        const by = front.y - center.y;
        const px = point.x - center.x;
        const py = point.y - center.y;
        const det = ax * by - ay * bx;
        if (Math.abs(det) <= 1e-6) return false;
        const localX = (px * by - py * bx) / det;
        const localZ = (ax * py - ay * px) / det;
        return localX * localX + localZ * localZ <= padding * padding;
      }

      function updateRicePose(frame: HandFrame, now: number) {
        if (!frame.present || frame.landmarks.length < 21) {
          if (now - riceLastSeenAt >= KNEAD.HAND_LOST_TIMEOUT) {
            riceStablePose = null;
            riceCandidatePose = null;
            riceCandidateSince = 0;
          }
          return null;
        }
        riceLastSeenAt = now;
        const ratio = kneadHandMetric(frame).handRatio;
        const next = ratio >= KNEAD.OPEN_THRESHOLD
          ? "OPEN"
          : ratio <= KNEAD.CLOSED_THRESHOLD
            ? "CLOSED"
            : null;
        if (!next || next === riceStablePose) {
          riceCandidatePose = null;
          riceCandidateSince = 0;
          return null;
        }
        if (next !== riceCandidatePose) {
          riceCandidatePose = next;
          riceCandidateSince = now;
          return null;
        }
        if (now - riceCandidateSince < KNEAD.POSE_HOLD_MS) return null;
        riceStablePose = next;
        riceCandidatePose = null;
        riceCandidateSince = 0;
        return next;
      }

      /** 한 번 붓기 시작하면 그 재료를 다 부을 때까지 이어진다 */
      let pourLatched = false;

      function clampHeldAboveMouth(actor: PourActor) {
        jarOpeningLocal.copy(jarOpeningWorld);
        stageGroup.worldToLocal(jarOpeningLocal);
        let dx = actor.node.position.x - jarOpeningLocal.x;
        let dz = actor.node.position.z - jarOpeningLocal.z;
        let distance = Math.hypot(dx, dz);
        if (distance < 1e-4) {
          dx = actor.home.x - jarOpeningLocal.x || 1;
          dz = actor.home.z - jarOpeningLocal.z;
          distance = Math.hypot(dx, dz);
        }
        const standOff = mashRadius + actor.radius * 0.62;
        actor.node.position.x = jarOpeningLocal.x + dx / distance * standOff;
        actor.node.position.z = jarOpeningLocal.z + dz / distance * standOff;
        const tiltedBottomClearance = actor.radius * Math.abs(Math.sin(actor.node.rotation.z)) + 0.025;
        actor.node.position.y = Math.max(actor.node.position.y, jarOpeningLocal.y + tiltedBottomClearance);
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
        pourLatched = false;   // 다음 재료는 다시 항아리 위로 가져와야 시작한다
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

      function snapLid() {
        lidHeld = false;
        lidReturning = false;
        lidRig.position.set(0, lidSnapY, 0);
        lidRig.rotation.set(0, 0, 0);
        S.mitsulLidSnapped = true;
        S.mitsulFermentPhase = "TEMPERATURE";
        S.temp = 20;
        handTracker?.setPaused(true);
        syncActorVisibility();
        syncMitsulMixUi();
        updateFermentPanel();
        setHandHud("dropped", "발효를 위해 항아리 뚜껑을 닫았어요");
      }

      startMitsulFermentation = () => {
        if (S.mitsulFermentPhase !== "TEMPERATURE" || !S.mitsulLidSnapped || S.temp !== 25) return;
        S.mitsulFermentPhase = "FERMENTING";
        S.mitsulFermentProgress = 0;
        S.mitsulFermentDay = 1;
        S.mitsulFermentDone = false;
        fermentElapsed = 0;
        fermentBubbles.visible = true;
        syncMitsulMixUi();
        updateFermentPanel();
      };

      resetMitsulFermentInteraction = () => {
        lidHeld = false;
        lidReturning = false;
        fermentElapsed = 0;
        lastFermentUiAt = -Infinity;
        lidRig.position.copy(lidHome);
        lidRig.rotation.set(0, 0, 0);
        S.mitsulFermentPhase = "LID";
        S.mitsulLidSnapped = false;
        S.temp = 20;
        S.mitsulFermentProgress = 0;
        S.mitsulFermentDay = 0;
        S.mitsulFermentDone = false;
        S.ferment = 0;
        fermentBubbles.visible = false;
        fermentBubbles.material.opacity = 0;
        fermentBubbles.geometry.setDrawRange(0, 10);
        fermentGlow.intensity = 0;
        if (S.step === "ferment") handTracker?.setPaused(false);
        syncActorVisibility();
        applyMixVisual();
        syncMitsulMixUi();
        updateFermentPanel();
        setHandHud("tracking", "작업대의 항아리 뚜껑을 집어주세요");
      };

      resetMitsulMixInteraction = () => {
        returnHeldHome();
        kneadGesture.reset();
        kneadSnapshot = emptyKneadSnapshot();
        S.mitsulPhase = "RICE";
        S.mitsulPourProgress = 0;
        S.mitsulRiceScoops = 0;
        S.mitsulKneadCount = 0;
        S.mitsulDone = false;
        S.mitsulFermentPhase = "LID";
        S.mitsulLidSnapped = false;
        S.mitsulFermentProgress = 0;
        S.mitsulFermentDay = 0;
        S.mitsulFermentDone = false;
        S.temp = 20;
        hasRiceScoop = false;
        riceDropActive = false;
        riceDropProgress = 0;
        finishRiceAfterDrop = false;
        riceStablePose = null;
        riceCandidatePose = null;
        riceCandidateSince = 0;
        riceLastSeenAt = -Infinity;
        riceClump.visible = false;
        riceClump.scale.setScalar(1);
        trayActor.position.copy(trayHome);
        trayActor.rotation.set(0, 0, 0);
        lidHeld = false;
        lidReturning = false;
        fermentElapsed = 0;
        lastFermentUiAt = -Infinity;
        lidRig.position.copy(lidHome);
        lidRig.rotation.set(0, 0, 0);
        fermentBubbles.visible = false;
        fermentBubbles.material.opacity = 0;
        fermentGlow.intensity = 0;
        S.ferment = 0;
        kneadPulse = 0;
        targetOutline.visible = false;
        handTracker?.setPaused(false);
        syncActorVisibility();
        applyMixVisual();
        syncMitsulMixUi();
        updateMixPanel(null);
        setHandHud("tracking", "채반 위에서 고두밥을 한 움큼 집어주세요");
      };

      const resetButton = $("#mitsul-debug-reset") as HTMLButtonElement | null;
      if (resetButton) resetButton.onclick = resetMitsulMixInteraction;
      const resetFermentButton = $("#mitsul-ferment-debug-reset") as HTMLButtonElement | null;
      if (resetFermentButton) resetFermentButton.onclick = resetMitsulFermentInteraction;
      if (S.mitsulDone && S.mitsulPhase === "COMPLETE") resetMitsulFermentInteraction();
      else resetMitsulMixInteraction();

      live.onHand = (frame, hand) => {
        const now = performance.now();
        const phase = S.mitsulPhase as MixPhase;
        jarRig.updateWorldMatrix(true, true);
        jarRig.localToWorld(jarOpeningWorld.set(0, jarHeight + 0.008, 0));
        worldToScreen(jarOpeningWorld, camera, jarOpeningScreen);

        if (phase === "COMPLETE" && S.mitsulFermentPhase === "LID") {
          if (!frame.present) {
            if (lidHeld) {
              lidHeld = false;
              lidReturning = true;
            }
            setHandHud("idle", "손을 카메라에 비춰 주세요");
            updateFermentPanel();
            return;
          }
          const pinch = hand.pinchScreen;
          if (lidHeld) {
            // 뚜껑이 항아리에 파묻히지 않도록 언제나 항아리보다 앞에 둔다.
            const jarDepth = camera.getWorldPosition(handOrigin).distanceTo(jarOpeningWorld);
            const showDepth = Math.max(0.3, Math.min(lidHeldDepth, jarDepth * 0.88));
            screenToWorld(pinch.x, pinch.y, showDepth, camera, followTarget);
            stageGroup.worldToLocal(followTarget);
            followTarget.x = THREE.MathUtils.clamp(followTarget.x, -0.46, 0.46);
            followTarget.z = THREE.MathUtils.clamp(followTarget.z, -0.4, 0.4);
            followTarget.y = Math.max(platformTop + 0.015, followTarget.y);
            lidRig.position.lerp(followTarget, 0.5);
            const nearMouth = screenDist(pinch, jarOpeningScreen) <= 0.22;
            if (nearMouth) {
              lidRig.position.x = THREE.MathUtils.lerp(lidRig.position.x, 0, 0.55);
              lidRig.position.z = THREE.MathUtils.lerp(lidRig.position.z, 0, 0.55);
              lidRig.position.y = Math.max(lidRig.position.y, lidSnapY + 0.04);
              // 항아리 위에 가져다 대기만 하면 닫힌다.
              // 손을 펴는 순간과 위치 조건을 모두 맞춰야 닫히게 하면,
              // 놓을 때 손 모양이 흔들리면서 아무리 해도 안 닫히고 여기서 막힌다.
              snapLid();
              updateFermentPanel();
              return;
            }
            if (frame.justReleased) {
              lidHeld = false;
              lidReturning = true;
              setHandHud("tracking", "항아리 입구 위에서 뚜껑을 놓아주세요");
            } else {
              setHandHud("holding", "뚜껑을 항아리 입구 위로 옮겨주세요");
            }
            updateFermentPanel();
            return;
          }

          lidRig.getWorldPosition(lidWorld);
          lidWorld.y += lidHeight * 0.5;
          worldToScreen(lidWorld, camera, lidScreen);
          const hovering = lidReady && screenDist(pinch, lidScreen) <= 0.13;
          if (hovering && frame.justPinched) {
            lidHeld = true;
            lidReturning = false;
            lidHeldDepth = camera.getWorldPosition(handOrigin).distanceTo(lidWorld);
            setHandHud("holding", "항아리 뚜껑을 집었어요");
          } else {
            setHandHud(hovering ? "hover" : "tracking", hovering
              ? "엄지와 검지를 붙여 뚜껑을 집으세요"
              : "작업대의 항아리 뚜껑으로 손을 옮겨주세요");
          }
          updateFermentPanel();
          return;
        }

        if (phase === "RICE") {
          const rawPalm = palmCenter(frame);
          const palm = rawPalm ? toScreen(rawPalm, handFit) : { x: 0.5, y: 0.5 };
          const poseChanged = updateRicePose(frame, now);
          let onTray = false;
          if (rawPalm) {
            trayActor.updateWorldMatrix(true, true);
            trayActor.localToWorld(trayCenterWorld.set(0, traySurfaceY, 0));
            trayActor.localToWorld(trayRightWorld.set(trayWidth * 0.5, traySurfaceY, 0));
            trayActor.localToWorld(trayFrontWorld.set(0, traySurfaceY, trayDepth * 0.5));
            worldToScreen(trayCenterWorld, camera, trayCenterScreen);
            worldToScreen(trayRightWorld, camera, trayRightScreen);
            worldToScreen(trayFrontWorld, camera, trayFrontScreen);
            onTray = inProjectedArea(palm, trayCenterScreen, trayRightScreen, trayFrontScreen, 1.04);
          }
          const overMouth = rawPalm !== null && screenDist(palm, jarOpeningScreen) <= POUR_TARGET_RADIUS;

          if (!frame.present) {
            if (hasRiceScoop && now - riceLastSeenAt >= KNEAD.HAND_LOST_TIMEOUT) {
              hasRiceScoop = false;
              riceClump.visible = false;
            }
            updateMixPanel(frame, false);
            setHandHud("idle", "손을 카메라에 비춰 주세요");
            return;
          }

          if (hasRiceScoop) {
            screenToWorld(palm.x, palm.y, riceClumpDepth, camera, followTarget);
            stageGroup.worldToLocal(followTarget);
            riceClump.position.lerp(followTarget, 0.5);
            if (overMouth) {
              jarOpeningLocal.copy(jarOpeningWorld);
              stageGroup.worldToLocal(jarOpeningLocal);
              riceClump.position.x = THREE.MathUtils.lerp(riceClump.position.x, jarOpeningLocal.x, 0.5);
              riceClump.position.z = THREE.MathUtils.lerp(riceClump.position.z, jarOpeningLocal.z, 0.5);
              riceClump.position.y = Math.max(riceClump.position.y, jarOpeningLocal.y + 0.04);
            }
            if (poseChanged === "OPEN" && overMouth) {
              hasRiceScoop = false;
              riceDropActive = true;
              riceDropProgress = 0;
              S.mitsulRiceScoops = Math.min(REQUIRED_RICE_SCOOPS, S.mitsulRiceScoops + 1);
              S.mitsulPourProgress = S.mitsulRiceScoops / REQUIRED_RICE_SCOOPS;
              finishRiceAfterDrop = S.mitsulRiceScoops >= REQUIRED_RICE_SCOOPS;
              applyMixVisual();
              syncMitsulMixUi();
              setHandHud("dropped", `고두밥 투입 ${S.mitsulRiceScoops}/${REQUIRED_RICE_SCOOPS}`);
            } else if (!overMouth) {
              setHandHud("holding", "고두밥 한 움큼을 항아리 입구 위로 옮겨주세요");
            } else {
              setHandHud("holding", "항아리 위에서 손을 펼쳐 고두밥을 놓아주세요");
            }
          } else if (!riceDropActive && poseChanged === "CLOSED" && onTray) {
            hasRiceScoop = true;
            riceClump.visible = true;
            riceClump.scale.setScalar(1);
            riceClump.position.copy(trayCenterWorld);
            stageGroup.worldToLocal(riceClump.position);
            riceClumpDepth = camera.getWorldPosition(handOrigin).distanceTo(trayCenterWorld);
            setHandHud("holding", "고두밥 한 움큼을 집었어요");
          } else if (riceDropActive) {
            setHandHud("dropped", "고두밥이 항아리에 떨어지는 중이에요");
          } else if (!onTray) {
            setHandHud("tracking", "손바닥을 채반 위 고두밥으로 옮겨주세요");
          } else {
            setHandHud("hover", "채반 위에서 손을 오므려 한 움큼 집어주세요");
          }
          updateMixPanel(frame, overMouth);
          return;
        }

        if (phase === "KNEAD" || phase === "COMPLETE") {
          const rawPalm = palmCenter(frame);
          const palm = rawPalm ? toScreen(rawPalm, handFit) : { x: 0.5, y: 0.5 };
          let onMash = false;
          if (rawPalm) {
            jarRig.localToWorld(mashCenterWorld.set(0, liquid.position.y, 0));
            jarRig.localToWorld(mashRightWorld.set(mashRadius, liquid.position.y, 0));
            jarRig.localToWorld(mashFrontWorld.set(0, liquid.position.y, mashRadius));
            worldToScreen(mashCenterWorld, camera, mashCenterScreen);
            worldToScreen(mashRightWorld, camera, mashRightScreen);
            worldToScreen(mashFrontWorld, camera, mashFrontScreen);
            onMash = inProjectedArea(palm, mashCenterScreen, mashRightScreen, mashFrontScreen, KNEAD.TARGET_PADDING);
          }
          if (phase === "KNEAD") {
            kneadSnapshot = kneadGesture.update(frame, onMash);
            S.mitsulKneadCount = kneadSnapshot.count;
            if (kneadSnapshot.justKneaded) kneadPulse = 1;
            if (kneadSnapshot.state === "COMPLETE") {
              S.mitsulPhase = "COMPLETE";
              S.mitsulDone = true;
              S.mitsulFermentPhase = "LID";
              S.mitsulLidSnapped = false;
              S.mitsulFermentProgress = 0;
              S.mitsulFermentDay = 0;
              S.mitsulFermentDone = false;
              lidRig.position.copy(lidHome);
              lidRig.rotation.set(0, 0, 0);
              targetOutline.visible = false;
              syncActorVisibility();
            }
            applyMixVisual();
            syncMitsulMixUi();
            updateMixPanel(frame, false, 0, onMash);
            if (S.mitsulDone) setHandHud("dropped", "혼합 완료 · 항아리 뚜껑을 닫아주세요");
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
          // 항아리보다 뒤에 놓이면 그릇이 항아리에 파묻혀 붓는 게 안 보인다.
          // 재료 고르기와 같은 방식으로, 든 것은 언제나 항아리 앞에 온다.
          const jarDepth = camera.getWorldPosition(handOrigin).distanceTo(jarOpeningWorld);
          const showDepth = Math.max(0.3, Math.min(heldDepth, jarDepth * 0.88));
          screenToWorld(pinch.x, pinch.y, showDepth, camera, followTarget);
          stageGroup.worldToLocal(followTarget);
          held.node.position.lerp(followTarget, 0.48);
          const nearJar = screenDist(pinch, jarOpeningScreen) <= POUR_TARGET_RADIUS;
          if (nearJar) clampHeldAboveMouth(held);
          // 손목을 정확히 꺾어야만 부어지게 하지 않는다. 항아리 위에 올리면 부어지고,
          // 기울기는 그 결과로 따라온다 — 그래야 "올렸는데 왜 안 부어지지"가 안 생긴다.
          if (frame.pinching && nearJar) pourLatched = true;
          pouring = pourLatched;
          // 제자리 기준으로 항아리 쪽으로 기운다 — 오른쪽 재료는 왼쪽으로 기울어
          // 그 손으로 붓는 옆모습이 나온다.
          const visualTilt = pouring
            ? (held.home.x >= jarOpeningLocal.x ? POUR_TILT_RAD : -POUR_TILT_RAD)
            : THREE.MathUtils.clamp(signedTilt, -Math.PI / 2, Math.PI / 2);
          held.node.rotation.z = THREE.MathUtils.lerp(held.node.rotation.z, visualTilt, 0.24);
          if (pouring) {
            const elapsed = Math.min(80, Math.max(0, now - lastPourAt));
            S.mitsulPourProgress = Math.min(1, S.mitsulPourProgress + elapsed / POUR_DURATION_MS);
            stream.visible = true;
            streamMaterial.color.setHex(phase === "NURUK" ? 0xb88a4d : 0x7fc8dd);
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

      live.tick = (time, dt) => {
        kneadPulse = Math.max(0, kneadPulse - dt * 2.6);
        if (lidReturning) {
          lidRig.position.lerp(lidHome, Math.min(1, dt * 7));
          lidRig.rotation.x = THREE.MathUtils.lerp(lidRig.rotation.x, 0, Math.min(1, dt * 7));
          lidRig.rotation.y = THREE.MathUtils.lerp(lidRig.rotation.y, 0, Math.min(1, dt * 7));
          lidRig.rotation.z = THREE.MathUtils.lerp(lidRig.rotation.z, 0, Math.min(1, dt * 7));
          if (lidRig.position.distanceTo(lidHome) < 0.004) {
            lidRig.position.copy(lidHome);
            lidReturning = false;
          }
        }

        if (S.mitsulFermentPhase === "FERMENTING") {
          const TIMELAPSE_SECONDS = 7.5;
          fermentElapsed = Math.min(TIMELAPSE_SECONDS, fermentElapsed + dt);
          S.mitsulFermentProgress = fermentElapsed / TIMELAPSE_SECONDS;
          S.mitsulFermentDay = Math.min(3, Math.floor(S.mitsulFermentProgress * 3) + 1);
          S.ferment = S.mitsulFermentProgress * 100;
          const activity = S.mitsulFermentProgress;
          fermentBubbles.visible = true;
          fermentBubbles.geometry.setDrawRange(0, Math.round(10 + activity * 32));
          const bubbleOptions = fermentBubbles.userData.opt as { speed: number };
          bubbleOptions.speed = 0.16 + activity * 0.38;
          fermentBubbles.material.opacity += ((0.18 + activity * 0.34) - fermentBubbles.material.opacity) * 0.1;
          fermentGlow.intensity += ((0.16 + activity * 0.34) - fermentGlow.intensity) * 0.08;
          if (time - lastFermentUiAt >= 0.1) {
            lastFermentUiAt = time;
            syncMitsulMixUi();
            updateFermentPanel();
          }
          if (S.mitsulFermentProgress >= 1) {
            S.mitsulFermentPhase = "COMPLETE";
            S.mitsulFermentDay = 3;
            S.mitsulFermentDone = true;
            S.fstage = Math.min(MASH_FIRST_STAGE, FERMENT_STEPS.length);
            fermentBubbles.geometry.setDrawRange(0, 14);
            syncMitsulMixUi();
            updateFermentPanel();
            // 밑술이 다 됐으니 덧술 무대로 넘어간다.
            // 지금은 이 무대의 tick 안이라, 무대를 갈아엎는 건 다음 프레임으로 미룬다.
            handOverToMash();
          }
        } else if (S.mitsulFermentPhase === "COMPLETE") {
          fermentBubbles.visible = true;
          fermentBubbles.material.opacity += (0.12 - fermentBubbles.material.opacity) * 0.06;
          fermentGlow.intensity += (0.12 - fermentGlow.intensity) * 0.06;
        }
        applyMixVisual();
        if (riceDropActive) {
          riceDropProgress = Math.min(1, riceDropProgress + dt / 0.34);
          jarRig.localToWorld(jarOpeningWorld.set(0, liquid.position.y, 0));
          stageGroup.worldToLocal(jarOpeningWorld);
          riceClump.position.lerp(jarOpeningWorld, Math.min(1, dt * 10));
          riceClump.scale.setScalar(1 - riceDropProgress * 0.72);
          if (riceDropProgress >= 1) {
            riceDropActive = false;
            riceClump.visible = false;
            riceClump.scale.setScalar(1);
            if (finishRiceAfterDrop) {
              finishRiceAfterDrop = false;
              advancePhase();
            }
          }
        }
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
          } else if (agingPhase === "snapping") {
            agingT += dt;
            agingJar.position.lerp(jarTarget, Math.min(1, dt * 8.5));
            agingJar.scale.lerp(new THREE.Vector3(0.94, 0.94, 0.94), Math.min(1, dt * 7));
            coldFloorGlowMaterial.opacity += (0.72 - coldFloorGlowMaterial.opacity) * Math.min(1, dt * 8);
            coldFloorGlow.scale.setScalar(1.02 + Math.sin(_t * 5.2) * 0.035);
            if (agingJar.position.distanceTo(jarTarget) < 0.008 || agingT > 0.75) {
              agingJar.position.copy(jarTarget);
              agingJar.scale.setScalar(0.94);
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

    /**
     * 밑술 무대(혼합·1차 발효)에서 덧술 무대로 넘긴다.
     * 무대를 세우는 함수가 지금 돌고 있는 tick 을 지워 버리므로 한 프레임 뒤에 바꾼다.
     */
    let mashHandOverPending = false;
    function handOverToMash() {
      if (mashHandOverPending) return;
      mashHandOverPending = true;
      setTimeout(() => {
        mashHandOverPending = false;
        if (S.step !== "ferment") return;
        buildStageFor("ferment");
        syncFermentPhase();
      }, 0);
    }

    function buildStageFor(step: typeof S.step) {
      clearStage();
      if (!S.placed) return;
      if (step === "ingredient") buildIngredients();
      else if (step === "godubap") buildGodubap();
      else if (step === "ferment") {
        if (kneadDebug) buildKneadDebug();
        // 밑술(혼합 → 1차 발효)까지가 한 무대, 덧술부터 후발효까지가 다음 무대다.
        // 둘은 만든 사람도 다루는 방식도 달라서 fstage 로 갈라 세운다.
        else if (productionMitsulMix && S.fstage < MASH_FIRST_STAGE) buildMitsulMix();
        else buildFerment();
      }
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
        if (productionCooling) resetCoolingInteraction?.();
        if (kneadDebug) resetKneadInteraction?.();
        if (productionMitsulMix) resetMitsulMixInteraction?.();
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
    // 항아리를 잡는 동안만 반응성을 높이고, 탐색 중에는 추론 빈도를 낮춰
    // 카메라 회전과 3D 렌더링에 GPU 시간을 더 배분한다.
    // 빠르게 움직이는 손을 따라가려면 표본이 촘촘해야 한다.
    const ACTIVE_AR_DETECT_MS = 56;
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

      if (!productionMitsulMix && S.step === "ferment" && S.fstage >= FERMENT_STEPS.length - 1 && S.ferment < 100) {
        const dist = Math.abs(S.temp - OPTIMAL_C);
        // 25℃에서 약 17초에 완주. 너무 빨리 끝나면 온도를 조절해 본 효과를 느끼기 어렵다.
        const rate = THREE.MathUtils.clamp(1 - dist / 9, 0.12, 1) * 6;
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
        handVisual.update(f, handCamera, handFit, Math.max(stageAt, 0.2));
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
        if (skipToMitsulFerment) {
          // 혼합 결과는 보존한 채 뚜껑 닫기부터 반복 QA한다.
          S.fstage = 0;
          S.ferment = 0;
          S.mitsulPhase = "COMPLETE";
          S.mitsulPourProgress = 0;
          S.mitsulRiceScoops = 3;
          S.mitsulKneadCount = KNEAD.TARGET_KNEAD_COUNT;
          S.mitsulDone = true;
          S.mitsulFermentPhase = "LID";
          S.mitsulLidSnapped = false;
          S.mitsulFermentProgress = 0;
          S.mitsulFermentDay = 0;
          S.mitsulFermentDone = false;
          S.temp = 20;
          setStep("ferment");
          syncMitsulMixUi();
        } else if (skipToMitsulMix) {
          // 공간 배치까지 정상 수행한 뒤 밑술 혼합의 첫 재료부터 시작한다.
          S.fstage = 0;
          S.ferment = 0;
          S.mitsulPhase = "RICE";
          S.mitsulPourProgress = 0;
          S.mitsulRiceScoops = 0;
          S.mitsulKneadCount = 0;
          S.mitsulDone = false;
          S.mitsulFermentPhase = "LID";
          S.mitsulLidSnapped = false;
          S.mitsulFermentProgress = 0;
          S.mitsulFermentDay = 0;
          S.mitsulFermentDone = false;
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
     * 고두밥 단계 진행 막대 — 헹구기·불리기·털기·찌기·식히기가 같은 자리를 나눠 쓴다.
     * 손으로 할 일이 있거나 저절로 흐르는 국면에서만 나타난다.
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
      } else if (rinseSettling()) {
        pct = 100;
        done = true;
        text = "다 헹궜어요 · 이제 물에 담가 둡니다";
      } else if (soakActive()) {
        const soaked = S.soakAt ? performance.now() - S.soakAt : 0;
        pct = Math.round(Math.min(1, soaked / SOAK_MS) * 100);
        done = pct >= 100;
        text = done ? "쌀이 다 불었어요" : "물에 담근 채로 잠시 기다려요";
      } else if (drainActive()) {
        pct = Math.round((S.shakes / REQUIRED_SHAKES) * 100);
        text =
          S.shakes === 0
            ? "소쿠리를 집고 위아래로 털어 주세요"
            : `물을 터는 중 · ${S.shakes}/${REQUIRED_SHAKES}번`;
      } else if (drainSettling()) {
        pct = 100;
        done = true;
        text = "물이 다 빠졌어요 · 이제 시루에 안칩니다";
      } else if (steamingStep()) {
        const steamed = S.lidAt ? performance.now() - S.lidAt : 0;
        pct = Math.round(Math.min(1, steamed / STEAM_MS) * 100);
        done = pct >= 100;
        text = !S.lidAt
          ? "옆에 놓인 뚜껑을 집어 솥 위로 가져가세요"
          : done
            ? "고두밥이 다 쪄졌어요"
            : "김이 오르는 중 · 잠시 기다려요";
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
                  : drainActive()
                    ? "소쿠리를 잡고 위아래로 털어 물을 빼주세요"
                    : steamingStep()
                      ? S.lidAt
                        ? "김이 오르는 동안 잠시 기다려요"
                        : "옆에 놓인 뚜껑을 집어 솥 위로 가져가주세요"
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
            : drainActive()
              ? "소쿠리를 털어 물을 빼 주세요"
              : steamingStep() && !S.lidAt
                ? "뚜껑을 덮어 주세요"
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
        S.mitsulPhase = "RICE";
        S.mitsulPourProgress = 0;
        S.mitsulRiceScoops = 0;
        S.mitsulKneadCount = 0;
        S.mitsulDone = false;
        S.mitsulFermentPhase = "LID";
        S.mitsulLidSnapped = false;
        S.mitsulFermentProgress = 0;
        S.mitsulFermentDay = 0;
        S.mitsulFermentDone = false;
        S.ferment = 0;
        S.mashTrayDone.clear();
        setStep("ferment");
        onFermentTick();
        syncFermentPhase();
      };

    /* --- 14 · 발효 --- */
    const tempInput = $("#temp") as HTMLInputElement | null;
    if (tempInput) {
      tempInput.oninput = () => {
        S.temp = +tempInput.value;
        if (productionMitsulMix && S.mitsulDone && S.mitsulFermentPhase === "TEMPERATURE") {
          syncMitsulMixUi();
          const debugTemp = $("#mitsul-ferment-debug-temp");
          if (debugTemp) debugTemp.textContent = `${S.temp}℃`;
        } else syncTemp();
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
          if (productionMitsulMix) return;
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
    function syncMitsulMixUi() {
      if (!productionMitsulMix) return;
      // 덧술로 넘어간 뒤에는 young 의 발효 UI 가 핀과 문구를 맡는다.
      if (S.fstage >= MASH_FIRST_STAGE) return;
      uiRoot!.classList.toggle(
        "mitsul-no-hands",
        S.mitsulDone && S.mitsulFermentPhase !== "LID"
      );
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
        RICE: `고두밥을 한 움큼씩 항아리에 담아주세요 · ${S.mitsulRiceScoops}/3`,
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

      if (S.mitsulDone) {
        const fermentPhase = S.mitsulFermentPhase;
        $$("#ferment-pills .pill").forEach((pill, index) => {
          (pill as HTMLElement).dataset.state = index === 0
            ? "done"
            : index === 1
              ? S.mitsulFermentDone ? "done" : "now"
              : "todo";
        });
        const fermentCaptions = {
          LID: "밑술 — 일양 · 발효를 위해 항아리 뚜껑을 닫아요",
          TEMPERATURE: "밑술 — 일양 · 1차 발효 온도를 25℃로 맞춰요",
          FERMENTING: `밑술 — 일양 · ${S.mitsulFermentDay}일차 발효 중`,
          COMPLETE: "밑술이 완성되었어요!",
        } satisfies Record<typeof fermentPhase, string>;
        const caption = $("#cap-ferment");
        if (caption) caption.textContent = fermentCaptions[fermentPhase];
        const hint = $("#ferment-hint");
        if (hint) hint.textContent = fermentPhase === "COMPLETE"
          ? "고두밥과 누룩, 물이 3일 동안 발효되어 첫 술덧이 완성됐어요"
          : fermentPhase === "FERMENTING"
            ? "항아리 속에서 첫 술덧이 익어가고 있어요"
            : "혼합한 재료를 3일 동안 발효해 밑술을 만들어요";

        const mixGame = $("#mitsul-mix-game");
        const temperatureGame = $("#ferment-game");
        const timeGame = $("#mitsul-timelapse");
        const fermentButton = $("#btn-ferment") as HTMLButtonElement | null;
        mixGame?.classList.toggle("hidden", fermentPhase !== "LID");
        temperatureGame?.classList.toggle("hidden", fermentPhase !== "TEMPERATURE");
        timeGame?.classList.toggle("hidden", fermentPhase !== "FERMENTING" && fermentPhase !== "COMPLETE");

        if (fermentPhase === "LID") {
          const label = $("#mitsul-mix-label");
          if (label) label.textContent = "작업대의 뚜껑을 집어 항아리 위에 놓아주세요";
          const pct = $("#mitsul-mix-pct");
          if (pct) pct.textContent = "혼합 완료";
          const bar = $("#bar-mitsul-mix") as HTMLElement | null;
          if (bar) bar.style.width = "100%";
          const button = $("#btn-mitsul-mix") as HTMLButtonElement | null;
          if (button) {
            button.disabled = true;
            button.textContent = "항아리 뚜껑을 닫아주세요";
          }
          fermentButton?.classList.add("hidden");
        } else if (fermentPhase === "TEMPERATURE") {
          if (tempInput) tempInput.value = String(S.temp);
          const temperatureReady = S.temp === 25;
          const rate = $("#ferment-rate") as HTMLElement | null;
          if (rate) {
            rate.textContent = temperatureReady ? "발효 온도 준비 완료" : "목표 온도 25℃";
            rate.dataset.state = temperatureReady ? "ok" : "warn";
          }
          const pct = $("#ferment-pct");
          if (pct) pct.textContent = `${S.temp}℃`;
          const value = $("#temp-val");
          if (value) value.textContent = `${S.temp}℃ · ${temperatureReady ? "알맞음" : "조절 중"}`;
          const message = $("#msg-ferment");
          if (message) message.textContent = temperatureReady
            ? "좋아, 발효가 잘 이루어질 온도라네. 이제 사흘을 익혀보세."
            : "발효가 잘 이루어지도록 온도를 25℃로 맞춰보게.";
          const bar = $("#bar-ferment") as HTMLElement | null;
          if (bar) bar.style.width = `${THREE.MathUtils.clamp((S.temp - 18) / 7, 0, 1) * 100}%`;
          if (fermentButton) {
            fermentButton.classList.remove("hidden");
            fermentButton.disabled = !temperatureReady;
            fermentButton.textContent = temperatureReady ? "25℃ 설정 완료 · 1차 발효 시작" : "25℃로 맞춰주세요";
          }
        } else {
          const day = $("#mitsul-day");
          if (day) day.textContent = fermentPhase === "COMPLETE" ? "3일 발효 완료" : `${S.mitsulFermentDay}일차 / 3일`;
          const pct = $("#mitsul-ferment-pct");
          if (pct) pct.textContent = `${Math.round(S.mitsulFermentProgress * 100)}%`;
          const bar = $("#bar-mitsul-ferment") as HTMLElement | null;
          if (bar) bar.style.width = `${S.mitsulFermentProgress * 100}%`;
          const message = $("#mitsul-ferment-message");
          if (message) message.textContent = fermentPhase === "COMPLETE"
            ? "밑술이 완성되었어요!"
            : `${S.mitsulFermentDay}일차 · 항아리 속 술덧이 발효되고 있어요`;
          if (fermentButton) {
            fermentButton.classList.toggle("hidden", fermentPhase !== "COMPLETE");
            fermentButton.disabled = true;
            fermentButton.textContent = "밑술 완성";
          }
        }
        return;
      }

      $("#ferment-game")?.classList.add("hidden");
      $("#mitsul-timelapse")?.classList.add("hidden");
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
      // 밑술(혼합·1차 발효)까지는 밑술 쪽 UI 가, 덧술부터는 이 아래 발효 UI 가 맡는다.
      if (productionMitsulMix && S.fstage < MASH_FIRST_STAGE) {
        syncMitsulMixUi();
        return;
      }
      // 밑술 무대에서 쓰던 진행바·타임랩스는 덧술로 넘어오면 자리를 비운다.
      $("#mitsul-mix-game")?.classList.add("hidden");
      $("#mitsul-timelapse")?.classList.add("hidden");
      uiRoot!.classList.remove("mitsul-no-hands");

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
        if (productionMitsulMix && S.fstage < MASH_FIRST_STAGE) {
          startMitsulFermentation?.();
          return;
        }
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
        S.coolingPhase = "TRAY_PULL";
        S.coolTrayProgress = 0;
        S.coolRiceProgress = 0;
        S.quizDone = false;
        S.temp = OPTIMAL_C;
        S.ferment = 0;
        S.fstage = 0;
        S.mashTrayDone.clear();
        S.mitsulPhase = "RICE";
        S.mitsulPourProgress = 0;
        S.mitsulRiceScoops = 0;
        S.mitsulKneadCount = 0;
        S.mitsulDone = false;
        S.mitsulFermentPhase = "LID";
        S.mitsulLidSnapped = false;
        S.mitsulFermentProgress = 0;
        S.mitsulFermentDay = 0;
        S.mitsulFermentDone = false;
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

    const debugSkipBeforePostFermentationBtn = $("#debug-skip-before-post-fermentation");

    if (debugSkipBeforePostFermentationBtn) {
      (debugSkipBeforePostFermentationBtn as HTMLButtonElement).onclick =
        debugSkipToBeforePostFermentation;
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
        void preloadExtraModels();
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
      dracoLoader.dispose();
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
        id="debug-skip-before-post-fermentation"
        type="button"
        style={{
          position: "absolute",
          top: 124,
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
        DEV · 후발효 직전
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

      {/* ?mitsulFermentDebug=1 전용 — 뚜껑/온도/3일 발효 QA */}
      <aside className="mitsul-ferment-debug-panel" aria-label="Mitsul fermentation debug values">
        <div className="mitsul-ferment-debug-title">MITSUL② · FIRST FERMENT</div>
        <div>PHASE <b id="mitsul-ferment-debug-phase">LID</b></div>
        <div>LID <b id="mitsul-ferment-debug-lid">FREE</b></div>
        <div>TEMP <b id="mitsul-ferment-debug-temp">20℃</b></div>
        <div>DAY <b id="mitsul-ferment-debug-day">0 / 3</b></div>
        <div>FERMENT PROGRESS <b id="mitsul-ferment-debug-progress">0%</b></div>
        <div>BUBBLE LEVEL <b id="mitsul-ferment-debug-bubbles">0</b></div>
        <strong id="mitsul-ferment-debug-ok">MITSUL COMPLETE</strong>
        <button type="button" id="mitsul-ferment-debug-reset">RESET FERMENT</button>
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
        <div>HAS SCOOP <b id="mitsul-debug-has-scoop">NO</b></div>
        <div>RICE SCOOPS <b id="mitsul-debug-scoops">0 / 3</b></div>
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
          <div id="mitsul-timelapse" className="hidden">
            <div className="ferment-row">
              <span className="ferment-rate" id="mitsul-day">1일차 / 3일</span>
              <span className="ferment-pct" id="mitsul-ferment-pct">0%</span>
            </div>
            <div className="bar"><i id="bar-mitsul-ferment" /></div>
            <div className="mitsul-ferment-message" id="mitsul-ferment-message">
              1일차 · 항아리 속 술덧이 발효되고 있어요
            </div>
          </div>
          <div id="ferment-game" className="hidden">
            {/* 밑술 1차 발효 — 온도를 맞추고 사흘을 보낸다.
                머지 과정에서 이 진행바와 온도계가 통째로 빠져 있었다. */}
            <div className="ferment-row">
              <span className="ferment-rate" id="ferment-rate">발효 속도 정상</span>
              <span className="ferment-pct" id="ferment-pct">0%</span>
            </div>
            <div className="bar"><i id="bar-ferment" /></div>
            <div className="meter">
              <div className="row"><span>발효 온도</span><span className="val" id="temp-val">20℃ · 조금 낮음</span></div>
              <input type="range" id="temp" min={18} max={34} step={1} defaultValue={20} aria-label="발효 온도" />
            </div>
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
