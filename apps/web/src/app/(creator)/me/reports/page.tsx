"use client";

import { useEffect, useState } from "react";
import type { ReportDto } from "@bytedance-aigc/shared";
import { apiFetch, clearToken, getToken } from "@bytedance-aigc/ui/lib/auth";
import { MeReportsList } from "./_components/MeReportsList";

interface MeReportsResponse {
  items: ReportDto[];
  nextCursor: string | null;
}

export default function MeReportsPage() {
  const [data, setData] = useState<MeReportsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) {
      window.location.replace("/login");
      return;
    }
    let cancelled = false;
    void apiFetch("/me/reports?limit=20")
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 401) {
          clearToken();
          window.location.replace("/login");
          return;
        }
        if (!res.ok) {
          setError(`加载失败 (HTTP ${res.status})`);
          return;
        }
        const json = (await res.json()) as MeReportsResponse;
        if (cancelled) return;
        setData(json);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "网络错误");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="max-w-[1200px] mx-auto px-5 py-5">
      <h1 className="text-[20px] font-medium text-foreground mb-4">我收到的举报</h1>
      {error && <p className="text-[14px] text-destructive">{error}</p>}
      {!data && !error && <p className="text-[14px] text-muted-foreground">加载中…</p>}
      {data && <MeReportsList initialItems={data.items} initialCursor={data.nextCursor} />}
    </div>
  );
}
