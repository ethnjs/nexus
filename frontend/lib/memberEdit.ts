import type {
  FormField, FormFieldOption, MembershipTrackStatus, MyEventPreferenceSelection,
  MyTrackOptions, ResolvedEventOption, ResolvedShiftOption, TrackStatus,
} from "./api";
import { membersApi } from "./api";

// What one track's controls hold while the member is editing them. Answers
// are keyed by field id and shaped exactly as QuestionRenderer wants them —
// an option id, a list of option ids, or a rank -> option id map — so the
// page can hand them straight to it and back.
export interface TrackDraft {
  /** null = no row yet ("pending"), which is not something a member can write. */
  status: TrackStatus | null;
  /** The mutually-exclusive "Not available" choice: no shifts, declined. */
  notAvailable: boolean;
  availability: Record<string, unknown>;
  lunch: Record<string, unknown>;
  eventPreference: unknown;
}

export type MemberEditDraft = Record<number, TrackDraft>;

/** The shift ids one availability option groups, whichever shape it came in. */
export function optionShiftIds(option: FormFieldOption): number[] {
  const value = option.value;
  if (Array.isArray(value)) {
    return value.every((entry) => typeof entry === "object" && entry !== null && "start" in entry)
      ? (value as ResolvedShiftOption[]).map((shift) => shift.id)
      : (value as number[]).filter((entry) => typeof entry === "number");
  }
  // The track_status_enabled shape: shifts sit under their own key.
  if (typeof value === "object" && value !== null && "shifts" in value) {
    return ((value as { shifts?: ResolvedShiftOption[] }).shifts ?? []).map((shift) => shift.id);
  }
  return [];
}

/** The event ids one event-preference option groups. */
export function optionEventIds(option: FormFieldOption): number[] {
  const value = option.value;
  if (!Array.isArray(value)) return [];
  return value.every((entry) => typeof entry === "object" && entry !== null && "name" in entry)
    ? (value as ResolvedEventOption[]).map((event) => event.id)
    : (value as number[]).filter((entry) => typeof entry === "number");
}

function liveOptions(field: FormField): FormFieldOption[] {
  return (field.config?.options ?? []).filter((option) => !option.is_archived);
}

/**
 * The answer an availability field should show, derived from the shifts the
 * member actually holds on this track.
 *
 * An option counts as picked when every shift it groups is selected — the
 * groups are the TD's unit, and a partially-covered group is not an answer
 * the form could have produced.
 */
function availabilityAnswer(field: FormField, selectedShiftIds: number[]): unknown {
  const selected = new Set(selectedShiftIds);
  const picked = liveOptions(field)
    .filter((option) => {
      const ids = optionShiftIds(option);
      return ids.length > 0 && ids.every((id) => selected.has(id));
    })
    .map((option) => option.option_id);
  return field.question_type === "multi_select_checkbox" ? picked : picked[0] ?? "";
}

/**
 * The answer a lunch field should show. Selections carry the stored value and
 * label rather than an option id, so they are matched back by value first —
 * `value` is the canonical short form the row was written with.
 */
function lunchAnswer(field: FormField & { category: string }, selections: MyTrackOptions["lunch_selections"]): unknown {
  const mine = selections.filter((selection) => selection.category === field.category);
  if (field.question_type === "short_text" || field.question_type === "long_text") {
    return mine[0]?.value ?? "";
  }
  const picked = mine
    .map((selection) => liveOptions(field).find(
      (option) => option.value === selection.value || option.label === selection.label,
    )?.option_id)
    .filter((id): id is string => !!id);
  return field.question_type === "multi_select_checkbox" ? picked : picked[0] ?? "";
}

/**
 * The answer an event-preference field should show. Selections are per event,
 * while the question is asked in option groups, so an option counts as picked
 * when any of its events is — write-through expands the option into exactly
 * those rows, so they can't disagree in practice.
 */
function eventPreferenceAnswer(field: FormField, selections: MyTrackOptions["event_preference_selections"]): unknown {
  const rankByEvent = new Map(selections.map((selection) => [selection.tournament_event_id, selection.rank]));
  const picked = liveOptions(field)
    .map((option) => ({ option, rank: optionEventIds(option).map((id) => rankByEvent.get(id)).find((r) => r !== undefined) }))
    .filter((entry) => entry.rank !== undefined);

  if (field.question_type === "ranked_choice") {
    return Object.fromEntries(picked.map(({ option, rank }) => [String(rank), option.option_id]));
  }
  const ids = picked.map(({ option }) => option.option_id);
  return field.question_type === "multi_select_checkbox" ? ids : ids[0] ?? "";
}

/**
 * Narrows each track to the questions the member has actually been asked —
 * i.e. those on a form they have completed.
 *
 * Editing is for changing an answer you already gave. A question from a form
 * you haven't filled in yet is one you've never seen in context: it may sit
 * behind branching, alongside others that give it meaning, or after a page of
 * instructions. Answering it here first would skip all of that, and the form
 * would still show as incomplete afterwards.
 *
 * A track with nothing left still appears — its status is always the member's
 * to set, regardless of any form.
 */
export function editableTracks(tracks: MyTrackOptions[], completedFormIds: Set<string>): MyTrackOptions[] {
  return tracks.map((track) => ({
    ...track,
    availability: track.availability.filter((field) => completedFormIds.has(field.form_id)),
    lunch: track.lunch.filter((field) => completedFormIds.has(field.form_id)),
    event_preferences: track.event_preferences && completedFormIds.has(track.event_preferences.form_id)
      ? track.event_preferences
      : null,
  }));
}

