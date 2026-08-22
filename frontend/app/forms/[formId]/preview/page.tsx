"use client";

import { use, useEffect, useMemo, useState } from "react";
import { formsApi, Form, FormField, FormFieldOption, ApiError } from "@/lib/api";
import { BRANCHING_TYPES } from "@/lib/forms/fieldTypes";
import { QuestionRenderer } from "@/components/forms/QuestionRenderer";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Banner } from "@/components/ui/Banner";
import { Spinner } from "@/components/ui/Spinner";
import { CONTENT_MAX_WIDTH } from "@/components/forms/SubHeader";

// Mirrors backend/app/core/form/branching.py's compute_reachable_field_ids —
// same walk (lowest-order field first, following each branching option's
// next_field_id/action, falling through to the next field by order
// otherwise, ending at a revisited field rather than looping forever) so the
// preview's question sequence always matches what a real respondent would
// see and what the server would accept.
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

function missingRequiredFieldIds(walk: FormField[], answers: Record<string, unknown>): string[] {
  return walk.filter((f) => f.config?.required && isBlank(answers[f.id])).map((f) => f.id);
}

// TD-only, read-only-but-simulated view of the form as a respondent would
// see it — must work on draft forms (that's the point of previewing before
// publishing). No FormResponse is created here: Submit only runs the same
// required-field validation the server would (see missingRequiredFieldIds),
// it never actually calls formsApi.submitResponse.
export default function FormPreviewPage({ params }: { params: Promise<{ formId: string }> }) {
  const { formId } = use(params);

  const [form, setForm] = useState<Form | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  // How many steps deep into the branching walk the respondent has
  // advanced — not tied to specific field ids, so if an earlier (still-
  // editable) answer's branch changes, re-slicing the freshly recomputed
  // walk at the same depth naturally reveals whatever's actually next now,
  // rather than a stale field.
  const [revealCount, setRevealCount] = useState(1);
  // Fields Continue/Submit has been clicked on at least once — drives which
  // rows show a "required" error, live-clearing the moment that field's
  // value stops being blank (same reactive-recheck pattern as FieldCard's
  // liveNonKeyErrors).
  const [attemptedIds, setAttemptedIds] = useState<Set<string>>(new Set());
  const [submitAttempted, setSubmitAttempted] = useState(false);

  useEffect(() => {
    formsApi.get(formId)
      .then(setForm)
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : "Failed to load form."));
  }, [formId]);

  const fields = useMemo(() => (form?.fields ?? []).filter((f) => !f.is_archived), [form]);
  const walk = useMemo(() => computeWalk(fields, answers), [fields, answers]);
  const visibleFields = walk.slice(0, revealCount);
  // True once Continue has been clicked past the walk's actual last field —
  // not just "the active field happens to be last" (that field still needs
  // its own Continue click first).
  const allContinued = walk.length > 0 && revealCount > walk.length;
  const missingIds = new Set(missingRequiredFieldIds(walk, answers));
  const showSuccess = submitAttempted && allContinued && missingIds.size === 0;

  function setAnswer(fieldId: string, value: unknown) {
    setAnswers((prev) => ({ ...prev, [fieldId]: value }));
  }

  function handleContinue(field: FormField) {
    setAttemptedIds((prev) => new Set(prev).add(field.id));
    if (field.config?.required && isBlank(answers[field.id])) return;
    setRevealCount((c) => c + 1);
  }

  function handleSubmit() {
    setSubmitAttempted(true);
    setAttemptedIds((prev) => new Set([...prev, ...walk.map((f) => f.id)]));
  }

  if (loadError) {
    return (
      <div style={{ padding: "22px 24px" }}>
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)" }}>
          {loadError}
        </p>
      </div>
    );
  }

  if (!form) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: `${CONTENT_MAX_WIDTH}px`, margin: "0 auto", padding: "22px 24px", display: "flex", flexDirection: "column", gap: "16px" }}>
      <Banner variant="info" message="Preview mode — nothing submitted here is saved." />

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
          const showError = attemptedIds.has(field.id) && !!field.config?.required && isBlank(answers[field.id]);
          return (
            <Card key={field.id} radius="lg" style={{ padding: "24px" }}>
              <QuestionRenderer
                field={field}
                interactive
                value={answers[field.id]}
                onChange={(v) => setAnswer(field.id, v)}
              />
              {showError && (
                <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)", marginTop: "10px" }}>
                  This question is required.
                </p>
              )}
              {isActive && (
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "16px" }}>
                  <Button type="button" variant="primary" size="sm" onClick={() => handleContinue(field)}>
                    Continue
                  </Button>
                </div>
              )}
            </Card>
          );
        })
      )}

      {allContinued && !showSuccess && (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button type="button" variant="primary" onClick={handleSubmit}>
            Submit
          </Button>
        </div>
      )}
      {showSuccess && (
        <Banner variant="success" message="This preview is complete — no response was recorded." />
      )}
    </div>
  );
}
