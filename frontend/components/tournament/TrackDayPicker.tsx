"use client";

import { useMemo } from "react";
import type { TournamentTrack } from "@/lib/api";
import { enumerateDays } from "@/lib/date";
import { Dropdown } from "@/components/ui/Dropdown";
import { formatDayLabel } from "@/lib/timeFormat";

interface TrackDayPickerProps {
  label?: string;
  value: string;
  onChange: (date: string) => void;
  /** The track whose days are on offer. Undefined until one is picked. */
  track: TournamentTrack | undefined;
  placeholder?: string;
  /** Extra caller-driven lock (e.g. a read-only panel), on top of the single-day lock this applies itself. */
  locked?: boolean;
  size?: "sm" | "md";
  fullWidth?: boolean;
  error?: string;
}

/**
 * Picks one of a *track's* running days.
 *
 * The tournament is the wrong scope for this: its `dates` are the union
 * across every primary track, so a day picker fed from it would offer Day 2's
 * date to a shift on Day 1 — which the backend then rejects, since a shift
 * validates against its own track's range.
 *
 * A track that runs a single day (the common case) has nothing to choose, so
 * the dropdown locks rather than disappearing — the field still says which
 * day the shift lands on.
 */
export function TrackDayPicker({
  label, value, onChange, track, placeholder = "Select a day", locked, size = "md", fullWidth, error,
}: TrackDayPickerProps) {
  const days = useMemo(
    () => (track?.start_date && track.end_date ? enumerateDays(track.start_date, track.end_date) : []),
    [track],
  );

  return (
    <Dropdown
      label={label}
      value={value}
      onChange={onChange}
      options={days.map((d) => ({ value: d, label: formatDayLabel(d) }))}
      placeholder={days.length === 0 ? "Pick a track first" : placeholder}
      locked={locked || days.length <= 1}
      size={size}
      fullWidth={fullWidth}
      error={error}
    />
  );
}

/** The days a track runs — for callers that need the list itself, not a control. */
export function trackDays(track: TournamentTrack | undefined): string[] {
  if (!track?.start_date || !track.end_date) return [];
  return enumerateDays(track.start_date, track.end_date);
}
