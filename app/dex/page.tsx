import Link from "next/link";
import ScreenHeader from "@/components/ScreenHeader";
import db from "@/data/drinks.json";

/**
 * 경기술 도감 — AR 체험을 마친 술의 카드가 모이는 화면.
 * 지금은 전부 미획득(잠김) 상태의 플레이스홀더.
 * TODO(내용 연결): 획득 카드(localStorage) 반영, 카드 아트, 획득 연출.
 */
export default function DexPage() {
  const total = db.drinks.length;

  return (
    <div style={{ position: "relative", zIndex: 5, minHeight: "100vh" }}>
      <ScreenHeader title="경기술 도감" backHref="/" />

      <div style={{ padding: "6px 18px 44px" }}>
        <h1 className="serif" style={{ margin: "0 0 6px", fontWeight: 800, fontSize: 24 }}>
          내 경기술 도감
        </h1>
        <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--ink-soft)" }}>
          AR 양조 체험을 마친 술의 카드가 모여요.
        </p>

        {/* 수집 진행도 */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <div style={{ flex: 1, height: 9, borderRadius: 99, background: "rgba(53,89,126,.15)", overflow: "hidden" }}>
            <div style={{ height: "100%", background: "var(--seal)", borderRadius: 99, width: "0%" }} />
          </div>
          <div className="serif" style={{ fontWeight: 700, fontSize: 14 }}>0 / {total}</div>
        </div>

        {/* 카드 그리드 (전부 잠김 플레이스홀더) */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 11 }}>
          {db.drinks.map((d) => (
            <Link key={d.id} href={`/drink/${d.id}`} style={{ textAlign: "center", color: "inherit" }}>
              <div style={{ width: "100%", background: "rgba(255,255,255,.35)", borderRadius: 11, padding: 6 }}>
                <div style={{ border: "1.2px solid rgba(34,48,62,.14)", borderRadius: 8, padding: "8px 5px 9px" }}>
                  <div
                    style={{
                      width: "100%",
                      aspectRatio: "3/4",
                      borderRadius: 5,
                      background: "rgba(53,89,126,.08)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      marginBottom: 6,
                    }}
                  >
                    <span style={{ fontSize: 22, color: "rgba(34,48,62,.28)" }}>?</span>
                  </div>
                  <div
                    className="serif"
                    style={{
                      fontWeight: 700,
                      fontSize: 11,
                      lineHeight: 1.25,
                      color: "rgba(34,48,62,.4)",
                      minHeight: 26,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    ???
                  </div>
                  <div style={{ fontSize: 9, color: "rgba(34,48,62,.35)", marginTop: 2 }}>미획득</div>
                </div>
              </div>
            </Link>
          ))}
        </div>

        <p style={{ margin: "22px 2px 0", fontSize: 12, lineHeight: 1.6, color: "rgba(34,48,62,.55)" }}>
          잠긴 카드는 해당 술의 상세에서 <b>AR 양조 체험</b>을 완료하면 열려요.
        </p>
      </div>
    </div>
  );
}
