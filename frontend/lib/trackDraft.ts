import type { TournamentDivision, TournamentTrack, TournamentTrackCreate } from "./api";

// The editable shape of one track, shared by the settings editor and the
// create modal. `location` is display text — free text, or the matched
// university's name — and `university_id` is non-null only when it matched,
// exactly as the tournament's own location field works.
export interface TrackDraft {
  name:          string;
  is_primary:    boolean;
  start_date:    string;
  end_date:      string;
  location:      string;
  university_id: number | null;
  division:      TournamentDivision[];
  allow_confirm: boolean;
}

export const EMPTY_TRACK_DRAFT: TrackDraft = {
  name: "", is_primary: false, start_date: "", end_date: "",
  location: "", university_id: null, division: [], allow_confirm: false,
};

export function trackToDraft(track: TournamentTrack): TrackDraft {
  return {
    name:          track.name,
    is_primary:    track.is_primary,
    start_date:    track.start_date ?? "",
    end_date:      track.end_date ?? "",
    location:      track.location ?? track.university?.name ?? "",
    university_id: track.university?.id ?? null,
    division:      track.division ?? [],
    allow_confirm: track.allow_confirm,
  };
}

/**
 * The when/where/what a draft actually sends.
 *
 * A cosmetic track must carry *none* of the primary fields — the backend
 * rejects a partial combination outright — so switching a track to cosmetic
 * explicitly nulls them rather than leaving stale dates behind.
 */
export function trackDraftPayload(draft: TrackDraft): TournamentTrackCreate {
  const base = {
    name:          draft.name.trim(),
    is_primary:    draft.is_primary,
    allow_confirm: draft.allow_confirm,
  };
  if (!draft.is_primary) {
    return { ...base, start_date: null, end_date: null, location: null, university_id: null, division: null };
  }
  return {
    ...base,
    start_date: draft.start_date,
    end_date:   draft.end_date,
    division:   draft.division,
    // Exactly one of the two, the other explicitly nulled — the same atomic
    // swap the tournament's own location field does.
    ...(draft.university_id
      ? { university_id: draft.university_id, location: null }
      : { location: draft.location.trim(), university_id: null }),
  };
}

/**
 * Mirrors require_primary_fields on the backend. Cosmetic tracks need no
 * checks here because the editor doesn't render those fields at all — the
 * payload nulls them, so the "only a primary track can have..." error is
 * unreachable from the UI.
 */
export function validateTrackDraft(draft: TrackDraft, otherNames: string[]): Record<string, string> {
  const errors: Record<string, string> = {};
  const name = draft.name.trim();
  if (!name) errors.name = "Cannot be empty.";
  else if (otherNames.some((other) => other.trim().toLowerCase() === name.toLowerCase())) {
    errors.name = "A track with this name already exists.";
  }
  if (draft.is_primary) {
    if (!draft.start_date) errors.start_date = "Required on a competition day.";
    if (!draft.end_date) errors.end_date = "Required on a competition day.";
    else if (draft.start_date && draft.end_date < draft.start_date) errors.end_date = "Cannot be before start date.";
    if (!draft.university_id && !draft.location.trim()) errors.location = "Required on a competition day.";
    if (draft.division.length === 0) errors.division = "Select at least one division.";
  }
  return errors;
}
