"use client";

import * as React from "react";
import Link from "next/link";
import { Bell, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Breadcrumb } from "./breadcrumb";
import { ThemeToggle } from "./theme-toggle";
import { Kbd } from "@/components/ui/kbd";

export function TopBar() {
  return (
    <header className="sticky top-0 z-30 h-14 border-b border-border bg-background/80 backdrop-blur-xl">
      <div className="h-full px-4 flex items-center gap-4">
        <div className="flex-1 min-w-0">
          <Breadcrumb />
        </div>

        <button
          type="button"
          className="hidden md:inline-flex h-8 min-w-[200px] items-center gap-2 px-2.5 rounded-md border border-border bg-muted/40 text-[13px] text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
          aria-label="打开命令面板"
          data-cmd-trigger
        >
          <Search className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="flex-1 text-left">搜索 / 命令</span>
          <Kbd>⌘K</Kbd>
        </button>

        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="通知">
          <Bell className="h-4 w-4" aria-hidden />
        </Button>

        <ThemeToggle />

        <div className="h-5 w-px bg-border" aria-hidden />

        <Link
          href="/login"
          className="text-[13px] text-muted-foreground hover:text-foreground transition-colors"
        >
          登录
        </Link>
      </div>
    </header>
  );
}
