"use client";

import { ReactNode } from "react";

// Read-only display primitives shared by MemberPanel's tournament sections
// and the profile page's own sections. ProfileFields.tsx is the editable
// counterpart; everything here renders values, never inputs.

// The small-caps label + value block. Pulled out once so every caller stays
// visually identical without hand-copying the label styles.
export function PanelField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div style={{
        fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 600,
        textTransform: "uppercase", letterSpacing: "0.06em",
        color: "var(--color-text-tertiary)", marginBottom: "5px",
      }}>
        {label}
      </div>
      {children}
    </div>
  );
}

// The body text of a field. `muted` is for placeholder text (no data on
// file) rather than a real value.
export function FieldValue({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return (
    <div style={{
      fontFamily: "var(--font-sans)", fontSize: "14px", fontWeight: 500,
      color: muted ? "var(--color-text-tertiary)" : "var(--color-text-primary)",
    }}>
      {children}
    </div>
  );
}

// The common case: one label, one string, a placeholder when it's absent.
export function TextField({ label, value, placeholder = "No info yet" }: {
  label: string;
  value: string | null;
  placeholder?: string;
}) {
  return (
    <PanelField label={label}>
      <FieldValue muted={value === null}>{value ?? placeholder}</FieldValue>
    </PanelField>
  );
}

// A stacked list of values under one label (shifts, lunch selections, ranked
// events, track statuses).
export function FieldList({ children }: { children: ReactNode }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>{children}</div>;
}

// The two-column field row used throughout both panels.
export function FieldGrid({ children }: { children: ReactNode }) {
  return <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>{children}</div>;
}
