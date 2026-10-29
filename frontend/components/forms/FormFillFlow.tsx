"use client";

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { FloatingSubmitBar } from "@/components/forms/FloatingSubmitBar";
import styles from "@/components/forms/FormFlow.module.css";
import { QuestionRenderer } from "@/components/forms/QuestionRenderer";
import { TOPBAR_HEIGHT } from "@/components/layout/Topbar";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormattedText } from "@/components/ui/FormattedText";
import type { Form, FormField } from "@/lib/api";
import { computeWalk } from "@/lib/forms/branching";
import { hasBlankOther } from "@/lib/forms/otherAnswer";
import { removedPickedOptions, storedAnswerToInput } from "@/lib/forms/storedAnswer";
import { useBlockNavigation } from "@/lib/useUnsavedChanges";

// Mirrors backend/app/core/form/branching.py's _is_blank.
function isBlank(value: unknown): boolean {
  if (value === null || value === undefined || value === false) return true;
  if (typeof value === "string" && value.length === 0) return true;
  if (Array.isArray(value) && value.length === 0) return true;
  if (typeof value === "object" && Object.keys(value as object).length === 0) return true;
  return false;
}

// A started ranking must fill every slot, even on an optional question.
function fieldErrorMessage(field: FormField, value: unknown): string | undefined {
  const required = !!field.config?.required;
  if (field.question_type === "ranked_choice") {
    const ranks = field.config?.ranks ?? 0;
    const pickedCount =
      value && typeof value === "object" ? Object.keys(value as object).length : 0;
    if (pickedCount === 0) return required ? "This can't be empty." : undefined;
    if (pickedCount < ranks) return "All ranks must be filled.";
    return undefined;
  }
  if (required && isBlank(value)) return "This question is required.";
  if (hasBlankOther(value)) return "Type your Other answer.";
  return undefined;
}

/** A response being revised rather than filled for the first time. */
export interface ExistingResponse {
  /** Stored answers by field id, raw (snapshots and all). */
  stored: Record<string, unknown>;
}

