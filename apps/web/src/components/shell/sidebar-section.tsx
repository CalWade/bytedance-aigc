import * as React from "react";
import { cn } from "@/lib/utils";

interface SidebarSectionProps {
  title?: string;
  children: React.ReactNode;
  className?: string;
}

export function SidebarSection({ title, children, className }: SidebarSectionProps) {
  return (
    <div className={cn("flex flex-col gap-1 px-2", className)}>
      {title ? (
        <div className="px-2 pt-3 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {title}
        </div>
      ) : null}
      {children}
    </div>
  );
}
