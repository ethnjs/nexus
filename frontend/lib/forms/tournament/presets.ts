import type {
  FormFieldConfig,
  FormFieldOption,
  FormQuestionType,
  TrackStatusAssignment,
} from "@/lib/api";
import { slugifyFieldKey } from "@/lib/forms/fieldKeys";

// Reserved field_key patterns — mirrors backend/app/core/form/validation.py
// exactly (AVAILABILITY_FIELD_KEY_PATTERN / EVENT_PREFERENCE_FIELD_KEY_PATTERN
// / LUNCH_FIELD_KEY_PATTERN).
//
// The numeric slot in each is a **TournamentTrack id**, not a date. Track is
// the scope a question is actually asked about: a track carries its own
// dates, venue and division, so "which day" and "which site" stop being
// separate questions. An id rather than a name, so renaming "Day 1" doesn't
// orphan every key and answer pointing at it.
//
// See backend/docs/form-question-types-reference.md ("Reserved field_keys") for
// the full contract, including why availability merges into one centralized
// pool while event_preference/lunch don't.
export type PresetKind = "availability" | "event_preference" | "lunch" | "track_status";

// availability/event_preference draw their options from real tournament
// entities (shifts/events) via EntityOptionsEditor — their option.value is
// an id array, not freeform text. lunch looks like a preset (a reserved
// field_key) but its options are TD-typed food choices just like a plain
// question's, so it shares OptionsEditor's freeform path instead.
export function isEntityBackedPreset(
  kind: PresetKind | null,
): kind is "availability" | "event_preference" {
  return kind === "availability" || kind === "event_preference";
}

// Whether a per-option `value` distinct from its label is even meaningful.
// It only is when the value is freeform text the TD types: the entity-backed
// presets carry id arrays and track_status carries assignment lists, and a
// custom-values row would be editing a shape it can't represent.
export function allowsCustomValues(kind: PresetKind | null): boolean {
  return !isEntityBackedPreset(kind) && kind !== "track_status";
}

interface PresetMeta {
  kind: PresetKind;
  label: string;
  allowedQuestionTypes: FormQuestionType[];
  defaultQuestionType: FormQuestionType;
}

export const PRESETS: Record<PresetKind, PresetMeta> = {
  availability: {
    kind: "availability",
    label: "Availability",
    allowedQuestionTypes: ["single_select_radio", "multi_select_checkbox"],
    defaultQuestionType: "single_select_radio",
  },
  event_preference: {
    kind: "event_preference",
    label: "Event Preference",
    allowedQuestionTypes: ["ranked_choice", "multi_select_checkbox", "single_select_dropdown"],
    defaultQuestionType: "ranked_choice",
  },
  lunch: {
    kind: "lunch",
    label: "Lunch",
    // The only preset that allows free text: a lunch question like "any
    // special requests?" belongs in the panel's Lunch section, and without
    // the reserved key it would be filtered out of custom responses (which
    // exclude reserved keys) and land nowhere. Mirrors the backend's
    // LUNCH_QUESTION_TYPES.
    allowedQuestionTypes: [
      "single_select_radio",
      "multi_select_checkbox",
      "short_text",
      "long_text",
    ],
    defaultQuestionType: "single_select_radio",
  },
  track_status: {
    kind: "track_status",
    label: "Track Status",
    allowedQuestionTypes: ["single_select_radio", "multi_select_checkbox"],
    defaultQuestionType: "single_select_radio",
  },
};

const AVAILABILITY_FIELD_KEY_PATTERN = /^availability_(\d+)(?:_([a-z0-9_]+))?$/;
const EVENT_PREFERENCE_FIELD_KEY_PATTERN = /^event_preference_(\d+)$/;
const LUNCH_FIELD_KEY_PATTERN = /^lunch_(\d+)_([a-z0-9_]+)$/;
const TRACK_STATUS_FIELD_KEY_PATTERN = /^track_status_([a-z0-9_]+)$/;

// The preset currently active on a field_key, if any — prefix-based, not
// the strict fully-parameterized pattern: PresetPopover sets a bare
// "availability_"/"event_preference_"/"lunch_" sentinel the instant a
// preset is picked, before its date/suffix/category is filled in, and that
// in-progress state must still read as "this preset is active" (matching
// the preset dropdown selection, the QuestionEditBody body it renders, etc.) —
// otherwise picking a preset would appear to silently do nothing until
// every parameter was filled in. Save-time validation is what actually
// enforces the fully-parameterized shape (matches
// backend/app/core/form/validation.py's stricter regexes exactly).
export function activePresetKind(fieldKey: string): PresetKind | null {
  if (fieldKey.startsWith("availability_")) return "availability";
  if (fieldKey.startsWith("event_preference_")) return "event_preference";
  if (fieldKey.startsWith("lunch_")) return "lunch";
  if (fieldKey.startsWith("track_status_")) return "track_status";
  return null;
}

