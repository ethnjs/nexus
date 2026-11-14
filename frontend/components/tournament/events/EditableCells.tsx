"use client";

import {
  type KeyboardEvent,
  type ReactNode,
  type SyntheticEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/Button";
import { ButtonGroup, type ButtonGroupOption } from "@/components/ui/ButtonGroup";
import { Checkbox } from "@/components/ui/Checkbox";
import { ChecklistPopover } from "@/components/ui/ChecklistPopover";
import { ChipInput, type ChipStatus } from "@/components/ui/ChipInput";
import { DivisionButtonGroup } from "@/components/ui/DivisionButtonGroup";
import { FormPopover } from "@/components/ui/FormPopover";
import { IconPlus } from "@/components/ui/Icons";
import { enterChoice, OptionList, stepActive, suggestionRows } from "@/components/ui/OptionList";
import { PillInput } from "@/components/ui/PillInput";
import type {
  Role,
  TournamentBuilding,
  TournamentDivision,
  TournamentEvent,
  TournamentEventInput,
  TournamentRoom,
  TournamentShift,
} from "@/lib/api";
import { buildingLabel, buildingSubtitle } from "@/lib/buildings";
import {
  chosenStaffing,
  staffingCount,
  staffingGroup,
  staffingKey,
  staffingOptions,
  type TrackStaffing,
  withStaffingCount,
} from "@/lib/eventTrackDetails";
import { focusAdjacentCell } from "@/lib/gridNav";
import { useToast } from "@/lib/useToast";

/** What an editable cell needs from the page. Absent = the table is read-only. */
export interface EventEditContext {
  /** Why this event can't be edited inline right now, or undefined if it can.
   *  Page-wide reasons only — the row adds "open in the panel" itself, so a
   *  focus change doesn't rebuild every column (see EventColumn.render). */
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
  /** The id of the named room in a building, created if it has none by that name. */
  ensureRoom: (buildingId: number, name: string) => Promise<number>;
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

/** Wraps an editable cell's control so its clicks stay in the cell, at the
 *  height its editor needs. `editing` marks it for the table's arrow keys
 *  (see gridNav), which leave an open editor alone. */
export function CellGuard({
  children,
  align = "center",
  editing = false,
}: {
  children: ReactNode;
  align?: "start" | "center";
  editing?: boolean;
}) {
  return (
    <span
      onClick={stop}
      data-editing={editing || undefined}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: align === "start" ? "flex-start" : "center",
        minWidth: 0,
        // The tallest editor (a sm chip field). Reserved at rest too, so
        // opening an editor never grows the row and shifts its text.
        minHeight: "28px",
      }}
    >
      {children}
    </span>
  );
}

/** A locked cell's box: CellGuard's layout, so locking a row never changes
 *  its height, but without stopping clicks — a locked cell belongs to the row
 *  (Select mode toggles through it). */
export function LockedCell({
  title,
  align = "center",
  children,
}: {
  title?: string;
  align?: "start" | "center";
  children: ReactNode;
}) {
  return (
    <span
      title={title}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: align === "start" ? "flex-start" : "center",
        minWidth: 0,
        minHeight: "28px",
        cursor: "not-allowed",
      }}
    >
      {children}
    </span>
  );
}

/** A failed save goes to a toast: text under a cell would overlap the next
 *  row. The editor stays open, so the value can be fixed in place. */
function useErrorToast() {
  const { show } = useToast();
  return useCallback(
    (err: unknown) => show(err instanceof Error ? err.message : "Failed to save", "error"),
    [show],
  );
}

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
  // Stable: a fresh ref callback per render makes React detach and re-attach
  // it on every render of every cell.
  const setRestRef = useCallback((el: HTMLElement | null) => {
    restRef.current = el;
  }, []);

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
      const target = e.target as Node;
      // A press inside the editor that already re-rendered it away, like a
      // suggestion whose pick closed its list. React handles the press first,
      // on this same document, so the row is gone before this check runs.
      if (!target.isConnected) return;
      if (wrapRef.current?.contains(target)) return;
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
    /** Close without moving focus — it has already gone somewhere. */
    close: () => setEditing(false),
    wrapRef,
    /** For the resting control's `ref`. */
    restRef: setRestRef,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        refocus.current = true;
        setEditing(false);
      } else if (e.key === "Tab" && !e.defaultPrevented && wrapRef.current) {
        // Tab leaves the cell (popover and all) for the next one, rather than
        // stepping through the editor's own controls — arrows do that.
        // Moving focus first blurs anything half-typed, which commits it.
        e.preventDefault();
        // Nowhere to go (the table's last cell): stay on this one.
        if (!focusAdjacentCell(wrapRef.current, e.shiftKey)) refocus.current = true;
        setEditing(false);
      }
    },
  };
}

