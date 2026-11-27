"use client";

import { type ReactNode, useEffect, useId, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/Button";
import { IconChevronLeft, IconX } from "@/components/ui/Icons";
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
  /** An × at the title row's right end — for a large modal with no footer. */
  showClose?: boolean;
  /** Controls on the title row's right end, before the × — e.g. a Display button. */
  headerActions?: ReactNode;
  /** Eases the body's height as its content grows and shrinks. */
  animateHeight?: boolean;
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
  showClose = false,
  headerActions,
  animateHeight = false,
}: ModalProps) {
  const modalId = useId();
  // Close on Escape key
  useEffect(() => {
    // Only the topmost modal answers, so Escape on one opened over another
    // doesn't close both. A closing modal's ghost copy doesn't count.
    function handleKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      const open = document.querySelectorAll<HTMLElement>(".modal-overlay:not(.modal-closing)");
      if (open[open.length - 1]?.dataset.modalId !== modalId) return;
      onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose, modalId]);

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
      data-modal-id={modalId}
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
          background: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-lg)",
          padding: "28px",
          width,
          maxWidth: "100%",
          // Centred while it fits, pinned to the top once it doesn't, so a
          // tall modal's title isn't clipped off the viewport.
          margin: "auto",
          flexShrink: 0,
          boxShadow:
            variant === "danger"
              ? "inset 0 0 28px 6px var(--color-danger-subtle), var(--shadow-lg)"
              : "var(--shadow-lg)",
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
                minWidth: 0,
                overflowWrap: "break-word",
              }}
            >
              {title}
            </h2>
            {(headerActions || showClose) && (
              <div
                style={{ display: "flex", alignItems: "center", gap: "6px", marginLeft: "auto" }}
              >
                {headerActions}
                {showClose && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    iconOnly
                    title="Close"
                    onClick={onClose}
                  >
                    <IconX size={14} />
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
        {animateHeight ? <AutoHeight>{children}</AutoHeight> : children}
        {footer && <div style={{ paddingTop: "16px" }}>{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/**
 * Eases its height to its content's, so rows slide the modal open and shut.
 * Set on the element directly, from the observer, so the new height lands
 * before the frame paints: a state update could let the rows spill over the
 * footer for a frame first.
 */
function AutoHeight({ children }: { children: ReactNode }) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;
    let last = inner.offsetHeight;
    outer.style.height = `${last}px`;
    const observer = new ResizeObserver(() => {
      const next = inner.offsetHeight;
      if (next === last) return;
      last = next;
      // Clipped only while it moves, so the rows' own popovers and hover
      // controls aren't cut off at rest.
      outer.style.overflow = "hidden";
      outer.style.height = `${next}px`;
    });
    observer.observe(inner);
    const settle = (e: TransitionEvent) => {
      if (e.target === outer && e.propertyName === "height") outer.style.overflow = "";
    };
    outer.addEventListener("transitionend", settle);
    return () => {
      observer.disconnect();
      outer.removeEventListener("transitionend", settle);
    };
  }, []);
  return (
    <div ref={outerRef} style={{ transition: "height 200ms cubic-bezier(0.2, 0.8, 0.2, 1)" }}>
      <div ref={innerRef}>{children}</div>
    </div>
  );
}
