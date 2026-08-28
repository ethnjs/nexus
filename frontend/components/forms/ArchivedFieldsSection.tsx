"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { IconChevronDown, IconRestore, IconTrash } from "@/components/ui/Icons";
import { ApiError, FormField, formsApi } from "@/lib/api";
import { QUESTION_TYPE_OPTIONS } from "@/lib/forms/fieldTypes";

const TYPE_LABELS = Object.fromEntries(QUESTION_TYPE_OPTIONS.map((o) => [o.value, o.label]));

// Questions taken out of use, listed below the builder rather than inline —
// they must not sit in the ordered list, where they'd join drag ordering and
// show up as branch targets. Collapsed by default: on a form that's been
// edited for a while this gets long, and it's a recovery surface rather than
// somewhere a TD works.
//
// Two actions, deliberately unequal in weight:
//   Unarchive — puts the question back, answers and all. Reversible.
//   Delete    — erases the question and every answer to it. Permanent.
export function ArchivedFieldsSection({ formId, fields, onUnarchive, onDeleted }: {
  formId: string;
  fields: FormField[];
  /** Hands the field to the builder, which unarchives it on the next Save —
      it isn't its own request, it's part of the target field list. */
  onUnarchive: (field: FormField) => void;
  onDeleted: (fieldId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState<FormField | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  if (fields.length === 0) return null;

  async function handleDelete() {
    if (!confirming) return;
    setError(undefined);
    setDeleting(true);
    try {
      await formsApi.deleteField(formId, confirming.id);
      onDeleted(confirming.id);
      setConfirming(null);
    } catch (err: unknown) {
      // The likely 409 is "another question still branches to this one",
      // which the TD can only resolve by editing that other question.
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div style={{ marginTop: "24px" }}>
      <Button
        type="button" variant="ghost" size="sm"
        onClick={() => setOpen((v) => !v)}
        style={{ color: "var(--color-text-secondary)" }}
      >
        <IconChevronDown
          size={14}
          style={{ transform: open ? "none" : "rotate(-90deg)", transition: "transform 120ms" }}
        />
        Archived questions ({fields.length})
      </Button>

      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "8px" }}>
          {fields.map((field) => (
            <Card key={field.id} radius="lg" style={{
              padding: "12px 16px", display: "flex", alignItems: "center",
              justifyContent: "space-between", gap: "12px",
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{
                  fontFamily: "var(--font-sans)", fontSize: "14px", color: "var(--color-text-primary)",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {field.label || "Untitled question"}
                </div>
                <div style={{
                  fontFamily: "var(--font-mono)", fontSize: "12px",
                  color: "var(--color-text-tertiary)", marginTop: "2px",
                }}>
                  {field.field_key} · {TYPE_LABELS[field.question_type] ?? field.question_type}
                </div>
              </div>
              <div style={{ display: "flex", gap: "4px", flexShrink: 0 }}>
                <Button type="button" variant="secondary" size="xs" onClick={() => onUnarchive(field)}>
                  <IconRestore size={12} /> Unarchive
                </Button>
                <Button
                  type="button" variant="ghost" size="xs" iconOnly
                  title="Delete permanently"
                  onClick={() => { setError(undefined); setConfirming(field); }}
                  style={{ color: "var(--color-danger)" }}
                >
                  <IconTrash size={12} />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {confirming && (
        <Modal title="Delete question" onClose={() => setConfirming(null)} variant="danger">
          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)" }}>
              Delete <strong>{confirming.label || "this question"}</strong> and every answer anyone
              gave it? This can&rsquo;t be undone — leave it archived instead if you might want the
              responses later.
            </p>

            {error && (
              <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)" }}>
                {error}
              </p>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "6px" }}>
              <Button type="button" variant="secondary" onClick={() => setConfirming(null)} disabled={deleting}>
                Cancel
              </Button>
              <Button type="button" variant="danger" loading={deleting} onClick={handleDelete}>
                Delete permanently
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