/** The resting face of an editable cell: plain content that is a Tab stop and
 *  opens the editor on click or Enter. It fills the whole cell, so a click on
 *  the empty space beside short text still opens it. */
function RestControl({
  restRef,
  onOpen,
  title,
  cursor = "pointer",
  children,
}: {
  restRef: (el: HTMLElement | null) => void;
  onOpen: () => void;
  title: string;
  cursor?: "pointer" | "text";
  children: ReactNode;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a span to lay out inline in the cell; focusable and keyboard-operable already
    <span
      ref={restRef}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onOpen();
        }
      }}
      title={title}
      style={{
        cursor,
        minWidth: 0,
        flex: 1,
        alignSelf: "stretch",
        display: "flex",
        alignItems: "center",
      }}
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
/** A yes/no field, saved on click. Read-only without `onToggle`. */
export function CheckboxCell({
  checked,
  lockReason,
  onToggle,
}: {
  checked: boolean;
  lockReason?: string;
  onToggle?: (next: boolean) => Promise<void>;
}) {
  const toastError = useErrorToast();
  const [saving, setSaving] = useState(false);
  if (lockReason || !onToggle) {
    return (
      <LockedCell title={lockReason}>
        {/* Inert, so a click reaches the row (Select mode toggles it). */}
        <span style={{ display: "flex", pointerEvents: "none" }}>
          <Checkbox checked={checked} locked onChange={() => {}} />
        </span>
      </LockedCell>
    );
  }
  return (
    <CellGuard>
      <Checkbox
        checked={checked}
        locked={saving}
        onChange={async (next) => {
          setSaving(true);
          try {
            await onToggle(next);
          } catch (err) {
            toastError(err);
          } finally {
            setSaving(false);
          }
        }}
      />
    </CellGuard>
  );
}

