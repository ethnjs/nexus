"use client";

import { useState } from "react";
import { Popover, PopoverProps } from "@/components/ui/Popover";
import { IconChevronDown } from "@/components/ui/Icons";

// Same four looks as Badge's default/pending/confirmed/declined variants —
// restated as CSS vars because a pill draws a solid 1px border where Badge
// uses a translucent one, and it sits inside a chip rather than beside text.
export type PillTone = "default" | "muted" | "success" | "danger";

const TONE_STYLE: Record<PillTone, { background: string; color: string; border: string }> = {
  default: { background: "transparent",              color: "var(--color-text-secondary)", border: "var(--color-border-strong)" },
  // Nothing chosen yet — filled rather than outlined, so it reads as an
  // empty slot asking to be filled instead of as a value.
  muted:   { background: "var(--color-bg)",          color: "var(--color-text-tertiary)",  border: "var(--color-border-strong)" },
  success: { background: "var(--color-success-subtle)", color: "var(--color-success)",     border: "var(--color-success)" },
  danger:  { background: "var(--color-danger-subtle)",  color: "var(--color-danger)",      border: "var(--color-danger)" },
};

type PillMenuProps<T> = Omit<PopoverProps<T>, "trigger" | "onOpenChange"> & {
  /** The pill's own text — what's currently chosen, or a prompt to choose. */
  label: string;
  tone?: PillTone;
};

// A Popover whose trigger is a small pill + chevron, for a menu that lives
// *inside* another control — the status on a track chip, the shift on a day
// chip. A plain pill rather than a bordered Dropdown so it reads as part of
// the chip instead of a boxed control embedded in one, and so the chip keeps
// one fixed height matching its neighbours instead of growing to fit a
// full-size Dropdown's chrome.
export function PillMenu<T>({ label, tone = "default", ...popover }: PillMenuProps<T>) {
  const [open, setOpen] = useState(false);
  const pill = TONE_STYLE[tone];

  return (
    <Popover
      {...popover}
      onOpenChange={setOpen}
      trigger={
        <span style={{
          display: "inline-flex", alignItems: "center", gap: "2px", boxSizing: "border-box",
          padding: "1px 6px", borderRadius: "999px",
          border: `1px solid ${pill.border}`, background: pill.background, color: pill.color,
          fontFamily: "var(--font-sans)", fontSize: "10px", fontWeight: 600,
          cursor: "pointer", whiteSpace: "nowrap",
        }}>
          {label}
          <IconChevronDown size={9} style={{ transition: "transform 150ms ease", transform: open ? "rotate(180deg)" : "rotate(0deg)" }} />
        </span>
      }
    />
  );
}
