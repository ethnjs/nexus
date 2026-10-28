"use client";

import type { ReactNode } from "react";
import { CollapsibleHeader } from "@/components/ui/CollapsibleHeader";

export default function FormsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <CollapsibleHeader heading="Forms" />
      {children}
    </>
  );
}
