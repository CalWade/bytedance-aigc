import { Suspense } from "react";
import Link from "next/link";
import type { FeedResponse } from "@bytedance-aigc/shared";
import { DEFAULT_FEED_WEIGHTS } from "@bytedance-aigc/shared";
import { serverFetchJson } from "@bytedance-aigc/ui/lib/server-fetch";
import { Card, CardContent } from "@bytedance-aigc/ui/components/ui/card";
import { FeedList } from "@bytedance-aigc/ui/components/feed/FeedList";
import { FeedSkeleton } from "@bytedance-aigc/ui/components/feed/FeedSkeleton";
import { LoadMore } from "@bytedance-aigc/ui/components/feed/LoadMore";
import { SafeRewriteHintBanner } from "./_components/SafeRewriteHintBanner";
import { WeightDrawer } from "@bytedance-aigc/ui/components/feed/WeightDrawer";

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
      <Card className="p-8 text-center">
        <p className="text-[15px] text-muted-foreground">加载失败,请刷新重试</p>
        <p className="text-[12px] text-muted-foreground/70 mt-1">
          请确认 API 服务已在 :4000 端口启动
        </p>
      </Card>
    );
  }

  if (data.items.length === 0) {
    return <p className="text-center py-16 text-[14px] text-muted-foreground">暂无文章</p>;
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
          <span className="px-2.5 py-1 rounded-md bg-brand/10 text-brand font-medium">
            综合推荐
          </span>
          <Link
            href="/rank/hot"
            className="px-2.5 py-1 rounded-md text-muted-foreground hover:bg-accent transition-colors"
          >
            最热
          </Link>
          <Link
            href="/rank/best"
            className="px-2.5 py-1 rounded-md text-muted-foreground hover:bg-accent transition-colors"
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
