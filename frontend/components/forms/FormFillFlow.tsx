"use client";

import { ReactNode, useEffect, useMemo, useState } from "react";
import { Form, FormField, FormFieldOption } from "@/lib/api";
import { BRANCHING_TYPES } from "@/lib/forms/fieldTypes";
import { QuestionRenderer } from "@/components/forms/QuestionRenderer";
import { FloatingSubmitBar } from "@/components/forms/FloatingSubmitBar";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Banner } from "@/components/ui/Banner";
import { CONTENT_MAX_WIDTH } from "@/components/forms/SubHeader";
import { TOPBAR_HEIGHT } from "@/components/layout/Topbar";
import { useBlockNavigation } from "@/lib/useUnsavedChanges";

// Mirrors backend/app/core/form/branching.py's compute_reachable_field_ids —
// same walk (lowest-order field first, following each branching option's
// next_field_id/action, falling through to the next field by order
// otherwise, ending at a revisited field rather than looping forever) so
// every viewer's question sequence always matches what a real respondent
// would see and what the server would accept.
function computeWalk(fields: FormField[], answers: Record<string, unknown>): FormField[] {
  if (fields.length === 0) return [];
  const byOrder = [...fields].sort((a, b) => a.order - b.order);
  const byId = new Map(fields.map((f) => [f.id, f]));
  const reached: FormField[] = [];
  const reachedIds = new Set<string>();
  let current: FormField | null = byOrder[0];

  while (current && !reachedIds.has(current.id)) {
    reachedIds.add(current.id);
    reached.push(current);

    let next: FormField | null = null;
    if (BRANCHING_TYPES.includes(current.question_type)) {
      const answer: unknown = answers[current.id];
      const options: FormFieldOption[] = current.config?.options ?? [];
      const matched = options.find((o) => o.option_id === answer);
      if (matched) {
        if (matched.action === "submit_form") return reached;
        if (matched.next_field_id) next = byId.get(matched.next_field_id) ?? null;
      }
    }
    if (!next) {
      const idx = byOrder.indexOf(current);
      next = idx + 1 < byOrder.length ? byOrder[idx + 1] : null;
    }
    current = next;
  }
  return reached;
}

// Mirrors backend/app/core/form/branching.py's _is_blank.
function isBlank(value: unknown): boolean {
  if (value === null || value === undefined || value === false) return true;
  if (typeof value === "string" && value.length === 0) return true;
  if (Array.isArray(value) && value.length === 0) return true;
  if (typeof value === "object" && Object.keys(value as object).length === 0) return true;
  return false;
}

// ranked_choice has a second validation rule beyond plain required/blank:
// a required question needs every rank slot filled (not just one), and an
// *optional* one — once the respondent has picked anything at all — also
// needs every slot filled (a half-finished ranking isn't a meaningful
// answer to leave in). `pickedCount < ranks` alone covers both: when
// required, `pickedCount === 0` already satisfies it (0 < ranks); when
// optional, the `pickedCount > 0` guard is what stops an untouched
// question from being flagged.
function fieldErrorMessage(field: FormField, value: unknown): string | undefined {
  const required = !!field.config?.required;
  if (field.question_type === "ranked_choice") {
    const ranks = field.config?.ranks ?? 0;
    const pickedCount = value && typeof value === "object" ? Object.keys(value as object).length : 0;
    if (pickedCount === 0) return required ? "This can't be empty." : undefined;
    if (pickedCount < ranks) return "All ranks must be filled.";
    return undefined;
  }
  if (required && isBlank(value)) return "This question is required.";
  return undefined;
}

interface FormFillFlowProps {
  form: Form;
  /** Rendered above the title card — e.g. the builder preview's "nothing
      submitted here is saved" notice. Omit for a real respondent viewer. */
  banner?: ReactNode;
  /** Shown in the success banner once every reachable question passes
      validation and Submit is clicked — differs between "no response was
      recorded" (preview) and an actual confirmation (a real viewer). */
  successMessage: string;
  /** Called once, after Submit's validation passes — a real viewer wires
      this to formsApi.submitResponse; omitted (the default), nothing is
      persisted, which is what makes this safe to use for a TD's preview. */
  onComplete?: (answers: Record<string, unknown>) => void;
}

