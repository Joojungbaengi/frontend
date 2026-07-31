import ScreenHeader from "@/components/ScreenHeader";
import ArBreweryClient from "@/components/ArBreweryClient";

/**
 * AR 양조 체험 — WebXR / Three.js.
 * 어떤 술을 체험할지는 /ar?type=<레시피 id> 쿼리로 고른다. (없으면 기본: 냥이탁주)
 * 체험 종료 후 흐름: AI 양조 리포트 → 경기술 카드 획득 → 도감 등록 (추후 연결)
 */
export default async function ArPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const { type } = await searchParams;

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
      <ScreenHeader title="AR 양조 체험" dark />

      {/* ▼▼▼ AR 구현 영역 ▼▼▼ */}
      <div
        style={{
          flex: 1,
          position: "relative",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <ArBreweryClient recipeId={type} />
      </div>
      {/* ▲▲▲ AR 구현 영역 끝 ▲▲▲ */}
    </div>
  );
}