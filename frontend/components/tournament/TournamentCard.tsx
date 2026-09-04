import { TournamentSummary } from "@/lib/api";
import { tournamentDisplayName, tournamentFactRows } from "@/lib/tournamentDisplay";
import { Card } from "@/components/ui/Card";
import { IconCalendar, IconLocation } from "@/components/ui/Icons";

export function TournamentCard({ tournament, onClick }: { tournament: TournamentSummary; onClick: () => void }) {
  // One row for a single-site tournament, one per primary track for a
  // regional running two venues — see tournamentFactRows.
  const rows = tournamentFactRows(tournament);
  const displayName = tournamentDisplayName(tournament);

  return (
    <Card
      hoverable
      radius="lg"
      onClick={onClick}
      style={{ padding: "22px 24px", cursor: "pointer", display: "flex", flexDirection: "column", gap: "14px" }}
    >
      <h3 style={{ fontFamily: "Georgia, serif", fontSize: "19px", fontWeight: 400, color: "var(--color-text-primary)", lineHeight: 1.25 }}>
        {displayName}
      </h3>
      <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
        {rows.map((row) => (
          <div key={row.key} style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
            {row.name && (
              <span style={{ fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 600, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                {row.name}
              </span>
            )}
            {row.place && (
              <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "var(--color-text-secondary)" }}>
                <IconLocation />
                <span style={{ fontFamily: "var(--font-sans)", fontSize: "13px" }}>{row.place}</span>
              </div>
            )}
            {row.dates && (
              <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "var(--color-text-secondary)" }}>
                <IconCalendar />
                <span style={{ fontFamily: "var(--font-sans)", fontSize: "13px" }}>{row.dates}</span>
              </div>
            )}
          </div>
        ))}
      </div>
      <div style={{ paddingTop: "14px", borderTop: "1px solid var(--color-border)", display: "flex", gap: "20px" }}>
        <div>
          <div style={{ fontFamily: "Georgia, serif", fontSize: "22px", color: "var(--color-text-primary)", lineHeight: 1 }}>
            {tournament.event_count}
          </div>
          <div style={{ fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 500, color: "var(--color-text-tertiary)", marginTop: "3px", textTransform: "uppercase", letterSpacing: "0.06em" }}>Events</div>
        </div>
        <div style={{ width: "1px", background: "var(--color-border)" }} />
        <div>
          <div style={{ fontFamily: "Georgia, serif", fontSize: "22px", color: "var(--color-text-primary)", lineHeight: 1 }}>
            {tournament.volunteer_count}
          </div>
          <div style={{ fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 500, color: "var(--color-text-tertiary)", marginTop: "3px", textTransform: "uppercase", letterSpacing: "0.06em" }}>Volunteers</div>
        </div>
      </div>
    </Card>
  );
}
