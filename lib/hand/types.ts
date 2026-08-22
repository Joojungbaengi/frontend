/**
 * 손 인식 공통 타입 — 엔진(ArBreweryExperience)이 보는 "손의 한 프레임".
 *
 * 인식 방식(MediaPipe / 훗날 WebXR XRHand)이 바뀌어도 이 모양만 지키면
 * 상호작용 코드는 그대로 쓴다.
 */

/** MediaPipe 손 랜드마크 21개의 인덱스 — 이름으로 읽어야 어디를 가리키는지 알 수 있다 */
export const LM = {
  WRIST: 0,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_TIP: 12,
  RING_MCP: 13,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_TIP: 20,
} as const;

/** 골격을 선으로 이을 때 쓰는 뼈대 연결 (MediaPipe HAND_CONNECTIONS 와 같다) */
export const HAND_CONNECTIONS: readonly (readonly [number, number])[] = [
  [0, 1], [1, 2], [2, 3], [3, 4],           // 엄지
  [0, 5], [5, 6], [6, 7], [7, 8],           // 검지
  [5, 9], [9, 10], [10, 11], [11, 12],      // 중지
  [9, 13], [13, 14], [14, 15], [15, 16],    // 약지
  [13, 17], [17, 18], [18, 19], [19, 20],   // 새끼
  [0, 17],                                   // 손바닥 아래 가로선
] as const;

/** 화면 정규화 좌표 (x,y 는 0~1, 좌상단 원점 / z 는 손목 기준 상대 깊이) */
export interface Landmark {
  x: number;
  y: number;
  z: number;
}

/** 한 프레임의 손 상태 — 상호작용 코드가 보는 유일한 입력 */
export interface HandFrame {
  /** 손이 잡혔는지. false 면 나머지 값은 직전 값이 남아 있으니 쓰지 않는다 */
  present: boolean;
  /** 21개 랜드마크 (화면 정규화, 스무딩 적용됨) */
  landmarks: Landmark[];
  /**
   * 21개 랜드마크의 **실제 3D 좌표** (미터, 손 중심이 원점).
   * MediaPipe 기준 축 그대로 — x 오른쪽, y 아래, z 카메라에서 멀어지는 쪽.
   *
   * 화면 좌표만으로는 손이 납작해져서, 뼈 길이가 정해진 3D 모델을 거기에
   * 맞출 수가 없다. 손등이 보이는지 손바닥이 보이는지도 알 수 없다.
   * 손 모양은 이 값에서 가져오고, 화면 어디에 그릴지만 landmarks 로 정한다.
   */
  world: Landmark[];
  /** 엄지-검지 끝의 중점 — "집는 지점" (화면 정규화) */
  pinchPoint: { x: number; y: number };
  /** 0(활짝 폄) ~ 1(완전히 붙임). 히스테리시스 판정 전의 연속값 */
  pinch: number;
  /** 지금 쥐고 있는지 — 히스테리시스 + 연속 프레임 확인을 거친 결과 */
  pinching: boolean;
  /** 이 프레임에 막 쥐었다 */
  justPinched: boolean;
  /** 이 프레임에 막 폈다 */
  justReleased: boolean;

  /**
   * 화면에서 손이 차지하는 크기(손목~중지 MCP 거리, 화면 정규화).
   * 카메라에 가까울수록 커진다 — 깊이 추정에 쓴다.
   */
  screenSpan: number;
  /** 왼손인가 오른손인가 — 3D 손 모델을 어느 쪽으로 세울지 정한다 */
  handedness: "left" | "right" | null;
  /** 후면 카메라 보정 전 MediaPipe 좌우 분류의 신뢰도 */
  handednessScore: number;
}

/** 아직 손이 없을 때 쓰는 빈 프레임 */
export function emptyHandFrame(): HandFrame {
  return {
    present: false,
    landmarks: [],
    world: [],
    pinchPoint: { x: 0.5, y: 0.5 },
    pinch: 0,
    pinching: false,
    justPinched: false,
    justReleased: false,
    screenSpan: 0.2,
    handedness: null,
    handednessScore: 0,
  };
}
