"use client";

import { useDroppable } from "@dnd-kit/core";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { EditableText } from "@/components/ui/EditableText";
import { IconPlus, IconTrash } from "@/components/ui/Icons";
import table from "@/components/ui/Table.module.css";
import type { TournamentRoom } from "@/lib/api";
import { roomFloor } from "@/lib/eventTrackDetails";

// The select track animates to zero rather than going away; see Table.module.css.
function roomColumns(selectMode: boolean): string {
  return `${selectMode ? "28px" : "0px"} minmax(72px, 1fr) 56px minmax(0, 3fr) 28px`;
}

const CELL_TEXT = { fontFamily: "var(--font-sans)", fontSize: "14px", fontWeight: 500 } as const;

export function roomDropId(roomId: number): string {
  return `building-room:${roomId}`;
}

export function parseRoomDropId(id: string): number | null {
  if (!id.startsWith("building-room:")) return null;
  const parsed = Number(id.slice("building-room:".length));
  return Number.isFinite(parsed) ? parsed : null;
}

/** A room's row, and where an event card dragged onto it lands. In Select
 *  mode a click anywhere on it toggles its checkbox. */
function RoomRow({
  room,
  dropLabel,
  locked,
  selected,
  onToggleSelect,
  children,
}: {
  room: TournamentRoom;
  dropLabel: string;
  locked: boolean;
  selected: boolean;
  onToggleSelect?: () => void;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: roomDropId(room.id),
    disabled: locked,
    data: { label: dropLabel },
  });
  return (
    <div
      ref={setNodeRef}
      className={`${table.row} ${onToggleSelect ? table.clickable : ""}`}
      data-room-id={room.id}
      data-active={isOver || selected}
      onClick={onToggleSelect}
    >
      {children}
    </div>
  );
}

interface RoomTableProps {
  /** Names the drop target while dragging: "Rowland 210". */
  buildingName: string;
  rooms: TournamentRoom[];
  locked: boolean;
  /** Resolves with the saved room; rejects with a message to show. */
  onAdd: (name: string) => Promise<TournamentRoom>;
  onRename: (room: TournamentRoom, name: string) => Promise<void>;
  onSetFloor: (room: TournamentRoom, floor: string | null) => Promise<void>;
  onDelete: (room: TournamentRoom) => void;
  /** The events cell for one room. */
  renderEvents?: (room: TournamentRoom) => ReactNode;
  /** Shows the checkbox column; everything else in the table is read-only. */
  selectMode?: boolean;
  selectedIds?: ReadonlySet<number>;
  onToggleSelect?: (roomId: number) => void;
  onToggleSelectAll?: (roomIds: number[], checked: boolean) => void;
}

