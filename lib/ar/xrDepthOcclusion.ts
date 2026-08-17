"use client";

import * as THREE from "three";

/**
 * WebXR real-world depth를 Three.js material에 연결한다.
 *
 * 현실 depth < 가상 object depth
 * → 해당 fragment를 discard
 *
 * 즉 현실 책상/바닥/사람 등이
 * 가상 GLB보다 앞에 있으면 GLB가 가려진다.
 */
export class XrDepthOcclusion {
  private binding: any = null;

  private depthTexture: THREE.ExternalTexture | null = null;

  private enabled = false;

  /**
   * 현재 기기에서 선택된 depth format.
   */
  private format = "";

  /**
   * 모든 material shader가 공유하는 uniforms.
   */
  private readonly uniforms = {
    depthTexture: {
      value: null as THREE.ExternalTexture | null,
    },

    depthUvTransform: {
      value: new THREE.Matrix4(),
    },

    rawValueToMeters: {
      value: 1,
    },

    /**
     * 0 = luminance-alpha
     * 1 = float32
     */
    depthFormat: {
      value: 0,
    },

    /**
     * 실제 depth와 가상 depth가 거의 같을 때
     * 경계가 떨리는 현상을 줄이기 위한 여유값.
     *
     * 단위: meter
     */
    bias: {
      value: 0.035,
    },
  };


  /**
   * XR session이 열린 뒤 한 번 호출.
   */
  init(
    session: XRSession,
    renderer: THREE.WebGLRenderer
  ) {
    const sessionAny = session as any;

    if (
      sessionAny.depthUsage !==
      "gpu-optimized"
    ) {
      console.warn(
        "[AR DEPTH] GPU depth를 받지 못했습니다:",
        sessionAny.depthUsage
      );

      this.enabled = false;
      return;
    }

    const gl =
      renderer.getContext();

    const XRWebGLBindingCtor =
      (window as any).XRWebGLBinding;

    if (!XRWebGLBindingCtor) {
      console.warn(
        "[AR DEPTH] XRWebGLBinding 미지원"
      );

      this.enabled = false;
      return;
    }

    try {
      this.binding =
        new XRWebGLBindingCtor(
          session,
          gl
        );

      this.format =
        sessionAny.depthDataFormat ?? "";

      /**
       * 이번 prototype에서는
       * luminance-alpha / float32를 지원한다.
       */
      if (
        this.format ===
        "luminance-alpha"
      ) {
        this.uniforms.depthFormat.value =
          0;
      } else if (
        this.format === "float32"
      ) {
        this.uniforms.depthFormat.value =
          1;
      } else {
        console.warn(
          "[AR DEPTH] 아직 처리하지 않는 format:",
          this.format
        );

        this.enabled = false;
        return;
      }

      this.enabled = true;

      console.log(
        "[AR DEPTH] GPU occlusion ready",
        {
          usage:
            sessionAny.depthUsage,

          format:
            sessionAny.depthDataFormat,

          type:
            sessionAny.depthType,
        }
      );
    } catch (e) {
      console.warn(
        "[AR DEPTH] XRWebGLBinding 생성 실패",
        e
      );

      this.enabled = false;
    }
  }


  /**
   * 매 XR frame에서 depth texture만 갱신한다.
   *
   * CPU로 pixel을 내려받지 않는다.
   */
  update(
    frame: XRFrame,
    referenceSpace: XRReferenceSpace
  ) {
    if (
      !this.enabled ||
      !this.binding
    ) {
      return;
    }

    const pose =
      frame.getViewerPose(
        referenceSpace
      );

    const view =
      pose?.views?.[0];

    if (!view) return;

    try {
      const depthInfo =
        this.binding.getDepthInformation(
          view
        );

      if (!depthInfo) return;

      /**
       * 현재 스마트폰 AR에서는 보통 texture이지만,
       * texture-array가 반환되는 환경은 일단 제외한다.
       */
      if (
        depthInfo.textureType !==
        "texture"
      ) {
        console.warn(
          "[AR DEPTH] texture-array는 현재 prototype에서 제외:",
          depthInfo.textureType
        );

        return;
      }

      /**
       * WebXR runtime이 생성한 WebGLTexture를
       * Three.js가 sampler2D uniform으로 사용할 수 있게 감싼다.
       */
      if (!this.depthTexture) {
        this.depthTexture =
          new THREE.ExternalTexture(
            depthInfo.texture
          );

        this.uniforms.depthTexture.value =
          this.depthTexture;
      } else {
        this.depthTexture.sourceTexture =
          depthInfo.texture;
      }

      /**
       * XR view 좌표 → depth texture 좌표 변환.
       */
      this.uniforms
        .depthUvTransform
        .value
        .fromArray(
          depthInfo
            .normDepthBufferFromNormView
            .matrix
        );

      this.uniforms
        .rawValueToMeters
        .value =
        depthInfo.rawValueToMeters;
    } catch {
      /**
       * frame 순간 누락은 정상적으로 생길 수 있으므로
       * 매 프레임 console을 찍지는 않는다.
       */
    }
  }


