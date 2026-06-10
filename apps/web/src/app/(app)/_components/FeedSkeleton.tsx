/**
 * 信息流骨架屏 — 与新 PostCard 对齐
 */
export function FeedSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: 9 }).map((_, i) => (
        <div key={i} className="card overflow-hidden animate-pulse">
          <div className="aspect-[16/10] bg-[var(--bg)]" />
          <div className="p-4 space-y-2.5">
            <div className="h-4 w-4/5 bg-[var(--bg)] rounded" />
            <div className="h-4 w-3/5 bg-[var(--bg)] rounded" />
            <div className="h-3 w-full bg-[var(--bg)] rounded mt-3" />
            <div className="h-3 w-2/3 bg-[var(--bg)] rounded" />
            <div className="h-3 w-1/2 bg-[var(--bg)] rounded mt-2" />
          </div>
        </div>
      ))}
    </div>
  );
}
