import type { Metadata } from "next";
import { Gowun_Dodum, Nanum_Myeongjo } from "next/font/google";
import "./globals.css";

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
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className={`${gowun.variable} ${myeongjo.variable} h-full antialiased`}>
      <body className="min-h-full">
        <div className="phone">
          <div className="mist mist-a" />
          <div className="mist mist-b" />
          {children}
        </div>
      </body>
    </html>
  );
}
