"use client";

import { useEffect, useRef, useState } from "react";
import type { FeedResponse, PostDto } from "@bytedance-aigc/shared";
import { PostCard } from "./PostCard";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export function LoadMore({
  initialCursor,
  endpoint,
}: {
  initialCursor: string | null;
  endpoint: string;
}) {
  const [items, setItems] = useState<PostDto[]>([]);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (done || !cursor) return;
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting || loading) return;
        setLoading(true);
        const sep = endpoint.includes("?") ? "&" : "?";
        fetch(`${API_BASE}${endpoint}${sep}cursor=${encodeURIComponent(cursor)}`)
          .then(async (res) => {
            if (!res.ok) {
              setErr(`加载失败 (HTTP ${res.status})`);
              setDone(true);
              return;
            }
            const data = (await res.json()) as FeedResponse;
            setItems((prev) => [...prev, ...data.items]);
            setCursor(data.nextCursor);
            if (!data.nextCursor) setDone(true);
          })
          .catch((e: unknown) => {
            setErr(e instanceof Error ? e.message : "网络错误");
            setDone(true);
          })
          .finally(() => setLoading(false));
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [cursor, loading, done, endpoint]);

  return (
    <>
      {items.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
          {items.map((p) => (
            <PostCard key={p.id} post={p} />
          ))}
        </div>
      )}
      {err && <p className="text-sm text-red-600 mt-4">{err}</p>}
      {!done && (
        <div
          ref={sentinel}
          className="h-8 flex items-center justify-center text-xs text-gray-400 mt-4"
        >
          {loading ? "加载中…" : "下拉加载更多"}
        </div>
      )}
      {done && items.length > 0 && (
        <p className="text-center text-xs text-gray-400 mt-4">没有更多了</p>
      )}
    </>
  );
}
