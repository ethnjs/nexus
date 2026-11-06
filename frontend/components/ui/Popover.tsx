"use client";

import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { IconLock } from "@/components/ui/Icons";
import { enterIndex, type ListOption, OptionList, stepActive } from "@/components/ui/OptionList";

export interface PopoverProps<T> {
  /** The element that toggles the panel — an icon button, a chip, whatever.
   *  A function form receives the open state, for a trigger that has to
   *  reflect it (a chevron that flips) without keeping its own copy. */
  trigger: ReactNode | ((open: boolean) => ReactNode);
  items: T[];
  getKey: (item: T) => string | number;
  renderLabel: (item: T) => ReactNode;
  /** May throw/reject — the popover shows the error inline and stays open. */
  onSelect: (item: T) => void | Promise<void>;
  emptyMessage?: string;
  width?: number;
  /** Which side of the trigger the panel hangs from. */
  align?: "left" | "right";
  /** Checklist mode: rows render as a checkbox + label (like a picker list), stay open across selections instead of closing after each one. Requires isSelected. */
  checklist?: boolean;
  isSelected?: (item: T) => boolean;
  /** Rows for which this returns true can't be selected (e.g. a role the actor isn't allowed to touch, or a delete blocked by existing data) but stay visible rather than being filtered out. In checklist mode they show a lock icon instead of a checkbox; in list mode they render inert with a tooltip. */
  isDisabled?: (item: T) => boolean;
  /** Tooltip text for a disabled row. Only consulted when isDisabled(item) is true; a falsy return skips the tooltip. */
  disabledReason?: (item: T) => string | undefined;
  /** Fires whenever the panel opens/closes — e.g. to rotate a chevron on the trigger. */
  onOpenChange?: (open: boolean) => void;
  /** Shows a search field at the top of the panel (focused on open) that narrows the rows. Requires getSearchText. For lists long enough that scrolling to find a row is the slow part — a tournament's events, a member's experience. */
  searchable?: boolean;
  /** The text `searchable` matches a row against — usually the same string renderLabel shows. */
  getSearchText?: (item: T) => string;
  /** Rendered above the rows and outside their scroll container — for a control that acts on the list as a whole, e.g. a select-all toggle. */
  header?: ReactNode;
  /** Heads a run of consecutive items sharing this text, as Dropdown's option groups do. Items must already be ordered by group. */
  getGroup?: (item: T) => string;
}