  /**
   * stage에 들어가는 Three.js material에
   * real-depth clipping shader를 삽입한다.
   */
  patchObject(
    root: THREE.Object3D
  ) {
    root.traverse((obj) => {
      if (
        !(obj instanceof THREE.Mesh)
      ) {
        return;
      }

      const mats =
        Array.isArray(obj.material)
          ? obj.material
          : [obj.material];

      mats.forEach((mat) => {
        if (
          mat instanceof
            THREE.MeshStandardMaterial ||
          mat instanceof
            THREE.MeshPhysicalMaterial
        ) {
          this.patchMaterial(mat);
        }
      });
    });
  }


  private patchMaterial(
    material:
      | THREE.MeshStandardMaterial
      | THREE.MeshPhysicalMaterial
  ) {
    /**
     * 같은 material을 두 번 patch하는 것 방지.
     */
    if (
      (material.userData as any)
        .xrDepthPatched
    ) {
      return;
    }

    (
      material.userData as any
    ).xrDepthPatched = true;


    const oldOnBeforeCompile =
      material.onBeforeCompile;


    material.onBeforeCompile =
      (shader, renderer) => {
        oldOnBeforeCompile?.(
          shader,
          renderer
        );

        shader.uniforms.uRealDepthTexture =
          this.uniforms.depthTexture;

        shader.uniforms.uDepthUvTransform =
          this.uniforms.depthUvTransform;

        shader.uniforms.uRawValueToMeters =
          this.uniforms.rawValueToMeters;

        shader.uniforms.uDepthFormat =
          this.uniforms.depthFormat;

        shader.uniforms.uDepthBias =
          this.uniforms.bias;


        /**
         * Standard/Physical material에는
         * vViewPosition이 이미 존재한다.
         *
         * vViewPosition.z:
         * 카메라 평면에서 가상 fragment까지의 거리.
         */
        shader.fragmentShader =
          shader.fragmentShader.replace(
            "void main() {",
            `
uniform sampler2D uRealDepthTexture;
uniform mat4 uDepthUvTransform;
uniform float uRawValueToMeters;
uniform int uDepthFormat;
uniform float uDepthBias;

float xrReadDepthMeters(
  sampler2D depthTex,
  vec2 uv
) {

  vec4 sampleValue =
    texture2D(
      depthTex,
      uv
    );

  // WebXR luminance-alpha
  if (uDepthFormat == 0) {

    vec2 packedDepth =
      sampleValue.ra;

    float rawDepth =
      dot(
        packedDepth,
        vec2(
          255.0,
          256.0 * 255.0
        )
      );

    return
      rawDepth *
      uRawValueToMeters;
  }

  // WebXR float32
  return
    sampleValue.r *
    uRawValueToMeters;
}

void main() {
`
          );


        /**
         * 출력 직전 real depth와 virtual depth를 비교한다.
         */
        shader.fragmentShader =
          shader.fragmentShader.replace(
            "#include <opaque_fragment>",
            `
// ======================================================
// WebXR REAL-WORLD OCCLUSION
// ======================================================

// 현재 fragment의 화면 좌표.
// WebGL은 좌하단 원점이므로 Y를 뒤집는다.
vec2 xrViewUv =
  vec2(
    gl_FragCoord.x /
      float(
        ${Math.max(
          1,
          window.innerWidth
        )}.0
      ),

    1.0 -
    gl_FragCoord.y /
      float(
        ${Math.max(
          1,
          window.innerHeight
        )}.0
      )
  );

vec2 xrDepthUv =
  (
    uDepthUvTransform *
    vec4(
      xrViewUv,
      0.0,
      1.0
    )
  ).xy;


// depth texture 범위 밖이면 비교하지 않는다.
if (
  xrDepthUv.x >= 0.0 &&
  xrDepthUv.x <= 1.0 &&
  xrDepthUv.y >= 0.0 &&
  xrDepthUv.y <= 1.0
) {

  float realDepth =
    xrReadDepthMeters(
      uRealDepthTexture,
      xrDepthUv
    );

  /**
   * vViewPosition.z는
   * 현재 가상 fragment의 view-space depth.
   */
  float virtualDepth =
    vViewPosition.z;

  /**
   * depth 0은 invalid data.
   *
   * 현실 geometry가 가상 object보다
   * 확실히 앞에 있을 때만 discard.
   */
  if (
    realDepth > 0.0 &&
    realDepth + uDepthBias <
    virtualDepth
  ) {
    discard;
  }
}

#include <opaque_fragment>
`
          );
      };


    material.customProgramCacheKey =
      () => "xr-real-depth-v1";

    material.needsUpdate = true;
  }


  dispose() {
    this.depthTexture?.dispose();

    this.depthTexture = null;
    this.binding = null;
    this.enabled = false;
  }
}