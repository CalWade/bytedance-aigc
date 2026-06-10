import Link from "next/link";

import { AdminReportsClient } from "./_components/AdminReportsClient";

export const dynamic = "force-dynamic";

export default async function AdminReportsPage() {
  return (
    <main className="max-w-5xl mx-auto px-6 py-8">
      <Link
        href="/admin"
        className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
      >
        ← 平台管理后台
      </Link>
      <h1 className="text-2xl font-bold mt-2 mb-6">举报工作台</h1>
      <AdminReportsClient />
    </main>
  );
}
