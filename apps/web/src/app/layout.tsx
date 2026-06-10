import type { Metadata } from "next";
import "./globals.css";
import { SiteMasthead } from "@/components/site-masthead";
import { SiteFooter } from "@/components/site-footer";

export const metadata: Metadata = {
  title: "AI 创作者辅助生产与分发平台",
  description: "双轨创作 · 五阶段审核 · 双榜分发 · 为创作者打造的 AI 写作与发布工作台",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-[var(--bg)] text-[var(--text)]">
        <SiteMasthead />
        <div className="flex-1">{children}</div>
        <SiteFooter />
      </body>
    </html>
  );
}
