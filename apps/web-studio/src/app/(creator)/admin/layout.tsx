"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { cn } from "@bytedance-aigc/ui/lib/utils";
import { useAuthSnapshot } from "@bytedance-aigc/ui/lib/use-auth-snapshot";

const NAV_ITEMS = [
  { href: "/admin", label: "总览" },
  { href: "/admin/reports", label: "举报" },
  { href: "/admin/offline", label: "下线" },
  { href: "/admin/sample-audits", label: "抽审" },
  { href: "/admin/rule-rechecks", label: "重检" },
  { href: "/admin/prompt-lab", label: "Prompt" },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname.startsWith(href);
}

// 客户端守卫(RBAC mini, 2026-06-11):非 ADMIN hard-nav 回工作台。
// 用 hard navigation(window.location.replace)而非 router.push 避免和 basePath 交互引发歧义,
// basePath 自动加 /studio 前缀。这是深度防御的路由层 — 后端 AdminGuard 仍是最终兜底。
//
// 关键:useSyncExternalStore 第一次 hydrate 必须用 getServerSnapshot 返回的 EMPTY,
// 真实 client snapshot 要在 commit 后下一拍才生效。所以守卫不能在 mounted=false 阶段就判,
// 否则第一次 effect 永远拿到 user=null → 误把已登录用户弹回工作台。
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, hasToken } = useAuthSnapshot();
  const role = user?.role;
  const isAdmin = role === "ADMIN";
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    // 还在加载 client snapshot:有 token 但 user 没解析出来 → 等下一拍
    if (hasToken && !user) return;
    if (!isAdmin) {
      window.location.replace("/me/dashboard");
    }
  }, [mounted, hasToken, user, isAdmin]);

  if (!mounted || !isAdmin) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
        正在校验权限...
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0">
      <nav
        className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60"
        aria-label="管理后台导航"
      >
        <ul className="flex items-center gap-1 overflow-x-auto px-6">
          {NAV_ITEMS.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className={cn(
                  "relative inline-flex items-center px-3 py-2.5 text-sm font-medium transition-colors hover:text-foreground",
                  isActive(pathname, item.href)
                    ? "text-foreground border-b-2 border-foreground"
                    : "text-muted-foreground",
                )}
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div>{children}</div>
    </div>
  );
}
