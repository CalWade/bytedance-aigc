import * as React from "react";
import { SiteMasthead } from "@/components/site-masthead";
import { SiteFooter } from "@/components/site-footer";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteMasthead />
      <div className="flex-1">{children}</div>
      <SiteFooter />
    </>
  );
}
