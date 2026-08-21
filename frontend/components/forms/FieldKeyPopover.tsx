"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { FormPopover } from "@/components/ui/FormPopover";
import { Input } from "@/components/ui/Input";
import { Tooltip } from "@/components/ui/Tooltip";
import { IconKey, IconInfo } from "@/components/ui/Icons";
import { EditableField } from "@/lib/forms/editableField";
import { activePresetKind, PRESETS, isFieldKeyError } from "@/lib/forms/fieldKeyPresets";

// The dashboard-facing identifier for a question — split out of the main
// card into its own toolbar popover (rather than an always-visible Combobox
// in the card body) so the far more common "just let it follow the label"
// path stays out of the way, while an actual collision still can't hide:
// Save force-opens this with the offending field red-outlined (see
// saveAttempt below) instead of a proactive disabled-row list, which meant
// rendering every other question's key just to type a new one.
export function FieldKeyPopover({ field, onFieldChange, usedFieldKeys, allFields, errors, saveAttempt }: {
  field: EditableField;
  onFieldChange: (updates: Partial<EditableField>) => void;
  usedFieldKeys: string[];
  allFields: EditableField[];
  errors: string[];
  /** Bumped by FieldList each time a Save attempt fails validation — the
      edge-trigger for auto-opening this popover, since the errors array
      alone can't distinguish "still has that old error" from "just failed
      Save again." 0 means "no attempt yet." */
  saveAttempt: number;
}) {
  const presetKind = activePresetKind(field.field_key);
  const [open, setOpen] = useState(false);
  const [blurError, setBlurError] = useState<string | undefined>(undefined);

  const keyError = errors.find(isFieldKeyError);
  const displayedError = blurError ?? keyError;

  useEffect(() => {
    if (saveAttempt > 0 && keyError) setOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveAttempt]);

  function handleBlur() {
    const key = field.field_key.trim();
    if (!key) { setBlurError(undefined); return; }
    // Exclude this field's own current key from both lists before checking —
    // usedFieldKeys includes every field already saved on this tournament,
    // this field's own prior save included, and allFields includes this
    // field itself.
    const takenByOtherSaved = usedFieldKeys.some((k) => k === key && k !== field.field_key);
    const takenBySibling = allFields.some((f) => f.clientKey !== field.clientKey && f.field_key.trim() === key);
    setBlurError(takenByOtherSaved || takenBySibling ? "This field key is already used by another question." : undefined);
  }

  return (
    <FormPopover
      trigger={
        <Button
          type="button" variant="secondary" size="sm" iconOnly title="Field key"
          style={displayedError ? { color: "var(--color-danger)", borderColor: "var(--color-danger)" } : undefined}
        >
          <IconKey size={14} />
        </Button>
      }
      width={280}
      align="left"
      open={open}
      onOpenChange={setOpen}
    >
      {() => (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{
              fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 600,
              textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--color-text-tertiary)",
            }}>
              Field Key
            </span>
            <Tooltip
              variant="info"
              maxWidth={320}
              message="How this question shows up when scanning or filtering responses on the dashboard — not shown to respondents. Follows the question text until you edit it here. Must be unique across every form this tournament owns."
            >
              <IconInfo size={12} style={{ color: "var(--color-text-tertiary)" }} />
            </Tooltip>
          </div>
          {presetKind ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "13px", color: "var(--color-text-primary)" }}>
                {field.field_key}
              </span>
              <span style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)" }}>
                Set by the {PRESETS[presetKind].label} preset — edit it from the presets icon below.
              </span>
            </div>
          ) : (
            <Input
              value={field.field_key}
              onChange={(e) => onFieldChange({ field_key: e.target.value })}
              onBlur={handleBlur}
              placeholder="e.g. volunteer_availability"
              size="sm"
              fullWidth
              error={displayedError}
            />
          )}
        </div>
      )}
    </FormPopover>
  );
}
