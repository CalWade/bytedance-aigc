"use client";

interface Props {
  visible: boolean;
  // 可选回调:点击「查看冲突备份」时打开版本历史(冲突备份是一个 OFFLINE_CONFLICT 版本)。
  onOpenVersionHistory?: () => void;
}

// 冲突短期提示(spec §6,显示 5s 后自动消)。
export function ConflictBanner({ visible, onOpenVersionHistory }: Props) {
  if (!visible) return null;
  return (
    <div
      data-testid="conflict-banner"
      className="rounded border border-blue-400 bg-blue-50 px-3 py-2 mb-4 text-sm text-blue-900 flex items-center justify-between gap-2"
    >
      <span>他端已修改,已为你保留冲突备份。云端版本已恢复到编辑器。</span>
      {onOpenVersionHistory && (
        <button
          type="button"
          onClick={onOpenVersionHistory}
          className="text-blue-700 underline hover:text-blue-900"
        >
          查看冲突备份
        </button>
      )}
    </div>
  );
}
