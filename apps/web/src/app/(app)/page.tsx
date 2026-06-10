import { Suspense } from "react";
import Link from "next/link";
import type { FeedResponse } from "@bytedance-aigc/shared";
import { DEFAULT_FEED_WEIGHTS } from "@bytedance-aigc/shared";
import { serverFetchJson } from "@/lib/server-fetch";
import { FeedList } from "./_components/FeedList";
import { FeedSkeleton } from "./_components/FeedSkeleton";
import { LoadMore } from "./_components/LoadMore";
import { SafeRewriteHintBanner } from "./_components/SafeRewriteHintBanner";
import { WeightDrawer } from "./_components/WeightDrawer";

/** ISR 30s — CDN 边缘缓存 */
export const revalidate = 30;

interface PageProps {
  searchParams: Promise<{
    alpha?: string;
    beta?: string;
    gamma?: string;
  }>;
}

async function FeedSection({ searchParams }: PageProps) {
  const sp = await searchParams;
  const alpha = sp.alpha ? Number(sp.alpha) : DEFAULT_FEED_WEIGHTS.alpha;
  const beta = sp.beta ? Number(sp.beta) : DEFAULT_FEED_WEIGHTS.beta;
  const gamma = sp.gamma ? Number(sp.gamma) : DEFAULT_FEED_WEIGHTS.gamma;
  const qs = new URLSearchParams({
    alpha: String(alpha),
    beta: String(beta),
    gamma: String(gamma),
    limit: "20",
  });

  let data: FeedResponse;
  try {
    data = await serverFetchJson<FeedResponse>(`/feed?${qs.toString()}`);
  } catch {
    return (
      <div className="card p-8 text-center">
        <p className="text-[15px] text-[var(--text-2)]">加载失败,请刷新重试</p>
        <p className="text-[12px] text-[var(--text-3)] mt-1">请确认 API 服务已在 :4000 端口启动</p>
      </div>
    );
  }

  if (data.items.length === 0) {
    return <p className="text-center py-16 text-[14px] text-[var(--text-3)]">暂无文章</p>;
  }

  return (
    <>
      <FeedList data={data} />
      <LoadMore initialCursor={data.nextCursor} endpoint={`/feed?${qs.toString()}`} />
    </>
  );
}

export default async function HomePage({ searchParams }: PageProps) {
  return (
    <main className="max-w-[1200px] mx-auto px-5 py-5">
      {/* 子工具条:子分类 + 权重 */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-1 text-[13px]">
          <span className="px-2.5 py-1 rounded-md bg-[var(--brand-soft)] text-[var(--brand)] font-medium">
            综合推荐
          </span>
          <Link
            href="/rank/hot"
            className="px-2.5 py-1 rounded-md text-[var(--text-2)] hover:bg-[var(--surface)] transition-colors"
          >
            最热
          </Link>
          <Link
            href="/rank/best"
            className="px-2.5 py-1 rounded-md text-[var(--text-2)] hover:bg-[var(--surface)] transition-colors"
          >
            高质
          </Link>
        </div>
        <WeightDrawer />
      </div>

      <SafeRewriteHintBanner />

      <Suspense fallback={<FeedSkeleton />}>
        <FeedSection searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
