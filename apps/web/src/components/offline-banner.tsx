"use client";

interface Props {
  visible: boolean;
}

// 离线时常驻提示;由调用方根据 navigator.onLine / autosave status 控制 visible。
export function OfflineBanner({ visible }: Props) {
  if (!visible) return null;
  return (
    <div
      data-testid="offline-banner"
      className="rounded border border-amber-400 bg-amber-50 px-3 py-2 mb-4 text-sm text-amber-900"
    >
      当前离线,内容已保存在本设备。网络恢复后将自动同步。
    </div>
  );
}
