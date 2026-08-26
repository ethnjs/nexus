'use client'

import { useLayoutEffect, useRef } from "react"
import { Button } from "@/components/ui/Button"

// Same resting-offset/height-reporting contract as FloatingSaveBar (see
// components/ui/FloatingSaveBar.tsx) — deliberately not that component
// reused with different copy: a submit flow has no "Cancel" (there's
// nothing to discard back to, answers just stay in local state) and its
// dirty/nav-block condition doesn't line up with this bar's own visibility
// the way FloatingSaveBar's do (see FormFillFlow's own useBlockNavigation
// call), so this stays a separate, purpose-built bar rather than a themed
// FloatingSaveBar variant.
const REST_OFFSET = 24

interface FloatingSubmitBarProps {
  visible: boolean
  /** Count of currently-invalid, already-attempted questions — 0 shows a
      plain "Submit" bar; >0 (only possible after a failed Submit click,
      since nothing is flagged invalid before that) adds an error summary
      line, same idea as FloatingSaveBar's validation error line. */
  invalidCount: number
  onSubmit: () => void
  loading?: boolean
  error?: string
  /** See FloatingSaveBar's own onHeightChange doc — same purpose. */
  onHeightChange?: (px: number) => void
}

export function FloatingSubmitBar({ visible, invalidCount, onSubmit, loading = false, error, onHeightChange }: FloatingSubmitBarProps) {
  const barRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = barRef.current
    if (!el || !onHeightChange) return
    const measure = () => onHeightChange(visible ? el.offsetHeight + REST_OFFSET + 16 : 0)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => { observer.disconnect(); onHeightChange(0) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  return (
    <div ref={barRef} style={{
      position: "fixed", left: "50%", bottom: visible ? `${REST_OFFSET}px` : "-80px",
      transform: "translateX(-50%)",
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
  )
}
