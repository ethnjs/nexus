"use client";

import { ProgressRing } from "@/components/ui/ProgressRing";

export function staffingColor(filled: number, count: number): string {
  return filled >= count
    ? "var(--color-success)"
    : filled > 0
      ? "var(--color-warning)"
      : "var(--color-border-strong)";
}

/** One need's progress on one track: a role's, or an any-role age rule's.
 *  Full label and a plain `#/#`, not an abbreviation — the crowding that
 *  motivated an abbreviated line only happens once several tracks' needs
 *  share one line, and this always renders inside its own track's block.
 *  Same three-state colour as the chip warning border: success once filled,
 *  warning while short, muted at zero. A null `filled` (not known) shows the
 *  count alone. */
export function StaffingNeedLine({
  label,
  count,
  filled,
}: {
  label: string;
  count: number;
  filled: number | null;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
      {filled !== null && (
        <ProgressRing
          completed={filled}
          total={count}
          size={13}
          strokeWidth={16}
          color={staffingColor(filled, count)}
        />
      )}
      <span
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: "11px",
          color: "var(--color-text-secondary)",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "11px",
          color: "var(--color-text-tertiary)",
        }}
      >
        {filled === null ? count : `${filled}/${count}`}
      </span>
    </div>
  );
}
