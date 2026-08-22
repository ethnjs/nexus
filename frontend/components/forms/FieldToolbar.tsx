"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { IconPlus, IconDescription, IconButton, IconBranch, IconSwap } from "@/components/ui/Icons";
import { TOPBAR_HEIGHT } from "@/components/layout/Topbar";
import { FieldKeyPopover } from "@/components/forms/FieldKeyPopover";
import { PresetPopover } from "@/components/forms/PresetPopover";
import { EditableField } from "@/lib/forms/editableField";
import { activePresetKind, isEntityBackedPreset } from "@/lib/forms/fieldKeyPresets";
import { BRANCHING_TYPES, OPTION_BEARING_TYPES } from "@/lib/forms/fieldTypes";

type ActivePopover = "key" | "preset" | null;

// The one toolbar shared by every field card (field key/presets, add a
// field below, toggle the description input). It's absolutely positioned
// over the expanded card's vertical span and sticky *inside* that span, so
// on a tall card it rides the scroll but can never drift onto a
// neighbouring card. FieldList measures the card and writes top/height onto
// boxRef — imperatively, since re-rendering on every observed resize frame
// would be waste.
export function FieldToolbar({
  boxRef, field, onFieldChange, usedFieldKeys, allFields, errors, saveAttempt, tournamentDates, onOpenPresets,
  showDescription, onAddFieldBelow, onToggleDescription, displayStyle, onToggleDisplayStyle,
}: {
  boxRef: React.RefObject<HTMLDivElement | null>;
  field: EditableField;
  onFieldChange: (updates: Partial<EditableField>) => void;
  usedFieldKeys: string[];
  allFields: EditableField[];
  errors: string[];
  saveAttempt: number;
  /** The tournament's individual running days — passed through to
      PresetPopover's availability/lunch date pickers. */
  tournamentDates: string[];
  /** Fires when the presets panel opens — see PresetPopover's onOpen. */
  onOpenPresets?: () => void;
  showDescription: boolean;
  onAddFieldBelow: () => void;
  onToggleDescription: () => void;
  /** undefined = the expanded field's question_type doesn't support display_style — hides the button. */
  displayStyle: "list" | "buttons" | undefined;
  onToggleDisplayStyle: () => void;
}) {
  // Only one of the key/preset popovers can be open at a time — setting one
  // implicitly closes the other, since both read from this single slot.
  const [activePopover, setActivePopover] = useState<ActivePopover>(null);

  return (
    <div ref={boxRef} style={{
      position: "absolute", left: "100%", marginLeft: "10px",
      visibility: "hidden", pointerEvents: "none",
    }}>
      <div style={{
        position: "sticky", top: `${TOPBAR_HEIGHT + 12}px`,
        display: "flex", flexDirection: "column", gap: "6px", pointerEvents: "auto",
      }}>
        <Button type="button" variant="secondary" size="sm" iconOnly title="Add field below" onClick={onAddFieldBelow}>
          <IconPlus size={14} />
        </Button>
        <Button
          type="button" variant={showDescription ? "primary" : "secondary"} size="sm" iconOnly
          title="Toggle description"
          onClick={onToggleDescription}
        >
          <IconDescription size={14} />
        </Button>
        <FieldKeyPopover
          field={field}
          onFieldChange={onFieldChange}
          usedFieldKeys={usedFieldKeys}
          allFields={allFields}
          errors={errors}
          saveAttempt={saveAttempt}
          open={activePopover === "key"}
          onOpenChange={(open) => setActivePopover(open ? "key" : null)}
        />
        <PresetPopover
          field={field}
          onFieldChange={onFieldChange}
          tournamentDates={tournamentDates}
          onOpen={onOpenPresets}
          errors={errors}
          saveAttempt={saveAttempt}
          open={activePopover === "preset"}
          onOpenChange={(open) => setActivePopover(open ? "preset" : null)}
        />
        {displayStyle && (
          <Button
            type="button" variant={displayStyle === "buttons" ? "primary" : "secondary"} size="sm" iconOnly
            title={displayStyle === "buttons" ? "Show as list" : "Show as buttons"}
            onClick={onToggleDisplayStyle}
          >
            <IconButton size={14} />
          </Button>
        )}
        {BRANCHING_TYPES.includes(field.question_type) && (
          <Button
            type="button" variant={field.branchingEnabled ? "primary" : "secondary"} size="sm" iconOnly
            title={field.branchingEnabled ? "Disable branching" : "Enable branching"}
            onClick={() => onFieldChange({ branchingEnabled: !field.branchingEnabled })}
          >
            <IconBranch size={14} />
          </Button>
        )}
        {OPTION_BEARING_TYPES.includes(field.question_type) && !isEntityBackedPreset(activePresetKind(field.field_key)) && (
          <Button
            type="button" variant={field.customValuesEnabled ? "primary" : "secondary"} size="sm" iconOnly
            title={field.customValuesEnabled ? "Hide custom values" : "Set custom values"}
            onClick={() => onFieldChange({ customValuesEnabled: !field.customValuesEnabled })}
          >
            <IconSwap size={14} />
          </Button>
        )}
      </div>
    </div>
  );
}
