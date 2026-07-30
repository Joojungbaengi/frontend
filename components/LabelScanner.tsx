"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { LabelDetector, YOLO_CLASSES, type Detection } from "@/lib/scanModel";

/**
 * 전통주 라벨 스캔 — 후면 카메라를 전체화면으로 띄우고 프레임을 YOLO로 훑는다.
 * 같은 술이 연속 STABLE_HITS번 잡히면 하단에 결과 버튼을 띄우고, 누르면 상세로 간다.
 * (한 프레임만 보고 판단하면 오인식에 그대로 끌려간다)
 */

/** 결과를 띄우기까지 필요한 연속 인식 횟수 */
const STABLE_HITS = 3;
/** 이만큼 연속으로 아무것도 못 잡으면 결과 버튼을 내린다 */
const MISS_LIMIT = 12;
/** 추론 사이 간격 — UI가 멈춘 것처럼 보이지 않게 숨을 돌려준다 */
const FRAME_GAP_MS = 90;

type Phase = "preparing" | "scanning" | "error";

export default function LabelScanner() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  /** 렌더 중인 결과 — 루프 안에서 불필요한 setState를 피하려고 같이 들고 있는다 */
  const shownRef = useRef<number | null>(null);

  const [phase, setPhase] = useState<Phase>("preparing");
  const [hint, setHint] = useState("카메라와 인식 모델을 준비하고 있어요…");
  const [foundIdx, setFoundIdx] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    let detector: LabelDetector | null = null;
    let streakIdx = -1;
    let streak = 0;
    let miss = 0;

    /** 결과 버튼 상태를 바뀔 때만 갱신 */
    const show = (idx: number | null) => {
      if (shownRef.current === idx) return;
      shownRef.current = idx;
      setFoundIdx(idx);
    };

    /** 후면 카메라 켜기 */
    const startCamera = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("mediaDevices-unavailable");
      }
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      const video = videoRef.current;
      if (!video) throw new Error("video-element-missing");
      video.srcObject = stream;
      await video.play();
    };

    const loop = async () => {
      while (!cancelled && detector && videoRef.current) {
        let dets: Detection[] = [];
        try {
          dets = await detector.detect(videoRef.current);
        } catch {
          // 한 프레임 실패는 넘어간다 (다음 프레임에서 회복)
        }
        if (cancelled) return;

        const best = dets[0];
        if (best) {
          miss = 0;
          streak = best.classIdx === streakIdx ? streak + 1 : 1;
          streakIdx = best.classIdx;
          if (streak >= STABLE_HITS) show(best.classIdx);
        } else {
          streak = 0;
          streakIdx = -1;
          if (++miss >= MISS_LIMIT) show(null);
        }
        await new Promise((r) => setTimeout(r, FRAME_GAP_MS));
      }
    };

    (async () => {
      // 카메라 권한 창과 모델 다운로드를 동시에 진행하되, 실패 원인은 따로 구분한다
      const [camera, model] = await Promise.allSettled([startCamera(), LabelDetector.load()]);
      if (cancelled) {
        if (model.status === "fulfilled") void model.value.release();
        return;
      }

      if (camera.status === "rejected") {
        console.error("[scan] 카메라 실패", camera.reason);
        if (model.status === "fulfilled") void model.value.release();
        setPhase("error");
        setHint(describeCameraError(camera.reason));
        return;
      }
      if (model.status === "rejected") {
        console.error("[scan] 모델 로드 실패", model.reason);
        setPhase("error");
        setHint(`인식 모델을 불러오지 못했어요. ${detail(model.reason)}`);
        return;
      }

      detector = model.value;
      setPhase("scanning");
      setHint("전통주 라벨을 비춰주세요.");
      void loop();
    })();

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
      void detector?.release();
    };
  }, []);

  const found = foundIdx === null ? null : YOLO_CLASSES[foundIdx];

  return (
    <>
      <video
        ref={videoRef}
        muted
        playsInline
        autoPlay
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
      />

      {/* 준비 중·오류일 때만 카메라 위를 덮는다 */}
      {phase !== "scanning" && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(36,27,16,.78)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "0 34px",
            textAlign: "center",
          }}
        >
          {phase === "preparing" ? (
            <span className="mini-spin" />
          ) : (
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.75, color: "rgba(246,236,214,.9)" }}>{hint}</p>
          )}
        </div>
      )}

      {/* 하단 — 인식되면 결과 버튼, 아니면 안내 한 줄 */}
      {phase === "scanning" && (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: "calc(40px + env(safe-area-inset-bottom, 0px))",
            display: "flex",
            justifyContent: "center",
            padding: "0 22px",
          }}
        >
          {found ? (
            <button
              onClick={() => router.push(`/drink/${found.drinkId}`)}
              style={{
                border: "1px solid rgba(232,201,138,.45)",
                background: "rgba(28,21,12,.86)",
                backdropFilter: "blur(6px)",
                borderRadius: 20,
                padding: "13px 30px",
                cursor: "pointer",
                textAlign: "center",
                boxShadow: "0 14px 30px rgba(0,0,0,.45)",
                animation: "rise .28s ease-out both",
              }}
            >
              <span
                style={{
                  display: "block",
                  fontSize: 11,
                  letterSpacing: ".22em",
                  color: "var(--gold-bright)",
                  marginBottom: 5,
                }}
              >
                인식됨
              </span>
              <span className="serif" style={{ display: "block", fontWeight: 700, fontSize: 18, color: "#f6ecd6" }}>
                {found.label}
              </span>
            </button>
          ) : (
            <p
              style={{
                margin: 0,
                fontSize: 13.5,
                color: "rgba(246,236,214,.85)",
                textShadow: "0 1px 8px rgba(0,0,0,.75)",
              }}
            >
              {hint}
            </p>
          )}
        </div>
      )}
    </>
  );
}

/** 원인 파악용 꼬리표 — 콘솔을 안 열어도 무엇이 터졌는지 보이게 */
function detail(err: unknown): string {
  if (!(err instanceof Error)) return `(${String(err)})`;
  return `(${err.name}: ${err.message || "메시지 없음"})`;
}

/** getUserMedia 실패 사유를 사용자 문장으로 */
function describeCameraError(err: unknown): string {
  const name = err instanceof Error ? err.name : "";
  const message = err instanceof Error ? err.message : "";

  if (typeof window !== "undefined" && !window.isSecureContext)
    return "카메라는 HTTPS 또는 localhost 에서만 열 수 있어요. 배포된 주소로 접속해 주세요.";
  if (message === "mediaDevices-unavailable")
    return "이 브라우저에서 카메라 API를 쓸 수 없어요. 최신 크롬·사파리에서 열어주세요.";
  if (name === "NotAllowedError")
    return "카메라 권한이 거부되었어요. 주소창의 자물쇠(또는 카메라) 아이콘에서 허용으로 바꿔주세요.";
  if (name === "NotFoundError")
    return "연결된 카메라를 찾지 못했어요. PC라면 웹캠이 있는지 확인해 주세요.";
  if (name === "NotReadableError")
    return "다른 앱이 카메라를 쓰고 있어요. 화상회의·카메라 앱을 모두 끄고 다시 시도해 주세요.";
  if (name === "OverconstrainedError")
    return "요청한 카메라 설정을 지원하지 않아요. 다른 기기에서 시도해 주세요.";
  return `카메라를 열지 못했어요. ${detail(err)}`;
}
