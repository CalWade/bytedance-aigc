import Link from "next/link";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function PostPage({ params }: PageProps) {
  const { id } = await params;
  return (
    <main className="max-w-2xl mx-auto px-6 py-12 flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">已发布</h1>
      <p className="text-sm text-zinc-600">
        草稿 <code>{id}</code> 已发布。详情页 Phase 2.5 实现。
      </p>
      <Link href="/drafts/mine" className="text-sm underline">
        返回我的草稿
      </Link>
    </main>
  );
}
