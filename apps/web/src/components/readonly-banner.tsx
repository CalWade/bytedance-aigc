"use client";

interface Props {
  visible: boolean;
}

// 多 Tab 抢占下的只读提示;真正接 useDraftPresence 数据源在 T8。
export function ReadonlyBanner({ visible }: Props) {
  if (!visible) return null;
  return (
    <div
      data-testid="readonly-banner"
      className="rounded border border-red-400 bg-red-50 px-3 py-2 mb-4 text-sm text-red-900"
    >
      该文章已在其他标签打开,均已切到只读模式。关闭其他标签后刷新本页继续编辑。
    </div>
  );
}
