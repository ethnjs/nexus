"use client";

import { useRouter } from "next/navigation";
import { TabStrip } from "@/components/ui/TabStrip";

type FormsTab = "forms" | "onboarding";

export function FormsTabs({ tournamentId, active }: { tournamentId: number; active: FormsTab }) {
  const router = useRouter();
  const base = `/dashboard/tournaments/${tournamentId}/forms`;

  return (
    <TabStrip
      activeKey={active}
      tabs={[{ key: "forms", label: "All Forms" }, { key: "onboarding", label: "Onboarding" }]}
      onChange={(tab) => router.push(tab === "forms" ? base : `${base}/onboarding`)}
    />
  );
}
