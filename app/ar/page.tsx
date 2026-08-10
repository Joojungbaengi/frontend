import Link from "next/link";
import ScreenHeader from "@/components/ScreenHeader";
import ArBreweryClient from "@/components/ArBreweryClient";
import { getRecipeForDrink } from "@/lib/brewery/recipes";

/**
 * AR 양조 체험 — WebXR / Three.js.
 * 어떤 술을 체험할지는 /ar?drink=<술 id> 로 정해진다. (data/drinks.json 의 id)
 * 체험을 마치면 그 술이 경기술 도감에 담긴다.
 *
 * 아직 레시피가 없는 술로 들어오면 체험 대신 준비 중 안내를 보여준다.
 * (상세 화면 버튼이 먼저 막아 주지만, 주소로 바로 들어오는 경우가 있다)
 */
export default async function ArPage({
  searchParams,
}: {
  searchParams: Promise<{ drink?: string }>;
}) {
  const { drink } = await searchParams;
  const recipe = getRecipeForDrink(drink);

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
        {recipe ? (
          <ArBreweryClient recipe={recipe} />
        ) : (
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 14,
              padding: "0 34px 60px",
              textAlign: "center",
            }}
          >
            <h2
              className="serif"
              style={{ margin: 0, fontSize: 19, fontWeight: 800, color: "#f6ecd6", wordBreak: "keep-all" }}
            >
              아직 준비 중인 체험이에요
            </h2>
            <p
              style={{
                margin: 0,
                fontSize: 13.5,
                lineHeight: 1.8,
                color: "rgba(246,236,214,.75)",
                wordBreak: "keep-all",
              }}
            >
              이 술의 AR 양조 체험은 지금 만들고 있어요.
              <br />
              먼저 준비된 술부터 만나보세요.
            </p>
            <Link
              href="/dex"
              className="btn-outline"
              style={{ marginTop: 6, padding: "13px 26px", fontSize: 14, color: "#f6ecd6", borderColor: "rgba(232,201,138,.45)" }}
            >
              경기술 도감으로 가기
            </Link>
          </div>
        )}
      </div>
      {/* ▲▲▲ AR 구현 영역 끝 ▲▲▲ */}
    </div>
  );
}
