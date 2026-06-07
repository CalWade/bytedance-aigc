import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { PostDetailDto } from "@bytedance-aigc/shared";
import { serverFetchJson } from "@/lib/server-fetch";
import { ReportButton } from "@/components/post/ReportButton";
import { QualityBadge } from "@/app/_components/QualityBadge";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function PostPage({ params }: PageProps) {
  const { id } = await params;
  let post: PostDetailDto;
  try {
    post = await serverFetchJson<PostDetailDto>(`/post/${encodeURIComponent(id)}`);
  } catch {
    notFound();
  }
  return (
    <main className="max-w-3xl mx-auto px-6 py-8">
      <Link href="/" className="text-sm text-gray-500 underline">
        ← 返回信息流
      </Link>
      <div className="float-right">
        <ReportButton postId={post.id} authorId={post.authorId} />
      </div>
      <article className="mt-4">
        <h1 className="text-3xl font-bold mb-3">{post.title}</h1>
        <div className="flex gap-3 text-sm text-gray-500 mb-4">
          <Link href={`/authors/${post.authorId}`} className="underline">
            {post.authorHandle}
          </Link>
          <span className="inline-flex items-center gap-1.5">
            · Q {post.qualityOverall.toFixed(0)}
            <QualityBadge score={post.qualityOverall} size="md" />
          </span>
          <span>· H {post.hotnessMock.toFixed(0)}</span>
          <span>· {new Date(post.publishedAt).toLocaleString()}</span>
        </div>
        <div className="relative aspect-video mb-6">
          <Image
            src={`/covers/cover-${post.coverIndex}.webp`}
            alt=""
            fill
            sizes="(max-width: 768px) 100vw, 768px"
            priority
            className="object-cover rounded-lg"
          />
        </div>
        <p className="text-base text-gray-700 dark:text-gray-300 leading-7">{post.excerpt}</p>
        <details className="mt-6 text-xs text-gray-400">
          <summary>原文 JSON(开发预览)</summary>
          <pre className="overflow-x-auto p-3 bg-gray-50 dark:bg-zinc-900 rounded mt-2">
            {JSON.stringify(post.body, null, 2)}
          </pre>
        </details>
      </article>
    </main>
  );
}
