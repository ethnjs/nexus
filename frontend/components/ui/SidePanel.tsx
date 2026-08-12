"use client";

import { ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
          height: "100%", overflowY: "auto",
          boxShadow: "var(--shadow-lg)",
          animation: "sidePanelIn 200ms ease-out",
          position: "relative",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          title="Close"
          style={{
            position: "absolute", top: "16px", right: "16px", zIndex: 1,
            display: "flex", alignItems: "center", justifyContent: "center",
            width: "28px", height: "28px", borderRadius: "var(--radius-md)",
            border: "1px solid var(--color-border)", background: "var(--color-surface)",
            color: "var(--color-text-secondary)", cursor: "pointer",
          }}
        >
          <IconX size={13} />
        </button>
        {children}
      </div>
    </div>,
    document.body
  );
}
