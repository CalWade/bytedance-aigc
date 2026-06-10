import { Suspense } from "react";
import type { FeedResponse } from "@bytedance-aigc/shared";
import { serverFetchJson } from "@/lib/server-fetch";
import { FeedList } from "../../_components/FeedList";
import { FeedSkeleton } from "../../_components/FeedSkeleton";
import { LoadMore } from "../../_components/LoadMore";

export const revalidate = 30;

async function BestFeedWithData() {
  let data: FeedResponse;
  try {
    data = await serverFetchJson<FeedResponse>(`/rank/best?limit=20`);
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
      <LoadMore initialCursor={data.nextCursor} endpoint="/rank/best?limit=20" />
    </>
  );
}

export default async function RankBestPage() {
  return (
    <main className="max-w-[1200px] mx-auto px-5 py-5">
      <div className="mb-4">
        <h1 className="text-[20px] font-medium text-[var(--text)]">爆文榜</h1>
        <p className="text-[13px] text-[var(--text-3)] mt-0.5">
          按四维质量分加权排序,看新鲜热乎请去{" "}
          <a href="/rank/hot" className="text-[var(--brand)] hover:underline">
            热点榜
          </a>
        </p>
      </div>
      <Suspense fallback={<FeedSkeleton />}>
        <BestFeedWithData />
      </Suspense>
    </main>
  );
}
