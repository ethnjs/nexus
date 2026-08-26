"use client";

import { Button } from "@/components/ui/Button";
import { FloatingBar } from "@/components/ui/FloatingBar";

interface FloatingSubmitBarProps {
  visible: boolean;
  /** Count of currently-invalid questions that have already been attempted. */
  invalidCount: number;
  onSubmit: () => void;
  loading?: boolean;
  error?: string;
  /** Shared FloatingBar footprint; FormFillFlow reserves this as bottom padding. */
  onHeightChange?: (px: number) => void;
}

// Submission intentionally remains distinct from save: it has no cancel
// action and uses FormFillFlow's own dirty-navigation guard. Only its fixed
// positioning/measurement shell is shared with FloatingSaveBar.
export function FloatingSubmitBar({ visible, invalidCount, onSubmit, loading = false, error, onHeightChange }: FloatingSubmitBarProps) {
  return (
    <FloatingBar visible={visible} onHeightChange={onHeightChange}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px" }}>
        <div>
          <span style={{ fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 600, color: "var(--color-text-primary)" }}>
            Ready to submit
          </span>
          {invalidCount > 0 && (
            <div style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-danger)", marginTop: "2px" }}>
              {invalidCount} question{invalidCount !== 1 ? "s" : ""} need{invalidCount === 1 ? "s" : ""} your attention.
            </div>
          )}
          {error && (
            <div style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-danger)", marginTop: "2px" }}>
              {error}
            </div>
          )}
        </div>
        <Button type="button" variant="primary" loading={loading} onClick={onSubmit} style={{ flexShrink: 0 }}>Submit</Button>
      </div>
    </FloatingBar>
  );
}
