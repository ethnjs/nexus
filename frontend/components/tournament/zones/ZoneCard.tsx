"use client";

import { useDroppable } from "@dnd-kit/core";
import type { ReactNode } from "react";
import {
  type ZoneTagChip,
  ZoneTagField,
  type ZoneTagOption,
} from "@/components/tournament/zones/ZoneTagField";
import { parseZoneDragId, zoneDropId } from "@/components/tournament/zones/zoneDnd";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EditableText } from "@/components/ui/EditableText";
import { IconTrash } from "@/components/ui/Icons";
import table from "@/components/ui/Table.module.css";
import type { Zone } from "@/lib/api";

interface ZoneCardProps<L, M> {
  zone: Zone;
  locked: boolean;
  lockedReason?: string;
  locations: ZoneTagChip[];
  locationOptions: ZoneTagOption<L>[];
  /** The rooms and events the rules reach, under the Location field. */
  contents: ReactNode;
  /** Null hides the Members section, for a viewer who can't staff zones. */
  members: ZoneTagChip[] | null;
  memberOptions: ZoneTagOption<M>[];
  onRename: (name: string) => Promise<void>;
  onDelete: () => void;
  onAddLocation: (value: L) => Promise<void>;
  onRemoveLocation: (key: string | number) => void;
  onAddMember: (value: M) => Promise<void>;
  onRemoveMember: (key: string | number) => void;
}

const HEADER_TEXT = {
  fontFamily: "var(--font-serif)",
  fontSize: "18px",
  fontWeight: 500,
} as const;

export function ZoneCard<L, M>({
  zone,
  locked,
  lockedReason,
  locations,
  locationOptions,
  contents,
  members,
  memberOptions,
  onRename,
  onDelete,
  onAddLocation,
  onRemoveLocation,
  onAddMember,
  onRemoveMember,
}: ZoneCardProps<L, M>) {
  const reached = zone.event_ids.length;
  const { setNodeRef, isOver, active } = useDroppable({
    id: zoneDropId(zone.id),
    disabled: locked,
    data: { label: zone.name },
  });
  const drag = active ? parseZoneDragId(String(active.id)) : null;
  const fromHere =
    (drag?.kind === "rule-chip" || drag?.kind === "member-chip") && drag.zoneId === zone.id;
  const highlighted = isOver && !!drag && !fromHere;

  return (
    <div ref={setNodeRef}>
      <Card
        radius="lg"
        style={{
          padding: "14px 18px",
          // The same tint a room row takes while an event is dragged over it.
          ...(highlighted && { background: "var(--color-bg)" }),
          transition: "background 100ms ease",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <EditableText
              value={zone.name}
              onSave={onRename}
              textStyle={HEADER_TEXT}
              locked={locked}
              title={locked ? lockedReason : "Rename zone"}
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            iconOnly
            title={locked ? lockedReason : "Delete zone"}
            disabled={locked}
            onClick={onDelete}
          >
            <IconTrash size={14} style={{ color: "var(--color-danger)" }} />
          </Button>
        </div>

        <Section label="Location" aside={`${reached} ${reached === 1 ? "event" : "events"}`}>
          <ZoneTagField
            chips={locations}
            options={locationOptions}
            locked={locked}
            placeholder="Add a building, floor, room or event…"
            emptyMessage="Nothing matches on this day"
            onAdd={onAddLocation}
            onRemove={onRemoveLocation}
          />
          <div style={{ marginTop: "10px" }}>{contents}</div>
        </Section>

        {members && (
          <Section label="Members">
            <ZoneTagField
              chips={members}
              options={memberOptions}
              locked={locked}
              placeholder="Add a member…"
              emptyMessage="No matching members"
              onAdd={onAddMember}
              onRemove={onRemoveMember}
            />
          </Section>
        )}
      </Card>
    </div>
  );
}

function Section({
  label,
  aside,
  children,
}: {
  label: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div style={{ marginTop: "12px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: "8px",
          marginBottom: "6px",
          fontFamily: "var(--font-sans)",
        }}
      >
        <span className={table.headerLabel}>{label}</span>
        {aside && (
          <span style={{ fontSize: "12px", color: "var(--color-text-tertiary)" }}>{aside}</span>
        )}
      </div>
      {children}
    </div>
  );
}
