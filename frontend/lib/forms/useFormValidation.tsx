"use client";

import { useState } from "react";
import { ApiError, FormFieldConfig, FormQuestionType, TrackStatusAssignment } from "@/lib/api";
import { Banner } from "@/components/ui/Banner";
import { activePresetKind, effectiveFieldKey, presetIncompleteMessage } from "@/lib/forms/fieldKeyPresets";

// Duck-typed against EditableField (frontend/app/forms/[formId]/edit/page.tsx)
// rather than importing it — the hook only touches these five properties,
// and importing a type from a page module for a value the hook never
// constructs isn't worth the coupling.
export interface ValidatableField {
  clientKey: string;
  field_key: string;
  label: string;
  question_type: FormQuestionType;
  config: FormFieldConfig | null;
}

export interface FieldValidationIssue {
  clientKey: string;
  message: string;
}

const OPTION_BEARING = new Set<FormQuestionType>([
  "single_select_radio", "single_select_dropdown", "multi_select_checkbox", "ranked_choice",
]);

// Structural checks only — matches the backend's per-config Pydantic models
// (backend/app/schemas/form.py) closely enough to catch the same problems
// before a round trip, but the backend remains the source of truth (e.g. it
// also validates next_field_id resolution and availability option shape,
// neither of which is checked here).
// Exported so callers that already know a field had errors as of the last
// validate() pass (e.g. FieldCard) can re-run just this field's structural
// checks against its live, currently-being-edited data — letting an error
// (and whatever border/highlight it drives) disappear the moment it's
// actually fixed, instead of staying stuck until the next full validate().
export function issuesFor(field: ValidatableField): string[] {
  const issues: string[] = [];
  const config = field.config ?? {};

  if (!field.label.trim()) issues.push("Question text is required.");

  // No standalone "field key is required" check — a blank field_key just
  // means the TD hasn't typed one, and it falls back to the label's own
  // slug at save time (see effectiveFieldKey/toFieldInput). A truly empty
  // label is already caught by the check above; nothing else needs a key
  // of its own to be valid.
  //
  // A preset's sentinel-only key (e.g. "availability_", picked but not yet
  // given a date) is a *complete-looking* string, not an empty one — it
  // needs its own check rather than falling through as if it were a valid
  // custom key. build{Availability,EventPreference,Lunch}FieldKey all
  // collapse back to the bare "{prefix}_" sentinel unless every one of
  // their parameters is filled in, so a trailing "_" reliably means
  // "still incomplete" — a real date/suffix/category never leaves one.
  const presetKind = activePresetKind(field.field_key);
  if (presetKind && field.field_key.endsWith("_")) issues.push(presetIncompleteMessage(presetKind));

  if (field.question_type === "acknowledgment" && !config.confirm_label?.trim()) {
    issues.push("Confirmation text is required.");
  }

  if (OPTION_BEARING.has(field.question_type)) {
    const options = (config.options ?? []).filter((o) => !o.is_archived);
    if (options.length === 0) {
      issues.push("Add at least one option.");
    } else {
      if (options.some((o) => !o.label.trim())) issues.push("Every option needs a label.");
      const labels = options.map((o) => o.label.trim().toLowerCase());
      if (new Set(labels).size !== labels.length) issues.push("Option labels must be unique.");
    }
    const hasTrackOutcomes = presetKind === "track_status" || (presetKind === "availability" && !!config.track_status_enabled);
    const trackAssignmentsFor = (option: typeof options[number]): TrackStatusAssignment[] => {
      const onlyAssignments = (items: unknown[]): TrackStatusAssignment[] => items.filter(
        (item): item is TrackStatusAssignment => typeof item === "object" && item !== null && "id" in item && "status" in item,
      );
      if (presetKind === "availability" && typeof option.value === "object" && !Array.isArray(option.value)) {
        return onlyAssignments(option.value.track_statuses ?? []);
      }
      return presetKind === "track_status" && Array.isArray(option.value) ? onlyAssignments(option.value) : [];
    };
    if (hasTrackOutcomes && options.some((option) => trackAssignmentsFor(option).some((assignment) => !assignment.status))) {
      issues.push("Choose a status for every track outcome.");
    }
    if (field.question_type === "ranked_choice" && (config.ranks ?? 1) > options.length) {
      issues.push("Ranks can't exceed the number of options.");
    }
  }

  return issues;
}

function validateFields(fields: ValidatableField[]): FieldValidationIssue[] {
  const issues: FieldValidationIssue[] = [];
  const keyCounts = new Map<string, number>();

  // Counted by the key each field will actually save with, not the raw
  // (possibly blank) field_key — two untouched fields whose labels happen
  // to slug to the same string collide on Save just as much as two fields
  // with the same typed key would.
  for (const field of fields) {
    const key = effectiveFieldKey(field);
    if (key) keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
  }

  for (const field of fields) {
    for (const message of issuesFor(field)) {
      issues.push({ clientKey: field.clientKey, message });
    }
    const key = effectiveFieldKey(field);
    if (key && (keyCounts.get(key) ?? 0) > 1) {
      issues.push({ clientKey: field.clientKey, message: "This field key is already used by another question on this form." });
    }
  }

  return issues;
}

// Mirrors useSheetValidation's shape (frontend/lib/useSheetValidation.tsx):
// validationErrors/hasErrors/handle422/renderErrorBanner. Diverges where the
// two domains differ — this hook's errors come from a live client-side
// pass over the whole field list rather than a structured 422 body, since
// the forms PUT .../fields/ route returns a single message string rather
// than a per-row {errors, warnings} shape.
export function useFormValidation() {
  const [validationErrors, setValidationErrors] = useState<FieldValidationIssue[]>([]);
  const [saveError, setSaveError] = useState("");

  const hasErrors = validationErrors.length > 0;

  function validate(fields: ValidatableField[]): FieldValidationIssue[] {
    const issues = validateFields(fields);
    setValidationErrors(issues);
    setSaveError("");
    return issues;
  }

  function errorsFor(clientKey: string): string[] {
    return validationErrors.filter((e) => e.clientKey === clientKey).map((e) => e.message);
  }

  function clearAll() {
    setValidationErrors([]);
    setSaveError("");
  }

  function handle422(e: unknown): boolean {
    if (e instanceof ApiError) {
      setSaveError(e.message);
      return true;
    }
    return false;
  }

  function renderErrorBanner() {
    if (hasErrors) {
      const n = validationErrors.length;
      return <Banner variant="error" message={`${n} issue${n !== 1 ? "s" : ""} — fix the highlighted question${n !== 1 ? "s" : ""}.`} />;
    }
    if (saveError) return <Banner variant="error" message={saveError} />;
    return null;
  }

  return {
    validationErrors,
    hasErrors,
    saveError,
    setSaveError,
    validate,
    errorsFor,
    clearAll,
    handle422,
    renderErrorBanner,
  };
}
