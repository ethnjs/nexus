"use client";

import { ReactNode, SyntheticEvent, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ButtonGroup, type ButtonGroupOption } from "@/components/ui/ButtonGroup";
import { DivisionButtonGroup } from "@/components/ui/DivisionButtonGroup";
import { FormPopover } from "@/components/ui/FormPopover";
import { ChipInput, type ChipStatus } from "@/components/ui/ChipInput";
import { ChecklistPopover } from "@/components/ui/ChecklistPopover";
import { IconPlus } from "@/components/ui/Icons";
import { EditableText } from "@/components/ui/EditableText";
import { TournamentBuilding, TournamentDivision, TournamentEvent, TournamentEventInput, TournamentShift } from "@/lib/api";

/** What an editable cell needs from the page. Absent = the table is read-only. */
export interface EventEditContext {
  /** Why this event can't be edited inline right now, or undefined if it can. */
  lockReason: (event: TournamentEvent) => string | undefined;
  /** Saves one change. Rejects with the server's message, which the cell shows. */
  update: (event: TournamentEvent, patch: Partial<TournamentEventInput>) => Promise<void>;
  /** The tournament's divisions — what the Division cell offers. */
  divisions: TournamentDivision[];
  /** Every shift in the tournament — what a per-track Shifts cell offers. */
  shifts: TournamentShift[];
  /** Every building in the tournament — the Location cell narrows to the track. */
  buildings: TournamentBuilding[];
  /** Finds or creates a building by name on a track, keeping the page's list current. */
  ensureBuilding: (name: string, trackId: number) => Promise<TournamentBuilding>;
  /** Asks before a change that takes more with it (a track and its shifts). */
  confirm: (request: ConfirmRequest) => void;
}

export interface ConfirmRequest {
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
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

/**
 * A multi-value cell edited as chips: × on a chip removes it, the + opens a
 * checklist of everything that could be there. Each add/remove saves on its
 * own. Locked, it's the read-only `display`.
 */
export function ChipsCell<T>({
  display, selected, all, getKey, getLabel, getTooltip, getStatus, lockReason, onAdd, onRemove, addTitle, emptyMessage,
}: {
  display: ReactNode;
  selected: T[];
  /** Everything the checklist offers, in the order it should list them. */
  all: T[];
  getKey: (item: T) => number;
  getLabel: (item: T) => string;
  getTooltip?: (item: T) => string | undefined;
  getStatus?: (item: T) => ChipStatus;
  lockReason?: string;
  onAdd: (item: T) => Promise<void>;
  onRemove: (item: T) => Promise<void>;
  addTitle: string;
  emptyMessage: string;
}) {
  const [error, setError] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  if (lockReason) {
    return <span title={lockReason} style={{ display: "flex", minWidth: 0 }}>{display}</span>;
  }

  const byLabel = (label: string) => selected.find((item) => getLabel(item) === label);
  async function run(change: () => Promise<void>) {
    setSaving(true);
    setError(undefined);
    try {
      await change();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <CellGuard align="start">
      <span style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 }}>
        <ChipInput
          value={selected.map(getLabel)}
          onChange={(labels) => {
            const removed = selected.find((item) => !labels.includes(getLabel(item)));
            if (removed) void run(() => onRemove(removed));
          }}
          getChipTooltip={getTooltip ? (label) => { const item = byLabel(label); return item ? getTooltip(item) : undefined; } : undefined}
          getChipStatus={getStatus ? (label) => { const item = byLabel(label); return item ? getStatus(item) : "default"; } : undefined}
          variant="transparent"
          size="sm"
          disableInput
          disabled={saving}
          addButton={
            <ChecklistPopover
              trigger={
                // Same as the roster's Roles cell add button.
                <Button type="button" variant="secondary" size="sm" iconOnly title={addTitle} disabled={saving} style={{ padding: 0, flexShrink: 0 }}>
                  <IconPlus size={14} />
                </Button>
              }
              items={all}
              getKey={getKey}
              renderLabel={getLabel}
              isSelected={(item) => selected.some((s) => getKey(s) === getKey(item))}
              // Popover shows a rejected toggle's error itself and stays open.
              onToggle={(item) => (selected.some((s) => getKey(s) === getKey(item)) ? onRemove(item) : onAdd(item))}
              emptyMessage={emptyMessage}
              width={220}
              align="left"
            />
          }
        />
        {error && (
          <span style={{ fontFamily: "var(--font-sans)", fontSize: "11px", color: "var(--color-danger)" }}>{error}</span>
        )}
      </span>
    </CellGuard>
  );
}

