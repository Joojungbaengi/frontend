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
    const PLATFORM_CONTENT_LIFT = 0.72;
    const platformContentY = (platformTop: number) => platformTop + PLATFORM_CONTENT_LIFT;

    function setStep(next: typeof S.step) {
      S.step = next;
      uiRoot!.dataset.step = next;
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

    const controls = new OrbitControls(camera, canvas);
    controls.target.set(0, 0.22, 0);
    controls.enableDamping = true;
    controls.minDistance = 0.4;
    controls.maxDistance = 2.2;
    controls.maxPolarAngle = Math.PI * 0.49;

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
        
        // 💡 원료(ingredient) 단계일 때는 바구니와 공들이 확실히 보이도록 위치를 직접 잡아줍니다.
        if (step === "ingredient") {
          g.position.set(0, baseY, 0); // 플랫폼 정중앙에 배치
        } else if (def.id === "rice_bowl") {
          g.position.set(0, platformContentY(baseY), 0);
        } else if (def.id === "water_jar") {
          g.position.set(0, platformContentY(baseY), 0);
        } else {
          const maxH = Math.max(...defs.map((d) => d.height));
          const radius = defs.length === 1 ? 0 : Math.max(0.14, maxH * 0.9);
          const ang = (i / defs.length) * Math.PI * 2 - Math.PI / 2;
          g.position.set(Math.cos(ang) * radius, baseY + def.y, Math.sin(ang) * radius);
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

    
    function addPlatform(): number {
      const gltf = LOADED["low_wooden_bench"] || LOADED["m4"];
      
      if (gltf) {
        // GLB 모델이 이미 로드되어 있는 경우
        const root = skinnedClone(gltf.scene) as THREE.Object3D;
        root.scale.setScalar(0.5);
        root.position.set(0, -0.3, 0);
        root.traverse((o: any) => {
          if (o.isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
          }
        });
        stageGroup.add(root);
        
        // 모델의 실제 바운딩 박스를 계산해서 "윗면 y좌표"를 구한다
        const box = new THREE.Box3().setFromObject(root);
        return box.max.y;
      } else {
        // 모델 로드가 아직 안 끝났을 때 빈 화면으로 두지 않고 임시 플랫폼(원기둥)을 먼저 생성
        const fallbackMesh = new THREE.Mesh(
          new THREE.CylinderGeometry(0.35, 0.38, 0.04, 32),
          new THREE.MeshStandardMaterial({ color: 0x8B5A2B, roughness: 0.8 })
        );
        fallbackMesh.position.set(0, 0.02, 0);
        fallbackMesh.castShadow = true;
        fallbackMesh.receiveShadow = true;
        stageGroup.add(fallbackMesh);
        return 0.02 + 0.02;
      }
    }

    /* --- 12 · 원료 --- */
    let ingredientNodes: THREE.Group[] = [];

    function buildIngredients() {
      const platformTop = addPlatform();       // 실제 상판 높이를 받음
      placeModelsForStep("ingredient", stageGroup, platformTop);

      const textureLoader = new THREE.TextureLoader();
      const floatY = platformTop + 0.1;       // 상판에서 살짝만 띄움 (기존 0.18 → 대체)
      const layoutRadius = 0.26;              // 0.2 → 0.26 (원 배치 반경도 넓혀서 안 겹치게)

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

        // 입체감을 더하는 얇은 테두리 링
        (g.userData as any) = { id: ing.id, mesh, phase: i };
        stageGroup.add(g);
        return g;
      });

      live.tick = (t) => {
        ingredientNodes.forEach((n) => {
          const ud = n.userData as any;
          const on = S.selected.has(ud.id);
          n.position.y = floatY + Math.sin(t * 1.4 + ud.phase) * 0.018 + (on ? 0.03 : 0);
          const s = on ? 1.35 : 1;
          n.scale.lerp(new THREE.Vector3(s, s, s), 0.1);
        });
      };
    }

    /* --- 13 · 고두밥 --- */
    function buildGodubap() {
      const platformTop = addPlatform();
      // 가상의 찜기+아이코사헤드론 쌀알 대신 rice_bowl.glb 실물 모델을 놓는다.
      // (rice_bowl 은 arModels.ts 에 step:"godubap" 으로 등록되어 있어 이 호출로 자동 배치됨)
      placeModelsForStep("godubap", stageGroup, platformTop);

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
        const scan = $("#scan");
        if (scan) scan.textContent = "AR 시작 실패 · " + (e?.name || e?.message);
        syncPlaceButton();
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
        reticle.visible = found;
        onSurfaceFound(found);
      } else {
        reticle.visible = false;
      }

      if (S.step === "ferment" && S.ferment < 100) {
        const dist = Math.abs(S.temp - 25);
        const rate = THREE.MathUtils.clamp(1 - dist / 9, 0.15, 1) * 11;
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
      const scan = $("#scan");
      if (!b || !scan) return;

      // 초기 로딩 중일 때는 무조건 준비 중 상태로 표시
      if (S.isInitializing) {
        b.disabled = true;
        b.textContent = "AR 환경 준비 중…";
        scan.textContent = "잠시만 기다려 주세요";
        return;
      }

      if (arSupported && !S.xr) {
        b.disabled = false;
        b.textContent = "카메라 켜고 AR 시작";
        scan.textContent = "AR 준비됨";
      } else if (surfaceReady) {
        b.disabled = false;
        b.textContent = "여기에 양조장 배치";
        scan.textContent = "평면 인식됨";
      } else {
        b.disabled = true;
        b.textContent = "평면을 찾는 중…";
        scan.textContent = S.xr ? "바닥을 비추며 폰을 천천히 움직이세요" : "3D 모드 · 드래그해 둘러보기";
      }
    }

    $$(".seg button").forEach((btn) => {
      (btn as HTMLElement).onclick = () => {
        $$(".seg button").forEach((b) => b.setAttribute("aria-pressed", "false"));
        btn.setAttribute("aria-pressed", "true");
        S.surface = (btn as HTMLElement).dataset.surface!;
        anchor.scale.setScalar(S.surface === "table" ? 0.55 : 1);
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
        anchor.scale.setScalar(S.surface === "table" ? 0.55 : 1);
        S.placed = true;
        if (!S.xr) controls.target.copy(anchor.position).add(new THREE.Vector3(0, 0.2, 0));
        setStep("ingredient");
      };
    }

    /* --- 12 · 원료 --- */
    const grid = $("#grid");
    if (grid) {
      INGREDIENTS.forEach((ing) => {
        const b = document.createElement("button");
        b.className = "card";
        b.setAttribute("aria-pressed", "false");
        b.innerHTML = `<span class="chip" style="background-image:url('${ing.texture}'); background-size:cover; background-position:center;"></span>${ing.name}`;
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
        (p as HTMLElement).dataset.state = i < S.godubap ? "done" : i === S.godubap ? "now" : "todo";
        p.textContent = GODUBAP_STEPS[i].name + (i < S.godubap ? " ✓" : "");
      });
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
    function syncTemp() {
      const tv = $("#temp-val");
      if (tv) tv.textContent = `${S.temp}℃ · ${tempLabel(S.temp)}`;
      const m = $("#msg-ferment");
      if (!m) return;
      if (S.temp > 26) m.textContent = "온도가 높아 발효가 너무 빠르네. 항아리 환경을 조금 낮춰보게.";
      else if (S.temp < 21) m.textContent = "너무 서늘하면 효모가 잠들어 버린다네. 조금만 올려보게.";
      else m.textContent = "24~26℃, 딱 좋구먼. 이대로 두면 곱게 익겠네.";
    }
    function onFermentTick() {
      const bar = $("#bar-ferment");
      if (bar) (bar as HTMLElement).style.width = S.ferment + "%";
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
    };
  }, []);

  return (
    <div ref={rootRef} className="ar-ui" data-step="place">
      <canvas ref={canvasRef} id="gl" />

      {/* 11 · AR 시작 */}
      <div className="panel-step" id="p-place">
        <div className="fill">
          <div className="scan" id="scan">평면 인식 중</div>
        </div>
        <div className="dock">
          <div className="lead">
            <h2>양조장을 놓을 곳을 정해요</h2>
            <p>바닥이나 책상 위 평면을 인식한 뒤,<br />원하는 위치를 탭해 배치하세요.</p>
          </div>
          <div className="seg">
            <button data-surface="floor" aria-pressed="true">바닥 · 양조장</button>
            <button data-surface="table" aria-pressed="false">탁상 · 미니어처</button>
          </div>
          <button className="cta" id="btn-place" disabled>평면을 찾는 중…</button>
        </div>
      </div>

      {/* 12 · 원료 확인 */}
      <div className="panel-step" id="p-ingredient">
        <div style={{ padding: "0 16px" }}>
          <div className="coach">
            <div className="avatar" />
            <div>
              <div className="who">AI 술도가 장인</div>
              <div className="msg" id="msg-ingredient">이 술은 가와지쌀로 빚는 막걸리라네. 들어갈 재료를 골라보게.</div>
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
        <div className="fill">
          <div className="caption" id="cap-godubap">쌀을 씻어 이물질을 걷어내요</div>
        </div>
        <div className="dock">
          <div id="quiz" className="hidden">
            <div className="coach">
              <div className="avatar" />
              <div style={{ flex: 1 }}>
                <div className="who">AI 술도가 장인</div>
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
          <button className="cta" id="btn-ferment" disabled>발효가 무르익는 중…</button>
        </div>
      </div>

      {/* 15 · 완성 */}
      <div id="finish">
        <div className="label">완성된 막걸리</div>
        <div className="eyebrow">탁주 · 양조 완료</div>
        <h1>가와지쌀 생막걸리<br />양조 체험 완료!</h1>
        <p>직접 빚어본 가와지쌀 생막걸리가 완성됐어요. 원료와 발효 곡선이 맛과 향을 어떻게 바꾸는지 체험해봤답니다.</p>
        <button className="cta" id="btn-report">AI 양조 리포트 보기</button>
        <button className="cta ghost" id="btn-restart" style={{ maxWidth: 320, marginTop: 10 }}>처음부터 다시 빚기</button>
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

/* 원본 index.html의 CSS를 컴포넌트 스코프로 이식.
   .topbar 는 ScreenHeader가 대신하므로 제거. #ui → .ar-ui 로 치환. */
const styles = `
.ar-ui{position:absolute; inset:0; display:flex; flex-direction:column; overflow:hidden;
  font-family:Pretendard,-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;
  color:#f2ecdb; --cream:#f2ecdb; --cream-dim:rgba(242,236,219,.62); --panel-2:#252d23;
  --clay:#c2452f; --clay-hi:#d6553e; --sage:#cfe0d3; --sage-deep:#a9c6b1; --line:rgba(242,236,219,.14);
  --r-md:12px; --r-sm:10px; --safe-b:env(safe-area-inset-bottom,0px);
  padding-top: 24px;}
.ar-ui canvas#gl{position:absolute; inset:0; width:100%; height:100%; display:block; z-index:0}
.ar-ui > *{position:relative; z-index:1}

.ar-ui.ar-mode{background:transparent}
.ar-ui.ar-mode canvas#gl{background:transparent}
.ar-ui.ar-mode .scan{border-color:rgba(242,236,219,.8)}
.ar-ui.ar-mode .lead h2{text-shadow:0 2px 12px rgba(0,0,0,.75)}
.ar-ui.ar-mode .lead p{color:#f2ecdb; text-shadow:0 1px 8px rgba(0,0,0,.8)}
.ar-ui.ar-mode .caption{color:#f2ecdb; text-shadow:0 1px 8px rgba(0,0,0,.8)}

.fill{flex:1; position:relative}
.dock{padding:0 16px calc(18px + var(--safe-b)); display:flex; flex-direction:column; gap:12px}

.scan{position:absolute; left:50%; top:44%; transform:translate(-50%,-50%);
  width:150px; height:86px; border:1.5px dashed rgba(242,236,219,.45); border-radius:6px;
  display:grid; place-items:center; font-size:11px; color:var(--cream-dim); letter-spacing:.1em;
  animation:breathe 2.6s ease-in-out infinite}
@keyframes breathe{0%,100%{opacity:.55}50%{opacity:1}}

.coach{display:flex; gap:11px; align-items:flex-start; background:var(--cream); color:#2b2a24;
  border-radius:var(--r-md); padding:12px 14px; box-shadow:0 10px 26px rgba(0,0,0,.32);
  animation:rise .34s cubic-bezier(.2,.8,.3,1) both}
@keyframes rise{from{opacity:0; transform:translateY(10px)}to{opacity:1; transform:none}}
.coach .avatar{width:26px;height:26px;border-radius:50%;flex:none;margin-top:2px;
  background:radial-gradient(circle at 35% 30%, #e6dcc0, #c9b98d)}
.coach .who{font-size:10.5px; font-weight:700; color:var(--clay); letter-spacing:.02em}
.coach .msg{font-size:12.8px; line-height:1.55; margin-top:3px}

.choices{display:flex; flex-direction:column; gap:8px; margin-top:11px}
.choice{text-align:left; width:100%; cursor:pointer; background:#fff; border:1px solid rgba(43,42,36,.16);
  color:#2b2a24; font:inherit; font-size:12.5px; padding:11px 13px; border-radius:var(--r-sm); transition:.18s}
.choice.ok{background:#e8f0e3; border-color:#7ea27f}
.choice.no{background:#f6e2de; border-color:#c58c80}

.grid{display:grid; grid-template-columns:repeat(3,1fr); gap:9px}
.card{background:var(--panel-2); border:1.5px solid transparent; border-radius:var(--r-sm);
  padding:14px 8px 10px; cursor:pointer; color:var(--cream-dim); display:flex; flex-direction:column;
  align-items:center; gap:9px; font:inherit; font-size:11.5px; transition:.2s}
.card .chip{width:34px;height:34px;border-radius:7px;background:#3a4437; transition:.2s}
.card[aria-pressed="true"]{background:var(--sage); border-color:var(--clay); color:#26301f; font-weight:600}
.card[aria-pressed="true"] .chip{transform:scale(1.06)}

.steps{display:flex; gap:7px; flex-wrap:wrap; padding:0 16px}
.pill{border:none; font:inherit; font-size:11.5px; font-weight:600; padding:7px 13px; border-radius:999px;
  cursor:pointer; background:var(--panel-2); color:rgba(242,236,219,.4)}
.pill[data-state="done"]{background:var(--sage); color:#26301f}
.pill[data-state="now"]{background:var(--clay); color:#fff; animation:pulse 1.8s ease-in-out infinite}
@keyframes pulse{0%,100%{box-shadow:0 0 0 0 rgba(194,69,47,.5)}50%{box-shadow:0 0 0 7px rgba(194,69,47,0)}}

.caption{position:absolute; left:0; right:0; bottom:16px; text-align:center; font-size:11.5px; color:var(--cream-dim)}

.meter{background:var(--cream); color:#2b2a24; border-radius:var(--r-md); padding:13px 14px}
.meter .row{display:flex; justify-content:space-between; align-items:baseline; font-size:12px; font-weight:600}
.meter .val{color:var(--clay); font-size:14px; font-variant-numeric:tabular-nums}
.meter input[type=range]{-webkit-appearance:none; appearance:none; width:100%; height:9px; margin:11px 0 0;
  border-radius:999px; outline:none; background:linear-gradient(90deg,#3f7a4e,#8fae4a,#e0b23c,#d1662f,#b7332a)}
.meter input[type=range]::-webkit-slider-thumb{-webkit-appearance:none; width:19px;height:19px;border-radius:50%;
  background:#fff; border:2px solid #2b2a24; cursor:pointer}
.meter input[type=range]::-moz-range-thumb{width:19px;height:19px;border-radius:50%;background:#fff;border:2px solid #2b2a24}

.bar{height:5px; border-radius:999px; background:rgba(242,236,219,.14); overflow:hidden}
.bar i{display:block; height:100%; width:0; background:var(--sage-deep); transition:width .4s linear}

.cta{width:100%; border:none; font:inherit; font-weight:700; font-size:14px; letter-spacing:.02em;
  color:#fff; background:var(--clay); padding:15px; border-radius:var(--r-sm); cursor:pointer; transition:.2s}
.cta:hover:not(:disabled){background:var(--clay-hi)}
.cta:disabled{background:#3a4437; color:rgba(242,236,219,.35); cursor:default}
.cta.ghost{background:transparent; border:1px solid var(--line); color:var(--cream-dim); font-weight:600; padding:12px}

.seg{display:flex; gap:7px; justify-content:center}
.seg button{border:1px solid var(--line); background:transparent; color:var(--cream-dim); font:inherit;
  font-size:11.5px; padding:7px 14px; border-radius:999px; cursor:pointer}
.seg button[aria-pressed="true"]{background:var(--sage); border-color:var(--sage); color:#26301f; font-weight:600}

.lead{text-align:center}
.lead h2{margin:0; font-size:19px; letter-spacing:.16em; font-weight:700}
.lead p{margin:9px 0 0; font-size:12px; line-height:1.7; color:var(--cream-dim)}

#finish{position:absolute; inset:0; display:none; flex-direction:column; align-items:center;
  justify-content:flex-start; text-align:center; padding:40px 28px calc(32px + var(--safe-b));
  overflow-y:auto;
  background:linear-gradient(180deg,#dbe8dc 0%,#bcd6c2 100%); color:#243027;
  animation:rise .5s cubic-bezier(.2,.8,.3,1) both}
#finish .label{width:150px;height:190px;border-radius:12px;background:#f2e9d2;
  box-shadow:0 18px 40px rgba(36,48,39,.28); display:grid; place-items:center; font-size:10.5px;
  color:#9a8f72; letter-spacing:.2em; margin-bottom:26px; animation:float 4s ease-in-out infinite}
@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-7px)}}
#finish .eyebrow{font-size:11px; letter-spacing:.24em; color:var(--clay); font-weight:700}
#finish h1{margin:10px 0 0; font-size:23px; line-height:1.45; letter-spacing:.02em}
#finish p{margin:14px 0 24px; font-size:12.5px; line-height:1.8; color:#3e4d41; max-width:300px}
#finish .cta{max-width:320px}

#report{position:absolute; inset:0; background:rgba(12,15,11,.6); backdrop-filter:blur(3px);
  display:none; align-items:flex-end; z-index:20}
#report.open{display:flex}
#report .sheet{width:100%; background:var(--cream); color:#2b2a24; border-radius:18px 18px 0 0;
  padding:22px 20px calc(22px + var(--safe-b)); animation:up .32s cubic-bezier(.2,.8,.3,1) both}
@keyframes up{from{transform:translateY(100%)}to{transform:none}}
#report h3{margin:0 0 4px; font-size:16px}
#report .sub{font-size:11.5px; color:#7c7663; margin-bottom:16px}
#report dl{display:grid; grid-template-columns:auto 1fr; gap:10px 14px; margin:0 0 18px; font-size:12.5px}
#report dt{color:#7c7663}
#report dd{margin:0; text-align:right; font-weight:600}

.hidden{display:none !important}
.panel-step{display:none; flex-direction:column; flex:1}
.ar-ui[data-step="place"] #p-place,
.ar-ui[data-step="ingredient"] #p-ingredient,
.ar-ui[data-step="godubap"] #p-godubap,
.ar-ui[data-step="ferment"] #p-ferment{display:flex}
.ar-ui[data-step="done"] #finish{display:flex}

@media (prefers-reduced-motion:reduce){*{animation:none !important; transition:none !important}}
`;
