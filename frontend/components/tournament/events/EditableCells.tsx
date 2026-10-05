"use client";

import { CSSProperties, KeyboardEvent, ReactNode, SyntheticEvent, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ButtonGroup, type ButtonGroupOption } from "@/components/ui/ButtonGroup";
import { DivisionButtonGroup } from "@/components/ui/DivisionButtonGroup";
import { FormPopover } from "@/components/ui/FormPopover";
import { ChipInput, type ChipStatus } from "@/components/ui/ChipInput";
import { ChecklistPopover } from "@/components/ui/ChecklistPopover";
import { IconPlus } from "@/components/ui/Icons";
import { PillInput } from "@/components/ui/PillInput";
import { EditableCombobox } from "@/components/ui/EditableText";
import { Role, TournamentBuilding, TournamentDivision, TournamentEvent, TournamentEventInput, TournamentShift } from "@/lib/api";

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
  /** Every role the tournament offers — what a Staffing cell can add. */
  roles: Role[];
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

// A click inside an editable cell is about the cell — it must not reach the
// row, which would open the panel (or toggle the Select box). Keys are left
// to bubble: the row only acts on its own keypresses (see rowActivation), and
// the table's arrow-key navigation needs to hear them.
const stop = (e: SyntheticEvent) => e.stopPropagation();

/** Wraps an editable cell's control so its clicks stay in the cell. `editing`
 *  marks it for the table's arrow keys (see gridNav), which leave an open
 *  editor alone. */
export function CellGuard({ children, align = "center", editing = false }: {
  children: ReactNode; align?: "start" | "center"; editing?: boolean;
}) {
  return (
    <span
      onClick={stop}
      data-editing={editing || undefined}
      style={{ display: "flex", justifyContent: align === "start" ? "flex-start" : "center", minWidth: 0 }}
    >
      {children}
    </span>
  );
}

const ERROR_TEXT: CSSProperties = { fontFamily: "var(--font-sans)", fontSize: "11px", color: "var(--color-danger)" };

/**
 * Rest/edit switching shared by the cells that swap a plain display for an
 * editor (chips, rooms, staffing).
 *
 * Closes on a press outside the editor rather than on blur: a checklist's rows
 * aren't focusable, so picking one would blur the cell and unmount the
 * checklist mid-click. Esc closes too. Closing from the keyboard puts focus
 * back on the resting control, so Tab and the arrow keys carry on from the
 * cell rather than from the top of the page.
 */
function useCellEditor() {
  const [editing, setEditing] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const restRef = useRef<HTMLElement | null>(null);
  const refocus = useRef(false);

  useEffect(() => {
    if (!editing) {
      if (refocus.current) {
        refocus.current = false;
        restRef.current?.focus();
      }
      return;
    }
    // Opening from the keyboard leaves focus on the resting control, which
    // just unmounted — move it into the editor.
    const wrap = wrapRef.current;
    if (wrap && !wrap.contains(document.activeElement)) {
      wrap.querySelector<HTMLElement>("input:not([disabled]), button:not([disabled])")?.focus();
    }
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current?.contains(e.target as Node)) return;
      // Blur first, so a value typed but not yet entered commits before its
      // field unmounts.
      const active = document.activeElement;
      if (active instanceof HTMLElement && wrapRef.current?.contains(active)) active.blur();
      setEditing(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [editing]);

  return {
    editing,
    open: () => setEditing(true),
    wrapRef,
    /** For the resting control's `ref`. */
    restRef: (el: HTMLElement | null) => { restRef.current = el; },
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      refocus.current = true;
      setEditing(false);
    },
  };
}

/** The resting face of an editable cell: plain content that is a Tab stop and
 *  opens the editor on click or Enter. */
