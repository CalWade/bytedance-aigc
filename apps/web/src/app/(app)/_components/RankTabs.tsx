"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "推荐" },
  { href: "/rank/hot", label: "热点榜" },
  { href: "/rank/best", label: "爆文榜" },
];

export function RankTabs() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-4 border-b mb-4">
      {TABS.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`pb-2 ${active ? "border-b-2 border-black font-medium" : "text-gray-500"}`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
