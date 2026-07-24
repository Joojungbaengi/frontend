"use client";

import { useRouter } from "next/navigation";

/**
 * 확정 디자인 헤더 — 뒤로가기(원형) + 가운데 페이지명(명조 19px)을 한 줄에.
 * 헤더와 본문 사이 간격은 각 페이지 콘텐츠의 상단 여백으로 확보한다.
 */
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
  const stroke = dark ? "#f6ecd6" : "#3d2f1c";

  return (
    <div className="screen-header">
      <button className={`btn-back${dark ? " on-dark" : ""}`} onClick={goBack} aria-label="뒤로가기">
        <svg width="9" height="16" viewBox="0 0 9 16">
          <path d="M8 1L1 8l7 7" stroke={stroke} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <div
        className="screen-header-title"
        style={dark ? { color: "#f6ecd6", textShadow: "0 1px 4px rgba(0,0,0,.4)" } : undefined}
      >
        {title}
      </div>
      {right ?? <div style={{ width: 40 }} />}
    </div>
  );
}
