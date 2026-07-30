"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { LabelDetector, YOLO_CLASSES, type Detection } from "@/lib/scanModel";

/**
 * 전통주 라벨 스캔 — 후면 카메라 프레임을 YOLO로 훑어 제품을 찾아낸다.
 * 같은 술이 연속 STABLE_HITS번 잡히면 확정하고 상세 페이지로 넘어간다.
 * (한 프레임만 보고 넘어가면 오인식에 그대로 끌려가므로)
 */

/** 확정에 필요한 연속 인식 횟수 */
const STABLE_HITS = 3;
/** 추론 사이 간격 — UI가 멈춘 것처럼 보이지 않게 숨을 돌려준다 */
const FRAME_GAP_MS = 90;
/** 확정 후 결과를 보여주는 시간 */
const CONFIRM_DELAY_MS = 1100;

type Phase = "preparing" | "scanning" | "found" | "error";

export default function LabelScanner() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const [phase, setPhase] = useState<Phase>("preparing");
  const [hint, setHint] = useState("카메라와 인식 모델을 준비하고 있어요…");
  const [foundIdx, setFoundIdx] = useState<number | null>(null);

  /** 인식된 박스를 비디오 위에 그린다 (object-fit: cover 기준으로 좌표 변환) */
  const paint = useCallback((dets: Detection[]) => {
    const canvas = overlayRef.current;
    const video = videoRef.current;
    const stage = stageRef.current;
    if (!canvas || !video || !stage) return;

    const cw = stage.clientWidth;
    const ch = stage.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== cw * dpr || canvas.height !== ch * dpr) {
      canvas.width = cw * dpr;
      canvas.height = ch * dpr;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    if (!video.videoWidth) return;

    // cover: 짧은 축을 채우고 넘치는 부분은 잘린다 → 같은 변환을 박스에도 적용
    const s = Math.max(cw / video.videoWidth, ch / video.videoHeight);
    const ox = (cw - video.videoWidth * s) / 2;
    const oy = (ch - video.videoHeight * s) / 2;

    for (const d of dets) {
      const x = ox + d.x * s;
      const y = oy + d.y * s;
      const w = d.w * s;
      const h = d.h * s;

      ctx.strokeStyle = "#e8c98a";
      ctx.lineWidth = 3;
      ctx.shadowColor = "rgba(198,165,104,.9)";
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 10);
      ctx.stroke();
      ctx.shadowBlur = 0;

      const text = `${YOLO_CLASSES[d.classIdx]?.label ?? "?"} ${Math.round(d.score * 100)}%`;
      ctx.font = "600 13px system-ui, sans-serif";
      const pad = 7;
      const tw = ctx.measureText(text).width;
      const ty = Math.max(y - 26, 2);
      ctx.fillStyle = "rgba(36,27,16,.82)";
      ctx.beginPath();
      ctx.roundRect(x, ty, tw + pad * 2, 22, 6);
      ctx.fill();
      ctx.fillStyle = "#f6ecd6";
      ctx.fillText(text, x + pad, ty + 15);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    let detector: LabelDetector | null = null;
    let streakIdx = -1;
    let streak = 0;

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
        paint(dets);

        const best = dets[0];
        if (best) {
          streak = best.classIdx === streakIdx ? streak + 1 : 1;
          streakIdx = best.classIdx;
          if (streak >= STABLE_HITS) {
            setPhase("found");
            setFoundIdx(best.classIdx);
            return;
          }
          setHint("조금만 더 그대로 들고 있어 주세요…");
        } else {
          streak = 0;
          streakIdx = -1;
          setHint("라벨이 화면 안에 꽉 차도록 비춰주세요.");
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
      setHint("라벨이 화면 안에 꽉 차도록 비춰주세요.");
      void loop();
    })();

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
      void detector?.release();
    };
  }, [paint]);

  // 확정되면 잠깐 결과를 보여준 뒤 상세로 이동
  useEffect(() => {
    if (phase !== "found" || foundIdx === null) return;
    const drinkId = YOLO_CLASSES[foundIdx]?.drinkId;
    if (!drinkId) return;
    const timer = setTimeout(() => router.push(`/drink/${drinkId}`), CONFIRM_DELAY_MS);
    return () => clearTimeout(timer);
  }, [phase, foundIdx, router]);

  const found = foundIdx === null ? null : YOLO_CLASSES[foundIdx];

  return (
    <>
      <div ref={stageRef} style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        <video
          ref={videoRef}
          muted
          playsInline
          autoPlay
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
        />
        <canvas
          ref={overlayRef}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
        />

        {/* 가운데 조준 가이드 — 스캔 중에만 */}
        {phase === "scanning" && (
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              transform: "translate(-50%,-50%)",
              width: 230,
              height: 230,
              pointerEvents: "none",
            }}
          >
            <div
              style={{
                position: "absolute",
                left: "6%",
                right: "6%",
                height: 2,
                background: "#e8c98a",
                boxShadow: "0 0 12px #c6a568",
                animation: "scanline 1.8s ease-in-out infinite alternate",
              }}
            />
            {CORNERS.map((corner, i) => (
              <div key={i} style={corner} />
            ))}
          </div>
        )}

        {/* 준비/오류 상태에서는 카메라 위를 덮어준다 */}
        {phase !== "scanning" && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(36,27,16,.72)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 14,
              padding: "0 32px",
              textAlign: "center",
            }}
          >
            {phase === "preparing" && <span className="mini-spin" />}
            {phase === "found" && found && (
              <>
                <div style={{ fontSize: 12, letterSpacing: ".3em", color: "#e8c98a" }}>인 식 완 료</div>
                <div className="serif" style={{ fontWeight: 800, fontSize: 26, color: "#f6ecd6" }}>
                  {found.label}
                </div>
                <div style={{ fontSize: 13, color: "rgba(246,236,214,.75)" }}>제품 정보를 불러올게요…</div>
              </>
            )}
            {phase === "error" && (
              <div style={{ fontSize: 14, lineHeight: 1.7, color: "rgba(246,236,214,.9)" }}>{hint}</div>
            )}
          </div>
        )}
      </div>

      <div style={{ padding: "22px 22px 44px", textAlign: "center" }}>
        {/* 오류 문구는 화면 위 오버레이에 이미 떠 있으므로 여기서는 생략 */}
        <p style={{ margin: 0, minHeight: 22, fontSize: 14, lineHeight: 1.6, color: "rgba(255,255,255,.8)" }}>
          {phase === "preparing" || phase === "scanning" ? hint : ""}
        </p>
      </div>
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

const CORNER_BASE: React.CSSProperties = { position: "absolute", width: 26, height: 26 };
const GOLD = "3px solid #e8c98a";
const CORNERS: React.CSSProperties[] = [
  { ...CORNER_BASE, left: 0, top: 0, borderLeft: GOLD, borderTop: GOLD, borderRadius: "6px 0 0 0" },
  { ...CORNER_BASE, right: 0, top: 0, borderRight: GOLD, borderTop: GOLD, borderRadius: "0 6px 0 0" },
  { ...CORNER_BASE, left: 0, bottom: 0, borderLeft: GOLD, borderBottom: GOLD, borderRadius: "0 0 0 6px" },
  { ...CORNER_BASE, right: 0, bottom: 0, borderRight: GOLD, borderBottom: GOLD, borderRadius: "0 0 6px 0" },
];
