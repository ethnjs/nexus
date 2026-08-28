"use client";

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Toggle } from "@/components/ui/Toggle";
import { IconLock } from "@/components/ui/Icons";
import { FieldChange } from "@/lib/api";
import { REASON_CONSEQUENCES, REASON_LABELS } from "@/lib/forms/changeClassification";

// Last stop before a save asks people to redo work. Shown only on a form that
// already has responses, and only for questions whose edits could actually
// raise a prompt — a save that changes nothing consequential goes straight
// through.
//
// Locked rows aren't a formality: a mandatory change invalidated the stored
// answer, so the prompt isn't optional. They're listed anyway so the TD sees
// the full blast radius, not just the part they can still change.
export function NotifyRespondersModal({
  changes, notify, onToggle, onCancel, onConfirm, saving,
}: {
  /** The server's verdict for this save — see formsApi.classifyFieldChanges. */
  changes: FieldChange[];
  /** field_id -> whether to ask previous responders about this question. */
  notify: Record<string, boolean>;
  onToggle: (fieldId: string, value: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
  saving: boolean;
}) {
  const asking = changes.filter((c) => notify[c.field_id]).length;

  return (
    <Modal title="Ask responders to review?" onClose={onCancel} width={560}>
      <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)" }}>
          This form already has responses. These questions changed — pick which
          ones previous responders should be asked to look at again.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {changes.map((change) => {
            const on = !!notify[change.field_id];
            return (
              <div key={change.field_id} style={{
                display: "flex", alignItems: "flex-start", justifyContent: "space-between",
                gap: "16px", padding: "12px 14px",
                border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)",
              }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{
                    fontFamily: "var(--font-sans)", fontSize: "14px", fontWeight: 500,
                    color: "var(--color-text-primary)",
                  }}>
                    {change.label}
                  </div>
                  <ul style={{
                    margin: "4px 0 0", paddingLeft: "16px",
                    fontFamily: "var(--font-sans)", fontSize: "12px",
                    color: "var(--color-text-secondary)",
                  }}>
                    {change.reasons.map((reason) => (
                      <li key={reason}>
                        {REASON_LABELS[reason]}
                        {/* Only for the judgment calls — a locked row's
                            consequence isn't the TD's to weigh. */}
                        {!change.locked && REASON_CONSEQUENCES[reason] && (
                          <span style={{ color: "var(--color-text-tertiary)" }}>
                            {" "}{REASON_CONSEQUENCES[reason]}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0, paddingTop: "2px" }}>
                  {change.locked && (
                    <span
                      title="This change makes the old answer invalid, so it can't be skipped"
                      style={{ display: "flex", color: "var(--color-text-tertiary)" }}
                    >
                      <IconLock size={12} />
                    </span>
                  )}
                  <Toggle checked={on} onChange={(v) => onToggle(change.field_id, v)} locked={change.locked} />
                </div>
              </div>
            );
          })}
        </div>

        {/* The summary sits on its own line rather than beside the buttons:
            it's a full sentence, and sharing the row squeezed the labels
            until "Save changes" wrapped. */}
        <span style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)" }}>
          {asking === 0
            ? "Nobody will be asked to re-answer."
            : `${asking} question${asking === 1 ? "" : "s"} will be sent back to previous responders.`}
        </span>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
          <Button type="button" variant="secondary" onClick={onCancel} disabled={saving}>Cancel</Button>
          <Button type="button" variant="primary" loading={saving} onClick={onConfirm}>Save changes</Button>
        </div>
      </div>
    </Modal>
  );
}