function RestControl({ restRef, onOpen, title, cursor = "pointer", children }: {
  restRef: (el: HTMLElement | null) => void;
  onOpen: () => void;
  title: string;
  cursor?: "pointer" | "text";
  children: ReactNode;
}) {
  return (
    <span
      ref={restRef}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onOpen(); } }}
      title={title}
      style={{ cursor, minWidth: 0 }}
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
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const Group = divisions ? DivisionButtonGroup : ButtonGroup;
  if (lockReason) {
    return <span title={lockReason} style={{ display: "flex" }}>{display}</span>;
  }
  // Focus was on a button inside the popover, which is about to unmount.
  const closeAndRefocus = (close: () => void) => {
    close();
    triggerRef.current?.focus();
  };
  return (
    <CellGuard editing={open}>
      <FormPopover
        trigger={
          // A Button, so Tab reaches it and Enter/Space open the popover.
          <Button
            ref={triggerRef}
            type="button" variant="ghost" interactive={false} title="Click to change"
            style={{ height: "auto", padding: 0, border: "none", minWidth: 0 }}
          >
            {display}
          </Button>
        }
        onOpenChange={(next) => { setOpen(next); setError(undefined); }}
        // Wide enough for every button on one row: roughly a label's text
        // plus a small button's padding and border, the gaps, and the panel's own padding.
        width={options.reduce((w, o) => w + o.label.length * 7 + 32, 0) + (options.length - 1) * 8 + 30}
        align="left"
      >
        {(close) => (
          <div
            style={{ display: "flex", flexDirection: "column", gap: "6px" }}
            onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); closeAndRefocus(close); } }}
          >
            <Group
              options={options}
              value={value}
              locked={saving}
              onChange={async (next) => {
                if (next === value) { closeAndRefocus(close); return; }
                setSaving(true);
                try {
                  await onPick(next);
                  closeAndRefocus(close);
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Failed to save");
                } finally {
                  setSaving(false);
                }
              }}
            />
            {error && <span style={ERROR_TEXT}>{error}</span>}
          </div>
        )}
      </FormPopover>
    </CellGuard>
  );
}

/**
 * A multi-value cell. At rest it's the read-only `display` (badges); clicked
 * or Entered, it becomes chips — × on a chip removes it, the + opens a
 * checklist of everything that could be there. Each add/remove saves on its
 * own. Locked, it's just the `display`.
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
  const editor = useCellEditor();
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
    <CellGuard align="start" editing={editor.editing}>
      <span
        ref={editor.wrapRef}
        onKeyDown={editor.onKeyDown}
        style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 }}
      >
        {editor.editing ? (
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
        ) : (
          <RestControl restRef={editor.restRef} onOpen={editor.open} title={`Click to edit — ${addTitle.toLowerCase()}`}>
            {display}
          </RestControl>
        )}
        {error && <span style={ERROR_TEXT}>{error}</span>}
      </span>
    </CellGuard>
  );
}

/**
 * One track's location, edited in place on one line: the building as
 * EditableCombobox (existing names suggested as you type), then the rooms as
 * plain text that turns into chips when clicked. Each saves on its own. No
 * floor field — the server derives it from the first room ("210" → 2); an
 * override lives in the panel. Locked, it's the read-only `display`.
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
  // The rooms editor. Saving a new building opens it, so building then room
  // reads as one gesture.
  const roomsEditor = useCellEditor();
  const [hovered, setHovered] = useState(false);
  const [roomsError, setRoomsError] = useState<string | undefined>(undefined);
  const [savingRooms, setSavingRooms] = useState(false);

  if (lockReason) {
    return <span title={lockReason} style={{ display: "flex", minWidth: 0 }}>{display}</span>;
  }

  const buildingId = detail?.building_id ?? null;
  const buildingName = buildings.find((b) => b.id === buildingId)?.name ?? "";
  // Only buildings tagged with this track — the other pairing is a 422.
  const onTrack = buildings.filter((b) => b.track_ids.includes(trackId));
  const rooms = detail?.rooms ?? [];

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
    if (id !== null) roomsEditor.open();
  }

  async function saveRooms(next: string[]) {
    setSavingRooms(true);
    setRoomsError(undefined);
    try {
      await onSave({ rooms: next });
    } catch (err) {
      setRoomsError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSavingRooms(false);
    }
  }

  return (
    <CellGuard align="start" editing={roomsEditor.editing}>
      <span
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0, width: "100%" }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
          <span style={{ flexShrink: 0 }}>
            <EditableCombobox
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
          {buildingId !== null && (roomsEditor.editing ? (
            <span ref={roomsEditor.wrapRef} onKeyDown={roomsEditor.onKeyDown} style={{ flex: 1, minWidth: 0 }}>
              <ChipInput
                value={rooms}
                onChange={(next) => void saveRooms(next)}
                disabled={savingRooms}
                autoFocus
                variant="transparent"
                size="sm"
                font="mono"
                placeholder="Add room"
                fullWidth
              />
            </span>
          ) : (
            <RestControl restRef={roomsEditor.restRef} onOpen={roomsEditor.open} title="Click to edit rooms" cursor="text">
              <span style={{
                fontFamily: "var(--font-mono)", fontSize: "12px", whiteSpace: "nowrap",
                overflow: "hidden", textOverflow: "ellipsis",
                color: rooms.length > 0 ? "var(--color-text-secondary)" : "var(--color-text-tertiary)",
                // No rooms: the way in only shows on hover, so a resting
                // table reads like any other. Still a Tab stop, so it is
                // never unreachable by keyboard.
                opacity: rooms.length > 0 || hovered ? 1 : 0,
              }}>
                {rooms.length > 0 ? rooms.join(", ") : "Add room"}
              </span>
            </RestControl>
          ))}
        </span>
        {roomsError && <span style={ERROR_TEXT}>{roomsError}</span>}
      </span>
    </CellGuard>
  );
}

/**
 * One track's staffing needs. At rest it's the normal progress display;
 * clicked, it becomes chips — one per role, × to drop it, the head count in a
 * pill on the chip, and + to add a role (starting at 1). Each change saves the
 * track's whole needs list. Locked, it's the read-only `display`.
 */
