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
import { getRecipe } from "@/lib/brewery/recipes";
import { styles } from "@/components/arBreweryStyles";

/**
 * 공통 엔진 — 술 종류별 데이터는 recipe(Recipe) 하나로만 받는다.
 * recipe 를 넘기지 않으면 기본 레시피(냥이탁주)로 동작한다.
 */
export default function ArBreweryExperience({ recipe = getRecipe() }: { recipe?: Recipe }) {
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
      fstage: 0,
      press: 0,
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

    // 원료 단계에 막 들어온 시각 — 화면 전환 직후 밀려오는 '유령 클릭'을 걸러내는 데 쓴다.
    let enteredIngredientAt = 0;
    // 고두밥 하위 단계가 바뀔 때 무대 모델을 갈아 끼우는 함수(buildGodubap 이 채운다)
    let godubapShowStage: (() => void) | null = null;
    // 완성 공정 단계가 바뀔 때 출고 제품(Nyangi)을 보이는 함수(buildFinish 가 채운다)
    let finishShowShip: (() => void) | null = null;
    // 발효 하위 단계가 바뀔 때 채반고두밥/항아리를 갈아 끼우는 함수(buildFerment 가 채운다)
    let fermentShowStage: (() => void) | null = null;
    function resetIngredientSelection() {
      enteredIngredientAt = performance.now();
      S.selected.clear();
      $$("#grid .card").forEach((c) => c.setAttribute("aria-pressed", "false"));
      const msg = $("#msg-ingredient");
      if (msg) msg.textContent = recipe.intro; // 진입 시 항상 인트로부터
      syncIngredient(); // 버튼 "주원료 0/N" 로 초기화 (interacted=false → 멘트는 인트로 유지)
    }

    function setStep(next: typeof S.step) {
      S.step = next;
      uiRoot!.dataset.step = next;
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
        [...MODELS, ...GODUBAP_MODELS, ...(FINISH_MODEL ? [FINISH_MODEL] : [])].map(async (m) => {
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

      let coolT = 0; // 냉각 연출 진행 시간

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

        // 김 — steam:true 단계에서만
        const steaming = cur?.steam === true;
        glow.intensity += ((steaming ? 1.6 : 0.05) - glow.intensity) * 0.05;
        steam.material.opacity += ((steaming ? 0.55 : 0) - steam.material.opacity) * 0.06;
        (steam.userData as any).opt.speed = steaming ? 0.35 : 0.15;

        // 물 — 현재 단계 water 값으로 채워지고 빠진다
        const targetWater = cur?.water ?? 0;
        waterLevel += (targetWater - waterLevel) * 0.06;
        water.visible = waterLevel > 0.01;
        water.position.y = THREE.MathUtils.lerp(waterLowY, waterHighY, waterLevel);
        (water.material as THREE.MeshBasicMaterial).opacity = 0.72 * waterLevel;
        water.rotation.y = t * 0.25;
        const ripple = 1 + Math.sin(t * 2.2) * 0.012 * waterLevel;
        water.scale.set(ripple, DOME_FLATTEN, ripple);

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

      if (S.step === "ferment" && S.fstage >= FERMENT_STEPS.length - 1 && S.ferment < 100) {
        const dist = Math.abs(S.temp - OPTIMAL_C);
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
          if (i === GB_LAST && !S.quizDone) {
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
            : S.godubap === GB_LAST && !S.quizDone
              ? "장인의 질문에 먼저 답해주세요"
              : "";
      }
      const cur = GODUBAP_STEPS[Math.min(S.godubap, GB_LAST)];
      const cap = $("#cap-godubap");
      if (cap) cap.textContent = S.godubap >= GB_N ? "고두밥 완성 · 채반에서 차게 식었어요" : cur.caption;
      if (S.godubap === GB_LAST && !S.quizDone) $("#quiz")?.classList.remove("hidden");
      const b = $("#btn-godubap") as HTMLButtonElement | null;
      if (b) {
        b.disabled = S.godubap < GB_N;
        b.textContent = S.godubap < GB_N ? "공정을 순서대로 진행하세요" : "누룩 섞고 항아리에 담기";
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
              S.godubap = GB_N;
              syncGodubap();
            }, 900);
          } else {
            setTimeout(() => c.classList.remove("no"), 900);
          }
        };
        quizChoices.appendChild(c);
      });
    }
    const btnGodubap = $("#btn-godubap");
    if (btnGodubap)
      (btnGodubap as HTMLElement).onclick = () => {
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
        b.disabled = !done;
        b.textContent = done ? "완성된 냥이탁주 만나기" : "공정을 순서대로 진행하세요";
      }
    }
    const btnFinishing = $("#btn-finishing");
    if (btnFinishing)
      (btnFinishing as HTMLElement).onclick = () => {
        uiRoot!.classList.add("shipped");
        // 축하 화면은 한지 배경 — 이때만 헤더를 밝은 톤으로 바꾼다.
        document.documentElement.dataset.arStep = "done";
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
              <div className="who">AI 술도가 장인</div>
              <div className="msg" id="msg-ingredient">{recipe.intro}</div>
            </div>
          </div>
        </div>
        <div className="fill" />
        <div className="dock">
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
          <div id="quiz" className="hidden">
            <div className="coach">
              <div className="avatar" />
              <div style={{ flex: 1 }}>
                <div className="who">AI 술도가 장인</div>
                <div className="msg" id="quiz-q">{recipe.quiz.question}</div>
                <div className="choices" id="quiz-choices" />
              </div>
            </div>
          </div>
          <button className="cta" id="btn-godubap" disabled>공정을 순서대로 진행하세요</button>
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
                <div className="who">AI 술도가 장인</div>
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
          <button className="cta" id="btn-finishing" disabled>공정을 순서대로 진행하세요</button>
        </div>
      </div>

      {/* 16 · 완성 */}
      <div id="finish">
        <img className="finish-drink" src={recipe.finish.image} alt={recipe.finish.alt} />
        <h1>{recipe.name}<br />양조 체험 완료!</h1>
        <p>{recipe.finish.note}</p>
        <div className="finish-actions">
          <button className="cta" id="btn-report">AI 양조 리포트 보기</button>
          <Link href="/dex" className="cta dex-link">술 도감으로 가기</Link>
        </div>
        <button className="cta ghost" id="btn-restart">처음부터 다시 빚기</button>
      </div>

      {/* 리포트 */}
      <div id="report">
        <div className="sheet">
          <h3>AI 양조 리포트</h3>
          <div className="sub">이번 체험에서 만든 술의 기록</div>
          <dl id="report-body" />
          <button className="cta" id="btn-close-report">닫기</button>
        </div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: styles }} />
    </div>
  );
}