export function SelectCell({
  display,
  value,
  options,
  lockReason,
  onPick,
  divisions = false,
  align = "center",
}: {
  display: ReactNode;
  /** "" stands for "none" (e.g. no division) — ButtonGroup values are strings. */
  value: string;
  options: ButtonGroupOption[];
  lockReason?: string;
  onPick: (value: string) => Promise<void>;
  /** Draw the options as a DivisionButtonGroup (A/B/C in their colours). */
  divisions?: boolean;
  align?: "start" | "center";
}) {
  const toastError = useErrorToast();
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const Group = divisions ? DivisionButtonGroup : ButtonGroup;
  // On open, focus lands on the current choice, so Enter keeps it and ←/→
  // move to the others. Stable so it runs once per opening, not per render.
  const selectedIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: focuses the current selection once, when the list mounts
  const focusSelected = useCallback((el: HTMLDivElement | null) => {
    el?.querySelectorAll<HTMLButtonElement>("button")[selectedIndex]?.focus();
  }, []);
  if (lockReason) {
    return (
      <LockedCell title={lockReason} align={align}>
        {display}
      </LockedCell>
    );
  }
  // Focus was on a button inside the popover, which is about to unmount.
  const closeAndRefocus = (close: () => void) => {
    close();
    triggerRef.current?.focus();
  };
  return (
    <CellGuard editing={open} align={align}>
      <FormPopover
        trigger={
          // A Button, so Tab reaches it and Enter/Space open the popover.
          <Button
            ref={triggerRef}
            type="button"
            variant="ghost"
            interactive={false}
            title="Click to change"
            style={{ height: "auto", padding: 0, border: "none", minWidth: 0 }}
          >
            {display}
          </Button>
        }
        onOpenChange={setOpen}
        // Wide enough for every button on one row: roughly a label's text
        // plus a small button's padding and border, the gaps, and the panel's own padding.
        width={
          options.reduce((w, o) => w + o.label.length * 7 + 32, 0) + (options.length - 1) * 8 + 30
        }
        align="left"
      >
        {(close) => (
          <div
            ref={focusSelected}
            style={{ display: "flex", flexDirection: "column", gap: "6px" }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                closeAndRefocus(close);
                return;
              }
              // Tab leaves for the next cell; ←/→ move between the choices.
              if (e.key === "Tab") {
                e.preventDefault();
                close();
                if (triggerRef.current) focusAdjacentCell(triggerRef.current, e.shiftKey);
                return;
              }
              if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
              const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
              const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
              const next =
                buttons[(at + (e.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length];
              if (next) {
                e.preventDefault();
                next.focus();
              }
            }}
          >
            <Group
              options={options}
              value={value}
              locked={saving}
              onChange={async (next) => {
                if (next === value) {
                  closeAndRefocus(close);
                  return;
                }
                setSaving(true);
                try {
                  await onPick(next);
                  closeAndRefocus(close);
                } catch (err) {
                  toastError(err);
                } finally {
                  setSaving(false);
                }
              }}
            />
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
  display,
  selected,
  all,
  getKey,
  getLabel,
  getTooltip,
  getStatus,
  lockReason,
  onAdd,
  onRemove,
  addTitle,
  emptyMessage,
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
  const toastError = useErrorToast();
  const [saving, setSaving] = useState(false);
  const editor = useCellEditor();
  // Opening the cell is opening its checklist — chips alone are one more
  // click from anything you'd want to do. Popover has no open prop, so its
  // trigger is pressed once the editor mounts.
  const addRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (editor.editing) addRef.current?.click();
  }, [editor.editing]);
  if (lockReason) {
    return (
      <LockedCell title={lockReason} align="start">
        {display}
      </LockedCell>
    );
  }

  const byLabel = (label: string) => selected.find((item) => getLabel(item) === label);
  async function run(change: () => Promise<void>) {
    setSaving(true);
    try {
      await change();
    } catch (err) {
      toastError(err);
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
            getChipTooltip={
              getTooltip
                ? (label) => {
                    const item = byLabel(label);
                    return item ? getTooltip(item) : undefined;
                  }
                : undefined
            }
            getChipStatus={
              getStatus
                ? (label) => {
                    const item = byLabel(label);
                    return item ? getStatus(item) : "default";
                  }
                : undefined
            }
            variant="transparent"
            size="sm"
            disableInput
            disabled={saving}
            addButton={
              <ChecklistPopover
                trigger={
                  // Same as the roster's Roles cell add button.
                  <Button
                    ref={addRef}
                    type="button"
                    variant="secondary"
                    size="sm"
                    iconOnly
                    title={addTitle}
                    disabled={saving}
                    style={{ padding: 0, flexShrink: 0 }}
                  >
                    <IconPlus size={14} />
                  </Button>
                }
                items={all}
                getKey={getKey}
                renderLabel={getLabel}
                isSelected={(item) => selected.some((s) => getKey(s) === getKey(item))}
                // Caught here, so the toast is the only report — the popover
                // would otherwise print it inline too. It stays open either way.
                onToggle={(item) =>
                  (selected.some((s) => getKey(s) === getKey(item))
                    ? onRemove(item)
                    : onAdd(item)
                  ).catch(toastError)
                }
                emptyMessage={emptyMessage}
                width={220}
                align="left"
              />
            }
          />
        ) : (
          <RestControl
            restRef={editor.restRef}
            onOpen={editor.open}
            title={`Click to edit — ${addTitle.toLowerCase()}`}
          >
            {display}
          </RestControl>
        )}
      </span>
    </CellGuard>
  );
}

/**
 * One track's location. At rest it's the same one line of text as the locked
 * cell ("RH 110, 210"). Editing, it's one text box: type the building and
 * press Enter or Tab to set it, then keep typing rooms, each added on Enter or
 * Tab. Backspace on an empty box takes the last room off, and with no rooms
 * left it pulls the building back into the box to edit. Tab on an empty box
 * moves on to the next cell. No floor field — the server derives it from the
 * first room ("210" → 2); an override lives in the panel.
 * Locked, it's just the `display`.
 */
