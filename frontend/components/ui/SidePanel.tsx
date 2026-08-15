"use client";

import { ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/Button";
import { IconX } from "@/components/ui/Icons";

interface SidePanelProps {
  onClose: () => void;
  children: ReactNode;
  width?: number;
  /**
   * Rendered below the scrollable content, e.g. a FloatingSaveBar — scoped
   * to this panel's box (via a containing-block trick) so it centers on
   * the panel instead of the viewport. Deliberately narrow: only this slot
   * gets scoped, not all of `children` — anything else position:fixed
   * inside `children` (a Popover, a Modal) still needs real viewport
   * coordinates, since its own position math (getBoundingClientRect) is
   * viewport-relative and would land off-screen if it inherited this
   * panel's box as its containing block too.
   */
  footer?: ReactNode;
}

// Right-anchored slide-in panel — same overlay/escape/portal pattern as
// Modal, but docked to the viewport edge instead of centered, for content
// that's read alongside the page rather than blocking it (e.g. a member's
// full profile while the roster stays visible).
export function SidePanel({ onClose, children, width = 480, footer }: SidePanelProps) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const mouseDownOnOverlay = useRef(false);

  if (!mounted) return null;

  return createPortal(
    <div
      style={{
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,0.35)",
        zIndex: 200,
        display: "flex", justifyContent: "flex-end",
      }}
      onMouseDown={(e) => { mouseDownOnOverlay.current = e.target === e.currentTarget; }}
      onClick={(e) => {
        if (mouseDownOnOverlay.current && e.target === e.currentTarget) onClose();
      }}
    >
      <style>{`
        @keyframes sidePanelIn {
          from { transform: translateX(100%); }
          to   { transform: translateX(0); }
        }
      `}</style>
      <div
        style={{
          background: "var(--color-bg)",
          borderLeft: "1px solid var(--color-border)",
          width, maxWidth: "calc(100vw - 32px)",
          height: "100%",
          display: "flex", flexDirection: "column",
          boxShadow: "var(--shadow-lg)",
          animation: "sidePanelIn 200ms ease-out",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{
          display: "flex", justifyContent: "flex-end", flexShrink: 0,
          padding: "12px", borderBottom: "1px solid var(--color-border)",
        }}>
          <Button type="button" variant="secondary" size="sm" iconOnly onClick={onClose} title="Close">
            <IconX size={13} />
          </Button>
        </div>
        <div style={{ flex: 1, overflowY: "auto" }}>
          {children}
        </div>
        {footer && (
          // Only this slot gets the containing-block trick — see the prop
          // doc above for why it can't be the whole panel.
          <div style={{ willChange: "transform" }}>
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
