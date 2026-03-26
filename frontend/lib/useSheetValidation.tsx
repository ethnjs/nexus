"use client";

import { useState } from "react";
import { ValidationIssue, ApiError } from "@/lib/api";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useSheetValidation() {
  const [validationErrors,   setValidationErrors]   = useState<ValidationIssue[]>([]);
  const [validationWarnings, setValidationWarnings] = useState<ValidationIssue[]>([]);
  const [saveError,          setSaveError]          = useState("");

  const errorCount = validationErrors.length;
  const hasErrors  = errorCount > 0;

  /**
   * Call before every save attempt to reset state from the previous attempt.
   */
  function clearAll() {
    setValidationErrors([]);
    setValidationWarnings([]);
    setSaveError("");
  }

  /**
   * Call when a row is edited to clear its validation state immediately,
   * so the row stops being highlighted while the user is fixing it.
   */
  function clearRow(header: string) {
    setValidationErrors((prev)   => prev.filter((e) => e.header !== header));
    setValidationWarnings((prev) => prev.filter((w) => w.header !== header));
  }

  /**
   * Parse warnings from a successful 200/201 response body.
   * The backend includes warnings even when the save succeeds.
   * Call this with the response body after a successful updateConfig/createConfig.
   */
  function handleSaveSuccess(responseBody: { warnings?: ValidationIssue[] } | null) {
    const warns = responseBody?.warnings ?? [];
    setValidationWarnings(warns);
    // Clear any previous errors since the save succeeded
    setValidationErrors([]);
    setSaveError("");
  }

  /**
   * Parse a caught error. If it's a 422 with structured validation body,
   * populate errors/warnings and set a friendly saveError message.
   * Returns true if it was a 422 (caller should not set their own saveError).
   * Returns false for other errors (caller sets their own saveError).
   */
  function handle422(e: unknown): boolean {
    if (e instanceof ApiError && e.status === 422) {
      const detail = e.detail as { errors?: ValidationIssue[]; warnings?: ValidationIssue[] } | null;
      const errs   = detail?.errors   ?? [];
      const warns  = detail?.warnings ?? [];
      setValidationErrors(errs);
      setValidationWarnings(warns);
      setSaveError(
        errs.length === 1
          ? "1 validation error — expand the highlighted row to fix it."
          : `${errs.length} validation errors — expand the highlighted rows to fix them.`
      );
      return true;
    }
    return false;
  }

  /**
   * Set a generic (non-422) save error.
   */
  function setGenericError(message: string) {
    setSaveError(message);
  }

  /**
   * Render the validation error banner + optional generic save error.
   * Pass onShowSummary if there's a summary modal to open (unused here but
   * kept for future use).
   */
  function renderErrorBanner() {
    const warningCount = validationWarnings.length;
    if (!hasErrors && !saveError) return null;

    const parts: string[] = [];
    if (errorCount > 0) parts.push(`${errorCount} error${errorCount !== 1 ? "s" : ""}`);
    if (warningCount > 0) parts.push(`${warningCount} warning${warningCount !== 1 ? "s" : ""}`);
    const summary = parts.join(", ");
    const suffix = errorCount > 0
      ? " — expand the highlighted rows to fix errors."
      : "";

    return (
      <Banner
        variant="error"
        message={`${summary}${suffix}`}
      />
    );
  }

  return {
    validationErrors,
    validationWarnings,
    saveError,
    setSaveError,
    hasErrors,
    errorCount,
    clearAll,
    clearRow,
    handle422,
    handleSaveSuccess,
    setGenericError,
    renderErrorBanner,
  };
}