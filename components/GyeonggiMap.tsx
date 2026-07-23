"use client";

import { useRouter } from "next/navigation";
import mapData from "@/data/gyeonggi-regions.json";

interface RegionShape {
  name: string; // 전체 이름 (예: 수원시)
  label: string; // 짧은 이름 (예: 수원)
  d: string; // SVG path
  cx: number;
  cy: number;
}

const { width, height, regions } = mapData as {
  width: number;
  height: number;
  regions: RegionShape[];
};

/**
 * 경기도 시군 지도 — 조각을 누르면 해당 지역 목록(/map/지역명)으로 이동.
 * activeRegions: 전통주가 등록된 시군 전체 이름 목록 (붉게 칠해짐)
 */
export default function GyeonggiMap({ activeRegions }: { activeRegions: string[] }) {
  const router = useRouter();
  const active = new Set(activeRegions);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" style={{ display: "block" }}>
      {regions.map((r) => {
        const has = active.has(r.name);
        return (
          <path
            key={r.name}
            d={r.d}
            fill={has ? "#b5482f" : "#d5e1d8"}
            stroke="#f4f0e6"
            strokeWidth={1.6}
            className={`map-piece${has ? "" : " inactive"}`}
            onClick={() => router.push(`/map/${encodeURIComponent(r.name)}`)}
          />
        );
      })}
      {regions.map((r) => {
        const has = active.has(r.name);
        return (
          <text
            key={`t-${r.name}`}
            x={r.cx}
            y={r.cy}
            fill={has ? "#fff" : "#6b7a70"}
            fontSize={has ? 26 : 18}
            textAnchor="middle"
            dominantBaseline="middle"
            style={{
              fontFamily: "var(--font-myeongjo), serif",
              fontWeight: has ? 800 : 600,
              pointerEvents: "none",
            }}
          >
            {r.label}
          </text>
        );
      })}
    </svg>
  );
}
