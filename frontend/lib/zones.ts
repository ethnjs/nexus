import type {
  MembershipFull,
  TournamentBuilding,
  TournamentEvent,
  TournamentRoom,
  Zone,
  ZoneMember,
  ZoneMemberRead,
} from "@/lib/api";
import { buildingLabel } from "@/lib/buildings";
import { eventNameWithDivision } from "@/lib/eventDisplay";
import { roomFloor, trackDetail } from "@/lib/eventTrackDetails";

/** What makes two rules the same rule. Mirrors ZoneMember.dedupe_key. */
export function ruleKey(rule: ZoneMember): string {
  switch (rule.kind) {
    case "building":
      return `building:${rule.building_id}`;
    case "floor":
      return `floor:${rule.building_id}:${rule.floor}`;
    case "room":
      return `room:${rule.room_id}`;
    case "event":
      return `event:${rule.tournament_event_id}`;
  }
}

/** A read rule as the write payload takes it. */
export function ruleInput(rule: ZoneMemberRead): ZoneMember {
  return {
    kind: rule.kind,
    building_id: rule.kind === "event" ? null : rule.building_id,
    floor: rule.floor,
    room_id: rule.room_id,
    tournament_event_id: rule.tournament_event_id,
  };
}

/** `{ruleKey: zone}` across a day's zones; at most one zone per key. */
export function ruleOwners(zones: readonly Zone[]): Map<string, Zone> {
  const owners = new Map<string, Zone>();
  for (const zone of zones) {
    for (const rule of zone.members) owners.set(ruleKey(rule), zone);
  }
  return owners;
}

export interface ZoneTarget {
  rule: ZoneMember;
  label: string;
  /** The picker group, and what the row is under a search. */
  group: "Buildings" | "Floors" | "Rooms" | "Events";
  searchText: string;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Everything on the day a zone can claim, grouped and in display order. */
export function zoneTargets(
  buildings: readonly TournamentBuilding[],
  events: readonly TournamentEvent[],
): ZoneTarget[] {
  const sorted = [...buildings].sort((a, b) => collator.compare(a.name, b.name));
  const targets: ZoneTarget[] = sorted.map((b) => ({
    rule: { kind: "building", building_id: b.id },
    label: b.name,
    group: "Buildings",
    searchText: `${b.name} ${b.short_name ?? ""}`,
  }));
  for (const b of sorted) {
    const floors = [...new Set(b.rooms.map(roomFloor).filter((f): f is string => !!f))];
    for (const floor of floors.sort(collator.compare)) {
      targets.push({
        rule: { kind: "floor", building_id: b.id, floor },
        label: floorLabel(b, floor),
        group: "Floors",
        searchText: `${b.name} ${b.short_name ?? ""} floor ${floor}`,
      });
    }
  }
  for (const b of sorted) {
    for (const room of b.rooms) {
      targets.push({
        rule: { kind: "room", room_id: room.id },
        label: `${buildingLabel(b)} ${room.name}`,
        group: "Rooms",
        searchText: `${b.name} ${b.short_name ?? ""} ${room.name}`,
      });
    }
  }
  for (const event of [...events].sort((a, b) =>
    collator.compare(eventNameWithDivision(a), eventNameWithDivision(b)),
  )) {
    targets.push({
      rule: { kind: "event", tournament_event_id: event.id },
      label: eventNameWithDivision(event),
      group: "Events",
      searchText: eventNameWithDivision(event),
    });
  }
  return targets;
}

function floorLabel(building: Pick<TournamentBuilding, "name" | "short_name">, floor: string) {
  return `${buildingLabel(building)} floor ${floor}`;
}

/** A rule's chip text, from the day's buildings and events where possible so
 *  short names apply, else from the names the rule carries. */
export function ruleLabel(
  rule: ZoneMemberRead,
  buildings: readonly TournamentBuilding[],
  events: readonly TournamentEvent[],
): string {
  const building = buildings.find((b) => b.id === rule.building_id);
  const name = building ? buildingLabel(building) : (rule.building_name ?? "Unknown building");
  switch (rule.kind) {
    case "building":
      return building?.name ?? rule.building_name ?? "Unknown building";
    case "floor":
      return building
        ? floorLabel(building, rule.floor ?? "")
        : `${name} floor ${rule.floor ?? ""}`;
    case "room":
      return `${name} ${rule.room_name ?? ""}`.trim();
    case "event": {
      const event = events.find((e) => e.id === rule.tournament_event_id);
      return event ? eventNameWithDivision(event) : (rule.event_name ?? "Unknown event");
    }
  }
}

export type DayStatus = "confirmed" | "declined" | "unconfirmed";

/** A member's status on this day, with interested and no answer both unconfirmed. */
export function memberDayStatus(member: MembershipFull, trackId: number): DayStatus {
  const status = member.track_statuses?.find((t) => t.track_id === trackId)?.status;
  return status === "confirmed" || status === "declined" ? status : "unconfirmed";
}

export interface ZoneRoomRow {
  room: TournamentRoom;
  events: TournamentEvent[];
}

export interface ZoneContents {
  buildings: { building: TournamentBuilding; rooms: ZoneRoomRow[] }[];
  /** The zone's events with no room. */
  unplaced: TournamentEvent[];
}

/**
 * The rooms a zone's rules reach, plus the rooms its events are in, with the
 * zone's events in each. A room is reached when this zone has the most
 * specific rule for it (room, then floor, then building), as on the server.
 * Events come from the server's `event_ids`.
 */
export function zoneContents(
  zone: Zone,
  owners: Map<string, Zone>,
  buildings: readonly TournamentBuilding[],
  events: readonly TournamentEvent[],
  trackId: number,
): ZoneContents {
  const zoneEvents = events.filter((e) => zone.event_ids.includes(e.id));
  const rows: ZoneContents["buildings"] = [];

  for (const building of [...buildings].sort((a, b) => collator.compare(a.name, b.name))) {
    const rooms: ZoneRoomRow[] = [];
    for (const room of building.rooms) {
      const floor = roomFloor(room);
      const owner =
        owners.get(`room:${room.id}`) ??
        (floor ? owners.get(`floor:${building.id}:${floor}`) : undefined) ??
        owners.get(`building:${building.id}`);
      const inRoom = zoneEvents.filter((e) => trackDetail(e, trackId)?.room_ids.includes(room.id));
      if (owner?.id === zone.id || inRoom.length > 0) rooms.push({ room, events: inRoom });
    }
    if (rooms.length > 0) rows.push({ building, rooms });
  }

  const unplaced = zoneEvents.filter((e) => !trackDetail(e, trackId)?.room_ids.length);
  return { buildings: rows, unplaced };
}
