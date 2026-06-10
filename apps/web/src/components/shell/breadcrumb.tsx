"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const LABELS: Record<string, string> = {
  "": "首页",
  rank: "榜单",
  hot: "热点榜",
  best: "爆文榜",
  drafts: "草稿",
  mine: "我的草稿",
  me: "工作台",
  dashboard: "数据",
  works: "作品",
  assets: "素材",
  reports: "举报",
  admin: "管理",
  offline: "下线",
  "sample-audits": "抽审",
  "rule-rechecks": "重检",
  "prompt-lab": "Prompt",
  post: "文章",
  login: "登录",
};

function labelOf(seg: string) {
  return LABELS[seg] ?? seg;
}

export function Breadcrumb() {
  const pathname = usePathname();
  const segments = React.useMemo(() => pathname.split("/").filter(Boolean), [pathname]);

  if (segments.length === 0) {
    return <div className="flex items-center text-[13px] text-foreground font-medium">推荐</div>;
  }

  const crumbs = segments.map((seg, idx) => {
    const href = "/" + segments.slice(0, idx + 1).join("/");
    const isLast = idx === segments.length - 1;
    return { seg, href, isLast };
  });

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-[13px]">
      <Link href="/" className="text-muted-foreground hover:text-foreground transition-colors">
        首页
      </Link>
      {crumbs.map((c) => (
        <React.Fragment key={c.href}>
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" aria-hidden />
          {c.isLast ? (
            <span className={cn("text-foreground font-medium truncate max-w-[200px]")}>
              {labelOf(c.seg)}
            </span>
          ) : (
            <Link
              href={c.href}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              {labelOf(c.seg)}
            </Link>
          )}
        </React.Fragment>
      ))}
    </nav>
  );
}
