"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import styles from "@/components/tournament/overview/Overview.module.css";
import { OverviewCard } from "@/components/tournament/overview/OverviewCard";
import { type SetupChecklistResponse, setupChecklistApi } from "@/lib/api";
import { useMyMembership } from "@/lib/useMyMembership";
import { ChecklistCard } from "./ChecklistCard";
import { ChecklistProgressRing } from "./ChecklistProgressRing";

interface ChecklistConfigEntry {
  buildable: boolean;
  onClick: ((router: ReturnType<typeof useRouter>, tournamentId: string) => void) | null;
}

const CHECKLIST_CONFIG: Record<string, ChecklistConfigEntry> = {
  roles: {
    buildable: true,
    onClick: (r, id) => r.push(`/dashboard/tournaments/${id}/settings/roles`),
  },
  invite: {
    buildable: true,
    onClick: (r, id) => r.push(`/dashboard/tournaments/${id}/settings/invites`),
  },
  events: { buildable: true, onClick: (r, id) => r.push(`/dashboard/tournaments/${id}/events`) },
  shifts: { buildable: true, onClick: (r, id) => r.push(`/dashboard/tournaments/${id}/shifts`) },
  first_form: { buildable: true, onClick: (r, id) => r.push(`/dashboard/tournaments/${id}/forms`) },
  onboarding: {
    buildable: true,
    onClick: (r, id) => r.push(`/dashboard/tournaments/${id}/forms?flow=onboarding`),
  },
};

export function SetupChecklistWidget({ tournamentId }: { tournamentId: string }) {
  const router = useRouter();
  const { membership, hasPermission } = useMyMembership();
  const [checklist, setChecklist] = useState<SetupChecklistResponse | null>(null);

  const canSee = !!membership && (membership.is_owner || hasPermission("manage_tournament"));

  useEffect(() => {
    if (!canSee) return;
    setupChecklistApi
      .get(Number(tournamentId))
      .then(setChecklist)
      .catch(() => {});
  }, [canSee, tournamentId]);

  if (!canSee || !checklist) return null;

  return (
    // data-min-width: the item grid plus the ring — the overview's grid
    // spans as many columns as that takes.
    <OverviewCard title="Setup progress" data-min-width={640}>
      <div className={styles.checklistBody}>
        <div className={styles.checklistItems}>
          {checklist.items.map((item) => {
            const config = CHECKLIST_CONFIG[item.item_key];
            const onClick =
              config?.buildable && config.onClick
                ? () => config.onClick!(router, tournamentId)
                : null;
            return <ChecklistCard key={item.item_key} item={item} onClick={onClick} />;
          })}
        </div>
        <div className={styles.checklistRing}>
          <ChecklistProgressRing
            completed={checklist.completed_count}
            total={checklist.total_count}
            size={180}
          />
        </div>
      </div>
    </OverviewCard>
  );
}
