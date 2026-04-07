"use client";

import { useState, useRef } from "react";
import { ValidationIssue, ApiError } from "@/lib/api";
import { Banner } from "@/components/ui/Banner";

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useSheetValidation() {
  const [validationErrors,     setValidationErrors]     = useState<ValidationIssue[]>([]);
  const [validationGeneration, setValidationGeneration] = useState(0);
  const [validationWarnings,   setValidationWarnings]   = useState<ValidationIssue[]>([]);
  const [saveError,            setSaveError]            = useState("");

  const errorCount   = validationErrors.length;
  const warningCount = validationWarnings.length;
  const hasErrors    = errorCount > 0;
  const hasWarnings  = warningCount > 0;

  // Tracks whether the current warnings have been shown to the user.
  // Set to true when warnings arrive; reset when warnings are cleared.
  const warningsShown = useRef(false);

  function clearAll() {
    setValidationErrors([]);
    setValidationWarnings([]);
    setSaveError("");
    warningsShown.current = false;
  }

  function handleValidateResult(result: { ok: boolean; errors: ValidationIssue[]; warnings: ValidationIssue[] }): {
    ok: boolean;
    shouldConfirm: boolean;
  } {
    const errs  = result.errors   ?? [];
    const warns = result.warnings ?? [];
    const hadWarningsAlready = warningsShown.current;

    setValidationErrors(errs);
    setValidationWarnings(warns);
    setSaveError("");

    if (warns.length > 0) {
      warningsShown.current = true;
    } else {
      warningsShown.current = false;
    }

    const ok            = errs.length === 0;
    const shouldConfirm = ok && warns.length > 0 && hadWarningsAlready;
    return { ok, shouldConfirm };
  }

  function clearRow(columnIndex: number | undefined, header: string | undefined) {
    const matches = (issue: ValidationIssue) => {
      const ci = issue.column_index;
      const ciMatch = columnIndex != null && (
        Array.isArray(ci) ? ci.includes(columnIndex) : ci === columnIndex
      );
      const h = issue.header;
      const hMatch = header != null && (
        Array.isArray(h) ? h.includes(header) : h === header
      );
      return ciMatch || hMatch;
    };
    setValidationErrors((prev)   => prev.filter((e) => !matches(e)));
    setValidationWarnings((prev) => prev.filter((w) => !matches(w)));
  }

  function handleSaveSuccess(responseBody: { warnings?: ValidationIssue[] } | null) {
    const warns = responseBody?.warnings ?? [];
    setValidationWarnings(warns);
    setValidationErrors([]);
    setSaveError("");
    if (warns.length > 0) {
      warningsShown.current = true;
    } else {
      warningsShown.current = false;
    }
  }

  function handle422(e: unknown): boolean {
    if (e instanceof ApiError && e.status === 422) {
      const detail = e.detail as
        | { errors?: ValidationIssue[]; warnings?: ValidationIssue[] }
        | Array<{ loc: (string | number)[]; msg: string }>
        | null;

      let errs: ValidationIssue[] = [];
      let warns: ValidationIssue[] = [];

      if (Array.isArray(detail)) {
        errs = detail.map((d) => {
          const loc       = d.loc ?? [];
          const header    = typeof loc[2] === "string" ? loc[2] : undefined;
          const ruleIndex = typeof loc[4] === "number" ? loc[4] : undefined;
          const message   = d.msg.replace(/^Value error,\s*/i, "");
          return { header, rule_index: ruleIndex, message } as ValidationIssue;
        });
      } else if (detail && "errors" in detail) {
        errs  = detail.errors  ?? [];
        warns = detail.warnings ?? [];
      }

      setValidationErrors(errs);
      setValidationWarnings(warns);
      setValidationGeneration((g) => g + 1);
      setSaveError(
        errs.length === 1
          ? "1 validation error — expand the highlighted row to fix it."
          : `${errs.length} validation errors — expand the highlighted rows to fix them.`
      );
      return true;
    }
    return false;
  }

  function setGenericError(message: string) {
    setSaveError(message);
  }

  /**
   * Renders a validation banner covering all three states:
   *   - Errors only        → error variant, red
   *   - Errors + warnings  → error variant, red (errors take priority)
   *   - Warnings only      → warning variant, amber
   *
   * Returns null when there's nothing to show.
   * Call this in both the top and bottom positions of the mapping step.
   */
  function renderErrorBanner() {
    if (!hasErrors && !hasWarnings && !saveError) return null;

    if (hasErrors) {
      const parts: string[] = [];
      parts.push(`${errorCount} error${errorCount !== 1 ? "s" : ""}`);
      if (hasWarnings) parts.push(`${warningCount} warning${warningCount !== 1 ? "s" : ""}`);
      const message = `${parts.join(", ")} — expand the highlighted rows to fix errors.`;
      return <Banner variant="error" message={message} />;
    }

    if (hasWarnings) {
      const message = `${warningCount} warning${warningCount !== 1 ? "s" : ""} — review the highlighted rows. Click Save & Sync again to proceed anyway.`;
      return <Banner variant="warning" message={message} />;
    }

    if (saveError) {
      return <Banner variant="error" message={saveError} />;
    }

    return null;
  }

  return {
    validationErrors,
    validationWarnings,
    validationGeneration,
    saveError,
    setSaveError,
    hasErrors,
    hasWarnings,
    errorCount,
    warningCount,
    clearAll,
    clearRow,
    handle422,
    handleSaveSuccess,
    handleValidateResult,
    setGenericError,
    renderErrorBanner,
  };
}
