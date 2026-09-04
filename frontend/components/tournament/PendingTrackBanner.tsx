"use client";

import type { TournamentTrack } from "@/lib/api";
import { Banner } from "@/components/ui/Banner";

/**
 * Why a pending-delete track is still showing up everywhere.
 *
 * `is_archived` on a track is not a TD-facing archive — it means the TD asked
 * to delete it and something still points at it. It stays visible (and
 * flagged) precisely so those references can be found and repointed, at which
 * point the track deletes itself and takes every member's data for it along.
 */
export const PENDING_TRACK_NOTE =
  "This track is pending deletion. It disappears — along with every member's status, availability, lunch and event preferences for it — once the last shift, event and form field pointing at it has been repointed. Restore it in tournament settings to keep it.";

/** The tracks in `tracks` that are pending deletion. */
export function pendingTracks(tracks: TournamentTrack[]): TournamentTrack[] {
  return tracks.filter((track) => track.is_archived);
}

export function PendingTrackBanner({ tracks, subject }: {
  /** Every track in play on the page — only the pending ones are named. */
  tracks: TournamentTrack[];
  /** What the page lists, for the sentence: "events", "shifts". */
  subject: string;
}) {
  const pending = pendingTracks(tracks);
  if (pending.length === 0) return null;

  const one = pending.length === 1;
  const names = pending.map((track) => `“${track.name}”`).join(", ");
  return (
    <div style={{ marginBottom: "12px" }}>
      <Banner
        variant="warning"
        message={
          `The ${names} ${one ? "track is" : "tracks are"} pending deletion. ` +
          `The highlighted ${subject} are what's holding ${one ? "it" : "them"} here — ` +
          `repoint them to another track and ${one ? "it deletes itself" : "they delete themselves"}, ` +
          `taking every member's data for ${one ? "the track" : "those tracks"} with ${one ? "it" : "them"}. ` +
          `Restore in tournament settings to keep ${one ? "it" : "them"}.`
        }
      />
    </div>
  );
}
