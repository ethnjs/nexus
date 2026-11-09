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
import {
  ApiError,
  buildingsApi,
  type TournamentBuilding,
  type TournamentEvent,
  type TournamentTrack,
  tournamentEventsApi,
} from "@/lib/api";
import { eventName, eventNameWithDivision, trackLocationLabel } from "@/lib/eventDisplay";
import { trackDetail, withTrackDetail } from "@/lib/eventTrackDetails";

interface PlannedBuilding {
  key: string;
  /** The name a new building is created with, or the existing one's label. */
  label: string;
  existing: TournamentBuilding | null;
  /** Rooms the building doesn't have yet, as typed. */
  newRooms: string[];
}

interface PlannedEvent {
  event: TournamentEvent;
  buildingKey: string;
  rooms: string[];
}

interface ParsedAssignments {
  buildings: PlannedBuilding[];
  events: PlannedEvent[];
  errors: string[];
}

/** An event by "Name Division" as it displays, or by name alone when only
 *  one event on the track has it. */
function matchEvent(
  events: readonly TournamentEvent[],
  typed: string,
): TournamentEvent | "ambiguous" | null {
  const key = typed.toLowerCase();
  const full = events.find((e) => eventNameWithDivision(e).toLowerCase() === key);
  if (full) return full;
  const byName = events.filter((e) => eventName(e).toLowerCase() === key);
  if (byName.length > 1) return "ambiguous";
  return byName[0] ?? null;
}

function parseAssignments(
  text: string,
  events: readonly TournamentEvent[],
  buildings: readonly TournamentBuilding[],
  trackName: string,
): ParsedAssignments {
  const planned = new Map<string, PlannedBuilding>();
  const byEvent = new Map<number, PlannedEvent>();
  const errors: string[] = [];

  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;
    const lineNo = index + 1;
    const columns = splitColumns(line);
    if (index === 0 && columns?.[0]?.toLowerCase() === "event") return;

    let typedEvent = "";
    let typedBuilding = "";
    let typedRoom = "";
    if (columns?.length === 2) {
      typedEvent = columns[0];
      [typedBuilding, typedRoom] = splitBuildingRoom(columns[1]);
    } else if (columns?.length === 3) {
      [typedEvent, typedBuilding, typedRoom] = columns;
    }
    typedRoom = unwrapParens(typedRoom);
    if (!typedEvent || !typedBuilding || !typedRoom) {
      errors.push(
        `Line ${lineNo}: expected an event, then a building and room, separated by commas or tabs.`,
      );
      return;
    }
    if (typedBuilding.length > MAX_BUILDING_NAME) {
      errors.push(`Line ${lineNo}: building name is over ${MAX_BUILDING_NAME} characters.`);
      return;
    }
    if (typedRoom.length > MAX_ROOM_NAME) {
      errors.push(`Line ${lineNo}: room name is over ${MAX_ROOM_NAME} characters.`);
      return;
    }

    const event = matchEvent(events, typedEvent);
    if (event === "ambiguous") {
      errors.push(`Line ${lineNo}: "${typedEvent}" matches more than one event; add its division.`);
      return;
    }
    if (!event) {
      errors.push(`Line ${lineNo}: no event "${typedEvent}" on ${trackName}.`);
      return;
    }

    const existing = findBuilding(buildings, typedBuilding);
    const key = existing ? `id:${existing.id}` : `new:${typedBuilding.toLowerCase()}`;
    let building = planned.get(key);
    if (!building) {
      building = {
        key,
        label: existing ? existing.short_name || existing.name : typedBuilding,
        existing,
        newRooms: [],
      };
      planned.set(key, building);
    }
    const existingRoom = existing?.rooms.find(
      (r) => r.name.toLowerCase() === typedRoom.toLowerCase(),
    );
    const newRoom = building.newRooms.find((r) => r.toLowerCase() === typedRoom.toLowerCase());
    const roomName = existingRoom?.name ?? newRoom ?? typedRoom;
    if (!existingRoom && !newRoom) building.newRooms.push(typedRoom);

    const placed = byEvent.get(event.id);
    if (!placed) {
      byEvent.set(event.id, { event, buildingKey: key, rooms: [roomName] });
    } else if (placed.buildingKey !== key) {
      const first = planned.get(placed.buildingKey)?.label;
      errors.push(
        `Line ${lineNo}: ${eventNameWithDivision(event)} is already in ${first} above; an event's rooms must be in one building.`,
      );
    } else if (!placed.rooms.includes(roomName)) {
      placed.rooms.push(roomName);
    }
  });

  return { buildings: [...planned.values()], events: [...byEvent.values()], errors };
}

