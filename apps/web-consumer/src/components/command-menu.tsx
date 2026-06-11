"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Compass,
  Flame,
  TrendingUp,
  LayoutDashboard,
  Sun,
  Moon,
  Monitor,
  LogIn,
  LogOut,
  type LucideIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@bytedance-aigc/ui/components/ui/command";
import { useAuthSnapshot } from "@bytedance-aigc/ui/lib/use-auth-snapshot";
import { clearToken } from "@bytedance-aigc/ui/lib/auth";

interface CmdItem {
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  keywords?: string[];
}

interface CmdGroup {
  heading: string;
  items: CmdItem[];
}

export function CommandMenu() {
  const [open, setOpen] = React.useState(false);
  const router = useRouter();
  const { setTheme } = useTheme();
  const { isLoggedIn } = useAuthSnapshot();

  const go = React.useCallback(
    (href: string) => {
      router.push(href);
      setOpen(false);
    },
    [router],
  );

  // 跨 zone 跳转必须是 hard navigation(Multi-Zones doc),用 window.location
  const goCrossZone = React.useCallback((href: string) => {
    window.location.href = href;
  }, []);

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  React.useEffect(() => {
    function onClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const trigger = target.closest("[data-cmd-trigger]");
      if (trigger) {
        e.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, []);

  const groups: CmdGroup[] = [
    {
      heading: "导航",
      items: [
        { label: "推荐", icon: Compass, onSelect: () => go("/"), keywords: ["home", "feed"] },
        { label: "热点榜", icon: Flame, onSelect: () => go("/rank/hot"), keywords: ["hot"] },
        { label: "爆文榜", icon: TrendingUp, onSelect: () => go("/rank/best"), keywords: ["best"] },
      ],
    },
    {
      heading: "工作台",
      items: [
        {
          label: "前往工作台",
          icon: LayoutDashboard,
          onSelect: () => goCrossZone("/studio/me/dashboard"),
          keywords: ["studio", "dashboard", "creator"],
        },
      ],
    },
    {
      heading: "主题",
      items: [
        {
          label: "切换到浅色",
          icon: Sun,
          onSelect: () => {
            setTheme("light");
            setOpen(false);
          },
          keywords: ["light"],
        },
        {
          label: "切换到暗色",
          icon: Moon,
          onSelect: () => {
            setTheme("dark");
            setOpen(false);
          },
          keywords: ["dark"],
        },
        {
          label: "跟随系统",
          icon: Monitor,
          onSelect: () => {
            setTheme("system");
            setOpen(false);
          },
          keywords: ["system"],
        },
      ],
    },
    {
      heading: "账户",
      items: isLoggedIn
        ? [
            {
              label: "退出登录",
              icon: LogOut,
              onSelect: () => {
                clearToken();
                window.location.href = "/";
              },
              keywords: ["logout"],
            },
          ]
        : [{ label: "登录", icon: LogIn, onSelect: () => go("/login"), keywords: ["login"] }],
    },
  ];

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="命令面板"
      description="搜索页面、切换主题、管理账户"
    >
      <CommandInput placeholder="输入命令或搜索..." />
      <CommandList>
        <CommandEmpty>没有结果</CommandEmpty>
        {groups.map((group, gi) => (
          <React.Fragment key={group.heading}>
            {gi > 0 ? <CommandSeparator /> : null}
            <CommandGroup heading={group.heading}>
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <CommandItem
                    key={item.label}
                    value={`${group.heading} ${item.label} ${item.keywords?.join(" ") ?? ""}`}
                    onSelect={item.onSelect}
                  >
                    <Icon className="mr-2 h-4 w-4" aria-hidden />
                    <span>{item.label}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </React.Fragment>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
