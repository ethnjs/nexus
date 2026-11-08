"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Textarea } from "@/components/ui/Textarea";
import { ApiError, buildingsApi, type TournamentBuilding } from "@/lib/api";

const MAX_BUILDING_NAME = 255;
const MAX_ROOM_NAME = 64;

interface ImportGroup {
  name: string;
  existing: TournamentBuilding | null;
  newRooms: string[];
  existingRooms: number;
}

interface ParsedImport {
  groups: ImportGroup[];
  errors: string[];
}

/** Split on a tab (a spreadsheet paste), else a comma, else the first space,
 *  so a building name with spaces needs one of the first two. */
function splitLine(line: string): string[] {
  if (line.includes("\t")) return line.split("\t").map((p) => p.trim());
  if (line.includes(",")) return line.split(",").map((p) => p.trim());
  const space = line.search(/\s/);
  return space < 0 ? [line] : [line.slice(0, space), line.slice(space).trim()];
}

/** "(Back Court)" → "Back Court"; "164 (Lab)" and "(A) or (B)" stay as typed. */
function unwrapParens(room: string): string {
  if (!room.startsWith("(") || !room.endsWith(")")) return room;
  const inner = room.slice(1, -1);
  return /[()]/.test(inner) ? room : inner.trim();
}

/** One building and room per line. Names match existing buildings and rooms
 *  case-insensitively. */
function parseImport(text: string, buildings: TournamentBuilding[]): ParsedImport {
  const groups = new Map<string, ImportGroup>();
  const errors: string[] = [];

  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;
    const [building = "", rawRoom = "", ...rest] = splitLine(line);
    const room = unwrapParens(rawRoom);
    if (index === 0 && building.toLowerCase() === "building" && room.toLowerCase() === "room")
      return;

    const lineNo = index + 1;
    if (!building || !room || rest.some(Boolean)) {
      errors.push(`Line ${lineNo}: expected a building and a room.`);
      return;
    }
    if (building.length > MAX_BUILDING_NAME) {
      errors.push(`Line ${lineNo}: building name is over ${MAX_BUILDING_NAME} characters.`);
      return;
    }
    if (room.length > MAX_ROOM_NAME) {
      errors.push(`Line ${lineNo}: room name is over ${MAX_ROOM_NAME} characters.`);
      return;
    }

    const key = building.toLowerCase();
    let group = groups.get(key);
    if (!group) {
      const existing = buildings.find((b) => b.name.toLowerCase() === key) ?? null;
      group = { name: existing?.name ?? building, existing, newRooms: [], existingRooms: 0 };
      groups.set(key, group);
    }
    const roomKey = room.toLowerCase();
    if (group.newRooms.some((r) => r.toLowerCase() === roomKey)) return;
    if (group.existing?.rooms.some((r) => r.name.toLowerCase() === roomKey)) {
      group.existingRooms += 1;
      return;
    }
    group.newRooms.push(room);
  });

  return { groups: [...groups.values()], errors };
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function ImportRoomsModal({
  tournamentId,
  trackIds,
  buildings,
  onClose,
  onImported,
}: {
  tournamentId: number;
  /** Every competition day — a new building starts on all of them. */
  trackIds: number[];
  /** Every building in the tournament, on any day. */
  buildings: TournamentBuilding[];
  onClose: () => void;
  /** Called with each building created or given rooms, even when a later one fails. */
  onImported: (buildings: TournamentBuilding[]) => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  const { groups, errors } = useMemo(() => parseImport(text, buildings), [text, buildings]);
  const changes = groups.filter((g) => !g.existing || g.newRooms.length > 0);
  const roomCount = changes.reduce((sum, g) => sum + g.newRooms.length, 0);

  async function handleImport() {
    setError(undefined);
    setSaving(true);
    const done: TournamentBuilding[] = [];
    try {
      for (const group of changes) {
        const building =
          group.existing ??
          (await buildingsApi.create(tournamentId, { name: group.name, track_ids: trackIds }));
        const rooms =
          group.newRooms.length > 0
            ? await buildingsApi.addRooms(tournamentId, building.id, group.newRooms)
            : building.rooms;
        done.push({ ...building, rooms });
      }
      onImported(done);
      onClose();
    } catch (err: unknown) {
      onImported(done);
      const message = err instanceof ApiError ? err.message : "Something went wrong. Try again.";
      setError(
        done.length > 0
          ? `${message} ${plural(done.length, "building")} imported before this; re-importing skips them.`
          : message,
      );
      setSaving(false);
    }
  }

  return (
    <Modal title="Import rooms" onClose={onClose} width={520}>
      <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        <Textarea
          label="One building and room per line. Use a comma or tab if the building name has spaces."
          placeholder={"RH 104\nISEB 1310\nScience Library, 1201"}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          font="mono"
          fullWidth
          autoFocus
        />

        {(groups.length > 0 || errors.length > 0) && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "6px",
              maxHeight: "220px",
              overflowY: "auto",
            }}
          >
            {groups.map((group) => (
              <div
                key={group.name.toLowerCase()}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  fontFamily: "var(--font-sans)",
                  fontSize: "13px",
                }}
              >
                <span style={{ fontWeight: 500, color: "var(--color-text-primary)" }}>
                  {group.name}
                </span>
                {!group.existing && <Badge>New building</Badge>}
                <span style={{ color: "var(--color-text-secondary)" }}>
                  {[
                    group.newRooms.length > 0 && plural(group.newRooms.length, "new room"),
                    group.existingRooms > 0 && `${group.existingRooms} already added`,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                </span>
              </div>
            ))}
            {errors.map((message) => (
              <span
                key={message}
                style={{
                  fontFamily: "var(--font-sans)",
                  fontSize: "13px",
                  color: "var(--color-danger)",
                }}
              >
                {message}
              </span>
            ))}
          </div>
        )}

        {error && (
          <span
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: "13px",
              color: "var(--color-danger)",
            }}
          >
            {error}
          </span>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "6px" }}>
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            loading={saving}
            disabled={changes.length === 0 || errors.length > 0}
            title={errors.length > 0 ? "Fix the lines above first" : undefined}
            onClick={handleImport}
          >
            {roomCount > 0 ? `Import ${plural(roomCount, "room")}` : "Import"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