// Generic click-to-open panel of selectable items, anchored to a trigger —
// outside-click closes it. In default "list" mode, selecting an item runs
// onSelect and closes on success (shows the error and stays open on
// failure). In "checklist" mode, rows show a checkbox and the panel stays
// open across selections so multiple items can be toggled in one visit.
// Content-agnostic: callers supply the items, key, label, and select handler.
// The panel itself is OptionList, the list every picker draws.
export function Popover<T>({
  trigger,
  items,
  getKey,
  renderLabel,
  onSelect,
  emptyMessage = "Nothing to show",
  width = 180,
  align = "right",
  checklist = false,
  isSelected,
  isDisabled,
  disabledReason,
  onOpenChange,
  searchable = false,
  getSearchText,
  header,
  getGroup,
}: PopoverProps<T>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pendingKey, setPendingKey] = useState<string | number | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  // The row ↑/↓ have moved to, or the mouse is over, which Enter picks.
  const [active, setActive] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: notifies the parent only when open changes
  useEffect(() => {
    onOpenChange?.(open);
  }, [open]);

  // Each opening starts fresh.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (!open) {
      setQuery("");
      setActive(-1);
      setError(undefined);
    }
  }

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Back to the trigger's own control, so keyboard focus isn't dropped on the
  // page when the panel it was in unmounts.
  function closeToTrigger() {
    setOpen(false);
    triggerRef.current?.querySelector<HTMLElement>("button, [tabindex]")?.focus();
  }

  async function handleSelect(item: T, fromKeyboard = false) {
    setError(undefined);
    setPendingKey(getKey(item));
    try {
      await onSelect(item);
      if (!checklist) {
        if (fromKeyboard) closeToTrigger();
        else setOpen(false);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setPendingKey(null);
    }
  }

  const busy = pendingKey !== null;
  const needle = query.trim().toLowerCase();
  const visibleItems =
    searchable && needle
      ? items.filter((item) => (getSearchText?.(item) ?? "").toLowerCase().includes(needle))
      : items;
  const options: ListOption[] = visibleItems.map((item) => {
    const disabled = isDisabled?.(item) ?? false;
    return {
      key: String(getKey(item)),
      label: renderLabel(item),
      group: getGroup?.(item),
      // Every row waits while one pick is in flight.
      disabled: disabled || busy,
      reason: disabled ? disabledReason?.(item) : undefined,
      ...(checklist && {
        checked: isSelected?.(item) ?? false,
        control: disabled ? (
          <IconLock size={13} style={{ flexShrink: 0, color: "var(--color-text-tertiary)" }} />
        ) : undefined,
      }),
    };
  });

  // Focus is in the panel or its search box, and their keys bubble up to here.
  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (!open) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const dir = e.key === "ArrowDown" ? 1 : -1;
      // Nothing highlighted yet: ↑ starts from the bottom.
      setActive(stepActive(options, active < 0 && dir === -1 ? options.length : active, dir));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const index = enterIndex(options, active);
      if (index >= 0) void handleSelect(visibleItems[index], true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeToTrigger();
    } else if (e.key === "Tab") {
      // Not a way around the panel — arrows are. Tab leaves it: back to the
      // trigger first, so the default Tab carries on from there (a cell
      // further up may take over and move on itself).
      closeToTrigger();
    }
  }

  return (
    <div ref={ref} onKeyDown={handleKeyDown} style={{ position: "relative" }}>
      {/* display: flex so the trigger box is exactly as tall as the trigger
          itself. As a plain block it held the trigger as *inline* content, so
          its height came from a line box — and the strut of that line box is
          sized from the ambient font (body's unitless line-height: 1.5 × the
          inherited font-size, so 21px at 14px). A 19px pill inside a 21px
          line box is baseline-aligned, which puts all 2px of the excess above
          it, and anything centred against that box then sits ~1px low. */}
      <div ref={triggerRef} onClick={() => setOpen((v) => !v)} style={{ display: "flex" }}>
        {typeof trigger === "function" ? trigger(open) : trigger}
      </div>

      {open && (
        // Rendered inside its trigger's subtree, so its clicks bubble there;
        // this lets an ancestor recognise them (see the members Roles cell).
        <div data-popover-panel>
          <OptionList
            anchorRef={triggerRef}
            options={options}
            active={active}
            onActiveChange={setActive}
            onPick={(index) => void handleSelect(visibleItems[index])}
            width={width}
            align={align}
            followAnchor={false}
            reasonAs="tooltip"
            focusOnOpen={!searchable}
            emptyMessage={needle ? "No matches" : emptyMessage}
            header={
              (searchable || header) && (
                <>
                  {searchable && (
                    <input
                      type="text"
                      value={query}
                      onChange={(e) => {
                        setQuery(e.target.value);
                        setActive(-1);
                      }}
                      placeholder="Search..."
                      // Focused on mount: the panel only renders once it's
                      // positioned, so a focus() fired when `open` flips runs
                      // before the input exists.
                      // biome-ignore lint/a11y/noAutofocus: see above
                      autoFocus
                      style={{
                        width: "100%",
                        height: "26px",
                        marginBottom: "6px",
                        padding: "0 8px",
                        boxSizing: "border-box",
                        fontFamily: "var(--font-sans)",
                        fontSize: "12px",
                        color: "var(--color-text-primary)",
                        background: "var(--color-bg)",
                        border: "1px solid var(--color-border)",
                        borderRadius: "var(--radius-sm)",
                        outline: "none",
                      }}
                    />
                  )}
                  {header && <div style={{ marginBottom: "6px" }}>{header}</div>}
                </>
              )
            }
            footer={
              error && (
                <p
                  style={{
                    fontFamily: "var(--font-sans)",
                    fontSize: "12px",
                    color: "var(--color-danger)",
                    padding: "4px 10px 2px",
                    margin: 0,
                  }}
                >
                  {error}
                </p>
              )
            }
          />
        </div>
      )}
    </div>
  );
}
