"use client";

import { useParams } from "next/navigation";
import { useTournament } from "@/lib/useTournament";
import { SetupChecklistWidget } from "@/components/tournament/setup/SetupChecklistWidget";
import { PageHeader } from "@/components/ui/PageHeader";

export default function OverviewPage() {
  const params = useParams();
  const tournamentId = params.id as string;
  const { selectedTournament } = useTournament();

  const fmt = (d: string) =>
    new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  const dateRange = selectedTournament?.start_date
    ? selectedTournament.end_date && selectedTournament.end_date !== selectedTournament.start_date
      ? `${fmt(selectedTournament.start_date)} – ${fmt(selectedTournament.end_date)}`
      : fmt(selectedTournament.start_date)
    : null;

  const metadata = (selectedTournament?.location || dateRange) && (
    <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
      {selectedTournament?.location && (
        <span style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)" }}>
          {selectedTournament.location}
        </span>
      )}
      {dateRange && (
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--color-text-tertiary)" }}>
          {dateRange}
        </span>
      )}
    </div>
  );

  return (
    <div>
      <PageHeader heading={selectedTournament?.name ?? "—"} metadata={metadata} />

      <div style={{ display: "flex", flexWrap: "wrap", gap: "16px" }}>
        <SetupChecklistWidget tournamentId={tournamentId} />
      </div>
    </div>
  );
}
