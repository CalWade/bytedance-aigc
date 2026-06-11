import { Suspense } from "react";
import { Card } from "@bytedance-aigc/ui/components/ui/card";
import { Skeleton } from "@bytedance-aigc/ui/components/ui/skeleton";
import { serverFetchJson } from "@bytedance-aigc/ui/lib/server-fetch";
import { RankTabs } from "@bytedance-aigc/ui/components/feed/RankTabs";
import type { DouyinTrendingResult } from "@bytedance-aigc/ui/components/feed/external-trending-types";
import { DouyinHotList } from "./_components/DouyinHotList";

/**
 * 抖音热榜页:接 NestJS /external/trending/douyin。
 * ISR 5 分钟和后端缓存对齐,不再多打上游。
 */
export const revalidate = 300;

async function DouyinFeed() {
  let data: DouyinTrendingResult;
  try {
    data = await serverFetchJson<DouyinTrendingResult>(`/external/trending/douyin?limit=30`, {
      revalidate: 300,
    });
  } catch {
    return (
      <Card className="p-8 text-center">
        <p className="text-[15px] text-muted-foreground">
          抖音热榜暂时拉取失败,可能触发风控,请稍后重试
        </p>
      </Card>
    );
  }
  return (
    <>
      {data.stale && (
        <div className="mb-3 text-[12px] text-muted-foreground bg-muted/30 px-3 py-2 rounded-md">
          抖音上游暂时不稳定,显示为上次抓取的数据(
          {new Date(data.fetchedAt).toLocaleString()})
        </div>
      )}
      <DouyinHotList data={data} />
      <p className="mt-4 text-[11px] text-muted-foreground/70 text-center">
        数据来自抖音网页端公开接口,仅供创作选题参考。最近抓取于{" "}
        {new Date(data.fetchedAt).toLocaleString()}
      </p>
    </>
  );
}

function DouyinSkeleton() {
  return (
    <ul className="flex flex-col gap-2">
      {Array.from({ length: 8 }).map((_, i) => (
        <li key={i}>
          <Card className="p-4">
            <div className="flex items-start gap-3">
              <Skeleton className="w-7 h-7 rounded-full" />
              <div className="flex-1">
                <Skeleton className="h-4 w-3/4 mb-2" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}

export default async function RankDouyinPage() {
  return (
    <main className="max-w-[1200px] mx-auto px-5 py-5">
      <RankTabs />
      <div className="mb-4">
        <h1 className="text-[20px] font-medium text-foreground">抖音热榜</h1>
        <p className="text-[13px] text-muted-foreground mt-0.5">
          外部热点参考 — 看到感兴趣的话题,点「以此选题创作」一键带题进入 FAST 模式
        </p>
      </div>
      <Suspense fallback={<DouyinSkeleton />}>
        <DouyinFeed />
      </Suspense>
    </main>
  );
}
