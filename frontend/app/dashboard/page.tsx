"use client";

import { useTournament } from "@/lib/useTournament";

export default function DashboardPage() {
  const { selectedTournament, loading } = useTournament();

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "60vh" }}>
        {/* Loading state — sans is fine for short UI strings */}
        <span style={{ fontFamily: "var(--font-sans)", fontSize: "14px", color: "var(--color-text-tertiary)" }}>
          Loading…
        </span>
      </div>
    );
  }

  if (!selectedTournament) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "60vh", gap: "10px", textAlign: "center" }}>
        {/* Empty state heading — Instrument Serif */}
        <p style={{ fontFamily: "var(--font-serif)", fontSize: "28px", color: "var(--color-text-primary)" }}>
          No tournament selected
        </p>
        {/* Supporting text — DM Sans */}
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "14px", color: "var(--color-text-secondary)", maxWidth: "320px" }}>
          Use the tournament selector above to choose or create a tournament.
        </p>
      </div>
    );
  }

  const fmt = (d: string) =>
    new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  const dateRange = selectedTournament.start_date
    ? selectedTournament.end_date && selectedTournament.end_date !== selectedTournament.start_date
      ? `${fmt(selectedTournament.start_date)} – ${fmt(selectedTournament.end_date)}`
      : fmt(selectedTournament.start_date)
    : null;

  return (
    <div>
      {/* Page header */}
      <div style={{ marginBottom: "32px" }}>
        {/* Tournament name — h1, gets Instrument Serif from globals */}
        <h1 style={{ fontSize: "34px", marginBottom: "6px" }}>
          {selectedTournament.name}
        </h1>
        <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
          {selectedTournament.location && (
            /* Location is a data value — DM Mono */
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "13px", color: "var(--color-text-secondary)" }}>
              {selectedTournament.location}
            </span>
          )}
          {dateRange && (
            /* Date is a data value — DM Mono */
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "13px", color: "var(--color-text-tertiary)" }}>
              {dateRange}
            </span>
          )}
          {selectedTournament.blocks?.length > 0 && (
            <span style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)" }}>
              {selectedTournament.blocks.length} blocks
            </span>
          )}
        </div>
      </div>

      {/* Stat cards — placeholder until 7f/7g */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "14px" }}>
        {[
          { label: "Events",     value: "—", note: "coming in 7f" },
          { label: "Volunteers", value: "—", note: "coming in 7f" },
          { label: "Assigned",   value: "—", note: "coming in 7g" },
          { label: "Unassigned", value: "—", note: "coming in 7g" },
        ].map(({ label, value, note }) => (
          <div
            key={label}
            style={{
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-lg)",
              padding: "20px",
            }}
          >
            {/* Card label — DM Sans, uppercase, small */}
            <div style={{ fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--color-text-tertiary)", marginBottom: "10px" }}>
              {label}
            </div>
            {/* Big number — Instrument Serif */}
            <div style={{ fontFamily: "var(--font-serif)", fontSize: "38px", color: "var(--color-text-primary)", lineHeight: 1, marginBottom: "8px" }}>
              {value}
            </div>
            {/* Note — DM Sans, muted */}
            <div style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)" }}>
              {note}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}