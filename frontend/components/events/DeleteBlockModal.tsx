"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { IconWarning } from "@/components/ui/Icons";
import { TimeBlock } from "@/lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AffectedEvent {
  id:       number;
  name:     string;
  division: string | null;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  block:          TimeBlock;
  affectedEvents: AffectedEvent[];
  onConfirm:      () => Promise<void>;
  onCancel:       () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DeleteBlockModal({ block, affectedEvents, onConfirm, onCancel }: Props) {
  const [deleting, setDeleting] = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  const hasEvents = affectedEvents.length > 0;

  const handleConfirm = async () => {
    setDeleting(true);
    setError(null);
    try {
      await onConfirm();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete block");
      setDeleting(false);
    }
  };

  return (
    <Modal title={`Delete "${block.label}"?`} onClose={onCancel} width={420}>
      {/* Warning banner — only shown when events are affected */}
      {hasEvents && (
        <div
          style={{
            display:      "flex",
            gap:          "10px",
            alignItems:   "flex-start",
            padding:      "12px 14px",
            background:   "var(--color-warning-subtle)",
            border:       "1px solid var(--color-warning)",
            borderRadius: "var(--radius-md)",
            marginBottom: "16px",
          }}
        >
          <IconWarning size={16} style={{ color: "var(--color-warning)", flexShrink: 0, marginTop: "1px" }} />
          <p
            style={{
              fontFamily: "var(--font-sans)",
              fontSize:   "13px",
              color:      "var(--color-text-primary)",
              lineHeight: 1.5,
            }}
          >
            These events will become unscheduled. You can reassign their blocks before deleting.
          </p>
        </div>
      )}

      {/* Affected event list */}
      {hasEvents && (
        <div
          style={{
            border:       "1px solid var(--color-border)",
            borderRadius: "var(--radius-md)",
            overflow:     "hidden",
            marginBottom: "20px",
          }}
        >
          {affectedEvents.map((ev, i) => (
            <div
              key={ev.id}
              style={{
                display:      "flex",
                alignItems:   "center",
                justifyContent: "space-between",
                padding:      "9px 14px",
                borderBottom: i < affectedEvents.length - 1 ? "1px solid var(--color-border)" : "none",
                background:   "var(--color-surface)",
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize:   "13px",
                  color:      "var(--color-text-primary)",
                }}
              >
                {ev.name}
              </span>
              {ev.division && (
                <span
                  style={{
                    fontFamily:   "var(--font-sans)",
                    fontSize:     "11px",
                    fontWeight:   600,
                    color:        "var(--color-text-secondary)",
                    background:   "var(--color-accent-subtle)",
                    borderRadius: "var(--radius-sm)",
                    padding:      "2px 7px",
                  }}
                >
                  Div {ev.division}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* No-events confirmation copy */}
      {!hasEvents && (
        <p
          style={{
            fontFamily:   "var(--font-sans)",
            fontSize:     "13px",
            color:        "var(--color-text-secondary)",
            marginBottom: "20px",
            lineHeight:   1.5,
          }}
        >
          This block has no events assigned. It will be permanently removed.
        </p>
      )}

      {/* API error */}
      {error && (
        <p
          style={{
            fontFamily:   "var(--font-sans)",
            fontSize:     "12px",
            color:        "var(--color-danger)",
            marginBottom: "14px",
          }}
        >
          {error}
        </p>
      )}

      {/* Actions */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
        <Button variant="secondary" size="sm" onClick={onCancel} disabled={deleting}>
          Cancel
        </Button>
        <Button variant="danger" size="sm" onClick={handleConfirm} loading={deleting}>
          {hasEvents ? "Delete anyway" : "Delete"}
        </Button>
      </div>
    </Modal>
  );
}
