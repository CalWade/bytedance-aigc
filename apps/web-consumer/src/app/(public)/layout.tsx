import * as React from "react";
import { SiteMasthead } from "@/components/site-masthead";
import { SiteFooter } from "@/components/site-footer";
import { Toaster } from "@bytedance-aigc/ui/components/ui/sonner";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteMasthead />
      <div className="flex-1">{children}</div>
      <SiteFooter />
      <Toaster richColors closeButton position="bottom-right" />
    </>
  );
}