export function StaffingCell({
  display, needs, roles, lockReason, onSave,
}: {
  display: ReactNode;
  needs: { role_id: number; role_label: string; count: number }[];
  /** Every role the tournament offers. */
  roles: Role[];
  lockReason?: string;
  onSave: (needs: { role_id: number; count: number }[]) => Promise<void>;
}) {
  const editor = useCellEditor();
  const [hovered, setHovered] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  // The empty state's + should land in the role picker, not in an editor
  // whose only content is another +. So it opens the editor and asks it to
  // press its own add button once mounted (Popover has no open prop).
  const addRef = useRef<HTMLButtonElement>(null);
  const [openPicker, setOpenPicker] = useState(false);
  useEffect(() => {
    if (editor.editing && openPicker) {
      addRef.current?.click();
      setOpenPicker(false);
    }
  }, [editor.editing, openPicker]);

  if (lockReason) {
    return <span title={lockReason} style={{ display: "flex", minWidth: 0 }}>{display}</span>;
  }

  async function save(next: { role_id: number; count: number }[]) {
    setSaving(true);
    setError(undefined);
    try {
      await onSave(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  const current = needs.map((n) => ({ role_id: n.role_id, count: n.count }));
  const byLabel = (label: string) => needs.find((n) => n.role_label === label);

  return (
    <CellGuard align="start" editing={editor.editing}>
      <span
        ref={editor.wrapRef}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onKeyDown={editor.onKeyDown}
        style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0, width: "100%" }}
      >
        {editor.editing ? (
          <ChipInput
            value={needs.map((n) => n.role_label)}
            // Only removal reaches here (disableInput): keep the needs whose chip is left.
            onChange={(labels) => void save(
              needs.filter((n) => labels.includes(n.role_label)).map((n) => ({ role_id: n.role_id, count: n.count })),
            )}
            renderChipTrailing={(label) => {
              const need = byLabel(label);
              return need ? (
                <PillInput
                  value={need.count}
                  label={`${label} needed`}
                  disabled={saving}
                  onCommit={(count) => void save(current.map((n) => (n.role_id === need.role_id ? { ...n, count } : n)))}
                />
              ) : null;
            }}
            variant="transparent"
            size="sm"
            disableInput
            disabled={saving}
            addButton={
              <ChecklistPopover
                trigger={
                  <Button ref={addRef} type="button" variant="secondary" size="sm" iconOnly title="Add role" disabled={saving} style={{ padding: 0, flexShrink: 0 }}>
                    <IconPlus size={14} />
                  </Button>
                }
                items={roles}
                getKey={(r) => r.id}
                renderLabel={(r) => r.label}
                isSelected={(r) => needs.some((n) => n.role_id === r.id)}
                onToggle={(r) => save(needs.some((n) => n.role_id === r.id)
                  ? current.filter((n) => n.role_id !== r.id)
                  : [...current, { role_id: r.id, count: 1 }])}
                searchable={roles.length > 8}
                getSearchText={(r) => r.label}
                emptyMessage="No roles yet."
                width={220}
                align="left"
              />
            }
          />
        ) : (
          <RestControl restRef={editor.restRef} onOpen={editor.open} title="Click to edit staffing">
            {needs.length > 0 ? display : (
              // Muted, like the location cell's "No location". The add button
              // only appears on hover, so a resting table reads normally.
              <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-tertiary)" }}>
                  No staffing
                </span>
                {hovered && (
                  <Button
                    type="button" variant="secondary" size="sm" iconOnly title="Add role"
                    // Not a Tab stop: the cell itself is one, and Enter on it opens the editor.
                    tabIndex={-1}
                    onClick={(e) => { e.stopPropagation(); editor.open(); setOpenPicker(true); }}
                    style={{ padding: 0, flexShrink: 0 }}
                  >
                    <IconPlus size={14} />
                  </Button>
                )}
              </span>
            )}
          </RestControl>
        )}
        {error && <span style={ERROR_TEXT}>{error}</span>}
      </span>
    </CellGuard>
  );
}
