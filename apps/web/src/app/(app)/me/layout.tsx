import { NotificationBell } from "@/components/notification-bell";

export default function MeLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <div className="border-b border-[var(--border)] bg-[var(--surface)]">
        <div className="max-w-[1200px] mx-auto px-5 py-3 flex items-center justify-between">
          <h2 className="text-[16px] font-medium text-[var(--text)]">我的工作台</h2>
          <NotificationBell />
        </div>
      </div>
      <main className="max-w-[1200px] mx-auto px-5 py-5">{children}</main>
    </div>
  );
}
