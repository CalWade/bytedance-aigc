import * as React from "react";

/**
 * 编辑器沉浸式 layout。
 *
 * (creator)/layout.tsx 已套了 AppShell(sidebar + topbar)。
 * 这一层把主区撑满宽度，不额外约束 max-w，让编辑器工具栏和内容区自由排布。
 * 编辑区自身的宽度由 prose max-w-prose 控制（~65ch 居中）。
 */
export default function DraftEditorLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-svh w-full">{children}</div>;
}
