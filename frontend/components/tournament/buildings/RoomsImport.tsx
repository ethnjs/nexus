"use client";

import { useMemo, useState } from "react";
import {
  ImportFooter,
  ImportHelp,
  ImportPreview,
  ImportPreviewRow,
  TAB,
  useImportHelp,
} from "@/components/tournament/buildings/ImportParts";
import {
  findBuilding,
  MAX_BUILDING_NAME,
  MAX_ROOM_NAME,
  plural,
  splitBuildingRoom,
  splitColumns,
  unwrapParens,
} from "@/components/tournament/buildings/importParsing";
import { Badge } from "@/components/ui/Badge";
import { Textarea } from "@/components/ui/Textarea";
import { ApiError, buildingsApi, type TournamentBuilding } from "@/lib/api";

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

/** One building and room per line. A building matches an existing one by
 *  name or short name, and rooms by name, all case-insensitively. */
function parseImport(text: string, buildings: TournamentBuilding[]): ParsedImport {
  const groups = new Map<string, ImportGroup>();
  const errors: string[] = [];

  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;
    // With no tab or comma, the first word is the building, so a building
    // name with spaces needs one of those.
    const [building = "", rawRoom = "", ...rest] = splitColumns(line) ?? splitBuildingRoom(line);
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

    const existing = findBuilding(buildings, building);
    // By building, so "RH" and "Rowland Hall" lines land in the same group.
    const key = existing ? `id:${existing.id}` : `new:${building.toLowerCase()}`;
    let group = groups.get(key);
    if (!group) {
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

export function RoomsImport({
  tournamentId,
  trackIds,
  buildings,
  onCancel,
  onDone,
  onImported,
}: {
  tournamentId: number;
  /** Every competition day — a new building starts on all of them. */
  trackIds: number[];
  /** Every building in the tournament, on any day. */
  buildings: TournamentBuilding[];
  onCancel: () => void;
  onDone: () => void;
  /** Called with each building created or given rooms, even when a later one fails. */
  onImported: (buildings: TournamentBuilding[]) => void;
}) {
  const [text, setText] = useState("");
  const help = useImportHelp();
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
      onDone();
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

  const rows = groups.map((group) => (
    <ImportPreviewRow key={group.name.toLowerCase()}>
      <span style={{ fontWeight: 500 }}>{group.name}</span>
      {!group.existing && <Badge>New building</Badge>}
      <span style={{ color: "var(--color-text-secondary)" }}>
        {[
          group.newRooms.length > 0 && plural(group.newRooms.length, "new room"),
          group.existingRooms > 0 && `${group.existingRooms} already added`,
        ]
          .filter(Boolean)
          .join(", ")}
      </span>
    </ImportPreviewRow>
  ));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <ImportHelp
        open={help.open}
        onToggle={help.toggle}
        columns={["Building", "Room"]}
        examples={[
          { input: "RH 210", parts: ["RH", "210"] },
          { input: "RH, 210", parts: ["RH", "210"] },
          { input: `Science Library${TAB}1201`, parts: ["Science Library", "1201"] },
        ]}
        notes={[
          "Comma or tab between columns",
          "With neither, the first word is the building",
          "Buildings match by name or short name",
          "Missing buildings are created",
        ]}
      />
      <Textarea
        aria-label="Rooms"
        placeholder={"RH 104\nISEB, 1310\nScience Library\t1201"}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          help.onInput(e.target.value);
        }}
        rows={8}
        font="mono"
        fullWidth
        autoFocus
      />
      <ImportPreview rows={rows} errors={errors} />
      <ImportFooter
        error={error}
        saving={saving}
        disabled={changes.length === 0}
        hasErrors={errors.length > 0}
        label={roomCount > 0 ? `Import ${plural(roomCount, "room")}` : "Import"}
        onCancel={onCancel}
        onImport={handleImport}
      />
    </div>
  );
}
