import type { FeedResponse } from "@bytedance-aigc/shared";
import { DEFAULT_FEED_WEIGHTS } from "@bytedance-aigc/shared";
import { serverFetchJson } from "@/lib/server-fetch";
import { FeedList } from "./_components/FeedList";
import { LoadMore } from "./_components/LoadMore";
import { RankTabs } from "./_components/RankTabs";
import { SafeRewriteHintBanner } from "./_components/SafeRewriteHintBanner";
import { WeightDrawer } from "./_components/WeightDrawer";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    alpha?: string;
    beta?: string;
    gamma?: string;
  }>;
}

export default async function HomePage({ searchParams }: PageProps) {
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
  const data = await serverFetchJson<FeedResponse>(`/feed?${qs.toString()}`);
  return (
    <main className="max-w-6xl mx-auto px-4 py-6">
      <SafeRewriteHintBanner />
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-semibold">推荐</h1>
        <WeightDrawer />
      </div>
      <RankTabs />
      <FeedList data={data} />
      <LoadMore initialCursor={data.nextCursor} endpoint={`/feed?${qs.toString()}`} />
    </main>
  );
}