export function LocationCell({
  display,
  detail,
  trackId,
  buildings,
  lockReason,
  onSave,
  ensureBuilding,
  ensureRoom,
}: {
  display: ReactNode;
  /** This event's entry for the track, if it has one. */
  detail: { building_id: number | null; room_ids: number[]; rooms: TournamentRoom[] } | undefined;
  trackId: number;
  buildings: TournamentBuilding[];
  lockReason?: string;
  /** Saves this track's location fields; the caller resends every other track. */
  onSave: (updates: { floor?: null; room_ids?: number[] }) => Promise<void>;
  /** Finds or creates the named building on this track. */
  ensureBuilding: (name: string, trackId: number) => Promise<TournamentBuilding>;
  ensureRoom: (buildingId: number, name: string) => Promise<number>;
}) {
  const {
    editing,
    open: openEditor,
    close: closeEditor,
    wrapRef,
    restRef,
    onKeyDown: editorKeys,
  } = useCellEditor();
  const [text, setText] = useState("");
  // The saved building, pulled back into the box by Backspace. Not unset on
  // the server until Enter/Tab commits whatever the box then says.
  const [buildingInBox, setBuildingInBox] = useState(false);
  // A building picked in this edit, held here until a room is added: a
  // building with no room isn't a location, so there is nothing to save yet.
  const [pickedBuildingId, setPickedBuildingId] = useState<number | null | undefined>(undefined);
  const [highlight, setHighlight] = useState(-1);
  const toastError = useErrorToast();
  // Turns the underline red until the next try; the message itself is a toast.
  const [failed, setFailed] = useState(false);
  // Until a building save lands, the box would still read the next keystrokes
  // as a building name — so it pauses (read-only keeps focus; disabled wouldn't).
  const [savingBuilding, setSavingBuilding] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  if (lockReason) {
    return (
      <LockedCell title={lockReason} align="start">
        {display}
      </LockedCell>
    );
  }

  const savedBuildingId = detail?.building_id ?? null;
  const buildingId = pickedBuildingId !== undefined ? pickedBuildingId : savedBuildingId;
  const building = buildings.find((b) => b.id === buildingId);
  const buildingName = building ? buildingLabel(building) : "";
  // Only buildings tagged with this track — the other pairing is a 422.
  const onTrack = buildings.filter((b) => b.track_ids.includes(trackId));
  // The saved rooms belong to the saved building; a newly picked one has none yet.
  const inSavedBuilding = buildingId === savedBuildingId;
  const rooms = inSavedBuilding ? (detail?.rooms ?? []) : [];
  const roomIds = inSavedBuilding ? (detail?.room_ids ?? []) : [];
  const typingBuilding = buildingId === null || buildingInBox;
  const rows =
    editing && typingBuilding
      ? suggestionRows(onTrack.map(buildingLabel), text, undefined, (label) =>
          buildingSubtitle(onTrack, label),
        )
      : { names: [], options: [] };

  function open() {
    setText("");
    setBuildingInBox(false);
    setPickedBuildingId(undefined);
    setHighlight(-1);
    setFailed(false);
    openEditor();
  }

  async function run(change: () => Promise<void>) {
    setFailed(false);
    try {
      await change();
    } catch (err) {
      setFailed(true);
      toastError(err);
    }
  }

  // Enter/Tab: pick the building (an existing name picks it, a new one creates
  // it, an emptied box clears the location) or add a room. Leaving the saved
  // building unplaces the event until a room in the new one is added — the
  // old rooms and floor described a place inside the old one. Returns whether
  // there was anything to commit.
  function commit(picked?: string): boolean {
    if (typingBuilding) {
      const name = (picked ?? text).trim();
      if (!name && !buildingInBox) return false;
      setText("");
      setHighlight(-1);
      setSavingBuilding(true);
      void run(async () => {
        let id: number | null = null;
        if (name) {
          const typed = name.toLowerCase();
          const match = onTrack.find(
            (b) => b.name.toLowerCase() === typed || b.short_name?.toLowerCase() === typed,
          );
          id = match ? match.id : (await ensureBuilding(name, trackId)).id;
        }
        if (id !== savedBuildingId && (detail?.room_ids.length ?? 0) > 0) {
          await onSave({ floor: null, room_ids: [] });
        }
        setPickedBuildingId(id);
        setBuildingInBox(false);
      }).finally(() => setSavingBuilding(false));
      return true;
    }
    const room = text.trim();
    if (!room || buildingId === null) return false;
    setText("");
    void run(async () => {
      const id = await ensureRoom(buildingId, room);
      if (!roomIds.includes(id)) await onSave({ room_ids: [...roomIds, id] });
    });
    return true;
  }

  if (!editing) {
    return (
      <CellGuard align="start">
        <RestControl restRef={restRef} onOpen={open} title="Click to edit location" cursor="text">
          {display}
        </RestControl>
      </CellGuard>
    );
  }

  return (
    <CellGuard align="start" editing>
      <span
        style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0, width: "100%" }}
      >
        <span
          ref={wrapRef}
          onKeyDown={editorKeys}
          // Tab out of an empty box moves focus on; the editor follows it out.
          onBlur={(e) => {
            const to = e.relatedTarget as Node | null;
            if (to && !e.currentTarget.contains(to)) closeEditor();
          }}
          style={{
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "4px 6px",
            minWidth: 0,
            // A shadow, not a border: a border adds a pixel of height, and
            // the text would shift the moment the box opened.
            boxShadow: `inset 0 -1px 0 ${failed ? "var(--color-danger)" : "var(--color-border-strong)"}`,
            fontFamily: "var(--font-sans)",
            fontSize: "13px",
          }}
        >
          {!typingBuilding && (
            <span style={{ color: "var(--color-text-primary)", whiteSpace: "nowrap" }}>
              {buildingName}
            </span>
          )}
          {!typingBuilding &&
            rooms.map((room) => (
              <span
                key={room.id}
                style={{
                  padding: "0 5px",
                  borderRadius: "var(--radius-sm)",
                  whiteSpace: "nowrap",
                  background: "var(--color-accent-subtle)",
                  color: "var(--color-text-secondary)",
                  fontSize: "12px",
                }}
              >
                {room.name}
              </span>
            ))}
          <input
            ref={inputRef}
            value={text}
            aria-label={typingBuilding ? "Building" : "Room"}
            readOnly={savingBuilding}
            placeholder={typingBuilding ? "Building" : "Room"}
            onChange={(e) => {
              setText(e.target.value);
              setHighlight(-1);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" && rows.options.length > 0) {
                e.preventDefault();
                setHighlight((h) => stepActive(rows.options, h, 1));
                return;
              }
              if (e.key === "ArrowUp" && rows.options.length > 0) {
                e.preventDefault();
                setHighlight((h) => stepActive(rows.options, h, -1));
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                // A building: the highlighted row, else the exact/first match
                // for typed text; an empty box picks nothing (clears it).
                const picked = typingBuilding
                  ? enterChoice(rows.names, highlight, text)
                  : undefined;
                // Tab with nothing to commit is a plain Tab: focus moves on.
                if (commit(picked) || e.key === "Enter") e.preventDefault();
                return;
              }
              if (e.key === "Backspace" && text === "" && !typingBuilding) {
                e.preventDefault();
                if (roomIds.length > 0) void run(() => onSave({ room_ids: roomIds.slice(0, -1) }));
                // No rooms left: the building comes back into the box, minus
                // the character this Backspace was for.
                else {
                  setBuildingInBox(true);
                  setText(buildingName.slice(0, -1));
                }
              }
            }}
            style={{
              flex: 1,
              minWidth: "60px",
              padding: 0,
              margin: 0,
              border: "none",
              outline: "none",
              background: "transparent",
              color: "var(--color-text-primary)",
              // Inherited, so the typed text sits on the same line box as the
              // resting text it replaced.
              fontFamily: "var(--font-sans)",
              fontSize: "13px",
              lineHeight: "inherit",
            }}
          />
          {rows.options.length > 0 && (
            <OptionList
              anchorRef={inputRef}
              options={rows.options}
              active={highlight}
              onActiveChange={setHighlight}
              onPick={(i) => {
                commit(rows.names[i] ?? text);
                inputRef.current?.focus();
              }}
            />
          )}
        </span>
      </span>
    </CellGuard>
  );
}

