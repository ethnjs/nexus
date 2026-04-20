import { ApiError } from "@/lib/api";
import { fmtTime } from "@/lib/formatters";

/**
 * Converts any thrown value into a human-readable error string.
 *
 * Handles:
 *  - 409 overlap (time block create/edit)
 *      → "Overlaps with [label] ([start]–[end]). Adjust the time range."
 *  - 409 other conflict
 *      → the detail message or a generic conflict string
 *  - 422 validation — FastAPI array shape: [{ loc, msg, type }]
 *      → first item's msg, stripped of "Value error, " prefix
 *  - 422 validation — sheets shape: { errors: [{ message }], warnings: [...] }
 *      → first error's message, or a count summary
 *  - 5xx / network
 *      → "Something went wrong. Please try again."
 *  - anything else
 *      → the error's own message or the generic fallback
 */
export function parseApiError(e: unknown): string {
  if (!(e instanceof ApiError)) {
    return e instanceof Error
      ? e.message
      : "Something went wrong. Please try again.";
  }

  // ── 409 Conflict ────────────────────────────────────────────────────────────
  if (e.status === 409) {
    const body     = e.body as Record<string, unknown> | undefined;
    const conflict = body?.conflict as
      | { label?: string; start?: string; end?: string }
      | undefined;

    if (conflict) {
      // Time block overlap: backend returns { detail: "...", conflict: { label, start, end } }
      const label = conflict.label ?? "another block";
      const range =
        conflict.start && conflict.end
          ? ` (${fmtTime(conflict.start)}–${fmtTime(conflict.end)})`
          : "";
      return `Overlaps with ${label}${range}. Adjust the time range.`;
    }

    // Other 409 (e.g. affected_events is handled upstream by DeleteBlockModal)
    return e.message || "Conflict. Please try again.";
  }

  // ── 422 Validation ──────────────────────────────────────────────────────────
  if (e.status === 422) {
    const detail = e.detail;

    // FastAPI array shape: [{ loc: [...], msg: "...", type: "..." }]
    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0] as Record<string, unknown>;
      if (typeof first.msg === "string") {
        return first.msg.replace(/^Value error,\s*/i, "");
      }
    }

    // Sheets shape: { errors: [{ message: "..." }], warnings: [...] }
    if (detail && typeof detail === "object" && "errors" in detail) {
      const errs = (detail as { errors?: { message?: string }[] }).errors ?? [];
      if (errs.length > 0 && errs[0].message) {
        return errs.length === 1
          ? errs[0].message
          : `${errs.length} validation errors. First: ${errs[0].message}`;
      }
    }

    return "Validation error. Please check your input.";
  }

  // ── 5xx / network ───────────────────────────────────────────────────────────
  if (e.status >= 500) {
    return "Something went wrong. Please try again.";
  }

  return e.message || "Something went wrong. Please try again.";
}
