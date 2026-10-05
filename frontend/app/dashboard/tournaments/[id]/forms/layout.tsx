"use client";

import { ReactNode, useCallback } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import { CollapsibleHeader } from "@/components/ui/CollapsibleHeader";

// Module-level so its identity is stable — CollapsibleHeader re-registers the
// Topbar's copy of the tabs whenever this changes.
const FORMS_TABS = [{ key: "forms", label: "All Forms" }, { key: "onboarding", label: "Onboarding" }];

export default function FormsLayout({ children }: { children: ReactNode }) {
  const params = useParams();
  const pathname = usePathname();
  const router = useRouter();
  const tournamentId = Number(params.id);
  const base = `/dashboard/tournaments/${tournamentId}/forms`;

  // The tabs are routes, so picking one navigates rather than setting state.
  const pickTab = useCallback(
    (tab: string) => router.push(tab === "forms" ? base : `${base}/onboarding`),
    [router, base],
  );

  return (
    <>
      <CollapsibleHeader
        heading="Forms"
        tabs={FORMS_TABS}
        activeKey={pathname === base ? "forms" : "onboarding"}
        onChange={pickTab}
      />
      {children}
    </>
  );
}
