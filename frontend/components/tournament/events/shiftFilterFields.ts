import type { TournamentEvent, TournamentShift, TournamentTrack } from "@/lib/api";
import { eventNameWithDivision } from "@/lib/eventDisplay";
import type { FilterField } from "@/lib/filters/model";
import { formatDayLabel, toDateInput, toTimeInput } from "@/lib/timeFormat";

/** A shift's end as "HH:mm", past "24:00" when it ends on a later day than
 *  `start`, so it still compares as after the start. */
function endTimeAfter(start: string, end: string): string {
  const time = toTimeInput(end);
  if (time >= start) return time;
  const [hours, minutes] = time.split(":");
  return `${Number(hours) + 24}:${minutes}`;
}

/** The shifts table's filter fields, matched in the browser. Track and Day
 *  are left out when every shift shares one. */
export function shiftFilterFields(
  shifts: TournamentShift[],
  tracks: TournamentTrack[],
  events: TournamentEvent[],
): FilterField<TournamentShift>[] {
  const liveTracks = tracks.filter((t) => !t.is_archived);
  const days = [...new Set(shifts.map((s) => toDateInput(s.start)))].sort();
  const eventsByShift = new Map<number, string[]>();
  for (const e of events) {
    for (const s of e.shifts) {
      const ids = eventsByShift.get(s.id) ?? [];
      ids.push(String(e.id));
      eventsByShift.set(s.id, ids);
    }
  }
  const eventOptions = events
    .map((e) => ({ value: String(e.id), label: eventNameWithDivision(e) }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const fields: (FilterField<TournamentShift> | false)[] = [
    liveTracks.length > 1 && {
      key: "track",
      label: "Track",
      ops: ["any_of", "none_of"],
      control: "buttons",
      options: liveTracks.map((t) => ({ value: String(t.id), label: t.name })),
      rowValues: (s) => [String(s.track_id)],
    },
    // A track can run over several days.
    days.length > 1 && {
      key: "day",
      label: "Day",
      ops: ["any_of", "none_of"],
      options: days.map((day) => ({ value: day, label: formatDayLabel(day) })),
      rowValues: (s) => [toDateInput(s.start)],
    },
    // Start and end both, so a shift matches only if it lies wholly inside.
    {
      key: "time",
      label: "Time",
      kind: "time",
      ops: ["between"],
      rowValues: (s) => [toTimeInput(s.start), endTimeAfter(toTimeInput(s.start), s.end)],
    },
    {
      key: "events",
      label: "Events",
      ops: ["any_of", "all_of", "none_of", "empty", "not_empty"],
      control: "chips",
      searchable: true,
      options: eventOptions,
      opLabels: {
        any_of: "include any of",
        all_of: "include all of",
        none_of: "include none of",
        empty: "are empty",
        not_empty: "aren't empty",
      },
      rowValues: (s) => eventsByShift.get(s.id) ?? [],
    },
  ];
  return fields.filter((field): field is FilterField<TournamentShift> => field !== false);
}
