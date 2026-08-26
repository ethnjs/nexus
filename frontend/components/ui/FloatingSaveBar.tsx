"use client";

import { Button } from "@/components/ui/Button";
import { FloatingBar } from "@/components/ui/FloatingBar";
import { useBlockNavigation } from "@/lib/useUnsavedChanges";

interface FloatingSaveBarProps {
  visible: boolean;
  saving?: boolean;
  error?: string;
  onSave: () => void;
  onCancel: () => void;
  /** Pathname prefix that counts as staying put — links under it navigate freely. */
  stayWithin?: string;
  /** Current measured fixed-bar footprint; callers reserve this as bottom padding. */
  onHeightChange?: (px: number) => void;
}

export function FloatingSaveBar({ visible, saving, error, onSave, onCancel, stayWithin, onHeightChange }: FloatingSaveBarProps) {
  // Wherever this bar is shown for unsaved changes, leaving the page should
  // prompt — no page-specific wiring required.
  useBlockNavigation(visible, stayWithin);

  return (
    <FloatingBar visible={visible} onHeightChange={onHeightChange}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px" }}>
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
    </FloatingBar>
  );
}
