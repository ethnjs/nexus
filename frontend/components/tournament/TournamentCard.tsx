import { Tournament } from "@/lib/api";
import { parseLocalDate } from "@/lib/date";
import { Card } from "@/components/ui/Card";
import { IconCalendar, IconLocation } from "@/components/ui/Icons";

export interface CardCounts { events: number | null; volunteers: number | null }

export function TournamentCard({ tournament, counts, onClick }: { tournament: Tournament; counts: CardCounts; onClick: () => void }) {
  const fmt = (d: string) =>
    parseLocalDate(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  const dateRange = tournament.start_date
    ? tournament.end_date && tournament.end_date !== tournament.start_date
      ? `${fmt(tournament.start_date)} – ${fmt(tournament.end_date)}`
      : fmt(tournament.start_date)
    : null;

  const year = parseLocalDate(tournament.start_date).getFullYear();
  const displayName = `${year} ${tournament.short_name || tournament.name}`;

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
        {tournament.location && (
          <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "var(--color-text-secondary)" }}>
            <IconLocation />
            <span style={{ fontFamily: "var(--font-sans)", fontSize: "13px" }}>{tournament.location}</span>
          </div>
        )}
        {dateRange && (
          <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "var(--color-text-tertiary)" }}>
            <IconCalendar />
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px" }}>{dateRange}</span>
          </div>
        )}
      </div>
      <div style={{ paddingTop: "14px", borderTop: "1px solid var(--color-border)", display: "flex", gap: "20px" }}>
        <div>
          <div style={{ fontFamily: "Georgia, serif", fontSize: "22px", color: "var(--color-text-primary)", lineHeight: 1 }}>
            {counts.events === null ? "—" : counts.events}
          </div>
          <div style={{ fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 500, color: "var(--color-text-tertiary)", marginTop: "3px", textTransform: "uppercase", letterSpacing: "0.06em" }}>Events</div>
        </div>
        <div style={{ width: "1px", background: "var(--color-border)" }} />
        <div>
          <div style={{ fontFamily: "Georgia, serif", fontSize: "22px", color: "var(--color-text-primary)", lineHeight: 1 }}>
            {counts.volunteers === null ? "—" : counts.volunteers}
          </div>
          <div style={{ fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 500, color: "var(--color-text-tertiary)", marginTop: "3px", textTransform: "uppercase", letterSpacing: "0.06em" }}>Volunteers</div>
        </div>
      </div>
    </Card>
  );
}
