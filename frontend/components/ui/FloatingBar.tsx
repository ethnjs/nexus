"use client";

import { ReactNode, useLayoutEffect, useRef, useState } from "react";

const REST_OFFSET = 24;
const FOOTPRINT_BUFFER = 16;

interface FloatingBarProps {
  visible: boolean;
  children: ReactNode;
  /** Receives 0 while hidden, otherwise the measured bar footprint. */
  onHeightChange?: (px: number) => void;
}

// Shared fixed-bottom shell for save/submit actions. It measures below the
// viewport first, so the parent reserves bottom space before the next frame
// slides the bar onscreen. This prevents the first visible frame from
// covering the page's last item.
export function FloatingBar({ visible, children, onHeightChange }: FloatingBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const [prepared, setPrepared] = useState(false);

  useLayoutEffect(() => {
    const el = barRef.current;
    if (!el) return;

    let frame = 0;
    if (!visible) {
      onHeightChange?.(0);
      frame = requestAnimationFrame(() => setPrepared(false));
      return () => cancelAnimationFrame(frame);
    }

    const measure = () => onHeightChange?.(el.offsetHeight + REST_OFFSET + FOOTPRINT_BUFFER);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    frame = requestAnimationFrame(() => setPrepared(true));

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      onHeightChange?.(0);
    };
    // Height handlers are often inline page functions. Re-subscribing for
    // each parent render would cleanup with 0, remeasure, and create a
    // feedback loop; visibility is the lifecycle boundary instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  return (
    <div ref={barRef} style={{
      position: "fixed", left: "50%", bottom: visible && prepared ? `${REST_OFFSET}px` : "-160px",
      transform: "translateX(-50%)",
      // A fixed-position containing block (such as DockedPanel) scopes this
      // percentage width automatically, without a caller-specific width prop.
      width: "min(560px, calc(100% - 40px))",
      background: "var(--color-surface)", border: "1px solid var(--color-border)",
      borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)",
      padding: "14px 18px",
      transition: "bottom 0.25s ease",
      zIndex: 60,
    }}>
      {children}
    </div>
  );
}
