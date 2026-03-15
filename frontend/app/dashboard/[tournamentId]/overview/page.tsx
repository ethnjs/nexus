"use client";

import { useTournament } from "@/lib/useTournament";

export default function OverviewPage() {
  const { selectedTournament } = useTournament();

  const fmt = (d: string) =>
    new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  const dateRange = selectedTournament?.start_date
    ? selectedTournament.end_date && selectedTournament.end_date !== selectedTournament.start_date
      ? `${fmt(selectedTournament.start_date)} – ${fmt(selectedTournament.end_date)}`
      : fmt(selectedTournament.start_date)
    : null;

  return (
    <div>
      <h1 style={{ fontSize: "28px", lineHeight: 1.2, marginBottom: "4px" }}>
        {selectedTournament?.name ?? "—"}
      </h1>
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
    </div>
  );
}