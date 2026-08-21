"use client";

import { useState } from "react";
import { ApiError, FormFieldConfig, FormQuestionType } from "@/lib/api";
import { Banner } from "@/components/ui/Banner";

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
function issuesFor(field: ValidatableField): string[] {
  const issues: string[] = [];
  const config = field.config ?? {};

  if (!field.label.trim()) issues.push("Question text is required.");

  if (!field.field_key.trim()) {
    issues.push("Field key is required.");
  } else if (field.field_key === "lunch_") {
    issues.push("Set a date and category for this lunch question.");
  }

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
    if (field.question_type === "ranked_choice" && (config.ranks ?? 1) > options.length) {
      issues.push("Ranks can't exceed the number of options.");
    }
  }

  return issues;
}

function validateFields(fields: ValidatableField[]): FieldValidationIssue[] {
  const issues: FieldValidationIssue[] = [];
  const keyCounts = new Map<string, number>();

  for (const field of fields) {
    const key = field.field_key.trim();
    if (key) keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
  }

  for (const field of fields) {
    for (const message of issuesFor(field)) {
      issues.push({ clientKey: field.clientKey, message });
    }
    const key = field.field_key.trim();
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
