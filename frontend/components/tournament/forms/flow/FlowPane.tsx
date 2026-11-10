"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";

/** One Form flow view: a scrolling body over a Save/Cancel footer that shows
 *  only while the view has unsaved changes. */
export function FlowPane({
  title,
  actions,
  children,
  dirty,
  saving,
  error,
  lockedReason,
  onSave,
  onCancel,
}: {
  title: ReactNode;
  /** Right side of the title row. */
  actions?: ReactNode;
  children: ReactNode;
  dirty: boolean;
  saving: boolean;
  error?: string;
  lockedReason?: string;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "20px 24px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
            marginBottom: "16px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
            {title}
          </div>
          {actions}
        </div>
        {children}
      </div>
      {(dirty || error) && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
            padding: "12px 24px",
            borderTop: "1px solid var(--color-border)",
            background: "var(--color-surface)",
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: "13px",
              color: error ? "var(--color-danger)" : "var(--color-text-secondary)",
            }}
          >
            {error ?? "You have unsaved changes"}
          </span>
          <div style={{ display: "flex", gap: "8px" }}>
            <Button type="button" variant="secondary" size="sm" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={!dirty || !!lockedReason}
              title={lockedReason}
              loading={saving}
              onClick={onSave}
            >
              Save
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function FlowTitle({ children }: { children: ReactNode }) {
  return (
    <h3
      style={{
        margin: 0,
        fontFamily: "var(--font-serif)",
        fontSize: "20px",
        fontWeight: 400,
        color: "var(--color-text-primary)",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </h3>
  );
}

export function FlowSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section
      style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "24px" }}
    >
      <span
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: "11px",
          fontWeight: 700,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--color-text-tertiary)",
        }}
      >
        {label}
      </span>
      {children}
    </section>
  );
}
