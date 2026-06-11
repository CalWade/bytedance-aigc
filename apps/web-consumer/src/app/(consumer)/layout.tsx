import * as React from "react";
import { ConsumerShell } from "@bytedance-aigc/ui/components/shell/consumer-shell";
import { CommandMenu } from "@/components/command-menu";
import { Toaster } from "@bytedance-aigc/ui/components/ui/sonner";

// C 段(读者 / 推荐 / 榜单)layout —— 顶部水平导航 + 沉浸阅读。
// 与 (creator) 共享 shadcn token、CommandMenu、Toaster,差异点在 shell 本身的版式。
export default function ConsumerLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ConsumerShell>{children}</ConsumerShell>
      <CommandMenu />
      <Toaster richColors closeButton position="bottom-right" />
    </>
  );
}
