"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { hasArExperience } from "@/lib/brewery/recipes";

/**
 * AR 양조 체험 진입 버튼.
 *
 * 술마다 체험을 따로 만들고 있어서, 아직 레시피가 없는 술은 눌러도 넘어가지 않고
 * 준비 중이라고 알려준다. 예전에는 어떤 술에서 눌러도 냥이탁주 체험으로 갔다.
 *
 * 어떤 술이 준비됐는지는 레시피 레지스트리(lib/brewery/recipes/index.ts)가 답한다.
 * 새 술의 레시피를 등록하면 이 버튼은 자동으로 그 술로 이어진다.
 */
export default function ArEntryButton({
  drinkId,
  className = "btn-seal",
  label = "AR 양조 체험 시작",
  style,
}: {
  drinkId: string;
  className?: string;
  label?: string;
  style?: React.CSSProperties;
}) {
  const [notice, setNotice] = useState(false);
  const ready = hasArExperience(drinkId);

  // 모달이 열려 있는 동안 Esc 로 닫기
  useEffect(() => {
    if (!notice) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNotice(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [notice]);

  if (ready) {
    return (
      <Link href={`/ar?drink=${drinkId}`} className={className} style={style}>
        {label}
      </Link>
    );
  }

  return (
    <>
      <button type="button" className={className} style={style} onClick={() => setNotice(true)}>
        {label}
      </button>

      {notice && (
        <div
          onClick={() => setNotice(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 60,
            background: "rgba(30,22,12,.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 30,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ar-notice-title"
            style={{ position: "relative", width: "100%", maxWidth: 340, padding: "24px 22px 20px", borderRadius: 22 }}
          >
            <button
              onClick={() => setNotice(false)}
              aria-label="닫기"
              style={{
                position: "absolute",
                top: 12,
                right: 12,
                width: 30,
                height: 30,
                border: "none",
                background: "transparent",
                cursor: "pointer",
                color: "var(--ink-faint)",
                fontSize: 17,
                lineHeight: 1,
              }}
            >
              ✕
            </button>

            <div style={{ textAlign: "center", paddingTop: 6 }}>
              <h2
                id="ar-notice-title"
                className="serif"
                style={{ margin: "0 0 8px", fontWeight: 800, fontSize: 17, color: "var(--ink)", wordBreak: "keep-all" }}
              >
                AR 양조 체험을 준비하고 있어요
              </h2>
              <p
                style={{
                  margin: "0 0 18px",
                  fontSize: 13,
                  lineHeight: 1.7,
                  color: "var(--ink-faint)",
                  wordBreak: "keep-all",
                }}
              >
                이 술의 양조 과정은 아직 만드는 중이에요.
                <br />
                준비되면 가장 먼저 알려드릴게요.
              </p>
              <button className="btn-primary" style={{ width: "100%", padding: 13, fontSize: 14 }} onClick={() => setNotice(false)}>
                알겠어요
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
