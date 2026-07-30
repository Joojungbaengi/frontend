import LabelScanner from "@/components/LabelScanner";
import ScreenHeader from "@/components/ScreenHeader";

/**
 * 전통주 스캔 — 후면 카메라 + YOLO 라벨 인식.
 * 실제 카메라·추론은 클라이언트 컴포넌트 LabelScanner 가 담당한다.
 */
export default function ScanPage() {
  return (
    <div
      style={{
        position: "relative",
        zIndex: 5,
        minHeight: "100dvh",
        background: "var(--dark)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <ScreenHeader title="전통주 스캔" backHref="/" dark />
      <LabelScanner />
    </div>
  );
}
