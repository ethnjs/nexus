import { IconCalendar, IconLocation } from "@/components/ui/Icons";
import type { TournamentTrack } from "@/lib/api";
import { formatTrackDates, placeOfTrack } from "@/lib/tournamentDisplay";

/** The day's name, dates and venue, beside a page's buttons. */
export function TrackSummary({ track }: { track: TournamentTrack }) {
  const dates = formatTrackDates(track, "weekday");
  const place = placeOfTrack(track);
  const fact = {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    fontFamily: "var(--font-sans)",
    fontSize: "13px",
    color: "var(--color-text-secondary)",
  } as const;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: "6px 16px",
        minWidth: 0,
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: "14px",
          fontWeight: 600,
          color: "var(--color-text-primary)",
        }}
      >
        {track.name}
      </span>
      {dates && (
        <span style={fact}>
          <IconCalendar /> {dates}
        </span>
      )}
      {place && (
        <span style={fact}>
          <IconLocation /> {place}
        </span>
      )}
    </div>
  );
}
