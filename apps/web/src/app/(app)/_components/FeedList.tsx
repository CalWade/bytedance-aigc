import type { FeedResponse } from "@bytedance-aigc/shared";
import { PostCard } from "./PostCard";

const PRIORITY_COUNT = 3;

export function FeedList({ data }: { data: FeedResponse }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {data.items.map((p, i) => (
        <PostCard key={p.id} post={p} index={i + 1} priority={i < PRIORITY_COUNT} />
      ))}
    </div>
  );
}
