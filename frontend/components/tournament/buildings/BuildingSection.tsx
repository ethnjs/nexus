"use client";

import { type ReactNode, useState } from "react";
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
  onSetShortName: (shortName: string | null) => Promise<void>;
  onToggleDay: (trackId: number) => Promise<void>;
  onDelete: () => void;
  children?: ReactNode;
}

const HEADER_TEXT = {
  fontFamily: "var(--font-serif)",
  fontSize: "18px",
  fontWeight: 500,
} as const;

const SHORT_NAME_TEXT = {
  fontFamily: "var(--font-sans)",
  fontSize: "13px",
  fontWeight: 500,
  color: "var(--color-text-secondary)",
} as const;

export function BuildingSection({
  building,
  days,
  locked,
  lockedReason,
  onRename,
  onSetShortName,
  onToggleDay,
  onDelete,
  children,
}: BuildingSectionProps) {
  const onDays = new Set(building.track_ids);
  // An unset short name stays out of sight until the header is hovered, or
  // while it's being typed.
  const [hovered, setHovered] = useState(false);
  const [editingShortName, setEditingShortName] = useState(false);
  const showShortName = !!building.short_name || (!locked && (hovered || editingShortName));

  return (
    <Card radius="lg" style={{ padding: "14px 18px" }}>
      <div
        style={{ display: "flex", alignItems: "center", gap: "8px" }}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
      >
        <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: "8px" }}>
          <EditableText
            value={building.name}
            onSave={onRename}
            textStyle={HEADER_TEXT}
            locked={locked}
            title={locked ? lockedReason : "Rename building"}
          />
          {showShortName && (
            <span
              // Never wraps or shrinks: a long building name wraps instead.
              style={{
                ...SHORT_NAME_TEXT,
                display: "inline-flex",
                alignItems: "center",
                flexShrink: 0,
                whiteSpace: "nowrap",
              }}
              onFocus={() => setEditingShortName(true)}
              onBlur={() => setEditingShortName(false)}
            >
              (
              <EditableText
                value={building.short_name ?? ""}
                placeholder="add short name"
                onSave={(value) => onSetShortName(value.trim() || null)}
                textStyle={SHORT_NAME_TEXT}
                locked={locked}
                title={locked ? lockedReason : "Short name: event locations use it when set"}
                allowEmpty
                errorToast
              />
              )
            </span>
          )}
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
