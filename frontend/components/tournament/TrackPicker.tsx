"use client";

import { useEffect } from "react";
import type { TournamentTrack } from "@/lib/api";
import { Dropdown } from "@/components/ui/Dropdown";

/**
 * Picks one of a tournament's tracks.
 *
 * A tournament with one track has nothing to choose, so the control locks and
 * fills itself in rather than disappearing — the field still says which track
 * the thing lands on, which is the whole reason it reads better than a hidden
 * input. Same treatment TrackDayPicker already gives a single-day track.
 *
 * The lock keys off how many tracks were *offered*, not off the tournament's
 * mode. Simple mode is the common case of that, but a caller can also narrow
 * the list itself — the shift panel offers only competition days — and a
 * narrowed list of one is just as unchoosable.
 */
export function TrackPicker({
  label, value, onChange, tracks, placeholder = "Select a track",
  emptyPlaceholder = "No tracks yet", locked, required, size = "md", fullWidth, error,
}: {
  label?: string;
  /** null = nothing picked yet. */
  value: number | null;
  onChange: (trackId: number) => void;
  /** The tracks on offer — already filtered by the caller if it needs to be. */
  tracks: TournamentTrack[];
  placeholder?: string;
  /** Shown when there is nothing to offer at all, which usually means a
   *  catalog that hasn't loaded or a tournament with no eligible track. */
  emptyPlaceholder?: string;
  /** Extra caller-driven lock (a read-only panel), on top of the sole-track
   *  lock this applies itself. */
  locked?: boolean;
  required?: boolean;
  size?: "sm" | "md";
  fullWidth?: boolean;
  error?: string;
}) {
  // Fill in the sole track here rather than at each call site's state init:
  // the catalog is usually still loading when that state is created, so an
  // init-time guess leaves the field stuck empty behind a locked control.
  useEffect(() => {
    if (value === null && tracks.length === 1) onChange(tracks[0].id);
    // onChange is a fresh closure on most renders; re-running on it would
    // fight any caller that resets the value deliberately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks, value]);

  return (
    <Dropdown
      label={label}
      required={required}
      value={value !== null ? String(value) : ""}
      onChange={(v) => onChange(Number(v))}
      options={tracks.map((t) => ({ value: String(t.id), label: t.name }))}
      placeholder={tracks.length === 0 ? emptyPlaceholder : placeholder}
      locked={locked || tracks.length <= 1}
      size={size}
      fullWidth={fullWidth}
      error={error}
    />
  );
}

/** The track to preselect, for callers that need the id itself rather than a
 *  control — a draft's initial state, say. Null when there is a real choice. */
export function soleTrackId(tracks: TournamentTrack[]): number | null {
  return tracks.length === 1 ? tracks[0].id : null;
}
