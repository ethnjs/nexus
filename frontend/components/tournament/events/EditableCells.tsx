"use client";

import { CSSProperties, KeyboardEvent, ReactNode, SyntheticEvent, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ButtonGroup, type ButtonGroupOption } from "@/components/ui/ButtonGroup";
import { DivisionButtonGroup } from "@/components/ui/DivisionButtonGroup";
import { FormPopover } from "@/components/ui/FormPopover";
import { ChipInput, type ChipStatus } from "@/components/ui/ChipInput";
import { ChecklistPopover } from "@/components/ui/ChecklistPopover";
import { IconPlus } from "@/components/ui/Icons";
import { PillInput } from "@/components/ui/PillInput";
import { enterChoice, OptionList, stepActive, suggestionRows } from "@/components/ui/OptionList";
import { focusAdjacentCell } from "@/lib/gridNav";
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

/** Wraps an editable cell's control so its clicks stay in the cell, at the
 *  height its editor needs. `editing` marks it for the table's arrow keys
 *  (see gridNav), which leave an open editor alone. */
export function CellGuard({ children, align = "center", editing = false }: {
  children: ReactNode; align?: "start" | "center"; editing?: boolean;
}) {
  return (
    <span
      onClick={stop}
      data-editing={editing || undefined}
      style={{
        display: "flex", alignItems: "center", justifyContent: align === "start" ? "flex-start" : "center", minWidth: 0,
        // The tallest editor (a sm chip field). Reserved at rest too, so
        // opening an editor never grows the row and shifts its text.
        minHeight: "28px",
      }}
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
    /** Close without moving focus — it has already gone somewhere. */
    close: () => setEditing(false),
    wrapRef,
    /** For the resting control's `ref`. */
    restRef: (el: HTMLElement | null) => { restRef.current = el; },
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
      style={{ cursor, minWidth: 0, flex: 1, alignSelf: "stretch", display: "flex", alignItems: "center" }}
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
  // On open, focus lands on the current choice, so Enter keeps it and ←/→
  // move to the others. Stable so it runs once per opening, not per render.
  const selectedIndex = Math.max(0, options.findIndex((o) => o.value === value));
  const focusSelected = useCallback((el: HTMLDivElement | null) => {
    el?.querySelectorAll<HTMLButtonElement>("button")[selectedIndex]?.focus();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
            ref={focusSelected}
            style={{ display: "flex", flexDirection: "column", gap: "6px" }}
            onKeyDown={(e) => {
              if (e.key === "Escape") { e.preventDefault(); closeAndRefocus(close); return; }
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
              const next = buttons[(at + (e.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length];
              if (next) { e.preventDefault(); next.focus(); }
            }}
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
  // Opening the cell is opening its checklist — chips alone are one more
  // click from anything you'd want to do. Popover has no open prop, so its
  // trigger is pressed once the editor mounts.
  const addRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (editor.editing) addRef.current?.click();
  }, [editor.editing]);
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
                  <Button ref={addRef} type="button" variant="secondary" size="sm" iconOnly title={addTitle} disabled={saving} style={{ padding: 0, flexShrink: 0 }}>
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
  const { editing, open: openEditor, close: closeEditor, wrapRef, restRef, onKeyDown: editorKeys } = useCellEditor();
  const [text, setText] = useState("");
  // The saved building, pulled back into the box by Backspace. Not unset on
  // the server until Enter/Tab commits whatever the box then says.
  const [buildingInBox, setBuildingInBox] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [error, setError] = useState<string | undefined>(undefined);
  // Until a building save lands, the box would still read the next keystrokes
  // as a building name — so it pauses (read-only keeps focus; disabled wouldn't).
  const [savingBuilding, setSavingBuilding] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  if (lockReason) {
    return <span title={lockReason} style={{ display: "flex", minWidth: 0 }}>{display}</span>;
  }

  const buildingId = detail?.building_id ?? null;
  const buildingName = buildings.find((b) => b.id === buildingId)?.name ?? "";
  // Only buildings tagged with this track — the other pairing is a 422.
  const onTrack = buildings.filter((b) => b.track_ids.includes(trackId));
  const rooms = detail?.rooms ?? [];
  const typingBuilding = buildingId === null || buildingInBox;
  const rows = editing && typingBuilding
    ? suggestionRows(onTrack.map((b) => b.name), text)
    : { names: [], options: [] };

  function open() {
    setText("");
    setBuildingInBox(false);
    setHighlight(-1);
    setError(undefined);
    openEditor();
  }

  async function run(change: () => Promise<void>) {
    setError(undefined);
    try {
      await change();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    }
  }

  // Enter/Tab: set the building (an existing name picks it, a new one creates
  // it, an emptied box clears the location) or add a room. A new building
  // clears the rooms and any floor override — they described a place inside
  // the old one. Returns whether there was anything to commit.
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
          const match = onTrack.find((b) => b.name.toLowerCase() === name.toLowerCase());
          id = match ? match.id : (await ensureBuilding(name, trackId)).id;
        }
        if (id !== buildingId) await onSave({ building_id: id, floor: null, rooms: [] });
        setBuildingInBox(false);
      }).finally(() => setSavingBuilding(false));
      return true;
    }
    const room = text.trim();
    if (!room) return false;
    setText("");
    if (!rooms.includes(room)) void run(() => onSave({ rooms: [...rooms, room] }));
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
      <span style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0, width: "100%" }}>
        <span
          ref={wrapRef}
          onKeyDown={editorKeys}
          // Tab out of an empty box moves focus on; the editor follows it out.
          onBlur={(e) => {
            const to = e.relatedTarget as Node | null;
            if (to && !e.currentTarget.contains(to)) closeEditor();
          }}
          style={{
            display: "flex", alignItems: "center", flexWrap: "wrap", gap: "4px 6px", minWidth: 0,
            // A shadow, not a border: a border adds a pixel of height, and
            // the text would shift the moment the box opened.
            boxShadow: "inset 0 -1px 0 var(--color-border-strong)",
            fontFamily: "var(--font-sans)", fontSize: "13px",
          }}
        >
          {!typingBuilding && <span style={{ color: "var(--color-text-primary)", whiteSpace: "nowrap" }}>{buildingName}</span>}
          {!typingBuilding && rooms.map((room) => (
            <span key={room} style={{
              padding: "0 5px", borderRadius: "var(--radius-sm)", whiteSpace: "nowrap",
              background: "var(--color-accent-subtle)", color: "var(--color-text-secondary)", fontSize: "12px",
            }}>
              {room}
            </span>
          ))}
          <input
            ref={inputRef}
            value={text}
            aria-label={typingBuilding ? "Building" : "Room"}
            readOnly={savingBuilding}
            placeholder={typingBuilding ? "Building" : "Room"}
            onChange={(e) => { setText(e.target.value); setHighlight(-1); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" && rows.options.length > 0) { e.preventDefault(); setHighlight((h) => stepActive(rows.options, h, 1)); return; }
              if (e.key === "ArrowUp" && rows.options.length > 0) { e.preventDefault(); setHighlight((h) => stepActive(rows.options, h, -1)); return; }
              if (e.key === "Enter" || e.key === "Tab") {
                // A building: the highlighted row, else the exact/first match
                // for typed text; an empty box picks nothing (clears it).
                const picked = typingBuilding ? enterChoice(rows.names, highlight, text) : undefined;
                // Tab with nothing to commit is a plain Tab: focus moves on.
                if (commit(picked) || e.key === "Enter") e.preventDefault();
                return;
              }
              if (e.key === "Backspace" && text === "" && !typingBuilding) {
                e.preventDefault();
                if (rooms.length > 0) void run(() => onSave({ rooms: rooms.slice(0, -1) }));
                // No rooms left: the building comes back into the box, minus
                // the character this Backspace was for.
                else { setBuildingInBox(true); setText(buildingName.slice(0, -1)); }
              }
            }}
            style={{
              flex: 1, minWidth: "60px", padding: 0, margin: 0, border: "none", outline: "none",
              background: "transparent", color: "var(--color-text-primary)",
              // Inherited, so the typed text sits on the same line box as the
              // resting text it replaced.
              fontFamily: "var(--font-sans)", fontSize: "13px", lineHeight: "inherit",
            }}
          />
          {rows.options.length > 0 && (
            <OptionList
              anchorRef={inputRef}
              options={rows.options}
              active={highlight}
              onActiveChange={setHighlight}
              onPick={(i) => { commit(rows.names[i] ?? text); inputRef.current?.focus(); }}
            />
          )}
        </span>
        {error && <span style={ERROR_TEXT}>{error}</span>}
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
  // Opening the cell opens its role picker (see ChipsCell for why it presses
  // the trigger). After a role is added the picker closes and focus goes to
  // that role's count, since setting it is the next thing to do.
  const addRef = useRef<HTMLButtonElement>(null);
  const [focusRoleId, setFocusRoleId] = useState<number | null>(null);
  useEffect(() => {
    if (editor.editing) addRef.current?.click();
    else setFocusRoleId(null);
  }, [editor.editing]);

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
                  // Set before the save, so the pill mounts already focused.
                  autoFocus={need.role_id === focusRoleId}
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
                onToggle={async (r) => {
                  if (needs.some((n) => n.role_id === r.id)) return save(current.filter((n) => n.role_id !== r.id));
                  setFocusRoleId(r.id);
                  await save([...current, { role_id: r.id, count: 1 }]);
                  addRef.current?.click(); // closes the picker
                }}
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
                    onClick={(e) => { e.stopPropagation(); editor.open(); }}
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
