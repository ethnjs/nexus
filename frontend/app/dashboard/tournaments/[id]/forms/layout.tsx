"use client";

import { ReactNode } from "react";
import { useParams, usePathname } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { FormsTabs } from "@/components/tournament/forms/FormsTabs";

export default function FormsLayout({ children }: { children: ReactNode }) {
  const params = useParams();
  const pathname = usePathname();
  const tournamentId = Number(params.id);
  const base = `/dashboard/tournaments/${tournamentId}/forms`;

  return (
    <>
      <PageHeader heading="Forms" />
      <FormsTabs tournamentId={tournamentId} active={pathname === base ? "forms" : "onboarding"} />
      {children}
    </>
  );
}
