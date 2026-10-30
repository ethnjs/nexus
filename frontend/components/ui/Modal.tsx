"use client";

import { type ReactNode, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/Button";
import { IconChevronLeft } from "@/components/ui/Icons";
import { useExitAnimation } from "@/lib/useExitAnimation";
import { useIsClient } from "@/lib/useIsClient";

type ModalVariant = "normal" | "danger";

interface ModalProps {
  title?: string;
  onClose: () => void;
  children: ReactNode;
  /** Rendered below the body, separated from it. Not pinned — the overlay
   *  scrolls as a page, so the actions sit at the end of the modal. */
  footer?: ReactNode;
  width?: number;
  closeOnOverlayClick?: boolean;
  variant?: ModalVariant;
  contentStyle?: React.CSSProperties;
  /** Shows a back chevron before the title, for a modal with steps — so the
   *  footer can keep Cancel on every one of them. */
  onBack?: () => void;
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  width = 440,
  closeOnOverlayClick = true,
  variant = "normal",
  contentStyle,
  onBack,
}: ModalProps) {
  // Close on Escape key
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const exitRef = useExitAnimation<HTMLDivElement>();

  const mounted = useIsClient();

  // Only close if both mousedown and mouseup landed on the overlay itself —
  // otherwise dragging a text selection from an input out past the modal
  // edge fires a click on the overlay and closes it mid-selection.
  const mouseDownOnOverlay = useRef(false);

  if (!mounted) return null;

  return createPortal(
    <div
      ref={exitRef}
      className="modal-overlay"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.35)",
        zIndex: 200,
        // The overlay is what scrolls, not the modal's insides: a tall form
        // grows to its natural height and you scroll the page past it, rather
        // than reading it through a window with its own scrollbar.
        overflowY: "auto",
        padding: "16px",
        // `margin: auto` on the child rather than centring here — with
        // alignItems: 'center' an over-tall child overflows *both* ways and
        // its top becomes unreachable.
        display: "flex",
      }}
      onMouseDown={(e) => {
        mouseDownOnOverlay.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (closeOnOverlayClick && mouseDownOnOverlay.current && e.target === e.currentTarget)
          onClose();
      }}
    >
      <div
        className="modal-panel"
        style={{
          background: variant === "danger" ? "var(--color-danger-subtle)" : "var(--color-surface)",
          border:
            variant === "danger"
              ? "2px solid var(--color-danger)"
              : "1px solid var(--color-border)",
          borderRadius: "var(--radius-lg)",
          padding: "28px",
          width,
          maxWidth: "100%",
          // Centred while it fits, pinned to the top once it doesn't — which
          // is what keeps a tall modal's title reachable instead of clipped
          // off the top of the viewport.
          margin: "auto",
          flexShrink: 0,
          boxShadow: "var(--shadow-lg)",
          ...contentStyle,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              marginBottom: "20px",
              // Pulled left by the button's own padding, so the chevron's
              // glyph lines up with the body's edge rather than its box.
              marginLeft: onBack ? "-8px" : undefined,
            }}
          >
            {onBack && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                iconOnly
                title="Back"
                onClick={onBack}
              >
                <IconChevronLeft size={16} />
              </Button>
            )}
            <h2
              style={{
                fontFamily: "var(--font-serif)",
                fontSize: "22px",
                color: variant === "danger" ? "var(--color-danger)" : "var(--color-text-primary)",
                flexShrink: 0,
              }}
            >
              {title}
            </h2>
          </div>
        )}
        {children}
        {footer && <div style={{ paddingTop: "16px" }}>{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
