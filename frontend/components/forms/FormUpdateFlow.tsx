"use client";

import { useMemo, useState } from "react";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ApiError, Form, FormResponse, formsApi, PendingUpdateReason } from "@/lib/api";
import { QuestionRenderer } from "@/components/forms/QuestionRenderer";
import { REASON_LABELS } from "@/lib/forms/changeClassification";

// Re-answering a submitted response. Deliberately not FormFillFlow: that one
// reveals a question at a time because the respondent is meeting the form for
// the first time. Here they've already answered — the whole form is shown at
// once, filled in, and only the questions the TD flagged can be touched.
//
// Everything else renders read-only rather than being hidden. Seeing the
// surrounding answers is what makes a flagged question answerable ("morning,
// like I said on the other question"), and it makes clear that the rest of
// the response is intact and isn't being resubmitted.
export function FormUpdateFlow({ form, response, onUpdated }: {
  form: Form;
  response: FormResponse;
  onUpdated: () => void;
}) {
  const flaggedReasons = useMemo(
    () => new Map(response.pending_updates.map((p) => [p.field_id, p.reasons])),
    [response.pending_updates]
  );
  const fields = useMemo(() => form.fields.filter((f) => !f.is_archived), [form.fields]);

  // Flagged questions start blank — the point is to answer them again, and
  // prefilling the answer being questioned invites a reflexive resubmit.
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const previousByField = useMemo(
    () => new Map(response.answers.map((a) => [a.field_id, a.value])),
    [response.answers]
  );

  const unanswered = [...flaggedReasons.keys()].filter((fieldId) => {
    const value = answers[fieldId];
    return value === undefined || value === null || value === "" ||
      (Array.isArray(value) && value.length === 0);
  });

  async function handleSubmit() {
    setError(undefined);
    setSaving(true);
    try {
      // Only the flagged questions — a patch isn't a resubmit, and sending
      // untouched answers back would re-fire their write-through.
      await formsApi.patchResponse(
        form.id,
        [...flaggedReasons.keys()].map((field_id) => ({ field_id, value: answers[field_id] ?? null })),
      );
      onUpdated();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <Banner
        variant="warning"
        message={
          flaggedReasons.size === 1
            ? "One question changed since you answered. Please take another look."
            : `${flaggedReasons.size} questions changed since you answered. Please take another look.`
        }
      />

      {fields.map((field) => {
        const reasons = flaggedReasons.get(field.id);
        const editable = reasons !== undefined;
        return (
          <Card
            key={field.id}
            radius="lg"
            // Dimming the locked questions rather than accenting the flagged
            // ones: on a long form most cards are locked, and highlighting
            // the majority reads as noise instead of direction.
            style={{ padding: "20px 24px", opacity: editable ? 1 : 0.55 }}
          >
            {editable && (
              <div style={{
                fontFamily: "var(--font-sans)", fontSize: "12px",
                color: "var(--color-text-secondary)", marginBottom: "10px",
              }}>
                {reasons.map((r: PendingUpdateReason) => REASON_LABELS[r]).join(" · ")}
              </div>
            )}
            <QuestionRenderer
              field={field}
              interactive={editable}
              value={editable ? answers[field.id] : previousByField.get(field.id)}
              onChange={(value) => setAnswers((prev) => ({ ...prev, [field.id]: value }))}
            />
          </Card>
        );
      })}

      {error && (
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)" }}>
          {error}
        </p>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: "12px" }}>
        {unanswered.length > 0 && (
          <span style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)" }}>
            {unanswered.length} still to answer
          </span>
        )}
        <Button
          type="button" variant="primary"
          loading={saving}
          disabled={unanswered.length > 0}
          onClick={handleSubmit}
        >
          Submit updates
        </Button>
      </div>
    </div>
  );
}
