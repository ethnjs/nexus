import { FormQuestionType } from "@/lib/api";

// Reserved field_key patterns — mirrors backend/app/core/form/validation.py
// exactly (AVAILABILITY_FIELD_KEY_PATTERN / EVENT_PREFERENCE_FIELD_KEY_PATTERN
// / LUNCH_FIELD_KEY_PATTERN). All three are now parameterized (a date and/or
// TD-chosen suffix), not a single fixed string — a tournament can have
// multiple fields under the same reserved prefix (one per date for
// availability, one per independently-ranked axis for event preference, one
// per date+category for lunch). See backend/form-question-types-reference.md
// ("Reserved field_keys") for the full contract, including why availability
// merges into one centralized pool while event_preference/lunch don't.
export type PresetKind = "availability" | "event_preference" | "lunch";

interface PresetMeta {
  kind: PresetKind;
  label: string;
  allowedQuestionTypes: FormQuestionType[];
  defaultQuestionType: FormQuestionType;
}

export const PRESETS: Record<PresetKind, PresetMeta> = {
  availability: {
    kind: "availability", label: "Availability",
    allowedQuestionTypes: ["single_select_radio", "multi_select_checkbox"],
    defaultQuestionType: "single_select_radio",
  },
  event_preference: {
    kind: "event_preference", label: "Event Preference",
    allowedQuestionTypes: ["ranked_choice", "multi_select_checkbox", "single_select_dropdown"],
    defaultQuestionType: "ranked_choice",
  },
  lunch: {
    kind: "lunch", label: "Lunch",
    allowedQuestionTypes: ["single_select_radio", "multi_select_checkbox"],
    defaultQuestionType: "single_select_radio",
  },
};

const AVAILABILITY_FIELD_KEY_PATTERN = /^availability_(\d{4})(\d{2})(\d{2})$/;
const EVENT_PREFERENCE_FIELD_KEY_PATTERN = /^event_preference_([a-z0-9_]+)$/;
const LUNCH_FIELD_KEY_PATTERN = /^lunch_(\d{4})(\d{2})(\d{2})_([a-z0-9_]+)$/;

// The preset currently active on a field_key, if any — prefix-based, not
// the strict fully-parameterized pattern: PresetPopover sets a bare
// "availability_"/"event_preference_"/"lunch_" sentinel the instant a
// preset is picked, before its date/suffix/category is filled in, and that
// in-progress state must still read as "this preset is active" (matching
// the ButtonGroup selection, the QuestionEditBody body it renders, etc.) —
// otherwise picking a preset would appear to silently do nothing until
// every parameter was filled in. Save-time validation is what actually
// enforces the fully-parameterized shape (matches
// backend/app/core/form/validation.py's stricter regexes exactly).
export function activePresetKind(fieldKey: string): PresetKind | null {
  if (fieldKey.startsWith("availability_")) return "availability";
  if (fieldKey.startsWith("event_preference_")) return "event_preference";
  if (fieldKey.startsWith("lunch_")) return "lunch";
  return null;
}

// availability_{YYYYMMDD}
export function parseAvailabilityFieldKey(fieldKey: string): { date: string } {
  const match = AVAILABILITY_FIELD_KEY_PATTERN.exec(fieldKey);
  if (!match) return { date: "" };
  const [, y, m, d] = match;
  return { date: `${y}-${m}-${d}` };
}

export function buildAvailabilityFieldKey(date: string): string {
  return date ? `availability_${date.replaceAll("-", "")}` : "availability_";
}

// event_preference_{suffix} — the suffix is TD-typed free text (slugified),
// not a date, so there's no fixed-width pattern to parse positionally like
// the date-based presets.
export function parseEventPreferenceFieldKey(fieldKey: string): { suffix: string } {
  const match = EVENT_PREFERENCE_FIELD_KEY_PATTERN.exec(fieldKey);
  return { suffix: match ? match[1] : "" };
}

export function buildEventPreferenceFieldKey(suffix: string): string {
  const slug = slugifyFieldKeyPart(suffix);
  return slug ? `event_preference_${slug}` : "event_preference_";
}

// lunch_{YYYYMMDD}_{category} — one date+category pair per lunch field (not
// per option; a lunch field's options are just that lunch's food choices).
export function parseLunchFieldKey(fieldKey: string): { date: string; category: string } {
  const match = LUNCH_FIELD_KEY_PATTERN.exec(fieldKey);
  if (!match) return { date: "", category: "" };
  const [, y, m, d, category] = match;
  return { date: `${y}-${m}-${d}`, category };
}

export function buildLunchFieldKey(date: string, category: string): string {
  const slug = slugifyFieldKeyPart(category);
  if (!date || !slug) return "lunch_";
  return `lunch_${date.replaceAll("-", "")}_${slug}`;
}

// Whether a useFormValidation issue message is about field_key specifically
// (vs. label/options/etc.) — matches both "Field key is required." and
// "This field key is already used by another question...". Shared so
// FieldCard's error list and FieldKeyPopover's danger styling agree on what
// counts as a key error (and get excluded from the card either way — see
// isPresetError below for the sibling "incomplete preset" case).
export function isFieldKeyError(message: string): boolean {
  return /field key|key is/i.test(message);
}

const PRESET_INCOMPLETE_PREFIX = "This question's preset is incomplete";

// What each preset kind still needs before its field_key is more than a
// sentinel — used both to build the useFormValidation message below and, via
// isPresetError, to route that same message to PresetPopover instead of the
// field card.
const PRESET_INCOMPLETE_REQUIREMENT: Record<PresetKind, string> = {
  availability: "pick a date",
  event_preference: "enter a suffix",
  lunch: "pick a date and category",
};

export function presetIncompleteMessage(kind: PresetKind): string {
  return `${PRESET_INCOMPLETE_PREFIX} — ${PRESET_INCOMPLETE_REQUIREMENT[kind]}.`;
}

// Whether a useFormValidation issue message is about an incomplete preset
// (a picked-but-not-yet-parameterized availability/event/lunch key) — shown
// in PresetPopover instead of the field card, same idea as isFieldKeyError.
export function isPresetError(message: string): boolean {
  return message.startsWith(PRESET_INCOMPLETE_PREFIX);
}

// Shared slug rule for every TD-typed field_key component: a reserved
// preset's suffix/category, or (via slugifyFieldKey below) the whole
// auto-derived key for a plain custom question.
function slugifyFieldKeyPart(text: string): string {
  return text.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

// Auto-fills field_key from the question label until the TD types into the
// key field themselves — same "slug follows the title until you touch it"
// pattern as a URL slug. Empty when the label itself slugifies to nothing
// (e.g. a label that's only punctuation), so the key stays blank rather than
// silently becoming "_" or similar noise.
export function slugifyFieldKey(label: string): string {
  return slugifyFieldKeyPart(label);
}

// The field_key a field will actually save with — its own typed key if set,
// else the label's slug. Shared by toFieldInput (what's sent to the
// backend) and useFormValidation (what's checked for duplicates) so the two
// can't disagree about what a blank-key field's real key is.
export function effectiveFieldKey(field: { field_key: string; label: string }): string {
  return field.field_key.trim() || slugifyFieldKey(field.label);
}