// availability_{track_id}[_{suffix}] — the suffix is optional, TD-typed free
// text (slugified), used only to let two fields cover the same track across
// different forms (a general form and a judges-only one both asking about
// Day 1) without colliding on field_key. The track is what actually scopes
// the question: it pins which shifts this field's write-through may touch.
export function parseAvailabilityFieldKey(fieldKey: string): {
  trackId: number | null;
  suffix: string;
} {
  const match = AVAILABILITY_FIELD_KEY_PATTERN.exec(fieldKey);
  if (!match) return { trackId: null, suffix: "" };
  const [, trackId, suffix] = match;
  return { trackId: Number(trackId), suffix: suffix ?? "" };
}

export function buildAvailabilityFieldKey(trackId: number | null, suffix: string = ""): string {
  if (trackId === null) return "availability_";
  const slug = slugifyFieldKey(suffix);
  return slug ? `availability_${trackId}_${slug}` : `availability_${trackId}`;
}

// event_preference_{track_id} — no suffix, so exactly one preference
// question per track. The track is the whole storage scope (the write-through
// table has no `key`): two questions on one track would write into one pool
// and their ranks would collide, with no way to say whose rank-1 is whose.
export function parseEventPreferenceFieldKey(fieldKey: string): { trackId: number | null } {
  const match = EVENT_PREFERENCE_FIELD_KEY_PATTERN.exec(fieldKey);
  return { trackId: match ? Number(match[1]) : null };
}

export function buildEventPreferenceFieldKey(trackId: number | null): string {
  return trackId === null ? "event_preference_" : `event_preference_${trackId}`;
}

// lunch_{track_id}_{category} — one track+category pair per lunch field (not
// per option; a lunch field's options are just that lunch's food choices).
export function parseLunchFieldKey(fieldKey: string): { trackId: number | null; category: string } {
  const match = LUNCH_FIELD_KEY_PATTERN.exec(fieldKey);
  if (!match) return { trackId: null, category: "" };
  const [, trackId, category] = match;
  return { trackId: Number(trackId), category };
}

export function buildLunchFieldKey(trackId: number | null, category: string): string {
  const slug = slugifyFieldKey(category);
  if (trackId === null || !slug) return "lunch_";
  return `lunch_${trackId}_${slug}`;
}

export function parseTrackStatusFieldKey(fieldKey: string): { suffix: string } {
  const match = TRACK_STATUS_FIELD_KEY_PATTERN.exec(fieldKey);
  return { suffix: match ? match[1] : "" };
}

export function buildTrackStatusFieldKey(suffix: string): string {
  const slug = slugifyFieldKey(suffix);
  return slug ? `track_status_${slug}` : "track_status_";
}

const PRESET_INCOMPLETE_PREFIX = "This question's preset is incomplete";

// What each preset kind still needs before its field_key is more than a
// sentinel — used both to build the validation message below and, via
// isPresetError, to route that same message to PresetPopover instead of the
// field card.
const PRESET_INCOMPLETE_REQUIREMENT: Record<PresetKind, string> = {
  availability: "pick a track",
  event_preference: "pick a track",
  lunch: "pick a track and category",
  track_status: "enter a key",
};

export function presetIncompleteMessage(kind: PresetKind): string {
  return `${PRESET_INCOMPLETE_PREFIX} — ${PRESET_INCOMPLETE_REQUIREMENT[kind]}.`;
}

// Whether a validation message is about an incomplete preset (a
// picked-but-not-yet-parameterized availability/event/lunch key) — shown in
// PresetPopover instead of the field card, same idea as isFieldKeyError.
export function isPresetError(message: string): boolean {
  return message.startsWith(PRESET_INCOMPLETE_PREFIX);
}

// The {id, status} pairs an option carries: its `value` on a track status
// question, or `track_statuses` on an availability one that also updates
// track status. Mirrors the backend's option_track_assignments.
export function optionTrackAssignments(value: FormFieldOption["value"]): TrackStatusAssignment[] {
  const list =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? value.track_statuses
      : value;
  return Array.isArray(list)
    ? list.filter(
        (item): item is TrackStatusAssignment =>
          typeof item === "object" && item !== null && "id" in item && "status" in item,
      )
    : [];
}

// The checks a preset adds on top of the core's structural ones.
export function presetIssuesFor(field: {
  field_key: string;
  config: FormFieldConfig | null;
}): string[] {
  const kind = activePresetKind(field.field_key);
  if (!kind) return [];
  const issues: string[] = [];
  // A preset's sentinel-only key (e.g. "availability_", picked but not yet
  // given a track) looks complete but isn't. The build*FieldKey helpers
  // collapse back to the bare "{prefix}_" until every parameter is filled in,
  // so a trailing "_" reliably means "still incomplete".
  if (field.field_key.endsWith("_")) issues.push(presetIncompleteMessage(kind));
  if (kind === "track_status" || (kind === "availability" && field.config?.track_status_enabled)) {
    const unset = (field.config?.options ?? [])
      .filter((option) => !option.is_archived)
      .some((option) => optionTrackAssignments(option.value).some((item) => !item.status));
    if (unset) issues.push("Choose a status for every track.");
  }
  return issues;
}