export function toDraft(tracks: MyTrackOptions[]): MemberEditDraft {
  return Object.fromEntries(tracks.map((track) => [track.track_id, {
    status: track.status,
    // Declined with nothing selected is exactly what the "Not available"
    // control writes, so that is how it reads back.
    notAvailable: track.status === "declined" && track.selected_shift_ids.length === 0,
    availability: Object.fromEntries(
      track.availability.map((field) => [field.id, availabilityAnswer(field, track.selected_shift_ids)]),
    ),
    lunch: Object.fromEntries(
      track.lunch.map((field) => [field.id, lunchAnswer(field, track.lunch_selections)]),
    ),
    eventPreference: track.event_preferences
      ? eventPreferenceAnswer(track.event_preferences, track.event_preference_selections)
      : undefined,
  }]));
}

/** Which statuses this member may set on a track — see backend/track-status-rules.md. */
export function allowedStatuses(allowConfirm: boolean): TrackStatus[] {
  // `interested` only without allow_confirm: with self-confirm on,
  // declined -> confirmed is available directly and the middle state would be
  // a step to nowhere. Driving the control off this is what keeps the UI from
  // being able to produce a 403.
  return allowConfirm ? ["confirmed", "declined"] : ["interested", "declined"];
}

/** The status picking a real availability group re-opts the member into. */
export function optedInStatus(allowConfirm: boolean): TrackStatus {
  return allowConfirm ? "confirmed" : "interested";
}

function answerOptionIds(answer: unknown): string[] {
  if (typeof answer === "string") return answer ? [answer] : [];
  if (Array.isArray(answer)) return answer as string[];
  return [];
}

/** The shifts an availability answer resolves to, across the track's fields. */
function draftShiftIds(track: MyTrackOptions, draft: TrackDraft): number[] {
  const ids = new Set<number>();
  for (const field of track.availability) {
    for (const optionId of answerOptionIds(draft.availability[field.id])) {
      const option = liveOptions(field).find((entry) => entry.option_id === optionId);
      if (option) for (const shiftId of optionShiftIds(option)) ids.add(shiftId);
    }
  }
  return [...ids].sort((a, b) => a - b);
}

function eventPreferenceSelections(field: FormField, answer: unknown): MyEventPreferenceSelection[] {
  if (field.question_type === "ranked_choice") {
    // The widget keys by rank; the route wants the pair the other way round.
    return Object.entries((answer as Record<string, string> | undefined) ?? {})
      .filter(([, optionId]) => !!optionId)
      .map(([rank, optionId]) => ({ option_id: optionId, rank: Number(rank) }))
      .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
  }
  return answerOptionIds(answer).map((optionId) => ({ option_id: optionId }));
}

export interface SaveResult {
  /** Track statuses the save produced, so the caller can refresh its copy. */
  statuses: MembershipTrackStatus[];
}

/**
 * Writes every track whose draft differs from its baseline.
 *
 * One request per changed thing rather than one batched call: each route owns
 * a different slice (a track's shifts, one lunch category, one track's
 * preferences) and the API has no combined form. They run sequentially so a
 * failure reports the first thing that went wrong rather than a pile.
 */
export async function saveDraft(
  tournamentId: number, tracks: MyTrackOptions[], draft: MemberEditDraft, baseline: MemberEditDraft,
): Promise<SaveResult> {
  const statuses: MembershipTrackStatus[] = [];

  for (const track of tracks) {
    const next = draft[track.track_id];
    const before = baseline[track.track_id];
    if (!next || !before || JSON.stringify(next) === JSON.stringify(before)) continue;

    const shiftIds = next.notAvailable ? [] : draftShiftIds(track, next);
    const beforeShiftIds = before.notAvailable ? [] : draftShiftIds(track, before);
    const shiftsChanged = JSON.stringify(shiftIds) !== JSON.stringify(beforeShiftIds);

    // "Not available" is one request, not two: the shifts and the status move
    // together, so the member can never be left declined with shifts still
    // selected (or opted back in with none).
    const statusWithShifts = next.notAvailable
      ? "declined" as TrackStatus
      : before.notAvailable && shiftIds.length > 0
        ? optedInStatus(track.allow_confirm)
        : undefined;

    if (shiftsChanged || statusWithShifts !== undefined) {
      await membersApi.updateMyAvailability(tournamentId, track.track_id, {
        shift_ids: shiftIds,
        ...(statusWithShifts ? { status: statusWithShifts } : {}),
      });
    }

    // The status control's own change, only when availability didn't already
    // carry one — two writes would make the later one the winner by accident.
    if (statusWithShifts === undefined && next.status && next.status !== before.status) {
      statuses.push(await membersApi.updateMyTrackStatus(tournamentId, track.track_id, next.status));
    }

    for (const field of track.lunch) {
      if (JSON.stringify(next.lunch[field.id]) === JSON.stringify(before.lunch[field.id])) continue;
      const answer = next.lunch[field.id];
      const freeText = field.question_type === "short_text" || field.question_type === "long_text";
      await membersApi.updateMyLunch(tournamentId, track.track_id, field.category,
        freeText ? { text: (answer as string) || null } : { option_ids: answerOptionIds(answer) });
    }

    if (track.event_preferences && JSON.stringify(next.eventPreference) !== JSON.stringify(before.eventPreference)) {
      await membersApi.updateMyEventPreferences(
        tournamentId, track.track_id, eventPreferenceSelections(track.event_preferences, next.eventPreference),
      );
    }
  }

  return { statuses };
}
