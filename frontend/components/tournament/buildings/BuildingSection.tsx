"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ChecklistPopover } from "@/components/ui/ChecklistPopover";
import { EditableText } from "@/components/ui/EditableText";
import { IconCalendar, IconTrash } from "@/components/ui/Icons";
import type { TournamentBuilding, TournamentTrack } from "@/lib/api";

interface BuildingSectionProps {
  building: TournamentBuilding;
  /** The tournament's competition days. With one, the day picker is hidden. */
  days: TournamentTrack[];
  locked: boolean;
  lockedReason?: string;
  onRename: (name: string) => Promise<void>;
  onToggleDay: (trackId: number) => Promise<void>;
  onDelete: () => void;
  children?: ReactNode;
}

const HEADER_TEXT = {
  fontFamily: "var(--font-serif)",
  fontSize: "18px",
  fontWeight: 500,
} as const;

export function BuildingSection({
  building,
  days,
  locked,
  lockedReason,
  onRename,
  onToggleDay,
  onDelete,
  children,
}: BuildingSectionProps) {
  const onDays = new Set(building.track_ids);

  return (
    <Card radius="lg" style={{ padding: "14px 18px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <EditableText
            value={building.name}
            onSave={onRename}
            textStyle={HEADER_TEXT}
            locked={locked}
            title={locked ? lockedReason : "Rename building"}
          />
        </div>
        {days.length > 1 && (
          <ChecklistPopover
            trigger={
              <Button
                type="button"
                variant="ghost"
                size="sm"
                iconOnly
                title="Competition days"
                disabled={locked}
              >
                <IconCalendar size={14} />
              </Button>
            }
            items={days}
            getKey={(t) => t.id}
            renderLabel={(t) => t.name}
            isSelected={(t) => onDays.has(t.id)}
            // A building must stay on at least one day; delete it instead.
            isDisabled={(t) => onDays.size === 1 && onDays.has(t.id)}
            disabledReason={() => "A building must be on at least one day."}
            onToggle={(t) => onToggleDay(t.id)}
            align="right"
            width={240}
          />
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          iconOnly
          title={locked ? lockedReason : "Delete building"}
          disabled={locked}
          onClick={onDelete}
        >
          <IconTrash size={14} style={{ color: "var(--color-danger)" }} />
        </Button>
      </div>
      {children}
    </Card>
  );
}
