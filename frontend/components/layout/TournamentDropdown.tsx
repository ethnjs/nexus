"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTournament } from "@/lib/useTournament";
import { useUnsavedChanges } from "@/lib/useUnsavedChanges";
import { Tournament } from "@/lib/api";
import { tournamentDisplayName } from "@/lib/tournamentDisplay";
import { NewTournamentModal } from "@/components/tournament/NewTournamentModal";
import { Dropdown } from "@/components/ui/Dropdown";
import { IconPlus } from "@/components/ui/Icons";

interface TournamentDropdownProps {
  tournamentId?: string | number;
  /** Fill the container instead of the fixed 280px toolbar width. */
  fullWidth?: boolean;
}

/**
 * The tournament switcher. Lives in its own file because it renders in two
 * places: the Topbar on desktop, and inside the nav drawer on mobile, where
 * the Topbar has no room for it beside the drawer toggle and the avatar.
 *
 * Both copies mount — CSS decides which is visible, so neither depends on a
 * viewport check that would only resolve after the first paint. useTournament()
 * is a context read, so the second copy costs a render, not a second fetch.
 *
 * Callers must sit inside a TournamentProvider and an UnsavedChangesProvider.
 */
export function TournamentDropdown({ tournamentId, fullWidth = false }: TournamentDropdownProps) {
  const router = useRouter();
  const { tournaments, refresh } = useTournament();
  const { guard } = useUnsavedChanges();
  const [showNewModal, setShowNewModal] = useState(false);

  // No optimistic setSelectedTournament here — the [id]/layout.tsx shell
  // refetches the full tournament keyed off the URL id on every navigation,
  // which is the sole writer of selectedTournament (see useTournament.tsx).
  async function handleCreated(t: Tournament) {
    await refresh();
    setShowNewModal(false);
    router.push(`/dashboard/tournaments/${t.id}/overview`);
  }

  function handleChange(value: string) {
    const t = tournaments.find((c) => String(c.id) === value);
    if (!t) return;
    // Always overview, never the section you were on. The old path can't be
    // carried across: deeper routes hold entity ids belonging to the previous
    // tournament, and permissions differ per tournament, so a TD-only page
    // like settings/general is a dead end where you're a plain member.
    guard(() => {
      router.push(`/dashboard/tournaments/${t.id}/overview`);
    });
  }

  return (
    <>
      <Dropdown
        value={String(tournamentId ?? "")}
        onChange={handleChange}
        options={tournaments.map((t) => ({
          value: String(t.id),
          label: tournamentDisplayName(t),
        }))}
        placeholder="Select tournament…"
        {...(fullWidth ? { fullWidth: true } : { width: 280 })}
        searchable={tournaments.length > 8}
        emptyMessage="No tournaments yet"
        footerLabel="New tournament"
        footerIcon={<IconPlus />}
        onFooterClick={() => setShowNewModal(true)}
      />

      {showNewModal && (
        <NewTournamentModal onClose={() => setShowNewModal(false)} onCreated={handleCreated} />
      )}
    </>
  );
}
