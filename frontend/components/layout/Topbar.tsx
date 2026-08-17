"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTournament } from "@/lib/useTournament";
import { useUnsavedChanges } from "@/lib/useUnsavedChanges";
import { Tournament, TournamentPublic } from "@/lib/api";
import { parseLocalDate } from "@/lib/date";
import { NewTournamentModal } from "@/components/tournament/NewTournamentModal";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { Dropdown } from "@/components/ui/Dropdown";
import { IconPlus } from "@/components/ui/Icons";
import { COLLAPSED_W, EXPANDED_W } from "@/components/layout/Sidebar";

// Shared with DockedPanel so its own header strip lines up exactly with
// Topbar's bottom border, reading as one continuous bar across both.
export const TOPBAR_HEIGHT = 52;

interface TopbarProps {
  showWordmark?: boolean;
  showDropdown?: boolean;
  showAvatar?: boolean;
  tournamentId?: string | number;
  sidebarExpanded?: boolean;
  // Extra left padding to clear a fixed-position control (e.g. a mobile
  // drawer toggle) rendered outside the Topbar but overlapping its top-left.
  extraLeftPad?: number;
}

// ─── Tournament Dropdown ──────────────────────────────────────────────────────
// Isolated into its own component so useTournament() is only called when
// showDropdown=true and a TournamentProvider is present in the tree.

function tournamentDisplayName(t: TournamentPublic) {
  const year = parseLocalDate(t.start_date).getFullYear();
  return `${year} ${t.short_name || t.name}`;
}

function TournamentDropdown({ tournamentId }: { tournamentId?: string | number }) {
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
    const segment = window.location.pathname.split("/").pop() ?? "overview";
    guard(() => {
      router.push(`/dashboard/tournaments/${t.id}/${segment}`);
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
          subtitle: t.location || t.university?.name,
        }))}
        placeholder="Select tournament…"
        width={280}
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

// ─── Topbar ───────────────────────────────────────────────────────────────────

export function Topbar({
  showWordmark = false,
  showDropdown = false,
  showAvatar = true,
  tournamentId,
  sidebarExpanded = false,
  extraLeftPad = 0,
}: TopbarProps) {
  const leftPad = (sidebarExpanded ? EXPANDED_W - COLLAPSED_W : 0) + 16 + extraLeftPad;

  return (
    <header style={{
      height: `${TOPBAR_HEIGHT}px`,
      background: "var(--color-surface)",
      borderBottom: "1px solid var(--color-border)",
      display: "flex", alignItems: "center",
      paddingLeft: leftPad, paddingRight: "20px",
      transition: "padding-left 0.2s ease",
      gap: "12px",
      position: "sticky",
      top: 0,
      zIndex: 40,
      flexShrink: 0,
    }}>
      {showWordmark && (
        <a
          href="/dashboard"
          style={{
            fontFamily: "Georgia, serif", fontSize: "15px",
            letterSpacing: "0.18em", textTransform: "uppercase",
            color: "var(--color-text-primary)", userSelect: "none",
            paddingLeft: "8px", textDecoration: "none",
          }}
        >
          NEXUS
        </a>
      )}

      {showDropdown && <TournamentDropdown tournamentId={tournamentId} />}

      <div style={{ flex: 1 }} />

      {showAvatar && <UserAvatar />}
    </header>
  );
}