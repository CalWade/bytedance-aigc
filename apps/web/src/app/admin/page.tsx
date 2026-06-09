import Link from "next/link";

export const dynamic = "force-dynamic";

export default function AdminHomePage() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-8">
      <h1 className="text-2xl font-bold mb-6">平台管理后台</h1>
      <p className="text-sm text-zinc-500 mb-6">
        访问需要 admin 权限(白名单 handle 由后端 ADMIN_HANDLES 控制)。
      </p>
      <div className="grid sm:grid-cols-2 gap-3">
        <NavCard
          href="/admin/reports"
          title="举报工作台"
          desc="待处理举报列表 / 处置记录,可一键下线违规稿件"
        />
        <NavCard
          href="/admin/offline"
          title="直接下线"
          desc="不经过举报流程,凭 draft id 直接下线已发布作品"
        />
        <NavCard
          href="/admin/sample-audits"
          title="抽样巡检"
          desc="按 5% 随机抽取已发布作品进行人工复审"
        />
        <NavCard
          href="/admin/rule-rechecks"
          title="规则复审"
          desc="规则更新后批量重审已发布作品,命中 BLOCK 自动下线"
        />
        <NavCard
          href="/admin/prompt-lab"
          title="Prompt 实验室"
          desc="批量评估 Prompt 准确率,版本对比,一键上线与回滚"
        />
      </div>
    </main>
  );
}

function NavCard({ href, title, desc }: { href: string; title: string; desc: string }) {
  return (
    <Link
      href={href}
      className="block rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4 hover:border-zinc-400 dark:hover:border-zinc-600"
    >
      <div className="text-base font-medium">{title}</div>
      <div className="text-xs text-zinc-500 mt-1">{desc}</div>
    </Link>
  );
}
