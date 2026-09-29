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
  default_role_id: number | null;
  // UI-only, never sent as fields of their own: the backend reads an absent
  // date or venue on a primary track as TBD. They exist because the form has
  // to tell "the TD hasn't filled this in yet" (a validation error) from "the
  // TD says it isn't decided" (a deliberate save) — and an empty input alone
  // can't say which. `trackDraftPayload` turns them back into nulls.
  dates_tbd:     boolean;
  location_tbd:  boolean;
}

export const EMPTY_TRACK_DRAFT: TrackDraft = {
  name: "", is_primary: false, start_date: "", end_date: "",
  location: "", university_id: null, division: [], allow_confirm: false,
  default_role_id: null, dates_tbd: false, location_tbd: false,
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
    default_role_id: track.default_role_id,
    // On a track that has already been saved, absent *is* TBD — there is no
    // half-filled state to preserve. Cosmetic tracks are never TBD: they have
    // no dates or venue by definition, and the editor hides the fields.
    dates_tbd:     track.is_primary && !track.start_date,
    location_tbd:  track.is_primary && !track.location && !track.university,
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
    default_role_id: draft.default_role_id,
  };
  if (!draft.is_primary) {
    return { ...base, start_date: null, end_date: null, location: null, university_id: null, division: null };
  }
  return {
    ...base,
    division: draft.division,
    // TBD is sent as absence, which is how the backend stores it. Both dates
    // go together — it rejects one without the other.
    ...(draft.dates_tbd
      ? { start_date: null, end_date: null }
      : { start_date: draft.start_date, end_date: draft.end_date }),
    // Exactly one of the two, the other explicitly nulled — the same atomic
    // swap the tournament's own location field does. TBD nulls both.
    ...(draft.location_tbd
      ? { university_id: null, location: null }
      : draft.university_id
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
    // Blank is not TBD. A competition day must either carry the answer or say
    // outright that it isn't decided, so a field left empty is still an error.
    if (!draft.dates_tbd) {
      if (!draft.start_date) errors.start_date = "Required, or mark the date TBD.";
      if (!draft.end_date) errors.end_date = "Required, or mark the date TBD.";
      else if (draft.start_date && draft.end_date < draft.start_date) errors.end_date = "Cannot be before start date.";
    }
    if (!draft.location_tbd && !draft.university_id && !draft.location.trim()) {
      errors.location = "Required, or mark the venue TBD.";
    }
    if (draft.division.length === 0) errors.division = "Select at least one division.";
  }
  return errors;
}
