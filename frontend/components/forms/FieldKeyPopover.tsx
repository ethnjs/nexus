"use client";

import { MouseEvent as ReactMouseEvent, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { FormPopover } from "@/components/ui/FormPopover";
import { Input } from "@/components/ui/Input";
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
export function FieldKeyPopover({ field, onFieldChange, usedFieldKeys, allFields, errors, saveAttempt, open, onOpenChange }: {
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
  /** Owned by FieldToolbar (shared with PresetPopover) — only one of the two
      can be open at a time, so this can't be local state. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const presetKind = activePresetKind(field.field_key);
  // Owns its own error state rather than deriving straight from `errors`
  // every render, specifically so it can clear the instant field_key
  // changes for *any* reason (typing here, or a preset param edited in
  // PresetPopover) — see the effect below — rather than staying stuck until
  // the next blur or Save.
  const [localError, setLocalError] = useState<string | undefined>(undefined);
  const prevFieldKeyRef = useRef(field.field_key);

  useEffect(() => {
    if (field.field_key !== prevFieldKeyRef.current) {
      prevFieldKeyRef.current = field.field_key;
      setLocalError(undefined);
    }
  }, [field.field_key]);

  useEffect(() => {
    if (saveAttempt === 0) return;
    const keyError = errors.find(isFieldKeyError);
    if (keyError) { onOpenChange(true); setLocalError(keyError); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveAttempt]);

  function handleBlur() {
    const key = field.field_key.trim();
    if (!key) { setLocalError(undefined); return; }
    // Exclude this field's own current key from both lists before checking —
    // usedFieldKeys includes every field already saved on this tournament,
    // this field's own prior save included, and allFields includes this
    // field itself.
    const takenByOtherSaved = usedFieldKeys.some((k) => k === key && k !== field.field_key);
    const takenBySibling = allFields.some((f) => f.clientKey !== field.clientKey && f.field_key.trim() === key);
    setLocalError(takenByOtherSaved || takenBySibling ? "This field key is already used by another question." : undefined);
  }

  return (
    <FormPopover
      trigger={
        <Button
          type="button" variant={localError ? "danger" : open ? "primary" : "secondary"} size="sm" iconOnly title="Field key"
        >
          <IconKey size={14} />
        </Button>
      }
      width={280}
      side="right"
      open={open}
      onOpenChange={onOpenChange}
      closeOnOutsideClick={false}
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
            <KeyInfoHint />
          </div>
          {presetKind ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <Input value={field.field_key} locked size="sm" fullWidth />
              <span style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)" }}>
                Set by the {PRESETS[presetKind].label} preset — edit it from the presets icon below.
              </span>
            </div>
          ) : (
            <Input
              value={field.field_key}
              onChange={(e) => onFieldChange({ field_key: e.target.value })}
              onBlur={handleBlur}
              placeholder={field.label.trim()}
              size="sm"
              fullWidth
              error={localError}
            />
          )}
        </div>
      )}
    </FormPopover>
  );
}

// A plain Tooltip here gets clipped — its bubble is position: absolute
// inside FormPopover's own overflow-y: auto panel, which clips any
// absolutely-positioned descendant regardless of z-index. Popover.tsx hit
// the identical problem for its own hover-reason tooltips and fixed it the
// same way: compute the bubble's position from the trigger's own
// getBoundingClientRect and render it position: fixed, escaping the
// clipping ancestor entirely instead of nesting inside it.
function KeyInfoHint() {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  function show(e: ReactMouseEvent<HTMLElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    setPos({ top: r.top - 8, left: r.left + r.width / 2 });
  }

  return (
    <span style={{ position: "relative", display: "inline-flex" }} onMouseEnter={show} onMouseLeave={() => setPos(null)}>
      <IconInfo size={12} style={{ color: "var(--color-text-tertiary)" }} />
      {pos && (
        <span style={{
          position: "fixed", top: pos.top, left: pos.left, zIndex: 400,
          transform: "translate(-50%, -100%)", maxWidth: "260px", width: "max-content",
          padding: "7px 11px", borderRadius: "var(--radius-md)",
          background: "var(--color-surface)", boxShadow: "var(--shadow-lg)",
          fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-primary)",
          pointerEvents: "none",
        }}>
          How this question shows up when scanning or filtering responses on the dashboard — not shown to respondents. Must be unique across every form this tournament owns.
        </span>
      )}
    </span>
  );
}