export function RoomTable({
  buildingName,
  rooms,
  locked,
  onAdd,
  onRename,
  onSetFloor,
  onDelete,
  renderEvents,
  selectMode = false,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
}: RoomTableProps) {
  const editLocked = locked || selectMode;
  const containerRef = useRef<HTMLDivElement>(null);

  // Rows keep the order they had when focus came in, so a room renamed or
  // added mid-edit doesn't jump under the cursor; it sorts once focus leaves.
  const [frozenOrder, setFrozenOrder] = useState<number[] | null>(null);
  const shown = frozenOrder
    ? [
        ...frozenOrder.flatMap((id) => rooms.filter((r) => r.id === id)),
        ...rooms.filter((r) => !frozenOrder.includes(r.id)),
      ]
    : rooms;

  // A blank row at the bottom while adding. Enter saves it and lands on the
  // new room's name; Tab saves it and moves right to the room's events;
  // Shift+Enter saves it and opens another. Shift+Enter anywhere else in the
  // table opens one.
  const [adding, setAdding] = useState(false);
  const [blankKey, setBlankKey] = useState(0);
  const lastKey = useRef<string | null>(null);
  const lastShift = useRef(false);
  const [focusTarget, setFocusTarget] = useState<{
    roomId: number;
    cell: "name" | "events";
  } | null>(null);

  // Set while Enter or Tab saves a new room: focus is briefly nowhere then,
  // which mustn't count as leaving the table.
  const savingFromKey = useRef(false);

  async function add(name: string) {
    try {
      const room = await onAdd(name);
      if (savingFromKey.current && lastKey.current === "Enter" && lastShift.current) {
        setBlankKey((k) => k + 1);
        return;
      }
      setAdding(false);
      // A click elsewhere also saves (on blur), but focus stays where it went.
      if (savingFromKey.current) {
        setFocusTarget({ roomId: room.id, cell: lastKey.current === "Tab" ? "events" : "name" });
      }
    } finally {
      savingFromKey.current = false;
    }
  }

  useEffect(() => {
    if (!focusTarget) return;
    const row = containerRef.current?.querySelector(`[data-room-id="${focusTarget.roomId}"]`);
    const target =
      focusTarget.cell === "events"
        ? row?.querySelector<HTMLElement>("[data-add-event]")
        : row?.querySelector<HTMLElement>('[tabindex="0"]');
    target?.focus();
    setFocusTarget(null);
  }, [focusTarget]);

  const hasRows = shown.length > 0 || adding;

  return (
    <div
      ref={containerRef}
      style={{ marginTop: "6px" }}
      onFocus={() => {
        if (!frozenOrder) setFrozenOrder(rooms.map((r) => r.id));
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.shiftKey && !editLocked && !adding) {
          e.preventDefault();
          setAdding(true);
        }
      }}
      onBlur={(e) => {
        if (savingFromKey.current) return;
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFrozenOrder(null);
      }}
    >
      {hasRows && (
        <div
          className={`${table.table} ${table.animatedTracks}`}
          style={{ gridTemplateColumns: roomColumns(selectMode) }}
        >
          {/* Not sticky: the tables stack in a grid, so a pinned header would ride over the next building. */}
          <div className={table.header} style={{ position: "static" }}>
            <span
              className={`${table.collapsible} ${selectMode ? "" : table.collapsed}`}
              style={{ display: "flex", justifyContent: "center" }}
            >
              {/* Unmounted, not just hidden, so Tab doesn't stop on it. */}
              {selectMode && (
                <Checkbox
                  checked={shown.length > 0 && shown.every((r) => selectedIds?.has(r.id))}
                  onChange={(checked) =>
                    onToggleSelectAll?.(
                      shown.map((r) => r.id),
                      checked,
                    )
                  }
                />
              )}
            </span>
            <span>Room</span>
            <span>Floor</span>
            <span>Events</span>
          </div>

          {shown.map((room) => (
            <RoomRow
              key={room.id}
              room={room}
              dropLabel={`${buildingName} ${room.name}`}
              locked={editLocked}
              selected={selectMode && !!selectedIds?.has(room.id)}
              onToggleSelect={selectMode ? () => onToggleSelect?.(room.id) : undefined}
            >
              <span
                className={`${table.collapsible} ${selectMode ? "" : table.collapsed}`}
                style={{ display: "flex", justifyContent: "center" }}
                onClick={(e) => e.stopPropagation()}
              >
                {selectMode && (
                  <Checkbox
                    checked={!!selectedIds?.has(room.id)}
                    onChange={() => onToggleSelect?.(room.id)}
                  />
                )}
              </span>
              <EditableText
                value={room.name}
                onSave={(name) => onRename(room, name)}
                textStyle={CELL_TEXT}
                locked={editLocked}
                title="Rename room"
                errorToast
              />
              {/* Out of the Tab order: Tab goes from a room straight to its events. */}
              <EditableText
                value={room.floor ?? ""}
                placeholder={roomFloor({ name: room.name, floor: null }) ?? "—"}
                onSave={(floor) => onSetFloor(room, floor.trim() || null)}
                textStyle={{ ...CELL_TEXT, fontWeight: 400 }}
                locked={editLocked}
                title="Floor — clear it to use the room number's first digit"
                allowEmpty
                skipTab
                errorToast
              />
              <div style={{ minWidth: 0 }}>{renderEvents?.(room)}</div>
              {!editLocked && (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  iconOnly
                  title="Delete room"
                  tabIndex={-1}
                  onClick={() => onDelete(room)}
                >
                  <IconTrash size={12} style={{ color: "var(--color-danger)" }} />
                </Button>
              )}
            </RoomRow>
          ))}

          {adding && !selectMode && (
            <div
              className={table.row}
              onKeyDownCapture={(e) => {
                lastKey.current = e.key;
                lastShift.current = e.shiftKey;
                const input = e.target instanceof HTMLInputElement ? e.target : null;
                if ((e.key === "Enter" || (e.key === "Tab" && !e.shiftKey)) && input?.value.trim())
                  savingFromKey.current = true;
                // Tab saves through the blur, then add() moves focus to the
                // new room's events, so the browser mustn't move it first.
                if (e.key === "Tab" && !e.shiftKey && input?.value.trim()) {
                  e.preventDefault();
                  input.blur();
                }
              }}
            >
              <span />
              <EditableText
                key={blankKey}
                value=""
                placeholder="Room"
                startEditing
                onSave={add}
                onCancel={() => setAdding(false)}
                textStyle={CELL_TEXT}
                title="New room"
                errorToast
              />
            </div>
          )}
        </div>
      )}

      {!editLocked && !adding && (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => setAdding(true)}
          style={{
            width: "100%",
            marginTop: "8px",
            border: "1px dashed var(--color-border-strong)",
            color: "var(--color-text-secondary)",
          }}
        >
          <IconPlus size={11} /> Add room
        </Button>
      )}
    </div>
  );
}
