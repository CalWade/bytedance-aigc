import { DraftEditor } from "@/components/draft-editor";

export default async function DraftDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DraftEditor id={id} />;
}
