"use client";

import { useRouter } from "next/navigation";

/** 뒤로가기 + 가운데 타이틀이 있는 상단 고정 헤더 */
export default function ScreenHeader({
  title,
  backHref,
  dark = false,
  right,
}: {
  title: string;
  /** 지정하면 해당 경로로, 없으면 브라우저 뒤로가기 */
  backHref?: string;
  /** 카메라·AR 같은 어두운 화면용 */
  dark?: boolean;
  right?: React.ReactNode;
}) {
  const router = useRouter();
  const goBack = () => (backHref ? router.push(backHref) : router.back());

  return (
    <div
      className="screen-header"
      style={dark ? { background: "none", backdropFilter: "none", padding: "56px 20px 12px" } : undefined}
    >
      <button className={`btn-back${dark ? " on-dark" : ""}`} onClick={goBack} aria-label="뒤로가기">
        <svg width="9" height="16" viewBox="0 0 9 16">
          <path
            d="M8 1L1 8l7 7"
            stroke={dark ? "#fff" : "#20302a"}
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <div className="screen-header-title" style={dark ? { color: "rgba(255,255,255,.8)" } : undefined}>
        {title}
      </div>
      {right ?? <div style={{ width: 38 }} />}
    </div>
  );
}
