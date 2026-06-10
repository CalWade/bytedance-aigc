import { redirect } from "next/navigation";
import type { ReportDto } from "@bytedance-aigc/shared";
import { serverFetchJson } from "@/lib/server-fetch";
import { MeReportsList } from "./_components/MeReportsList";

export const dynamic = "force-dynamic";

interface MeReportsResponse {
  items: ReportDto[];
  nextCursor: string | null;
}

export default async function MeReportsPage() {
  let data: MeReportsResponse;
  try {
    data = await serverFetchJson<MeReportsResponse>("/me/reports?limit=20");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes(" 401")) {
      redirect("/login");
    }
    throw err;
  }
  return (
    <main className="max-w-3xl mx-auto px-6 py-8">
      <h1 className="text-2xl font-semibold mb-4">我收到的举报</h1>
      <MeReportsList initialItems={data.items} initialCursor={data.nextCursor} />
    </main>
  );
}
