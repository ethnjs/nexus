import { FormQuestionType } from "@/lib/api";

// Reserved field_key presets, picked from the field_key Combobox rather than
// the question_type Dropdown — selecting one sets field_key, and constrains
// question_type to whichever of allowedQuestionTypes fits (switching to
// defaultQuestionType if the current type isn't one of them). Matches
// RESERVED_FIELD_KEY_QUESTION_TYPES / LUNCH_QUESTION_TYPES in
// backend/app/core/form/validation.py — keep in sync if those change.
// Lunch's field_key is a "lunch_" sentinel (not a real key yet) since the
// real key is server-derived from a date+category picker.
export interface FieldKeyPreset {
  kind: "preset";
  key: string;
  field_key: string;
  label: string;
  allowedQuestionTypes: FormQuestionType[];
  defaultQuestionType: FormQuestionType;
}

export const FIELD_KEY_PRESETS: FieldKeyPreset[] = [
  { kind: "preset", key: "availability", field_key: "availability", label: "Availability", allowedQuestionTypes: ["single_select_radio", "multi_select_checkbox"], defaultQuestionType: "single_select_radio" },
  { kind: "preset", key: "event_preference", field_key: "event_preference", label: "Event Preference", allowedQuestionTypes: ["ranked_choice", "multi_select_checkbox", "single_select_dropdown"], defaultQuestionType: "ranked_choice" },
  { kind: "preset", key: "lunch", field_key: "lunch_", label: "Lunch", allowedQuestionTypes: ["single_select_radio", "multi_select_checkbox"], defaultQuestionType: "single_select_radio" },
];

// A field_key already used elsewhere in this tournament — shown in the
// Combobox as a visibly disabled row (not selectable, not hidden) rather
// than letting the TD type it and only discover the collision from the
// 409 PUT .../fields/ would otherwise return.
export interface UsedFieldKeyOption {
  kind: "used";
  key: string;
  field_key: string;
  label: string;
}

export type FieldKeyComboOption = FieldKeyPreset | UsedFieldKeyOption;

// The preset currently active on a field_key, if any — the field_key itself
// (or, for Lunch, the "lunch_" sentinel prefix) matches what's stored.
export function activePreset(fieldKey: string): FieldKeyPreset | undefined {
  return FIELD_KEY_PRESETS.find((p) =>
    p.key === "lunch" ? fieldKey.startsWith("lunch_") : p.field_key === fieldKey
  );
}

// Reflects a field_key back onto the Combobox — shows the preset's
// descriptive label when active, the raw field_key otherwise (a custom
// TD-typed key).
export function fieldToComboboxValue(fieldKey: string): string {
  return activePreset(fieldKey)?.label ?? fieldKey;
}

// lunch_{YYYYMMDD}_{category} — one date+category pair per lunch field (not
// per option; a lunch field's options are just that lunch's food choices).
// Matches LUNCH_FIELD_KEY_PATTERN in backend/app/core/form/validation.py.
export function parseLunchFieldKey(fieldKey: string): { date: string; category: string } {
  const match = /^lunch_(\d{4})(\d{2})(\d{2})_([a-z0-9_]+)$/.exec(fieldKey);
  if (!match) return { date: "", category: "" };
  const [, y, m, d, category] = match;
  return { date: `${y}-${m}-${d}`, category };
}

export function buildLunchFieldKey(date: string, category: string): string {
  const slug = category.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!date || !slug) return "lunch_";
  return `lunch_${date.replaceAll("-", "")}_${slug}`;
}