/**
 * One track's staffing: role needs and the any-role 18+ / 21+ rules. At rest
 * it's the normal progress display; clicked, it becomes chips — one per need,
 * × to drop it, the head count in a pill on the chip, and + to add one
 * (starting at 1). Each change saves the track's whole staffing. Locked, it's
 * the read-only `display`.
 */
export function StaffingCell({
  display,
  staffing,
  roles,
  lockReason,
  onSave,
}: {
  display: ReactNode;
  staffing: TrackStaffing;
  /** Every role the tournament offers. */
  roles: Role[];
  lockReason?: string;
  onSave: (staffing: TrackStaffing) => Promise<void>;
}) {
  const editor = useCellEditor();
  const [hovered, setHovered] = useState(false);
  const toastError = useErrorToast();
  const [saving, setSaving] = useState(false);
  // Opening the cell opens its picker (see ChipsCell for why it presses the
  // trigger). After one is added the picker closes and focus goes to its
  // count, since setting it is the next thing to do.
  const addRef = useRef<HTMLButtonElement>(null);
  const [focusLabel, setFocusLabel] = useState<string | null>(null);
  useEffect(() => {
    if (editor.editing) addRef.current?.click();
    else setFocusLabel(null);
  }, [editor.editing]);

  if (lockReason) {
    return (
      <LockedCell title={lockReason} align="start">
        {display}
      </LockedCell>
    );
  }

  async function save(next: TrackStaffing) {
    setSaving(true);
    try {
      await onSave(next);
    } catch (err) {
      toastError(err);
    } finally {
      setSaving(false);
    }
  }

  const options = staffingOptions(roles);
  const chosen = chosenStaffing(staffing, roles);
  const byLabel = (label: string) => chosen.find((o) => o.label === label);

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
            value={chosen.map((o) => o.label)}
            emptyLabel="No staffing"
            // Only removal reaches here (disableInput): drop the needs whose chip is gone.
            onChange={(labels) =>
              void save(
                chosen
                  .filter((o) => !labels.includes(o.label))
                  .reduce((next, o) => withStaffingCount(next, o, null), staffing),
              )
            }
            renderChipTrailing={(label) => {
              const option = byLabel(label);
              return option ? (
                <PillInput
                  value={staffingCount(staffing, option)}
                  label={`${label} needed`}
                  // Set before the save, so the pill mounts already focused.
                  autoFocus={label === focusLabel}
                  disabled={saving}
                  onCommit={(count) => void save(withStaffingCount(staffing, option, count))}
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
                  <Button
                    ref={addRef}
                    type="button"
                    variant="secondary"
                    size="sm"
                    iconOnly
                    title="Add staffing"
                    disabled={saving}
                    style={{ padding: 0, flexShrink: 0 }}
                  >
                    <IconPlus size={14} />
                  </Button>
                }
                items={options}
                getKey={staffingKey}
                renderLabel={(o) => o.label}
                getGroup={staffingGroup}
                isSelected={(o) => chosen.some((c) => staffingKey(c) === staffingKey(o))}
                onToggle={async (o) => {
                  if (chosen.some((c) => staffingKey(c) === staffingKey(o)))
                    return save(withStaffingCount(staffing, o, null));
                  setFocusLabel(o.label);
                  await save(withStaffingCount(staffing, o, 1));
                  addRef.current?.click(); // closes the picker
                }}
                searchable={options.length > 8}
                getSearchText={(o) => o.label}
                emptyMessage="No roles yet."
                width={220}
                align="left"
              />
            }
          />
        ) : (
          <RestControl restRef={editor.restRef} onOpen={editor.open} title="Click to edit staffing">
            {chosen.length > 0 ? (
              display
            ) : (
              // Muted, like the location cell's "No location". The add button
              // only appears on hover, so a resting table reads normally.
              <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span
                  style={{
                    fontFamily: "var(--font-sans)",
                    fontSize: "13px",
                    color: "var(--color-text-tertiary)",
                  }}
                >
                  No staffing
                </span>
                {hovered && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    iconOnly
                    title="Add role"
                    // Not a Tab stop: the cell itself is one, and Enter on it opens the editor.
                    tabIndex={-1}
                    onClick={(e) => {
                      e.stopPropagation();
                      editor.open();
                    }}
                    style={{ padding: 0, flexShrink: 0 }}
                  >
                    <IconPlus size={14} />
                  </Button>
                )}
              </span>
            )}
          </RestControl>
        )}
      </span>
    </CellGuard>
  );
}
