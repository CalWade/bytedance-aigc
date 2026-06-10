import { Suspense } from "react";
import type { FeedResponse } from "@bytedance-aigc/shared";
import { serverFetchJson } from "@/lib/server-fetch";
import { FeedList } from "../../_components/FeedList";
import { FeedSkeleton } from "../../_components/FeedSkeleton";
import { LoadMore } from "../../_components/LoadMore";

export const revalidate = 30;

async function HotFeedWithData() {
  let data: FeedResponse;
  try {
    data = await serverFetchJson<FeedResponse>(`/rank/hot?limit=20`);
  } catch {
    return (
      <div className="card p-8 text-center">
        <p className="text-[15px] text-[var(--text-2)]">榜单加载失败,请刷新重试</p>
      </div>
    );
  }
  return (
    <>
      <FeedList data={data} />
      <LoadMore initialCursor={data.nextCursor} endpoint="/rank/hot?limit=20" />
    </>
  );
}

export default async function RankHotPage() {
  return (
    <main className="max-w-[1200px] mx-auto px-5 py-5">
      <div className="mb-4">
        <h1 className="text-[20px] font-medium text-[var(--text)]">热点榜</h1>
        <p className="text-[13px] text-[var(--text-3)] mt-0.5">
          按近 24 小时阅读热度排序,慢热长稿请看{" "}
          <a href="/rank/best" className="text-[var(--brand)] hover:underline">
            爆文榜
          </a>
        </p>
      </div>
      <Suspense fallback={<FeedSkeleton />}>
        <HotFeedWithData />
      </Suspense>
    </main>
  );
}
