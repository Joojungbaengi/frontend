"use client";

import { useEffect, useState } from "react";
import AppImage from "@/components/AppImage";

/**
 * 상세 화면의 술 사진 — 누르면 크게 펼쳐 본다.
 *
 * 목록에 쓰는 작은 사진은 잘려 들어가서 라벨을 읽기 어렵다.
 * 펼친 화면에서는 잘리지 않게 통째로 보여주고, 어두운 배경으로 뒤를 덮는다.
 * 닫는 길은 세 가지다 — 닫기 버튼, 사진 바깥, Esc.
 */
export default function DrinkPhotoViewer({
  src,
  alt,
  boxStyle,
}: {
  src: string;
  alt: string;
  boxStyle?: React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    // 펼친 동안에는 뒤쪽 화면이 따라 스크롤되지 않게 잠근다
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`${alt} 사진 크게 보기`}
        style={{
          padding: 0,
          border: "none",
          background: "none",
          cursor: "zoom-in",
          display: "block",
          flexShrink: 0,
        }}
      >
        <AppImage src={src} alt={alt} eager boxStyle={boxStyle} />
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${alt} 사진`}
          onClick={() => setOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 200,
            background: "rgba(16,11,6,.86)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 26,
          }}
        >
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="닫기"
            style={{
              position: "absolute",
              top: 16,
              right: 16,
              width: 42,
              height: 42,
              borderRadius: 999,
              border: "1px solid rgba(246,236,214,.35)",
              background: "rgba(0,0,0,.45)",
              color: "#f6ecd6",
              fontSize: 20,
              lineHeight: 1,
              cursor: "pointer",
            }}
          >
            ×
          </button>

          {/* 사진 자체를 누른 건 닫기가 아니다 — 바깥을 눌렀을 때만 닫힌다 */}
          <img
            src={src}
            alt={alt}
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
              objectFit: "contain",
              borderRadius: 12,
              boxShadow: "0 24px 60px -18px rgba(0,0,0,.8)",
            }}
          />
        </div>
      )}
    </>
  );
}
