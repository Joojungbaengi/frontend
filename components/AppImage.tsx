"use client";

import { useState } from "react";

/**
 * 이미지 로드 전에는 자리에서 스피너를 돌리고, 로드되면 부드럽게 페이드인.
 * boxStyle 로 자리(크기·테두리·모서리)를 지정한다.
 */
export default function AppImage({
  src,
  alt,
  boxStyle,
  objectFit = "cover",
  objectPosition,
  eager = false,
}: {
  src: string;
  alt: string;
  boxStyle?: React.CSSProperties;
  objectFit?: React.CSSProperties["objectFit"];
  /** 잘릴 때 어느 부분을 남길지 (예: 인물 얼굴을 살리려면 "top") */
  objectPosition?: React.CSSProperties["objectPosition"];
  eager?: boolean;
}) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div style={{ position: "relative", overflow: "hidden", background: "var(--hanji-bright)", ...boxStyle }}>
      {!loaded && (
        <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span className="mini-spin" />
        </span>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={() => setLoaded(true)}
        style={{
          width: "100%",
          height: "100%",
          objectFit,
          objectPosition,
          display: "block",
          opacity: loaded ? 1 : 0,
          transition: "opacity .35s ease",
        }}
      />
    </div>
  );
}
