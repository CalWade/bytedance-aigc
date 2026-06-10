import { DraftEditor } from "@/components/draft-editor";

export default async function DraftDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tool?: string }>;
}) {
  const { id } = await params;
  const { tool } = await searchParams;
  return <DraftEditor id={id} initialTool={tool} />;
}
