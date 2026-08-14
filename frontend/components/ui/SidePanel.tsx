"use client";

import { ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/Button";
import { IconX } from "@/components/ui/Icons";

interface SidePanelProps {
  onClose: () => void;
  children: ReactNode;
  width?: number;
}

// Right-anchored slide-in panel — same overlay/escape/portal pattern as
// Modal, but docked to the viewport edge instead of centered, for content
// that's read alongside the page rather than blocking it (e.g. a member's
// full profile while the roster stays visible).
export function SidePanel({ onClose, children, width = 480 }: SidePanelProps) {
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
          // Establishes a containing block for any position:fixed descendant
          // (e.g. a FloatingSaveBar rendered inside panel content) so it's
          // scoped to this panel's box instead of centering on the viewport.
          willChange: "transform",
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
      </div>
    </div>,
    document.body
  );
}
