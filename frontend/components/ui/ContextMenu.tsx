"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DrillMenu, MenuItem } from "@/components/ui/DrillMenu";

export interface ContextMenuItem {
  key: string;
  label: string;
  /** Given, the item is disabled and this shows on hover. */
  disabledReason?: string;
  /** Picking the item slides the menu to these items, with a Back row. */
  submenu?: { title: string; items: ContextMenuItem[] };
  onSelect?: () => void;
}

type Level = { title: string; items: ContextMenuItem[] };

const WIDTH = 240;
// Kept clear between the menu and the viewport edge.
const MARGIN = 8;

/**
 * A right-click menu, opened at the cursor. Render it while open and drop it
 * on `onClose`, which fires on a pick, Escape, an outside press or a scroll.
 *
 * Portalled to the body, so no ancestor clips it. React events still bubble
 * through the component tree, so pointer and context-menu events stop here
 * rather than reaching, say, a draggable the menu was opened from.
 */
export function ContextMenu({
  at,
  items,
  onClose,
}: {
  at: { x: number; y: number };
  items: ContextMenuItem[];
  onClose: () => void;
}) {
  const [stack, setStack] = useState<Level[]>([{ title: "", items }]);
  const panelRef = useRef<HTMLDivElement>(null);

  // Opened at the cursor, then pulled back inside the viewport once its size is known.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const r = panel.getBoundingClientRect();
    const left = Math.max(MARGIN, Math.min(at.x, window.innerWidth - r.width - MARGIN));
    const top =
      at.y + r.height + MARGIN > window.innerHeight ? Math.max(MARGIN, at.y - r.height) : at.y;
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.visibility = "visible";
  }, [at]);

  useEffect(() => {
    function onPress(e: MouseEvent) {
      if (!panelRef.current?.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onPress);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("mousedown", onPress);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={panelRef}
      role="menu"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      style={{
        position: "fixed",
        left: at.x,
        top: at.y,
        visibility: "hidden",
        zIndex: 9999,
        width: `${WIDTH}px`,
        overflow: "hidden",
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow-lg)",
      }}
    >
      <DrillMenu
        stack={stack}
        titleOf={(level) => level.title}
        onBack={() => setStack((s) => s.slice(0, -1))}
        renderLevel={(level) =>
          level.items.map((item) => (
            <MenuItem
              key={item.key}
              chevron={!!item.submenu}
              disabledReason={item.disabledReason}
              onClick={() => {
                if (item.submenu) {
                  const next = item.submenu;
                  setStack((s) => [...s, next]);
                  return;
                }
                onClose();
                item.onSelect?.();
              }}
            >
              {item.label}
            </MenuItem>
          ))
        }
      />
    </div>,
    document.body,
  );
}
