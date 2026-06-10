"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Compass,
  TrendingUp,
  Flame,
  PenLine,
  LayoutDashboard,
  FileText,
  Image as ImageIcon,
  Flag,
  Shield,
  ShieldAlert,
  ShieldOff,
  ListChecks,
  RotateCcw,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SidebarSection } from "./sidebar-section";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const GROUPS: NavGroup[] = [
  {
    title: "发现",
    items: [
      { href: "/", label: "推荐", icon: Compass, exact: true },
      { href: "/rank/hot", label: "热点榜", icon: Flame },
      { href: "/rank/best", label: "爆文榜", icon: TrendingUp },
    ],
  },
  {
    title: "创作",
    items: [{ href: "/drafts/mine", label: "我的草稿", icon: PenLine }],
  },
  {
    title: "工作台",
    items: [
      { href: "/me/dashboard", label: "数据", icon: LayoutDashboard },
      { href: "/me/works", label: "作品", icon: FileText },
      { href: "/me/assets", label: "素材", icon: ImageIcon },
      { href: "/me/reports", label: "举报", icon: Flag },
    ],
  },
  {
    title: "管理",
    items: [
      { href: "/admin", label: "总览", icon: Shield, exact: true },
      { href: "/admin/reports", label: "举报", icon: ShieldAlert },
      { href: "/admin/offline", label: "下线", icon: ShieldOff },
      { href: "/admin/sample-audits", label: "抽审", icon: ListChecks },
      { href: "/admin/rule-rechecks", label: "重检", icon: RotateCcw },
      { href: "/admin/prompt-lab", label: "Prompt", icon: Sparkles },
    ],
  },
];

function isActive(pathname: string, href: string, exact?: boolean) {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1 py-2">
      {GROUPS.map((group) => (
        <SidebarSection key={group.title} title={group.title}>
          {group.items.map((item) => {
            const Icon = item.icon;
            const active = isActive(pathname, item.href, item.exact);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group flex items-center gap-2.5 h-8 px-2.5 rounded-lg text-[13px] transition-all",
                  "active:scale-[0.98]",
                  active
                    ? "bg-accent text-accent-foreground font-medium"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
              >
                <Icon
                  className={cn(
                    "h-4 w-4 shrink-0 transition-colors",
                    active
                      ? "text-foreground"
                      : "text-muted-foreground group-hover:text-foreground",
                  )}
                  aria-hidden
                />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </SidebarSection>
      ))}
    </nav>
  );
}
