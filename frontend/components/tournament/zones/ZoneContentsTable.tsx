"use client";

import type { CSSProperties } from "react";
import table from "@/components/ui/Table.module.css";
import type { TournamentEvent } from "@/lib/api";
import { buildingLabel } from "@/lib/buildings";
import { eventNameWithDivision } from "@/lib/eventDisplay";
import type { ZoneContents } from "@/lib/zones";

const CELL: CSSProperties = {
  padding: "6px 8px",
  borderTop: "1px solid var(--color-border)",
  verticalAlign: "top",
  fontFamily: "var(--font-sans)",
  fontSize: "13px",
  color: "var(--color-text-primary)",
  textAlign: "left",
};

const MUTED: CSSProperties = { color: "var(--color-text-tertiary)" };

/** The rooms a zone covers or has events in, one row per room, with a
 *  building's cell spanning its rooms. */
export function ZoneContentsTable({
  contents,
  onOpenEvent,
}: {
  contents: ZoneContents;
  onOpenEvent: (eventId: number) => void;
}) {
  if (contents.buildings.length === 0 && contents.unplaced.length === 0) {
    return (
      <span style={{ fontFamily: "var(--font-sans)", fontSize: "13px", ...MUTED }}>
        No rooms or events yet
      </span>
    );
  }

  return (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead>
        <tr>
          <th className={table.headerLabel} style={{ ...HEAD, width: "30%" }}>
            Building
          </th>
          <th className={table.headerLabel} style={{ ...HEAD, width: "20%" }}>
            Room
          </th>
          <th className={table.headerLabel} style={HEAD}>
            Events
          </th>
        </tr>
      </thead>
      <tbody>
        {contents.buildings.flatMap(({ building, rooms }) =>
          rooms.map(({ room, events }, index) => (
            <tr key={room.id}>
              {index === 0 && (
                <td
                  rowSpan={rooms.length}
                  style={{ ...CELL, fontWeight: 500 }}
                  title={building.name}
                >
                  {buildingLabel(building)}
                </td>
              )}
              <td style={CELL}>{room.name}</td>
              <td style={CELL}>
                <EventLinks events={events} onOpen={onOpenEvent} />
              </td>
            </tr>
          )),
        )}
        {contents.unplaced.length > 0 && (
          <tr>
            <td colSpan={2} style={{ ...CELL, ...MUTED }}>
              No room
            </td>
            <td style={CELL}>
              <EventLinks events={contents.unplaced} onOpen={onOpenEvent} />
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

const HEAD: CSSProperties = { padding: "0 8px 6px", textAlign: "left" };

function EventLinks({
  events,
  onOpen,
}: {
  events: TournamentEvent[];
  onOpen: (eventId: number) => void;
}) {
  if (events.length === 0) return <span style={MUTED}>None</span>;
  return (
    <span style={{ display: "flex", flexWrap: "wrap", gap: "4px 10px" }}>
      {events.map((event) => (
        <button
          key={event.id}
          type="button"
          onClick={() => onOpen(event.id)}
          style={{
            padding: 0,
            border: "none",
            background: "transparent",
            fontFamily: "var(--font-sans)",
            fontSize: "13px",
            color: "var(--color-text-primary)",
            textAlign: "left",
            cursor: "pointer",
            textDecoration: "underline",
            textDecorationColor: "var(--color-border-strong)",
            textUnderlineOffset: "3px",
          }}
        >
          {eventNameWithDivision(event)}
        </button>
      ))}
    </span>
  );
}