/**
 * One track's location, edited in place on one line: the building as
 * EditableText (existing names suggested as you type), then the rooms as
 * chips. Each saves on its own. No floor field — the server derives it from
 * the first room ("210" → 2); an override lives in the panel.
 * Locked, it's the read-only `display`.
 */
export function LocationCell({
  display, detail, trackId, buildings, lockReason, onSave, ensureBuilding,
}: {
  display: ReactNode;
  /** This event's entry for the track, if it has one. */
  detail: { building_id: number | null; rooms: string[] } | undefined;
  trackId: number;
  buildings: TournamentBuilding[];
  lockReason?: string;
  /** Saves this track's location fields; the caller resends every other track. */
  onSave: (updates: { building_id?: number | null; floor?: null; rooms?: string[] }) => Promise<void>;
  /** Finds or creates the named building on this track. */
  ensureBuilding: (name: string, trackId: number) => Promise<TournamentBuilding>;
}) {
  // Set once a building is saved from here, so the room field that appears
  // next takes focus — building then room reads as one gesture.
  const [focusRooms, setFocusRooms] = useState(false);
  const [roomsError, setRoomsError] = useState<string | undefined>(undefined);
  const [savingRooms, setSavingRooms] = useState(false);

  if (lockReason) {
    return <span title={lockReason} style={{ display: "flex", minWidth: 0 }}>{display}</span>;
  }

  const buildingId = detail?.building_id ?? null;
  const buildingName = buildings.find((b) => b.id === buildingId)?.name ?? "";
  // Only buildings tagged with this track — the other pairing is a 422.
  const onTrack = buildings.filter((b) => b.track_ids.includes(trackId));

  // An existing name picks it, a new one creates the building, and clearing
  // the text removes the location. A new building clears the rooms (and any
  // floor override): they described a place inside the old one. Throws on
  // failure, which EditableText shows under the field.
  async function saveBuilding(name: string) {
    let id: number | null = null;
    if (name) {
      const match = onTrack.find((b) => b.name.toLowerCase() === name.toLowerCase());
      id = match ? match.id : (await ensureBuilding(name, trackId)).id;
    }
    if (id === buildingId) return;
    await onSave({ building_id: id, floor: null, rooms: [] });
    setFocusRooms(id !== null);
  }

  async function saveRooms(rooms: string[]) {
    setSavingRooms(true);
    setRoomsError(undefined);
    try {
      await onSave({ rooms });
    } catch (err) {
      setRoomsError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSavingRooms(false);
    }
  }

  return (
    <CellGuard align="start">
      <span style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0, width: "100%" }}>
        <span style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
          <span style={{ flexShrink: 0 }}>
            <EditableText
              value={buildingName}
              onSave={saveBuilding}
              allowEmpty
              placeholder="No location"
              suggestions={onTrack.map((b) => b.name)}
              title="Click to change building"
              textStyle={{ fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 400, whiteSpace: "nowrap" }}
            />
          </span>
          {/* Rooms only mean something inside a building. */}
          {buildingId !== null && (
            <span style={{ flex: 1, minWidth: 0 }}>
              <ChipInput
                // Remounts when a building lands, so autoFocus fires then.
                key={buildingId}
                value={detail?.rooms ?? []}
                onChange={(rooms) => void saveRooms(rooms)}
                disabled={savingRooms}
                autoFocus={focusRooms}
                variant="transparent"
                size="sm"
                font="mono"
                placeholder="Add room"
                fullWidth
              />
            </span>
          )}
        </span>
        {roomsError && (
          <span style={{ fontFamily: "var(--font-sans)", fontSize: "11px", color: "var(--color-danger)" }}>{roomsError}</span>
        )}
      </span>
    </CellGuard>
  );
}
