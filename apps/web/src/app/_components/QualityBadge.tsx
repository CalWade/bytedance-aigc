// PRD §:570 — 仅 80+ 显示「优质」徽章
const PREMIUM_THRESHOLD = 80;

export function QualityBadge({ score, size = "md" }: { score: number; size?: "sm" | "md" }) {
  if (score < PREMIUM_THRESHOLD) return null;
  const sizeCls = size === "sm" ? "text-[10px] px-1.5 py-0.5" : "text-xs px-2 py-0.5";
  return (
    <span
      className={`inline-flex items-center rounded bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 font-medium ${sizeCls}`}
    >
      优质
    </span>
  );
}