function sameAnswer(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

interface FormFillFlowProps {
  form: Form;
  /** Rendered above the title card. */
  banner?: ReactNode;
  successMessage: string;
  /** Rendered in the success banner's action slot. */
  successAction?: ReactNode;
  /** Called after Submit's validation passes. Without it nothing is saved, as in the preview. */
  onComplete?: (answers: Record<string, unknown>) => void | Promise<void>;
  /** Revising a response: answers start prefilled, and onComplete receives only the changed
      ones, since an unchanged answer sent back would re-fire its write-through. */
  existing?: ExistingResponse;
}

// Reveals one question at a time; Submit appears once every reachable question is continued past.
export function FormFillFlow({
  form,
  banner,
  successMessage,
  successAction,
  onComplete,
  existing,
}: FormFillFlowProps) {
  const initialAnswers = useMemo(() => {
    if (!existing) return {};
    const prefilled: Record<string, unknown> = {};
    for (const [fieldId, value] of Object.entries(existing.stored)) {
      prefilled[fieldId] = storedAnswerToInput(value);
    }
    return prefilled;
  }, [existing]);
  const [answers, setAnswers] = useState<Record<string, unknown>>(initialAnswers);
  // A depth rather than a field id, so a changed branch reveals what's next in the new walk.
  const [revealCount, setRevealCount] = useState(1);
  const [attemptedIds, setAttemptedIds] = useState<Set<string>>(new Set());
  // Cleared by any answer edit, so fixing the last error still needs another Submit click.
  const [submitSucceeded, setSubmitSucceeded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | undefined>(undefined);
  // Scrolled to in an effect, after the render that reveals its card commits.
  const [pendingScrollId, setPendingScrollId] = useState<string | null>(null);
  // Focused the same way, so the next Tab lands in that question rather than at the page top.
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);
  // On the final Continue the submit bar slides in and the card drops its button; both have
  // to settle before we can tell whether the bar covers the card.
  const [pendingBarClearanceId, setPendingBarClearanceId] = useState<string | null>(null);
  const [submitBarHeight, setSubmitBarHeight] = useState(0);

  const fields = useMemo(() => form.fields.filter((f) => !f.is_archived), [form.fields]);
  const walk = useMemo(() => computeWalk(fields, answers), [fields, answers]);

  function changedAnswers(): Record<string, unknown> {
    if (!existing) return answers;
    const changed: Record<string, unknown> = {};
    for (const field of fields) {
      if (!sameAnswer(answers[field.id], initialAnswers[field.id])) {
        changed[field.id] = answers[field.id] ?? null;
      }
    }
    return changed;
  }
  const visibleFields = walk.slice(0, revealCount);
  const allContinued = walk.length > 0 && revealCount > walk.length;
  const showSuccess = submitSucceeded;
  const invalidCount = walk.filter(
    (f) => attemptedIds.has(f.id) && fieldErrorMessage(f, answers[f.id]) !== undefined,
  ).length;
  // When revising, dirty means changed from what was stored, not merely non-blank.
  const isDirty =
    !showSuccess &&
    (existing
      ? Object.keys(changedAnswers()).length > 0
      : Object.values(answers).some((v) => !isBlank(v)));
  useBlockNavigation(isDirty);

  // Drops answers a changed branch made unreachable. Returning `prev` when nothing is stale
  // keeps this from looping with the walk memo.
  useEffect(() => {
    const reachableIds = new Set(walk.map((f) => f.id));
    setAnswers((prev) => {
      const staleIds = Object.keys(prev).filter((id) => !reachableIds.has(id));
      if (staleIds.length === 0) return prev;
      const next = { ...prev };
      for (const id of staleIds) delete next[id];
      return next;
    });
  }, [walk]);

  useEffect(() => {
    if (!pendingFocusId) return;
    setPendingFocusId(null);
    document
      .querySelector<HTMLElement>(`[data-form-field="${pendingFocusId}"]`)
      ?.focus({ preventScroll: true });
  }, [pendingFocusId]);

  useEffect(() => {
    if (!pendingScrollId) return;
    const el = document.querySelector<HTMLElement>(`[data-form-field="${pendingScrollId}"]`);
    setPendingScrollId(null);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const safeTop = TOPBAR_HEIGHT + 12;
    window.scrollTo({ top: window.scrollY + rect.top - safeTop - 8, behavior: "smooth" });
  }, [pendingScrollId]);

  useEffect(() => {
    if (!pendingBarClearanceId || submitBarHeight === 0) return;
    const card = document.querySelector<HTMLElement>(
      `[data-form-field="${pendingBarClearanceId}"]`,
    );
    if (!card) {
      setPendingBarClearanceId(null);
      return;
    }

    // Wait through the next paint and the card-height animation before measuring.
    let frame = 0;
    // @types/node types setTimeout as returning NodeJS.Timeout; the browser returns a number.
    let timer: number | undefined;
    const apply = () => {
      const safeTop = TOPBAR_HEIGHT + 12;
      const safeBottom = window.innerHeight - submitBarHeight;
      const rect = card.getBoundingClientRect();
      const visibleBand = safeBottom - safeTop;
      let delta = 0;

      if (rect.height <= visibleBand) {
        if (rect.top < safeTop) delta = rect.top - safeTop - 8;
        else if (rect.bottom > safeBottom) delta = rect.bottom - safeBottom + 8;
      } else if (rect.top < safeTop || rect.top >= safeBottom) {
        // Too tall to fit above the bar, so show its top.
        delta = rect.top - safeTop - 8;
      }

      if (delta !== 0) window.scrollTo({ top: window.scrollY + delta, behavior: "smooth" });
      setPendingBarClearanceId(null);
    };
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        timer = window.setTimeout(apply, 250);
      });
    });

    return () => {
      cancelAnimationFrame(frame);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [pendingBarClearanceId, submitBarHeight]);

  function setAnswer(fieldId: string, value: unknown) {
    setAnswers((prev) => ({ ...prev, [fieldId]: value }));
    setSubmitSucceeded(false);
    setSubmitError(undefined);
  }

  function handleContinue(field: FormField) {
    setAttemptedIds((prev) => new Set(prev).add(field.id));
    if (fieldErrorMessage(field, answers[field.id])) {
      setPendingFocusId(field.id);
      return;
    }
    setRevealCount((c) => c + 1);
    const nextField = walk[revealCount];
    if (nextField) setPendingScrollId(nextField.id);
    else setPendingBarClearanceId(field.id);
    setPendingFocusId(nextField?.id ?? field.id);
  }

  // Enter continues the active question, the same as its button. The listener reads the latest
  // handler through a ref so it's attached once.
  const continueActiveRef = useRef<((target: HTMLElement) => void) | null>(null);
  useEffect(() => {
    const active = visibleFields[visibleFields.length - 1];
    continueActiveRef.current =
      active && !allContinued && !showSuccess
        ? (target) => {
            // Focus left in an earlier card doesn't count, so one key can't skip ahead.
            const card = target.closest<HTMLElement>("[data-form-field]");
            if (card ? card.dataset.formField === active.id : target === document.body) {
              handleContinue(active);
            }
          }
        : null;
  });
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "Enter" || e.shiftKey || e.defaultPrevented || e.isComposing) return;
      const target = e.target as HTMLElement;
      // These keep Enter: a new line, a pressed button or link, a pick from an open list.
      if (target.closest("textarea, button, a, [contenteditable='true'], [data-select-panel]")) {
        return;
      }
      continueActiveRef.current?.(target);
      if (target instanceof HTMLInputElement) target.blur();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  async function handleSubmit() {
    setAttemptedIds((prev) => new Set([...prev, ...walk.map((f) => f.id)]));
    const firstInvalid = walk.find((f) => fieldErrorMessage(f, answers[f.id]) !== undefined);
    if (firstInvalid) {
      setSubmitSucceeded(false);
      setPendingScrollId(firstInvalid.id);
      return;
    }
    setSubmitting(true);
    setSubmitError(undefined);
    try {
      const payload = changedAnswers();
      // Nothing changed on a revision — there's nothing to send.
      if (!existing || Object.keys(payload).length > 0) await onComplete?.(payload);
      setSubmitSucceeded(true);
    } catch (error: unknown) {
      setSubmitSucceeded(false);
      setSubmitError(
        error instanceof Error
          ? error.message
          : "Failed to submit your response. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className={styles.page}
      // Inline because the submit bar's height is measured at runtime.
      style={{
        paddingBottom: `${120 + submitBarHeight}px`,
        transition: "padding-bottom 0.25s ease",
      }}
    >
      {banner}

      {(form.title || form.description) && (
        <Card radius="lg" className={styles.card}>
          {form.title && (
            <h1
              style={{
                fontFamily: "var(--font-serif)",
                fontSize: "24px",
                color: "var(--color-text-primary)",
              }}
            >
              <FormattedText markdown={form.title} variant="inline" />
            </h1>
          )}
          {form.description && (
            <div
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: "14px",
                color: "var(--color-text-secondary)",
                marginTop: "8px",
              }}
            >
              <FormattedText markdown={form.description} variant="rich" />
            </div>
          )}
        </Card>
      )}

      {fields.length === 0 ? (
        <Card radius="lg" className={styles.card}>
          <p
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: "14px",
              color: "var(--color-text-secondary)",
            }}
          >
            This form has no fields yet.
          </p>
        </Card>
      ) : (
        visibleFields.map((field, i) => {
          const isActive = i === visibleFields.length - 1 && !allContinued;
          const errorMessage = attemptedIds.has(field.id)
            ? fieldErrorMessage(field, answers[field.id])
            : undefined;
          // Only ranked_choice has an inline error slot; other types show it as text below.
          const isRanked = field.question_type === "ranked_choice";
          return (
            <Card
              key={field.id}
              data-form-field={field.id}
              tabIndex={-1}
              radius="lg"
              variant={errorMessage ? "danger" : "normal"}
              className={styles.card}
            >
              <QuestionRenderer
                field={field}
                interactive
                value={answers[field.id]}
                onChange={(v) => setAnswer(field.id, v)}
                error={isRanked ? errorMessage : undefined}
                // A past pick that's no longer offered still shows, marked Removed.
                removedOptions={
                  existing ? removedPickedOptions(field, existing.stored[field.id]) : undefined
                }
              />
              {!isRanked && errorMessage && (
                <p
                  style={{
                    fontFamily: "var(--font-sans)",
                    fontSize: "13px",
                    color: "var(--color-danger)",
                    marginTop: "10px",
                  }}
                >
                  {errorMessage}
                </p>
              )}
              {isActive && (
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "16px" }}>
                  <Button
                    type="button"
                    variant="primary"
                    size="md"
                    onClick={() => handleContinue(field)}
                  >
                    Continue
                  </Button>
                </div>
              )}
            </Card>
          );
        })
      )}

      {showSuccess && <Banner variant="success" message={successMessage} action={successAction} />}

      <FloatingSubmitBar
        visible={allContinued && !showSuccess}
        invalidCount={invalidCount}
        onSubmit={handleSubmit}
        loading={submitting}
        error={submitError}
        onHeightChange={setSubmitBarHeight}
      />
    </div>
  );
}
