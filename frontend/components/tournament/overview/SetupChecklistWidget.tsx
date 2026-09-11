"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useMyMembership } from "@/lib/useMyMembership";
import { setupChecklistApi, SetupChecklistResponse } from "@/lib/api";
import { OverviewCard } from "@/components/tournament/overview/OverviewCard";
import { StaffInviteModal } from "@/components/tournament/settings/StaffInviteModal";
import { ChecklistProgressRing } from "./ChecklistProgressRing";
import { ChecklistCard } from "./ChecklistCard";

interface ChecklistConfigEntry {
  buildable: boolean;
  onClick: ((router: ReturnType<typeof useRouter>, tournamentId: string) => void) | null;
}

const CHECKLIST_CONFIG: Record<string, ChecklistConfigEntry> = {
  roles:        { buildable: true, onClick: (r, id) => r.push(`/dashboard/tournaments/${id}/settings/roles`) },
  // invite_staff opens a modal rather than navigating — handled as a special
  // case below, not through onClick, but still marked buildable so the card
  // isn't dimmed/"Coming soon".
  invite_staff: { buildable: true, onClick: null },
  events:       { buildable: true, onClick: (r, id) => r.push(`/dashboard/tournaments/${id}/events`) },
  shifts:       { buildable: true, onClick: (r, id) => r.push(`/dashboard/tournaments/${id}/shifts`) },
  first_form:   { buildable: true, onClick: (r, id) => r.push(`/dashboard/tournaments/${id}/forms`) },
  onboarding:   { buildable: true, onClick: (r, id) => r.push(`/dashboard/tournaments/${id}/forms/onboarding`) },
};

export function SetupChecklistWidget({ tournamentId }: { tournamentId: string }) {
  const router = useRouter();
  const { membership, hasPermission } = useMyMembership();
  const [checklist, setChecklist] = useState<SetupChecklistResponse | null>(null);
  const [showStaffInvite, setShowStaffInvite] = useState(false);

  const canSee = !!membership && (membership.is_owner || hasPermission("manage_tournament"));

  function refetchChecklist() {
    setupChecklistApi.get(Number(tournamentId)).then(setChecklist).catch(() => {});
  }

  useEffect(() => {
    if (!canSee) return;
    refetchChecklist();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSee, tournamentId]);

  if (!canSee || !checklist) return null;

  return (
    // data-min-width: the item grid plus the ring — the overview's grid
    // spans as many columns as that takes.
    <OverviewCard title="Setup progress" data-min-width={640}>
      <div style={{ display: "flex", gap: "20px", alignItems: "stretch" }}>
        <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
          {checklist.items.map((item) => {
            const config = CHECKLIST_CONFIG[item.item_key];
            const onClick = item.item_key === "invite_staff"
              ? () => setShowStaffInvite(true)
              : config?.buildable && config.onClick
                ? () => config.onClick!(router, tournamentId)
                : null;
            return <ChecklistCard key={item.item_key} item={item} onClick={onClick} />;
          })}
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
          <ChecklistProgressRing completed={checklist.completed_count} total={checklist.total_count} size={180} />
        </div>
      </div>

      {showStaffInvite && (
        <StaffInviteModal
          tournamentId={Number(tournamentId)}
          onClose={() => setShowStaffInvite(false)}
          onSent={refetchChecklist}
        />
      )}
    </OverviewCard>
  );
}
