"use client";

import { CSSProperties, useState } from "react";
import { Popover, PopoverProps } from "@/components/ui/Popover";
import { IconChevronDown } from "@/components/ui/Icons";

// Same four looks as Badge's default/pending/confirmed/declined variants —
// restated as CSS vars because a pill draws a solid 1px border where Badge
// uses a translucent one, and it sits inside a chip rather than beside text.
export type PillTone = "default" | "muted" | "success" | "danger";
// "sm" is the pill inside a chip or a badge, where it must not outweigh the
// label beside it; "md" is the pill standing on its own in a list row.
export type PillSize = "sm" | "md";

const TONE_STYLE: Record<PillTone, { background: string; color: string; border: string }> = {
  default: { background: "transparent",              color: "var(--color-text-secondary)", border: "var(--color-border-strong)" },
  // Nothing chosen yet — filled rather than outlined, so it reads as an
  // empty slot asking to be filled instead of as a value.
  muted:   { background: "var(--color-bg)",          color: "var(--color-text-tertiary)",  border: "var(--color-border-strong)" },
  success: { background: "var(--color-success-subtle)", color: "var(--color-success)",     border: "var(--color-success)" },
  danger:  { background: "var(--color-danger-subtle)",  color: "var(--color-danger)",      border: "var(--color-danger)" },
};

const SIZE_STYLE: Record<PillSize, { padding: string; fontSize: string; chevron: number }> = {
  sm: { padding: "1px 6px", fontSize: "10px", chevron: 9 },
  md: { padding: "3px 9px", fontSize: "12px", chevron: 10 },
};

function pillStyle(tone: PillTone, size: PillSize): CSSProperties {
  const t = TONE_STYLE[tone];
  const s = SIZE_STYLE[size];
  return {
    display: "inline-flex", alignItems: "center", gap: "2px", boxSizing: "border-box",
    padding: s.padding, borderRadius: "999px",
    border: `1px solid ${t.border}`, background: t.background, color: t.color,
    fontFamily: "var(--font-sans)", fontSize: s.fontSize, fontWeight: 600,
    whiteSpace: "nowrap",
  };
}

/** The pill on its own, with no menu behind it — for a viewer who can see the
 *  value but isn't allowed to change it. */
export function Pill({ label, tone = "default", size = "sm", title }: {
  label: string; tone?: PillTone; size?: PillSize; title?: string;
}) {
  return <span title={title} style={pillStyle(tone, size)}>{label}</span>;
}

type PillMenuProps<T> = Omit<PopoverProps<T>, "trigger"> & {
  /** The pill's own text — what's currently chosen, or a prompt to choose. */
  label: string;
  tone?: PillTone;
  size?: PillSize;
};

// A Popover whose trigger is a small pill + chevron, for a menu that lives
// *inside* another control — the status on a track chip, the shift on a day
// chip. A plain pill rather than a bordered Dropdown so it reads as part of
// the chip instead of a boxed control embedded in one, and so the chip keeps
// one fixed height matching its neighbours instead of growing to fit a
// full-size Dropdown's chrome.
export function PillMenu<T>({ label, tone = "default", size = "sm", onOpenChange, ...popover }: PillMenuProps<T>) {
  const [open, setOpen] = useState(false);

  return (
    <Popover
      {...popover}
      // Chained, not replaced: the chevron needs it too.
      onOpenChange={(next) => { setOpen(next); onOpenChange?.(next); }}
      trigger={
        <span style={{ ...pillStyle(tone, size), cursor: "pointer" }}>
          {label}
          <IconChevronDown size={SIZE_STYLE[size].chevron} style={{ transition: "transform 150ms ease", transform: open ? "rotate(180deg)" : "rotate(0deg)" }} />
        </span>
      }
    />
  );
}
