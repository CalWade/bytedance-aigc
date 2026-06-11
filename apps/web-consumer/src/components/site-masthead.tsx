"use client";

import Link from "next/link";
import { clearToken } from "@bytedance-aigc/ui/lib/auth";
import { useAuthSnapshot } from "@bytedance-aigc/ui/lib/use-auth-snapshot";
import { Button } from "@bytedance-aigc/ui/components/ui/button";

export function SiteMasthead() {
  const { user, isLoggedIn } = useAuthSnapshot();

  return (
    <header className="sticky top-0 z-30 h-14 border-b border-border bg-background/80 backdrop-blur-xl">
      <div className="max-w-[1200px] mx-auto px-5 h-full flex items-center gap-4">
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground text-[12px] font-semibold leading-none">
            AI
          </span>
          <span className="text-[14px] font-medium text-foreground">创作者平台</span>
        </Link>

        <nav className="flex items-center gap-2 ml-auto">
          {isLoggedIn ? (
            <>
              <span className="hidden md:inline-flex items-center gap-2 px-2 h-8 text-[13px] text-muted-foreground">
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-muted text-foreground text-[11px] font-medium">
                  {user!.handle.slice(0, 1).toUpperCase()}
                </span>
                <span className="max-w-[100px] truncate">@{user!.handle}</span>
              </span>
              <Button asChild size="sm" variant="default">
                {/* 跨 zone 跳转必须是 hard navigation,用 <a> 而非 next/link(Multi-Zones) */}
                <a href="/studio/drafts/mine">进入工作台</a>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  clearToken();
                  window.location.href = "/";
                }}
              >
                退出
              </Button>
            </>
          ) : (
            <Button asChild size="sm" variant="default">
              <Link href="/login">登录</Link>
            </Button>
          )}
        </nav>
      </div>
    </header>
  );
}
