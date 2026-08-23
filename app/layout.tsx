import type { Metadata, Viewport } from "next";
import { Gowun_Dodum, Nanum_Myeongjo } from "next/font/google";
import "./globals.css";
import FullscreenOnTap from "@/components/FullscreenOnTap";

// 디자인 예시(claude_design_example.html)와 동일한 폰트 구성
const gowun = Gowun_Dodum({
  variable: "--font-gowun",
  weight: "400",
  subsets: ["latin"],
});

const myeongjo = Nanum_Myeongjo({
  variable: "--font-myeongjo",
  weight: ["400", "700", "800"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "경기술도가 — 경기도 전통주, 신선처럼 즐기다",
  description:
    "취향에 맞는 경기도 전통주를 AI가 추천하고, 그 술이 빚어지는 과정을 AR 양조장에서 체험하는 콘텐츠",
  // 홈 화면에 설치하면 주소창 없이 앱처럼 열린다 (app/manifest.ts)
  manifest: "/manifest.webmanifest",
  applicationName: "경기술도가",
  appleWebApp: {
    capable: true,
    title: "경기술도가",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#2a1b11",
  width: "device-width",
  initialScale: 1,
  // 주소창이 걷힌 뒤 화면 끝까지 쓰고, 노치 영역도 우리가 직접 다룬다
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className={`${gowun.variable} ${myeongjo.variable} h-full antialiased`}>
      <body className="min-h-full">
        <FullscreenOnTap />
        <div className="phone">{children}</div>
      </body>
    </html>
  );
}