// One question revealed at a time (Continue advances; Submit only appears
// once every reachable question has been continued past), sharing the same
// branching walk, required/completeness validation, and stale-answer
// cleanup between every place a form gets filled out — the builder's own
// /preview page and any other embedded viewer alike, so they can never
// drift out of sync with each other or with the server's own validation.
export function FormFillFlow({ form, banner, successMessage, onComplete }: FormFillFlowProps) {
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  // How many steps deep into the branching walk the respondent has
  // advanced — not tied to specific field ids, so if an earlier (still-
  // editable) answer's branch changes, re-slicing the freshly recomputed
  // walk at the same depth naturally reveals whatever's actually next now,
  // rather than a stale field.
  const [revealCount, setRevealCount] = useState(1);
  // Fields Continue/Submit has been clicked on at least once — drives which
  // rows show a validation error, live-clearing the moment that field's
  // value stops being invalid (same reactive-recheck pattern as FieldCard's
  // liveNonKeyErrors).
  const [attemptedIds, setAttemptedIds] = useState<Set<string>>(new Set());
  // True only across the span from a Submit click that found nothing
  // invalid to the next answer edit — reset by setAnswer, so fixing the
  // last error by itself never flips this true; Submit has to actually be
  // clicked again once things are fixed.
  const [submitSucceeded, setSubmitSucceeded] = useState(false);
  // Field to scroll to once its Card is actually in the DOM — set alongside
  // the state change that reveals/flags it (revealCount, attemptedIds), so
  // the effect below only ever fires after that same render has committed,
  // never against a stale layout.
  const [pendingScrollId, setPendingScrollId] = useState<string | null>(null);
  // Reported live by FloatingSubmitBar (its own measured height, which
  // grows when the error summary line wraps) — applied as bottom padding so
  // the bar never covers the last question(s), same pattern as FieldList's
  // saveBarHeight for FloatingSaveBar.
  const [submitBarHeight, setSubmitBarHeight] = useState(0);

  const fields = useMemo(() => form.fields.filter((f) => !f.is_archived), [form.fields]);
  const walk = useMemo(() => computeWalk(fields, answers), [fields, answers]);
  const visibleFields = walk.slice(0, revealCount);
  // True once Continue has been clicked past the walk's actual last field —
  // not just "the active field happens to be last" (that field still needs
  // its own Continue click first).
  const allContinued = walk.length > 0 && revealCount > walk.length;
  const showSuccess = submitSucceeded;
  const invalidCount = walk.filter((f) => attemptedIds.has(f.id) && fieldErrorMessage(f, answers[f.id]) !== undefined).length;
  // Broader than the submit bar's own visibility (allContinued) — leaving
  // partway through, before ever reaching the end, should still warn if the
  // respondent has actually answered something. Only clears once Submit
  // has succeeded, same as showSuccess.
  const isDirty = !showSuccess && Object.values(answers).some((v) => !isBlank(v));
  useBlockNavigation(isDirty);

  // A branching answer changing (editing an already-passed radio/dropdown)
  // can make an earlier answer's downstream fields unreachable — those
  // fields keep whatever the respondent answered before the branch changed
  // unless explicitly cleared, so this drops anything no longer in `walk`.
  // Effect (not derived state): it mutates `answers`, and only when there's
  // actually something stale to drop — an unchanged `prev` triggers no
  // re-render, so this can't loop against the walk/answers memo above.
  useEffect(() => {
    const reachableIds = new Set(walk.map((f) => f.id));
    setAnswers((prev) => {
      const staleIds = Object.keys(prev).filter((id) => !reachableIds.has(id));
      if (staleIds.length === 0) return prev;
      const next = { ...prev };
      staleIds.forEach((id) => delete next[id]);
      return next;
    });
  }, [walk]);

  // data-form-field on each Card is the only handle this needs — same
  // "measure after commit, offset past the topbar" approach as FieldList's
  // own pendingScrollKey effect.
  useEffect(() => {
    if (!pendingScrollId) return;
    const el = document.querySelector<HTMLElement>(`[data-form-field="${pendingScrollId}"]`);
    setPendingScrollId(null);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const safeTop = TOPBAR_HEIGHT + 12;
    window.scrollTo({ top: window.scrollY + rect.top - safeTop - 8, behavior: "smooth" });
  }, [pendingScrollId]);

  function setAnswer(fieldId: string, value: unknown) {
    setAnswers((prev) => ({ ...prev, [fieldId]: value }));
    // Whatever Submit last validated is now stale — require clicking it
    // again rather than letting showSuccess flip true the instant the last
    // error happens to clear.
    setSubmitSucceeded(false);
  }

  function handleContinue(field: FormField) {
    setAttemptedIds((prev) => new Set(prev).add(field.id));
    if (fieldErrorMessage(field, answers[field.id])) return;
    setRevealCount((c) => c + 1);
    const nextField = walk[revealCount];
    if (nextField) setPendingScrollId(nextField.id);
  }

  function handleSubmit() {
    setAttemptedIds((prev) => new Set([...prev, ...walk.map((f) => f.id)]));
    const firstInvalid = walk.find((f) => fieldErrorMessage(f, answers[f.id]) !== undefined);
    if (firstInvalid) {
      setSubmitSucceeded(false);
      setPendingScrollId(firstInvalid.id);
      return;
    }
    setSubmitSucceeded(true);
    onComplete?.(answers);
  }

  return (
    <div style={{
      maxWidth: `${CONTENT_MAX_WIDTH}px`, margin: "0 auto", padding: "22px 24px", display: "flex", flexDirection: "column", gap: "16px",
      paddingBottom: `${22 + submitBarHeight}px`, transition: "padding-bottom 0.25s ease",
    }}>
      {banner}

      {(form.title || form.description) && (
        <Card radius="lg" style={{ padding: "24px" }}>
          {form.title && (
            <h1 style={{ fontFamily: "var(--font-serif)", fontSize: "24px", color: "var(--color-text-primary)" }}>
              {form.title}
            </h1>
          )}
          {form.description && (
            <p style={{ fontFamily: "var(--font-sans)", fontSize: "14px", color: "var(--color-text-secondary)", marginTop: "8px" }}>
              {form.description}
            </p>
          )}
        </Card>
      )}

      {fields.length === 0 ? (
        <Card radius="lg" style={{ padding: "24px" }}>
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "14px", color: "var(--color-text-secondary)" }}>
            This form has no fields yet.
          </p>
        </Card>
      ) : (
        visibleFields.map((field, i) => {
          const isActive = i === visibleFields.length - 1 && !allContinued;
          const errorMessage = attemptedIds.has(field.id) ? fieldErrorMessage(field, answers[field.id]) : undefined;
          // ranked_choice surfaces its own error on the add-combobox (via
          // QuestionRenderer's `error` prop) — every other type has no
          // inline slot for it yet, so it falls back to plain text below.
          const isRanked = field.question_type === "ranked_choice";
          return (
            <Card key={field.id} data-form-field={field.id} radius="lg" variant={errorMessage ? "danger" : "normal"} style={{ padding: "24px" }}>
              <QuestionRenderer
                field={field}
                interactive
                value={answers[field.id]}
                onChange={(v) => setAnswer(field.id, v)}
                error={isRanked ? errorMessage : undefined}
              />
              {!isRanked && errorMessage && (
                <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)", marginTop: "10px" }}>
                  {errorMessage}
                </p>
              )}
              {isActive && (
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "16px" }}>
                  <Button type="button" variant="primary" size="md" onClick={() => handleContinue(field)}>
                    Continue
                  </Button>
                </div>
              )}
            </Card>
          );
        })
      )}

      {showSuccess && (
        <Banner variant="success" message={successMessage} />
      )}

      <FloatingSubmitBar
        visible={allContinued && !showSuccess}
        invalidCount={invalidCount}
        onSubmit={handleSubmit}
        onHeightChange={setSubmitBarHeight}
      />
    </div>
  );
}
