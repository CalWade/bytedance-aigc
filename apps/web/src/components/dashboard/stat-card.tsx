import * as React from "react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";

interface StatCardProps {
  label: string;
  value: number | string;
  suffix?: string;
  hint?: string;
  tone?: "default" | "warn";
  className?: string;
}

export function StatCard({ label, value, suffix, hint, tone, className }: StatCardProps) {
  return (
    <Card className={cn("px-4 py-3 gap-1 shadow-sm hover:shadow-md transition-shadow", className)}>
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "text-3xl font-semibold tabular-nums leading-none mt-1",
          tone === "warn" ? "text-amber-600 dark:text-amber-400" : "text-foreground",
        )}
      >
        {value}
        {suffix ? (
          <span className="text-sm font-normal text-muted-foreground ml-1">{suffix}</span>
        ) : null}
      </div>
      {hint ? <div className="text-[11px] text-muted-foreground/70">{hint}</div> : null}
    </Card>
  );
}