export function RoomAssignmentsImport({
  tournamentId,
  track,
  dayTrackIds,
  events,
  buildings,
  onCancel,
  onDone,
  onImported,
}: {
  tournamentId: number;
  /** The track tab the rooms are assigned on. */
  track: TournamentTrack;
  /** Every competition day — a new building starts on all of them. */
  dayTrackIds: number[];
  /** The events on `track`. */
  events: readonly TournamentEvent[];
  buildings: TournamentBuilding[];
  onCancel: () => void;
  onDone: () => void;
  /** Called with what changed, even when a later request fails. */
  onImported: (buildings: TournamentBuilding[], events: TournamentEvent[]) => void;
}) {
  const [text, setText] = useState("");
  const help = useImportHelp();
  const [error, setError] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  const parsed = useMemo(
    () => parseAssignments(text, events, buildings, track.name),
    [text, events, buildings, track.name],
  );
  const offTrack = (b: PlannedBuilding) => !!b.existing && !b.existing.track_ids.includes(track.id);
  const newRoomCount = parsed.buildings.reduce((sum, b) => sum + b.newRooms.length, 0);

  async function handleImport() {
    setError(undefined);
    setSaving(true);
    const savedBuildings: TournamentBuilding[] = [];
    const savedEvents: TournamentEvent[] = [];
    try {
      const roomIds = new Map<string, Map<string, number>>();
      for (const plan of parsed.buildings) {
        let building =
          plan.existing ??
          (await buildingsApi.create(tournamentId, { name: plan.label, track_ids: dayTrackIds }));
        if (offTrack(plan)) {
          building = await buildingsApi.update(tournamentId, building.id, {
            track_ids: [...building.track_ids, track.id],
          });
        }
        const rooms =
          plan.newRooms.length > 0
            ? await buildingsApi.addRooms(tournamentId, building.id, plan.newRooms)
            : building.rooms;
        savedBuildings.push({ ...building, rooms });
        roomIds.set(plan.key, new Map(rooms.map((r) => [r.name.toLowerCase(), r.id])));
      }
      for (const plan of parsed.events) {
        const ids = roomIds.get(plan.buildingKey);
        const room_ids = plan.rooms.flatMap((name) => ids?.get(name.toLowerCase()) ?? []);
        savedEvents.push(
          await tournamentEventsApi.update(tournamentId, plan.event.id, {
            track_details: withTrackDetail(plan.event, track.id, { floor: null, room_ids }),
          }),
        );
      }
      onImported(savedBuildings, savedEvents);
      onDone();
    } catch (err: unknown) {
      onImported(savedBuildings, savedEvents);
      const message = err instanceof ApiError ? err.message : "Something went wrong. Try again.";
      setError(
        savedEvents.length > 0
          ? `${message} ${plural(savedEvents.length, "event")} were assigned before this; importing again is safe.`
          : message,
      );
      setSaving(false);
    }
  }

  const rows = [
    ...parsed.buildings
      .filter((b) => !b.existing || b.newRooms.length > 0 || offTrack(b))
      .map((b) => (
        <ImportPreviewRow key={b.key}>
          <span style={{ fontWeight: 500 }}>{b.label}</span>
          {!b.existing && <Badge>New building</Badge>}
          {offTrack(b) && <Badge>Added to {track.name}</Badge>}
          {b.newRooms.length > 0 && (
            <span style={{ color: "var(--color-text-secondary)" }}>
              {plural(b.newRooms.length, "new room")}
            </span>
          )}
        </ImportPreviewRow>
      )),
    ...parsed.events.map(({ event, buildingKey, rooms }) => {
      const label = parsed.buildings.find((b) => b.key === buildingKey)?.label;
      const was = trackLocationLabel(trackDetail(event, track.id));
      const now = `${label} ${rooms.join(", ")}`;
      return (
        <ImportPreviewRow key={event.id}>
          <span style={{ fontWeight: 500 }}>{eventNameWithDivision(event)}</span>
          <span style={{ color: "var(--color-text-secondary)" }}>{now}</span>
          {was && was !== now && (
            <span style={{ color: "var(--color-text-tertiary)" }}>was {was}</span>
          )}
        </ImportPreviewRow>
      );
    }),
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <ImportHelp
        open={help.open}
        onToggle={help.toggle}
        columns={["Event", "Building", "Room"]}
        examples={[
          { input: "Anatomy C, RH 210", parts: ["Anatomy C", "RH", "210"] },
          { input: "Anatomy C, RH, 210", parts: ["Anatomy C", "RH", "210"] },
          { input: `Botany B${TAB}RH${TAB}115`, parts: ["Botany B", "RH", "115"] },
        ]}
        notes={[
          "Comma or tab between columns",
          <>
            Events must be formatted as [event name] [division] i.e. <Badge>Boomilever C</Badge>
          </>,
          "Multiple rooms for an event? List the event again",
          <>
            Replaces all event placements in the <Badge>{track.name}</Badge> track
          </>,
          "Missing buildings and rooms are created",
        ]}
      />
      <Textarea
        aria-label="Room assignments"
        placeholder={"Anatomy and Physiology C, RH 210\nBotany B\tRH\t115"}
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
      <ImportPreview rows={rows} errors={parsed.errors} />
      <ImportFooter
        error={error}
        saving={saving}
        disabled={parsed.events.length === 0}
        hasErrors={parsed.errors.length > 0}
        label={
          parsed.events.length > 0
            ? `Assign ${plural(parsed.events.length, "event")}${newRoomCount > 0 ? `, add ${plural(newRoomCount, "room")}` : ""}`
            : "Assign"
        }
        onCancel={onCancel}
        onImport={handleImport}
      />
    </div>
  );
}
