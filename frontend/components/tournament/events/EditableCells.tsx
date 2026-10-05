"use client";

import { ReactNode, SyntheticEvent, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ButtonGroup, type ButtonGroupOption } from "@/components/ui/ButtonGroup";
import { DivisionButtonGroup } from "@/components/ui/DivisionButtonGroup";
import { FormPopover } from "@/components/ui/FormPopover";
import { TournamentDivision, TournamentEvent, TournamentEventInput } from "@/lib/api";

/** What an editable cell needs from the page. Absent = the table is read-only. */
export interface EventEditContext {
  /** Why this event can't be edited inline right now, or undefined if it can. */
  lockReason: (event: TournamentEvent) => string | undefined;
  /** Saves one change. Rejects with the server's message, which the cell shows. */
  update: (event: TournamentEvent, patch: Partial<TournamentEventInput>) => Promise<void>;
  /** The tournament's divisions — what the Division cell offers. */
  divisions: TournamentDivision[];
}

// A click or keypress inside an editable cell is about the cell — it must not
// reach the row, which would open the panel (or toggle the Select box).
const stop = (e: SyntheticEvent) => e.stopPropagation();

/** Wraps an editable cell's control so its clicks and keys stay in the cell. */
export function CellGuard({ children, align = "center" }: { children: ReactNode; align?: "start" | "center" }) {
  return (
    <span
      onClick={stop}
      onKeyDown={stop}
      style={{ display: "flex", justifyContent: align === "start" ? "flex-start" : "center", minWidth: 0 }}
    >
      {children}
    </span>
  );
}

/**
 * A single-value cell edited from a button group in a popover: the resting
 * display (a badge) is the trigger. Picking saves and closes; a failure shows
 * under the buttons and the popover stays open. Locked, it's the plain
 * display with the reason on hover.
 */
export function SelectCell({
  display, value, options, lockReason, onPick, divisions = false,
}: {
  display: ReactNode;
  /** "" stands for "none" (e.g. no division) — ButtonGroup values are strings. */
  value: string;
  options: ButtonGroupOption[];
  lockReason?: string;
  onPick: (value: string) => Promise<void>;
  /** Draw the options as a DivisionButtonGroup (A/B/C in their colours). */
  divisions?: boolean;
}) {
  const [error, setError] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const Group = divisions ? DivisionButtonGroup : ButtonGroup;
  if (lockReason) {
    return <span title={lockReason} style={{ display: "flex" }}>{display}</span>;
  }
  return (
    <CellGuard>
      <FormPopover
        trigger={
          // A Button, so Tab reaches it and Enter/Space open the popover.
          <Button
            type="button" variant="ghost" interactive={false} title="Click to change"
            style={{ height: "auto", padding: 0, border: "none", minWidth: 0 }}
          >
            {display}
          </Button>
        }
        onOpenChange={() => setError(undefined)}
        // Wide enough for every button on one row: roughly a label's text
        // plus a small button's padding and border, the gaps, and the panel's own padding.
        width={options.reduce((w, o) => w + o.label.length * 7 + 32, 0) + (options.length - 1) * 8 + 30}
        align="left"
      >
        {(close) => (
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <Group
              options={options}
              value={value}
              locked={saving}
              onChange={async (next) => {
                if (next === value) { close(); return; }
                setSaving(true);
                try {
                  await onPick(next);
                  close();
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Failed to save");
                } finally {
                  setSaving(false);
                }
              }}
            />
            {error && (
              <span style={{ fontFamily: "var(--font-sans)", fontSize: "11px", color: "var(--color-danger)" }}>{error}</span>
            )}
          </div>
        )}
      </FormPopover>
    </CellGuard>
  );
}
