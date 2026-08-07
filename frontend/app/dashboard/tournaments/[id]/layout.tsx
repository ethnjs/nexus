"use client";

import { ReactNode, useState, useEffect } from "react";
import { use } from "react";
import { usePathname } from "next/navigation";
import { TournamentProvider, useTournament } from "@/lib/useTournament";
import { MyMembershipProvider } from "@/lib/useMyMembership";
import { Sidebar, COLLAPSED_W, EXPANDED_W } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { tournamentsApi } from "@/lib/api";

function TournamentShell({
  tournamentId,
  children,
}: {
  tournamentId: string;
  children: ReactNode;
}) {
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const { setSelectedTournament } = useTournament();
  const pathname = usePathname();
  // Sidebar is locked open (not just hover-expanded) on settings routes —
  // reserve its full width there instead of letting it overlay content.
  const onSettingsRoute = pathname.startsWith(`/dashboard/tournaments/${tournamentId}/settings`);

  useEffect(() => {
    tournamentsApi.get(Number(tournamentId)).then(setSelectedTournament).catch(console.error);
  }, [tournamentId, setSelectedTournament]);

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden", background: "var(--color-bg)" }}>
      <Sidebar
        onExpandedChange={setSidebarExpanded}
        tournamentId={tournamentId}
      />
      <div style={{
        flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden",
        marginLeft: onSettingsRoute ? EXPANDED_W : COLLAPSED_W,
        transition: "margin-left 0.2s ease",
      }}>
        <Topbar showDropdown tournamentId={tournamentId} showAvatar sidebarExpanded={sidebarExpanded && !onSettingsRoute} />
        <main style={{ flex: 1, overflowY: "auto", padding: "22px 24px" }}>
          {children}
        </main>
      </div>
    </div>
  );
}

export default function TournamentLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id: tournamentId } = use(params);

  return (
    <TournamentProvider>
      <MyMembershipProvider tournamentId={tournamentId}>
        <TournamentShell tournamentId={tournamentId}>
          {children}
        </TournamentShell>
      </MyMembershipProvider>
    </TournamentProvider>
  );
}