"use client";

import { ReactNode, useState, useEffect } from "react";
import { use } from "react";
import { TournamentProvider, useTournament } from "@/lib/useTournament";
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
  const sidebarWidth = sidebarExpanded ? EXPANDED_W : COLLAPSED_W;
  const { setSelectedTournament } = useTournament();

  useEffect(() => {
    tournamentsApi.get(Number(tournamentId)).then(setSelectedTournament).catch(console.error);
  }, [tournamentId, setSelectedTournament]);

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden", background: "var(--color-bg)" }}>
      {/* Sidebar — in normal flow, not fixed. Expanding it naturally pushes content right. */}
      <Sidebar
        expanded={sidebarExpanded}
        onToggle={() => setSidebarExpanded((v) => !v)}
        tournamentId={tournamentId}
      />

      {/* Right column — topbar + content stacked */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
        <Topbar tournamentId={tournamentId} />
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
  params: Promise<{ tournamentId: string }>;
}) {
  const { tournamentId } = use(params);

  return (
    <TournamentProvider>
      <TournamentShell tournamentId={tournamentId}>
        {children}
      </TournamentShell>
    </TournamentProvider>
  );
}