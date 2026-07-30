import LabelScanner from "@/components/LabelScanner";
import ScreenHeader from "@/components/ScreenHeader";

/**
 * 전통주 스캔 — 후면 카메라를 화면 가득 띄우고 YOLO로 라벨을 인식한다.
 * 카메라·추론은 클라이언트 컴포넌트 LabelScanner 가 담당하고,
 * 헤더는 그 위에 겹쳐 올린다 (상단 그라데이션으로 글자 가독성 확보).
 */
export default function ScanPage() {
  return (
    <div
      style={{
        position: "relative",
        zIndex: 5,
        height: "100dvh",
        background: "var(--dark)",
        overflow: "hidden",
      }}
    >
      <LabelScanner />

      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          height: 140,
          pointerEvents: "none",
          background: "linear-gradient(180deg, rgba(20,14,7,.72) 0%, rgba(20,14,7,0) 100%)",
        }}
      />
      <div style={{ position: "relative" }}>
        <ScreenHeader title="전통주 스캔" backHref="/" dark />
      </div>
    </div>
  );
}
