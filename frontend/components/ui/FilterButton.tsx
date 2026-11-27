"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { MenuHeading, MenuItem, MenuNote } from "@/components/ui/DrillMenu";
import { SavedFilterNameForm, savedFilterMatching } from "@/components/ui/FilterBuilderModal";
import { IconCheck, IconFilter, IconX } from "@/components/ui/Icons";
import { SplitButton } from "@/components/ui/SplitButton";
import type { FilterGroup } from "@/lib/api";
import type { SavedFilters } from "@/lib/filters/useSavedFilters";

interface FilterButtonProps {
  /** Filter rows narrowing the list; shown as a badge. */
  count: number;
  /** Opens the page's filter modal. */
  onOpen: () => void;
  /** Drops every filter at once — or, on a surface with defaults of its own,
   *  puts them back. */
  onClear: () => void;
  /** The viewer's saved filters; given, the caret lists them. */
  saved?: SavedFilters;
  /** The applied filter, to mark the saved one in use and to save it. */
  applied?: FilterGroup;
  /** Applies a saved filter picked from the caret. */
  onApplySaved?: (filter: FilterGroup) => void;
  /** Opens the modal on F, for the page's main table. */
  hotkey?: boolean;
  size?: "sm" | "md";
  /** Funnel only, no label — for a panel header. The label becomes the
   *  tooltip, so it still says what it filters. */
  iconOnly?: boolean;
  /** Tooltip / accessible name when iconOnly. */
  label?: string;
}

function CountBadge({ count }: { count: number }) {
  return (
    <span
      style={{
        marginLeft: "6px",
        minWidth: "18px",
        padding: "0 5px",
        borderRadius: "999px",
        fontFamily: "var(--font-sans)",
        fontSize: "11px",
        lineHeight: "18px",
        textAlign: "center",
        background: "rgba(255,255,255,0.2)",
      }}
    >
      {count}
    </span>
  );
}

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

/**
 * The toolbar's Filters control: the main segment opens the filter modal and
 * counts what's applied; the caret lists saved filters, saves the current
 * one, and clears.
 */
export function FilterButton({
  count,
  onOpen,
  onClear,
  saved,
  applied,
  onApplySaved,
  hotkey = false,
  size = "md",
  iconOnly = false,
  label = "Filters",
}: FilterButtonProps) {
  const [naming, setNaming] = useState(false);
  const icon = <IconFilter size={size === "sm" ? 14 : 16} />;
  const active = count > 0;
  const inUse = saved && applied ? savedFilterMatching(saved.items, applied) : undefined;

  useEffect(() => {
    if (!hotkey) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "f" || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (document.querySelector(".modal-overlay")) return;
      e.preventDefault();
      onOpen();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [hotkey, onOpen]);

  if (!saved) {
    if (!active) {
      return (
        <Button
          type="button"
          variant="secondary"
          size={size}
          iconOnly={iconOnly}
          title={iconOnly ? label : undefined}
          aria-label={iconOnly ? label : undefined}
          onClick={onOpen}
          style={{ flexShrink: 0 }}
        >
          {icon}
          {iconOnly ? null : ` ${label}`}
        </Button>
      );
    }
    return (
      <SplitButton
        variant="primary"
        size={size}
        icon={icon}
        label={label}
        iconOnly={iconOnly}
        badge={iconOnly ? undefined : <CountBadge count={count} />}
        onClick={onOpen}
        action={{
          icon: <IconX size={size === "sm" ? 12 : 14} />,
          label: "Clear filters",
          onClick: onClear,
        }}
      />
    );
  }

  return (
    <SplitButton
      variant={active ? "primary" : "secondary"}
      size={size}
      icon={icon}
      label={label}
      iconOnly={iconOnly}
      badge={active && !iconOnly ? <CountBadge count={count} /> : undefined}
      onClick={onOpen}
      menu={{
        width: 260,
        onOpenChange: (open) => !open && setNaming(false),
        render: (close) => (
          <div style={{ padding: "4px" }}>
            <MenuHeading>Saved</MenuHeading>
            {saved.items.length === 0 && <MenuNote>Nothing saved yet.</MenuNote>}
            {saved.items.map((item) => (
              <MenuItem
                key={item.id}
                onClick={() => {
                  onApplySaved?.(item.filter);
                  close();
                }}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                  <span style={{ width: "13px", display: "inline-flex" }}>
                    {inUse?.id === item.id && <IconCheck size={13} />}
                  </span>
                  {item.name}
                </span>
              </MenuItem>
            ))}
            {(active || naming) && (
              <div style={{ borderTop: "1px solid var(--color-border)", margin: "4px 0" }} />
            )}
            {naming && applied ? (
              <SavedFilterNameForm
                onSubmit={(name) => saved.create(name, applied)}
                onDone={close}
              />
            ) : (
              active &&
              !inUse && <MenuItem onClick={() => setNaming(true)}>Save current filters…</MenuItem>
            )}
            {active && (
              <MenuItem
                onClick={() => {
                  onClear();
                  close();
                }}
              >
                Clear filters
              </MenuItem>
            )}
          </div>
        ),
      }}
    />
  );
}
