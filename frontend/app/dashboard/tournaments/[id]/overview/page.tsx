"use client";

import { useParams } from "next/navigation";
import { useTournament } from "@/lib/useTournament";
import { parseLocalDate } from "@/lib/date";
import { SetupChecklistWidget } from "@/components/tournament/setup/SetupChecklistWidget";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { IconCalendar, IconLocation } from "@/components/ui/Icons";

export default function OverviewPage() {
  const params = useParams();
  const tournamentId = params.id as string;
  const { selectedTournament } = useTournament();

  const fmt = (d: string) =>
    parseLocalDate(d).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

  const dateRange = selectedTournament?.start_date
    ? selectedTournament.end_date && selectedTournament.end_date !== selectedTournament.start_date
      ? `${fmt(selectedTournament.start_date)} – ${fmt(selectedTournament.end_date)}`
      : fmt(selectedTournament.start_date)
    : null;

  const place = selectedTournament?.location || selectedTournament?.university?.name;

  const heading = selectedTournament
    ? `${parseLocalDate(selectedTournament.start_date).getFullYear()} ${selectedTournament.name}`
    : "—";

  const metadata = selectedTournament && (
    <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
      {place && (
        <span style={{ display: "flex", alignItems: "center", gap: "6px", fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)" }}>
          <IconLocation />
          {place}
        </span>
      )}
      {dateRange && (
        <span style={{ display: "flex", alignItems: "center", gap: "6px", fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)" }}>
          <IconCalendar />
          {dateRange}
        </span>
      )}
      {selectedTournament.state && <Badge>{selectedTournament.state}</Badge>}
      {selectedTournament.level && (
        <Badge>{selectedTournament.level[0].toUpperCase() + selectedTournament.level.slice(1)}</Badge>
      )}
      {selectedTournament.division?.map((d) => <Badge key={d}>{d}</Badge>)}
    </div>
  );

  return (
    <div>
      <PageHeader heading={heading} metadata={metadata} />

      <div style={{ display: "flex", flexWrap: "wrap", gap: "16px" }}>
        <SetupChecklistWidget tournamentId={tournamentId} />
      </div>
    </div>
  );
}
