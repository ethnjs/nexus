"use client";

import {
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type Ref,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { CheckboxRow } from "@/components/ui/CheckboxRow";
import { IconCheck } from "@/components/ui/Icons";

/**
 * The floating list every picker in the app draws: Dropdown's panel,
 * Combobox's matches, Popover's menus, and the suggestions under an inline
 * field (EditableCombobox, the events table's location box). One component
 * so they look, position and behave the same.
 *
 * Position: fixed off the anchor's rect (so no scrolling table, popover or
 * panel can clip it), flipped above when there's more room there, and capped
 * to the room on that side.
 *
 * The caller owns the keys and the highlighted index (see stepActive) — the
 * focus is in its trigger or field, or in the panel itself (`focusOnOpen`),
 * whose key events bubble to the caller. Rows pick on mousedown with
 * preventDefault, so picking never blurs that field first.
 */

export interface ListOption {
  key: string;
  label: ReactNode;
  /** A second, smaller line under the label. */
  subtitle?: ReactNode;
  /** Rendered after the label, e.g. a "Removed" marker. */
  badge?: ReactNode;
  disabled?: boolean;
  /** Why a disabled row is disabled — see `reasonAs`. */
  reason?: string;
  /** Ticked: the current value. */
  selected?: boolean;
  /** Set on a checklist row: a checkbox before the label, and a filled row
   *  when ticked — so the highlight is an outline there instead. */
  checked?: boolean;
  /** Replaces a checklist row's checkbox — e.g. a lock on one that can't be toggled. */
  control?: ReactNode;
  /** Starts a new group under this heading (Dropdown's option groups). */
  group?: string;
  /** Muted text, for a row that isn't one of the options — "Use “…”". */
  muted?: boolean;
}

const PANEL_MAX_HEIGHT = 260;
const PANEL_GAP = 4;
// Kept clear between the panel and the viewport edge.
const VIEWPORT_MARGIN = 8;

const SIZES = {
  sm: { padding: "5px 8px", fontSize: "13px" },
  md: { padding: "7px 10px", fontSize: "14px" },
} as const;

/** The next enabled index from `active` in `dir`, or `active` if there is none. */
export function stepActive(options: readonly ListOption[], active: number, dir: 1 | -1): number {
  let next = active + dir;
  while (next >= 0 && next < options.length && options[next].disabled) next += dir;
  return next >= 0 && next < options.length ? next : active;
}

/** The index Enter should pick: the highlighted row, else the first enabled one. */
export function enterIndex(options: readonly ListOption[], active: number): number {
  if (active >= 0 && !options[active]?.disabled) return active;
  return options.findIndex((o) => !o.disabled);
}

/**
 * A free-text combobox's rows: the names matching `text`, then "Use “text”"
 * when nothing matches exactly — the way to keep a new value Enter would
 * otherwise fill in as the first match.
 */
export function suggestionRows(
  names: readonly string[],
  text: string,
  max = 8,
): { names: string[]; options: ListOption[] } {
  const needle = text.trim().toLowerCase();
  const matching = names.filter((n) => n.toLowerCase().includes(needle)).slice(0, max);
  const exact = names.some((n) => n.toLowerCase() === needle);
  const options: ListOption[] = matching.map((n) => ({ key: n, label: n }));
  if (needle && !exact)
    options.push({ key: "__custom__", label: `Use “${text.trim()}”`, muted: true });
  return { names: matching, options };
}

/**
 * What Enter commits in a free-text combobox: the highlighted row, else (with
 * something typed) the exact match or the first row — so a partial name fills
 * in. With nothing typed, nothing is picked and the empty text stands.
 * Returns the chosen name, or the typed text for "Use …" or no pick. Row
 * indices past `names` are the "Use …" row.
 */
export function enterChoice(names: readonly string[], active: number, text: string): string {
  const typed = text.trim();
  const index = active >= 0 ? active : typed ? 0 : -1;
  if (index < 0 || index >= names.length) return typed;
  const exact = names.find((n) => n.toLowerCase() === typed.toLowerCase());
  return active < 0 && exact ? exact : names[index];
}

type Pos = { left: number; width: number; maxHeight: number } & (
  | { top: number; bottom?: undefined }
  | { bottom: number; top?: undefined }
);

type HoverTip = { text: string; top: number; left: number };

interface OptionListProps {
  anchorRef: RefObject<HTMLElement | null>;
  options: ListOption[];
  /** Highlighted index, or -1. */
  active: number;
  onActiveChange: (index: number) => void;
  onPick: (index: number) => void;
  size?: "sm" | "md";
  /** At least as wide as the anchor — a field's or trigger's own list. */
  matchWidth?: boolean;
  /** Exactly this wide, instead of sized by the rows. */
  width?: number;
  /** Which edge of the anchor the panel lines up with. */
  align?: "left" | "right";
  /** Re-measured on scroll and on any layout change, since a fixed box
   *  doesn't follow its anchor by itself. Off, it's placed once per opening —
   *  for an anchor that moves as the list is used (a chip input's add button
   *  shifting as chips are added), which would pull rows out from under the
   *  cursor. Window resizes re-place it either way. */
  followAnchor?: boolean;
  /** A disabled row's reason as italic text after its label, or on hover. */
  reasonAs?: "inline" | "tooltip";
  /** The panel takes focus when it appears — for a caller with no field of
   *  its own to keep focus in, which then handles keys bubbling from here. */
  focusOnOpen?: boolean;
  /** Shown when there are no options. Omit and an empty list renders nothing. */
  emptyMessage?: string;
  /** Above the rows, outside their scroll — e.g. a search box. */
  header?: ReactNode;
  /** Below the rows — e.g. Dropdown's "+ New" action. */
  footer?: ReactNode;
  /** The panel element, for a caller's outside-click check. */
  panelRef?: Ref<HTMLDivElement>;
  label?: string;
}

export function OptionList({
  anchorRef,
  options,
  active,
  onActiveChange,
  onPick,
  size = "sm",
  matchWidth = false,
  width,
  align = "left",
  followAnchor = true,
  reasonAs = "inline",
  focusOnOpen = false,
  emptyMessage,
  header,
  footer,
  panelRef,
  label,
}: OptionListProps) {
  const [pos, setPos] = useState<Pos | null>(null);
  const [hoverTip, setHoverTip] = useState<HoverTip | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const rowsRef = useRef<HTMLDivElement>(null);
  const sizing = SIZES[size];

  useLayoutEffect(() => {
    const update = () => {
      const r = anchorRef.current?.getBoundingClientRect();
      if (!r) return;
      const below = window.innerHeight - r.bottom - PANEL_GAP;
      const above = r.top - PANEL_GAP;
      const flip = below < PANEL_MAX_HEIGHT && above > below;
      // Rounded: a panel on a subpixel rasterises every row's checkbox at
      // that same offset phase.
      const left = Math.round(width !== undefined && align === "right" ? r.right - width : r.left);
      const maxHeight = Math.round((flip ? above : below) - VIEWPORT_MARGIN);
      setPos(
        flip
          ? {
              bottom: Math.round(window.innerHeight - r.top + PANEL_GAP),
              left,
              width: r.width,
              maxHeight,
            }
          : { top: Math.round(r.bottom + PANEL_GAP), left, width: r.width, maxHeight },
      );
    };
    update();
    window.addEventListener("resize", update);
    if (!followAnchor) return () => window.removeEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    // The anchor also moves when content above it grows, e.g. a ranked pick adding a row.
    const observer = new ResizeObserver(update);
    observer.observe(document.body);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      observer.disconnect();
    };
  }, [anchorRef, followAnchor, width, align]);

  // Keep the highlighted row on screen. Its wrapper holds any group heading
  // above it, so stepping into a group brings the heading along.
  useEffect(() => {
    if (active < 0) return;
    rowsRef.current
      ?.querySelector<HTMLElement>(`[data-idx="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  // Once, when the panel first appears — it only mounts after it's been
  // positioned. The rows take focus, so their keys bubble out through the panel.
  const placed = pos !== null;
  useEffect(() => {
    if (placed && focusOnOpen) rowsRef.current?.focus({ preventScroll: true });
  }, [placed, focusOnOpen]);

  // Fixed, off the row's own rect: anchored inside the scrolling rows, a
  // tooltip would be clipped by them and drawn under later rows.
  function showHoverTip(e: ReactMouseEvent<HTMLElement>, text: string) {
    const r = e.currentTarget.getBoundingClientRect();
    setHoverTip({ text, top: r.top - 8, left: r.left + r.width / 2 });
  }

  if (!pos || (options.length === 0 && !emptyMessage && !header && !footer)) return null;

  return (
    <div
      ref={panelRef}
      role="listbox"
      aria-label={label}
      // Kept from Dropdown's own panel: some row-click handlers skip clicks
      // that land in a picker's list, and a press here is never an "outside"
      // press to any popover or panel this list sits in.
      data-select-panel="true"
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: "fixed",
        left: pos.left,
        zIndex: 9999,
        ...(pos.top !== undefined ? { top: pos.top } : { bottom: pos.bottom }),
        maxHeight: `${pos.maxHeight}px`,
        ...(width !== undefined
          ? { width: `${width}px` }
          : { minWidth: matchWidth ? pos.width : 160 }),
        display: "flex",
        flexDirection: "column",
        padding: "4px",
        boxSizing: "border-box",
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow-lg)",
      }}
    >
      {header && <div style={{ flexShrink: 0 }}>{header}</div>}
      {/* Shrinks below its cap when the panel is clamped to the viewport. */}
      <div
        ref={rowsRef}
        tabIndex={focusOnOpen ? -1 : undefined}
        style={{
          maxHeight: `${PANEL_MAX_HEIGHT}px`,
          minHeight: 0,
          flex: "0 1 auto",
          overflowY: "auto",
          outline: "none",
        }}
      >
        {options.length === 0 && emptyMessage && (
          <p
            style={{
              padding: sizing.padding,
              fontFamily: "var(--font-sans)",
              fontSize: "13px",
              color: "var(--color-text-tertiary)",
              margin: 0,
            }}
          >
            {emptyMessage}
          </p>
        )}
        {options.map((opt, i) => {
          const newGroup = opt.group !== undefined && opt.group !== options[i - 1]?.group;
          const checklist = opt.checked !== undefined;
          const highlighted = i === active && !opt.disabled;
          const tooltip = reasonAs === "tooltip" ? opt.reason : undefined;
          return (
            <div key={opt.key} data-idx={i}>
              {newGroup && (
                <>
                  {i > 0 && (
                    <div
                      style={{ height: "1px", background: "var(--color-border)", margin: "4px 0" }}
                    />
                  )}
                  <div
                    style={{
                      padding: "5px 10px 3px",
                      fontFamily: "var(--font-mono)",
                      fontSize: "10px",
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.07em",
                      color: "var(--color-text-tertiary)",
                    }}
                  >
                    {opt.group}
                  </div>
                </>
              )}
              {/* biome-ignore lint/a11y/useFocusableInteractive: needs aria-activedescendant; deferred to the accessibility pass */}
              <div
                role="option"
                aria-selected={checklist ? opt.checked : !!opt.selected}
                aria-disabled={opt.disabled}
                // Move, not enter: a list that opens under a still cursor
                // mustn't highlight that row — Enter would then pick it.
                onMouseMove={() => {
                  if (!opt.disabled && i !== active) onActiveChange(i);
                }}
                onMouseEnter={(e) => {
                  setHovered(i);
                  if (tooltip) showHoverTip(e, tooltip);
                }}
                onMouseLeave={() => {
                  setHovered(null);
                  if (tooltip) setHoverTip(null);
                }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (!opt.disabled) onPick(i);
                }}
                title={reasonAs === "inline" ? opt.reason : undefined}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "8px",
                  padding: sizing.padding,
                  borderRadius: "var(--radius-sm)",
                  fontFamily: "var(--font-sans)",
                  fontSize: sizing.fontSize,
                  color:
                    opt.muted || opt.disabled
                      ? "var(--color-text-tertiary)"
                      : "var(--color-text-primary)",
                  background: !checklist
                    ? highlighted
                      ? "var(--color-accent-subtle)"
                      : "transparent"
                    : opt.checked
                      ? "var(--color-accent-subtle)"
                      : hovered === i && !opt.disabled
                        ? "var(--color-bg)"
                        : "transparent",
                  // Only once the arrows have moved off the hovered row — a
                  // mouse user shouldn't see a box around the row they're on.
                  boxShadow:
                    checklist && highlighted && hovered !== i
                      ? "inset 0 0 0 1px var(--color-border-strong)"
                      : undefined,
                  cursor: opt.disabled ? "not-allowed" : "pointer",
                  opacity: opt.disabled ? 0.6 : 1,
                  userSelect: "none",
                  // A panel sized by its rows can't wrap them; a fixed-width one must.
                  whiteSpace: width !== undefined ? "normal" : "nowrap",
                  transition: "background 80ms ease",
                  borderTop: opt.muted && i > 0 ? "1px solid var(--color-border)" : undefined,
                }}
              >
                {checklist ? (
                  // Drawn only — the row picks on mousedown, so a live checkbox
                  // would toggle a second time on the click that follows.
                  <CheckboxRow
                    checked={!!opt.checked}
                    onChange={() => {}}
                    label={opt.label}
                    control={opt.control}
                    fontSize={sizing.fontSize}
                    labelColor="inherit"
                    badge={opt.badge}
                    style={{ pointerEvents: "none", minWidth: 0, overflow: "hidden" }}
                  />
                ) : (
                  <div style={{ overflow: "hidden" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      {opt.label}
                      {opt.badge}
                      {reasonAs === "inline" && opt.reason && (
                        <span style={{ fontSize: "11px", fontStyle: "italic" }}>{opt.reason}</span>
                      )}
                    </div>
                    {opt.subtitle && (
                      <div
                        style={{
                          fontSize: "10px",
                          color: "var(--color-text-tertiary)",
                          marginTop: "2px",
                        }}
                      >
                        {opt.subtitle}
                      </div>
                    )}
                  </div>
                )}
                {opt.selected && <IconCheck size={12} style={{ color: "var(--color-accent)" }} />}
              </div>
            </div>
          );
        })}
      </div>
      {footer}
      {hoverTip && (
        <div
          style={{
            position: "fixed",
            top: hoverTip.top,
            left: hoverTip.left,
            zIndex: 10000,
            transform: "translate(-50%, -100%)",
            maxWidth: "220px",
            padding: "7px 11px",
            borderRadius: "var(--radius-md)",
            background: "var(--color-surface)",
            boxShadow: "var(--shadow-lg)",
            fontFamily: "var(--font-sans)",
            fontSize: "12px",
            color: "var(--color-text-primary)",
            whiteSpace: "normal",
            pointerEvents: "none",
          }}
        >
          {hoverTip.text}
        </div>
      )}
    </div>
  );
}
