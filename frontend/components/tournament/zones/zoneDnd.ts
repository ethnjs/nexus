import { parseEventDragId } from "@/components/tournament/buildings/EventListCard";
import type { ZoneMember } from "@/lib/api";

// Drag and drop ids for the zones page. Rule keys contain ":", so "|" separates parts.

export type ZoneDrag =
  /** A building, floor, room or event from the side panel. */
  | { kind: "target"; ruleKey: string }
  /** A member card from the side panel. */
  | { kind: "member"; membershipId: number }
  /** A location chip on a zone card. */
  | { kind: "rule-chip"; zoneId: number; ruleKey: string }
  /** A member chip on a zone card. */
  | { kind: "member-chip"; zoneId: number; membershipId: number };

/** For the drags this page starts itself; member and event cards carry their own ids. */
export function zoneDragId(drag: Exclude<ZoneDrag, { kind: "member" }>): string {
  switch (drag.kind) {
    case "target":
      return `zone-target|${drag.ruleKey}`;
    case "rule-chip":
      return `zone-rule-chip|${drag.zoneId}|${drag.ruleKey}`;
    case "member-chip":
      return `zone-member-chip|${drag.zoneId}|${drag.membershipId}`;
  }
}

/** Also reads the member card's and the event card's own drag ids. */
export function parseZoneDragId(id: string): ZoneDrag | null {
  const eventId = parseEventDragId(id);
  if (eventId !== null) return { kind: "target", ruleKey: `event:${eventId}` };
  if (id.startsWith("member:")) {
    const membershipId = Number(id.slice("member:".length));
    return membershipId ? { kind: "member", membershipId } : null;
  }
  const [prefix, a, b] = id.split("|");
  switch (prefix) {
    case "zone-target":
      return a ? { kind: "target", ruleKey: a } : null;
    case "zone-rule-chip":
      return Number(a) && b ? { kind: "rule-chip", zoneId: Number(a), ruleKey: b } : null;
    case "zone-member-chip":
      return Number(a) && Number(b)
        ? { kind: "member-chip", zoneId: Number(a), membershipId: Number(b) }
        : null;
    default:
      return null;
  }
}

/** Whether the drag is a location rather than a member. */
export function isLocationDrag(drag: ZoneDrag): boolean {
  return drag.kind === "target" || drag.kind === "rule-chip";
}

export function zoneDropId(zoneId: number): string {
  return `zone-card|${zoneId}`;
}

export function parseZoneDropId(id: string): number | null {
  const [prefix, a] = id.split("|");
  return prefix === "zone-card" && Number(a) ? Number(a) : null;
}

/** The side panel: a chip dropped here leaves its zone. */
export const ZONE_PANEL_DROP_ID = "zone-panel";

/** The inverse of ruleKey. */
export function ruleFromKey(key: string): ZoneMember | null {
  const [kind, a, ...rest] = key.split(":");
  switch (kind) {
    case "building":
      return { kind, building_id: Number(a) };
    case "floor":
      return { kind, building_id: Number(a), floor: rest.join(":") };
    case "room":
      return { kind, room_id: Number(a) };
    case "event":
      return { kind, tournament_event_id: Number(a) };
    default:
      return null;
  }
}
