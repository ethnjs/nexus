import { FormFieldConfig, FormQuestionType } from "@/lib/api";

// Plain question_type options — no reserved presets here (see FIELD_KEY_PRESETS in fieldKeyPresets.ts).
export const QUESTION_TYPE_OPTIONS: { value: FormQuestionType; label: string }[] = [
  { value: "short_text", label: "Short Answer" },
  { value: "long_text", label: "Paragraph" },
  { value: "single_select_radio", label: "Multiple Choice" },
  { value: "single_select_dropdown", label: "Dropdown" },
  { value: "multi_select_checkbox", label: "Checkboxes" },
  { value: "ranked_choice", label: "Ranked Choice" },
  { value: "acknowledgment", label: "Acknowledgment" },
];

// Types whose edit-mode body is a freeform options editor rather than a plain
// preview. Excludes availability/event_preference (entity-backed options
// sourced from real tournament data, not freeform rows) even though they
// reuse these same question_types — callers gate on !activePreset(field_key).
export const OPTION_BEARING_TYPES: FormQuestionType[] = [
  "single_select_radio", "single_select_dropdown", "multi_select_checkbox", "ranked_choice",
];

// Types whose edit-mode body offers per-option branching (Continue / Jump to /
// Submit form) — matches BranchingOption's scope in backend/app/schemas/form.py.
// Excludes reserved presets (availability, event_preference) even though they
// share these question_types — their options are entity-backed and
// auto-generated, not something a TD hand-builds a branch tree over.
export const BRANCHING_TYPES: FormQuestionType[] = ["single_select_radio", "single_select_dropdown"];

// Types whose config carries display_style — a TD-facing render choice
// between a plain radio/checkbox list and a ButtonGroup pill layout. Matches
// SingleSelectRadioConfig/MultiSelectCheckboxConfig's scope in
// backend/app/schemas/form.py; single_select_dropdown and ranked_choice have
// no equivalent (dropdown is always a closed Dropdown control, ranked_choice
// always a RankedList).
export const DISPLAY_STYLE_TYPES: FormQuestionType[] = ["single_select_radio", "multi_select_checkbox"];

// Every backend Config schema (backend/app/schemas/form.py) is
// extra="forbid" and only declares the keys that question_type actually
// uses — e.g. TextConfig has max_length, MultiSelectCheckboxConfig doesn't.
// Keep in sync with QUESTION_TYPE_CONFIG_SCHEMAS there.
const CONFIG_KEYS_BY_TYPE: Record<FormQuestionType, (keyof FormFieldConfig)[]> = {
  short_text: ["required", "max_length"],
  long_text: ["required", "max_length"],
  acknowledgment: ["required", "confirm_label"],
  single_select_radio: ["required", "display_style", "track_status_enabled", "options"],
  single_select_dropdown: ["required", "options"],
  multi_select_checkbox: ["required", "display_style", "track_status_enabled", "options"],
  ranked_choice: ["required", "ranks", "allow_duplicates", "options"],
};

// Drops whatever config keys don't belong to `questionType` — a config
// object carried over from a *different* question_type (the common case:
// switching a field's type in the builder) otherwise keeps stray keys the
// new type's schema doesn't declare, which the backend's extra="forbid"
// rejects wholesale rather than just ignoring. Always call this when
// question_type changes, not just when seeding new config.
export function sanitizeConfigForType(config: FormFieldConfig | null | undefined, questionType: FormQuestionType): FormFieldConfig {
  const allowedKeys = CONFIG_KEYS_BY_TYPE[questionType];
  const sanitized: FormFieldConfig = {};
  for (const key of allowedKeys) {
    if (config && config[key] !== undefined) (sanitized as Record<string, unknown>)[key] = config[key];
  }
  return sanitized;
}
