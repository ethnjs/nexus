"use client";

import { useMemo } from "react";
import { FormAnswer, FormField } from "@/lib/api";
import { isBlankAnswer, removedPickedOptions, storedAnswerToInput } from "@/lib/forms/storedAnswer";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { QuestionRenderer } from "@/components/forms/QuestionRenderer";
import styles from "@/components/forms/FormFlow.module.css";

// A submitted response, read-only — one card per live question. Shared by the
// managers' Responses tab and a member viewing their own, so the two can't
// drift. QuestionRenderer runs interactive + locked: non-interactive would
// hide the value entirely.
export function ResponseAnswers({ fields, answers, flaggedFieldIds }: {
  /** Live questions only, with option values hydrated (formsApi.get). */
  fields: FormField[];
  answers: FormAnswer[];
  /** Managers' view only — questions waiting on an updated answer. */
  flaggedFieldIds?: Set<string>;
}) {
  // Raw stored values: the input shape and any no-longer-offered picks both
  // derive from them.
  const byField = useMemo(() => new Map(answers.map((a) => [a.field_id, a.value])), [answers]);

  return (
    <>
      {fields.map((field) => {
        const stored = byField.get(field.id);
        return (
          <Card key={field.id} radius="lg" className={styles.card}>
            {flaggedFieldIds?.has(field.id) && (
              <div style={{ marginBottom: "10px" }}>
                <Badge variant="warning">Waiting on an updated answer</Badge>
              </div>
            )}
            <QuestionRenderer
              field={field} interactive locked
              value={storedAnswerToInput(stored)}
              removedOptions={removedPickedOptions(field, stored)}
              answerNote={isBlankAnswer(stored) ? (
                <span style={{ fontFamily: "var(--font-sans)", fontSize: "13px", fontStyle: "italic", color: "var(--color-text-tertiary)" }}>
                  Not answered
                </span>
              ) : undefined}
            />
          </Card>
        );
      })}
    </>
  );
}

/** Both stamps come from separate utcnow() calls on insert, so they never
 *  match exactly — only a real gap means the response was edited later. */
export function wasEdited(response: { submitted_at: string; updated_at: string }): boolean {
  return Date.parse(response.updated_at) - Date.parse(response.submitted_at) > 1000;
}
