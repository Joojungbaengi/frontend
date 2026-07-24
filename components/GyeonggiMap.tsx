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
 * 경기도 시군 지도 — 조각을 누르면 선택 콜백(onSelect) 실행.
 * onSelect가 없으면 기존처럼 /map/지역명 으로 이동한다.
 * activeRegions: 전통주가 등록된 시군 전체 이름 목록 (붉게 칠해짐)
 * selected: 현재 선택된 지역 (더 진하게 표시)
 */
export default function GyeonggiMap({
  activeRegions,
  selected,
  onSelect,
  stamped,
}: {
  activeRegions: string[];
  selected?: string | null;
  onSelect?: (region: string) => void;
  /** 체험을 마쳐 스탬프(도장)를 찍을 시군 전체 이름 목록 */
  stamped?: string[];
}) {
  const router = useRouter();
  const active = new Set(activeRegions);
  const stampSet = new Set(stamped ?? []);

  const handle = (name: string) => {
    if (onSelect) onSelect(name);
    else router.push(`/map/${encodeURIComponent(name)}`);
  };

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" style={{ display: "block" }}>
      {regions.map((r) => {
        const has = active.has(r.name);
        const isSel = selected === r.name;
        return (
          <path
            key={r.name}
            d={r.d}
            fill={has ? (isSel ? "#8f3a20" : "#b5482f") : "#d8ccb4"}
            stroke="#f4f0e6"
            strokeWidth={1.6}
            className={`map-piece${has ? "" : " inactive"}`}
            onClick={() => handle(r.name)}
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
            fill={has ? "#fff" : "#8a7757"}
            fontSize={20}
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
      {/* 체험 완료 스탬프 (도장) — 라벨 위에 겹쳐 찍힘 */}
      {regions.map((r) =>
        stampSet.has(r.name) ? (
          <g key={`s-${r.name}`} transform={`translate(${r.cx + 24}, ${r.cy + 28}) rotate(-12)`} style={{ pointerEvents: "none" }}>
            <rect x={-24} y={-24} width={48} height={48} rx={9} fill="#b5482f" stroke="#f4e9d8" strokeWidth={2} opacity={0.95} />
            <text
              x={0}
              y={2}
              fill="#fbeee5"
              fontSize={30}
              fontWeight={800}
              textAnchor="middle"
              dominantBaseline="middle"
              style={{ fontFamily: "var(--font-myeongjo), serif" }}
            >
              印
            </text>
          </g>
        ) : null
      )}
    </svg>
  );
}
