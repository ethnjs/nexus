'use client'

import { useLayoutEffect, useRef } from "react"
import { Button } from "@/components/ui/Button"
import { useBlockNavigation } from "@/lib/useUnsavedChanges"

// How far the resting bar sits above the viewport's bottom edge — also the
// gap `onHeightChange` reports on top of the bar's own measured height, so
// a caller's reserved padding actually clears it instead of running flush
// against its top edge.
const REST_OFFSET = 24

interface FloatingSaveBarProps {
  visible: boolean;
  saving?: boolean;
  error?: string;
  onSave: () => void;
  onCancel: () => void;
  /** Pathname prefix that counts as staying put — links under it navigate freely. */
  stayWithin?: string;
  /** Fires with the bar's current footprint (0 when hidden; its real
      rendered height + REST_OFFSET + a little breathing room when visible —
      the error line can wrap and grow the bar, so this isn't a fixed
      number). Callers use it as scroll-container bottom padding so the bar
      never covers content sitting where it lands. Measured via
      ResizeObserver rather than assumed, since the caller has no way to
      know the error text's wrapped height in advance. */
  onHeightChange?: (px: number) => void;
}

export function FloatingSaveBar({ visible, saving, error, onSave, onCancel, stayWithin, onHeightChange }: FloatingSaveBarProps) {
  // Wherever this bar is shown for unsaved changes, leaving the page should
  // prompt — no page-specific wiring required.
  useBlockNavigation(visible, stayWithin);

  const barRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = barRef.current;
    if (!el || !onHeightChange) return;
    const measure = () => onHeightChange(visible ? el.offsetHeight + REST_OFFSET + 16 : 0);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => { observer.disconnect(); onHeightChange(0); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  return (
    <div ref={barRef} style={{
      position: "fixed", left: "50%", bottom: visible ? `${REST_OFFSET}px` : "-80px",
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
