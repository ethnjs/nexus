'use client'

import { ValidationIssue } from "@/lib/api";
import { Button } from "@/components/ui/Button";

interface WarningsConfirmModalProps {
  warnings:  ValidationIssue[];
  onConfirm: () => void;
  onCancel:  () => void;
}

export function WarningsConfirmModal({ warnings, onConfirm, onCancel }: WarningsConfirmModalProps) {
  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={onCancel}
    >
      <div
        style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-lg)", padding: "28px", width: 480, maxWidth: "calc(100vw - 32px)", boxShadow: "var(--shadow-lg)", display: "flex", flexDirection: "column", gap: "16px" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h2 style={{ fontFamily: "Georgia, serif", fontSize: "22px", color: "var(--color-text-primary)", marginBottom: "6px" }}>
            Sync with warnings?
          </h2>
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)" }}>
            There are no blocking errors, but the following warnings were found. Review them before syncing.
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "280px", overflowY: "auto" }}>
          {warnings.map((w, i) => (
            <div
              key={i}
              style={{ background: "#FFFBEB", border: "1px solid #FDE047", borderRadius: "var(--radius-sm)", padding: "10px 12px" }}
            >
              {Array.isArray(w.header) ? (
                <p style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--color-text-tertiary)", marginBottom: "4px" }}>
                  {w.header.join(", ")}
                </p>
              ) : w.header ? (
                <p style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--color-text-tertiary)", marginBottom: "4px" }}>
                  {w.header}
                </p>
              ) : null}
              <p style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-primary)", margin: 0 }}>
                {w.message}
              </p>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: "10px" }}>
          <Button variant="secondary" size="md" fullWidth onClick={onCancel}>Go back</Button>
          <Button variant="primary"   size="md" fullWidth onClick={onConfirm}>Sync anyway</Button>
        </div>
      </div>
    </div>
  );
}