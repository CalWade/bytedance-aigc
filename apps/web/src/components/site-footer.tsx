import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="mt-12 border-t border-border bg-card/30">
      <div className="max-w-[1200px] mx-auto px-5 py-4 flex items-center justify-between text-[12px] text-muted-foreground flex-wrap gap-2">
        <span>© 2026 AI 创作者辅助生产与分发平台</span>
        <nav className="flex items-center gap-4">
          <Link href="/rank/hot" className="hover:text-foreground transition-colors">
            热点榜
          </Link>
          <Link href="/rank/best" className="hover:text-foreground transition-colors">
            爆文榜
          </Link>
          <Link href="/drafts/mine" className="hover:text-foreground transition-colors">
            我的草稿
          </Link>
          <Link href="/me/reports" className="hover:text-foreground transition-colors">
            举报记录
          </Link>
        </nav>
      </div>
    </footer>
  );
}
