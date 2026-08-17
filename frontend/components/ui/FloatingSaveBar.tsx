'use client'

import { Button } from "@/components/ui/Button"
import { useBlockNavigation } from "@/lib/useUnsavedChanges"

interface FloatingSaveBarProps {
  visible: boolean;
  saving?: boolean;
  error?: string;
  onSave: () => void;
  onCancel: () => void;
  /** Pathname prefix that counts as staying put — links under it navigate freely. */
  stayWithin?: string;
}

export function FloatingSaveBar({ visible, saving, error, onSave, onCancel, stayWithin }: FloatingSaveBarProps) {
  // Wherever this bar is shown for unsaved changes, leaving the page should
  // prompt — no page-specific wiring required.
  useBlockNavigation(visible, stayWithin);

  return (
    <div style={{
      position: "fixed", left: "50%", bottom: visible ? "24px" : "-80px",
      transform: "translateX(-50%)",
      // % resolves against the nearest ancestor that establishes a
      // containing block for fixed-position elements — the viewport by
      // default, but DockedPanel's footer slot claims that role (via
      // will-change: transform) so this shrinks to the panel's own width
      // automatically wherever it's scoped, no per-caller width prop needed.
      width: "min(560px, calc(100% - 40px))",
      background: "var(--color-surface)", border: "1px solid var(--color-border)",
      borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)",
      padding: "14px 18px",
      display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px",
      transition: "bottom 0.25s ease",
      zIndex: 60,
    }}>
      <div>
        <span style={{ fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 600, color: "var(--color-text-primary)" }}>
          You have unsaved changes
        </span>
        {error && (
          <div style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-danger)", marginTop: "2px" }}>
            {error}
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
        <Button type="button" variant="secondary" onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button type="button" variant="primary" onClick={onSave} loading={saving}>Save</Button>
      </div>
    </div>
  );
}
