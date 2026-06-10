"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { clearToken, type AuthUser } from "@/lib/auth";

const TABS = [
  { href: "/", label: "推荐" },
  { href: "/rank/hot", label: "热点榜" },
  { href: "/rank/best", label: "爆文榜" },
  { href: "/drafts/mine", label: "我的草稿" },
  { href: "/me/works", label: "创作中心" },
];

function subscribeAuth(cb: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", cb);
  return () => window.removeEventListener("storage", cb);
}

interface AuthSnapshot {
  user: AuthUser | null;
  hasToken: boolean;
}

const EMPTY: AuthSnapshot = { user: null, hasToken: false };

// useSyncExternalStore 要求 getSnapshot 在数据未变时返回引用相等的对象,
// 否则会触发"getSnapshot should be cached"无限循环。
let cachedSnap: AuthSnapshot = EMPTY;

function readAuth(): AuthSnapshot {
  if (typeof window === "undefined") return EMPTY;
  const token = window.localStorage.getItem("bytedance-aigc.accessToken");
  const userRaw = window.localStorage.getItem("bytedance-aigc.user");
  const hasToken = !!token;
  const userId = cachedSnap.user?.id ?? null;
  const userHandle = cachedSnap.user?.handle ?? null;
  let parsed: AuthUser | null = null;
  if (userRaw) {
    try {
      parsed = JSON.parse(userRaw) as AuthUser;
    } catch {
      parsed = null;
    }
  }
  if (
    cachedSnap.hasToken === hasToken &&
    userId === (parsed?.id ?? null) &&
    userHandle === (parsed?.handle ?? null)
  ) {
    return cachedSnap;
  }
  cachedSnap = { user: parsed, hasToken };
  return cachedSnap;
}

function getServerSnapshot(): AuthSnapshot {
  return EMPTY;
}

export function SiteMasthead() {
  const pathname = usePathname();
  const auth = useSyncExternalStore(subscribeAuth, readAuth, getServerSnapshot);
  const isLoggedIn = auth.hasToken && !!auth.user;

  return (
    <header className="bg-[var(--surface)] border-b border-[var(--border)] sticky top-0 z-30">
      {/* Row 1: Logo + 搜索 + 通知/头像 */}
      <div className="max-w-[1200px] mx-auto px-5 h-14 flex items-center gap-6">
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-[var(--brand)] text-white text-[12px] font-bold leading-none">
            AI
          </span>
          <span className="text-[15px] font-medium text-[var(--text)]">创作者平台</span>
        </Link>

        <div className="flex-1 max-w-[480px]">
          <label className="flex items-center gap-2 h-8 px-3 rounded-md bg-[var(--bg)] border border-transparent hover:border-[var(--border)] focus-within:border-[var(--brand)] focus-within:bg-white transition-colors">
            <svg
              className="w-4 h-4 text-[var(--text-3)] shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              type="search"
              placeholder="搜索文章 / 作者"
              className="flex-1 bg-transparent text-[13px] text-[var(--text)] placeholder:text-[var(--text-3)] outline-none"
            />
          </label>
        </div>

        <nav className="flex items-center gap-1 ml-auto">
          {isLoggedIn ? (
            <>
              <Link
                href="/drafts/mine"
                className="btn btn-primary btn-sm hidden md:inline-flex"
                aria-label="去写文章"
              >
                + 写文章
              </Link>
              <Link
                href="/me/works"
                className="btn btn-ghost btn-sm hidden sm:inline-flex"
                aria-label="进入创作中心"
              >
                创作中心
              </Link>
              <span className="hidden md:inline-flex items-center gap-2 px-2 h-8 text-[13px] text-[var(--text-2)]">
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[var(--brand-soft)] text-[var(--brand)] text-[11px] font-medium">
                  {auth.user!.handle.slice(0, 1).toUpperCase()}
                </span>
                <span className="max-w-[100px] truncate">@{auth.user!.handle}</span>
              </span>
              <button
                type="button"
                onClick={() => {
                  clearToken();
                  window.location.href = "/";
                }}
                className="btn btn-ghost btn-sm"
              >
                退出
              </button>
            </>
          ) : (
            <>
              <Link href="/login" className="btn btn-ghost btn-sm">
                登录
              </Link>
              <Link href="/login" className="btn btn-primary btn-sm">
                + 写文章
              </Link>
            </>
          )}
        </nav>
      </div>

      {/* Row 2: 分类 tabs */}
      <div className="border-t border-[var(--border)]">
        <div className="max-w-[1200px] mx-auto px-5 h-10 flex items-center gap-1 overflow-x-auto">
          {TABS.map((t) => {
            const active = t.href === "/" ? pathname === "/" : pathname.startsWith(t.href);
            return (
              <Link
                key={t.href}
                href={t.href}
                className={`relative inline-flex items-center h-10 px-3 text-[14px] shrink-0 transition-colors ${
                  active
                    ? "text-[var(--brand)] font-medium"
                    : "text-[var(--text-2)] hover:text-[var(--text)]"
                }`}
              >
                {t.label}
                {active && (
                  <span
                    aria-hidden
                    className="absolute left-3 right-3 bottom-0 h-[2px] bg-[var(--brand)] rounded-full"
                  />
                )}
              </Link>
            );
          })}
        </div>
      </div>
    </header>
  );
}
