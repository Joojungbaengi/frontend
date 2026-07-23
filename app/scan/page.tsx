import Link from "next/link";
import ScreenHeader from "@/components/ScreenHeader";

/**
 * 바코드 스캔 — 카메라 연동 전 껍데기 화면.
 * TODO(내용 연결): 카메라/바코드 인식 연동, 인식된 제품의 /drink/[id]로 이동.
 */
export default function ScanPage() {
  return (
    <div
      style={{
        position: "relative",
        zIndex: 5,
        minHeight: "100vh",
        background: "var(--dark)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <ScreenHeader title="바코드 스캔" backHref="/" dark />

      {/* 카메라 미리보기 자리 + 스캔라인 애니메이션 */}
      <div style={{ flex: 1, position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div
          style={{
            position: "relative",
            width: 250,
            height: 250,
            borderRadius: 24,
            background: "repeating-linear-gradient(45deg,#2b352d,#2b352d 14px,#252e27 14px,#252e27 28px)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: "6%",
              right: "6%",
              height: 2,
              background: "var(--seal)",
              boxShadow: "0 0 12px #b5482f",
              animation: "scanline 1.8s ease-in-out infinite alternate",
            }}
          />
          {/* 네 모서리 가이드 */}
          <div style={{ position: "absolute", left: 14, top: 14, width: 26, height: 26, borderLeft: "3px solid #dbe8d5", borderTop: "3px solid #dbe8d5", borderRadius: "6px 0 0 0" }} />
          <div style={{ position: "absolute", right: 14, top: 14, width: 26, height: 26, borderRight: "3px solid #dbe8d5", borderTop: "3px solid #dbe8d5", borderRadius: "0 6px 0 0" }} />
          <div style={{ position: "absolute", left: 14, bottom: 14, width: 26, height: 26, borderLeft: "3px solid #dbe8d5", borderBottom: "3px solid #dbe8d5", borderRadius: "0 0 0 6px" }} />
          <div style={{ position: "absolute", right: 14, bottom: 14, width: 26, height: 26, borderRight: "3px solid #dbe8d5", borderBottom: "3px solid #dbe8d5", borderRadius: "0 0 6px 0" }} />
          <span
            className="ph-label"
            style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", color: "rgba(255,255,255,.4)", fontSize: 10 }}
          >
            카메라 미리보기
          </span>
        </div>
      </div>

      <div style={{ padding: "22px 22px 44px", textAlign: "center" }}>
        <p style={{ margin: "0 0 18px", fontSize: 14, lineHeight: 1.6, color: "rgba(255,255,255,.8)" }}>
          전통주 병의 바코드를 사각형 안에
          <br />
          맞춰주세요. 인식 후 제품 정보를 불러옵니다.
        </p>
        {/* TODO(내용 연결): 실제 인식 결과로 이동 */}
        <Link href="/drink/placeholder" className="btn-primary" style={{ display: "block", textAlign: "center", color: "#fff", padding: 16 }}>
          제품 인식됨 · 정보 보기 (자리)
        </Link>
        <div style={{ marginTop: 12, fontSize: 12, color: "rgba(255,255,255,.55)" }}>
          등록되지 않은 제품인가요? <span style={{ color: "#dbe8d5" }}>직접 검색</span>
        </div>
      </div>
    </div>
  );
}
