"use client";

import { type MouseEvent as ReactMouseEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { FormPopover } from "@/components/ui/FormPopover";
import { IconInfo, IconKey } from "@/components/ui/Icons";
import { Input } from "@/components/ui/Input";
import type { FieldKeyUsage } from "@/lib/api";
import { useFieldExtension } from "@/lib/forms/builderAddon";
import type { EditableField } from "@/lib/forms/editableField";
import { isFieldKeyError } from "@/lib/forms/fieldKeys";
import { KEY_IN_USE_MESSAGE } from "@/lib/forms/useFormValidation";
import { toPlainText } from "@/lib/markdown";

// The dashboard-facing identifier for a question — split out of the main
// card into its own toolbar popover (rather than an always-visible Combobox
// in the card body) so the far more common "just let it follow the label"
// path stays out of the way, while a same-form collision still can't hide:
// Save force-opens this with the offending field red-outlined (see
// saveAttempt below) instead of a proactive disabled-row list, which meant
// rendering every other question's key just to type a new one.
export function FieldKeyPopover({
  field,
  onFieldChange,
  sharedFieldKeys,
  allFields,
  errors,
  saveAttempt,
  open,
  onOpenChange,
}: {
  field: EditableField;
  onFieldChange: (updates: Partial<EditableField>) => void;
  /** Keys on the owner's other forms — suggested for reuse, never blocked. */
  sharedFieldKeys: FieldKeyUsage[];
  allFields: EditableField[];
  errors: string[];
  /** Bumped by FieldList each time a Save attempt fails validation — the
      edge-trigger for auto-opening this popover, since the errors array
      alone can't distinguish "still has that old error" from "just failed
      Save again." 0 means "no attempt yet." */
  saveAttempt: number;
  /** Owned by FieldToolbar (shared with the add-on's popover) — only one can
      be open at a time, so this can't be local state. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { keyLockedReason } = useFieldExtension(field);
  // Cleared the instant field_key changes for *any* reason (typing here, or an
  // add-on editing the key), rather than staying stuck until the next blur or Save.
  const [localError, setLocalError] = useState<string | undefined>(undefined);
  const [prevFieldKey, setPrevFieldKey] = useState(field.field_key);
  if (field.field_key !== prevFieldKey) {
    setPrevFieldKey(field.field_key);
    setLocalError(undefined);
  }

  // An add-on-owned key isn't editable here (see the locked-input branch
  // below) — a key error on it is the add-on popover's to show and open.
  const attemptError =
    saveAttempt === 0 || keyLockedReason ? undefined : errors.find(isFieldKeyError);
  // Starts at 0, not saveAttempt: a popover mounted after a failed Save still shows its error.
  const [seenAttempt, setSeenAttempt] = useState(0);
  if (saveAttempt !== seenAttempt) {
    setSeenAttempt(saveAttempt);
    if (attemptError) setLocalError(attemptError);
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on each save attempt, not on every input change
  useEffect(() => {
    if (attemptError) onOpenChange(true);
  }, [saveAttempt]);

  // Only this form's other questions can clash; allFields includes this field
  // itself, so it's excluded. A server rejection from the last Save counts
  // too, until that save's errors are cleared.
  const key = field.field_key.trim();
  const keyTaken =
    !!key &&
    (allFields.some((f) => f.clientKey !== field.clientKey && f.field_key.trim() === key) ||
      errors.includes(KEY_IN_USE_MESSAGE));
  const shared = !!key && sharedFieldKeys.some((usage) => usage.field_key === key);
  // localError decides *when* to flag (blur or a failed Save, not mid-typing);
  // the live check decides whether the clash still exists — another question
  // giving the key up clears it here without this field's key changing.
  const shownError = keyTaken ? localError : undefined;

  function handleBlur() {
    setLocalError(keyTaken ? KEY_IN_USE_MESSAGE : undefined);
  }

  return (
    <FormPopover
      trigger={
        <Button
          type="button"
          variant={shownError ? "danger" : open ? "primary" : "secondary"}
          size="sm"
          iconOnly
          title="Field key"
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
            <span
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: "11px",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.07em",
                color: "var(--color-text-tertiary)",
              }}
            >
              Field Key
            </span>
            <KeyInfoHint />
          </div>
          {keyLockedReason ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <Input value={field.field_key} locked size="sm" fullWidth />
              <span
                style={{
                  fontFamily: "var(--font-sans)",
                  fontSize: "12px",
                  color: "var(--color-text-tertiary)",
                }}
              >
                {keyLockedReason}
              </span>
            </div>
          ) : (
            <Combobox
              options={sharedFieldKeys}
              getId={(usage) => usage.field_key}
              getLabel={(usage) => usage.field_key}
              value={field.field_key}
              onChange={(text) => onFieldChange({ field_key: text })}
              onBlur={handleBlur}
              placeholder={toPlainText(field.label).trim()}
              size="sm"
              error={shownError}
            />
          )}
          {shared && (
            <span
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: "12px",
                color: "var(--color-text-tertiary)",
              }}
            >
              Other forms use this key too. A member&rsquo;s latest answer to it is the one shown.
            </span>
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
    <span
      style={{ position: "relative", display: "inline-flex" }}
      onMouseEnter={show}
      onMouseLeave={() => setPos(null)}
    >
      <IconInfo size={12} style={{ color: "var(--color-text-tertiary)" }} />
      {pos && (
        <span
          style={{
            position: "fixed",
            top: pos.top,
            left: pos.left,
            zIndex: 400,
            transform: "translate(-50%, -100%)",
            maxWidth: "260px",
            width: "max-content",
            padding: "7px 11px",
            borderRadius: "var(--radius-md)",
            background: "var(--color-surface)",
            boxShadow: "var(--shadow-lg)",
            fontFamily: "var(--font-sans)",
            fontSize: "12px",
            color: "var(--color-text-primary)",
            pointerEvents: "none",
          }}
        >
          How this question shows up when scanning or filtering responses on the dashboard — not
          shown to respondents. Unique within this form; other forms can reuse it, and a
          member&rsquo;s latest answer to the key is the one shown.
        </span>
      )}
    </span>
  );
}
