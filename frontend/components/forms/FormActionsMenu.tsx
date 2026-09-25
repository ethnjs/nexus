"use client";

import { useState } from "react";
import { formsApi, ApiError } from "@/lib/api";
import { useToast } from "@/lib/useToast";
import { Button } from "@/components/ui/Button";
import { Popover } from "@/components/ui/Popover";
import { Switch } from "@/components/ui/Switch";
import { IconCopy, IconDotsVertical, IconEdit, IconEye, IconMembers } from "@/components/ui/Icons";

export type FormMenuKey = "edit" | "preview" | "responses" | "allow-edits" | "copy-json";

const LABELS: Record<FormMenuKey, string> = {
  "edit": "Edit",
  "preview": "Preview",
  "responses": "View responses",
  "allow-edits": "Allow response edits",
  "copy-json": "Copy JSON",
};

function openInNewTab(path: string) {
  window.open(path, "_blank", "noopener,noreferrer");
}

// The ⋮ menu for a form — in the builder's header and on each forms-list row,
// which pass different `items`. "Copy JSON" is a debug/support escape hatch,
// not a TD feature: it copies the form as a respondent's renderer sees it
// (formsApi.get, hydrated options included), not getForEdit's raw shape.
export function FormActionsMenu({ form, items, onAllowEditsChange, lockedReason, size = "md" }: {
  form: { id: string; allow_response_edits: boolean };
  items: FormMenuKey[];
  /** Called with the saved value once the toggle's PATCH succeeds. */
  onAllowEditsChange: (allow: boolean) => void;
  /** Archived tournament — the toggle is a write, so it locks. */
  lockedReason?: string;
  /** "sm" on a table row, to match the row's other buttons. */
  size?: "sm" | "md";
}) {
  const { show } = useToast();
  const [busy, setBusy] = useState(false);

  async function copyJson() {
    const full = await formsApi.get(form.id);
    await navigator.clipboard.writeText(JSON.stringify(full, null, 2));
    show("Copied form JSON to clipboard");
  }

  async function toggleEdits() {
    const updated = await formsApi.update(form.id, { allow_response_edits: !form.allow_response_edits });
    onAllowEditsChange(updated.allow_response_edits);
    show(updated.allow_response_edits ? "Members can now edit their responses" : "Response edits locked");
  }

  async function handleSelect(key: FormMenuKey) {
    if (key === "edit") return openInNewTab(`/forms/${form.id}/edit`);
    if (key === "preview") return openInNewTab(`/forms/${form.id}/preview`);
    if (key === "responses") return openInNewTab(`/forms/${form.id}/responses`);
    setBusy(true);
    try {
      await (key === "copy-json" ? copyJson() : toggleEdits());
    } catch (err) {
      show(err instanceof ApiError ? err.message : `Failed: ${LABELS[key]}.`, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    // stopPropagation: on a forms-list row, a click here mustn't also open the builder.
    <div onClick={(e) => e.stopPropagation()}>
      <Popover
        trigger={
          <Button type="button" variant={size === "sm" ? "secondary" : "ghost"} size={size} iconOnly title="More options" disabled={busy}>
            <IconDotsVertical size={16} />
          </Button>
        }
        items={items}
        getKey={(key) => key}
        renderLabel={(key) => (
          <span style={{ display: "flex", alignItems: "center", gap: "8px", width: "100%" }}>
            {key === "edit" && <IconEdit size={13} />}
            {key === "preview" && <IconEye size={13} />}
            {key === "responses" && <IconMembers size={13} />}
            {key === "copy-json" && <IconCopy size={13} />}
            <span style={{ flex: 1 }}>{LABELS[key]}</span>
            {key === "allow-edits" && (
              // Display only — selecting the row is what toggles it.
              <span style={{ pointerEvents: "none", display: "flex" }}>
                <Switch checked={form.allow_response_edits} onChange={() => {}} />
              </span>
            )}
          </span>
        )}
        isDisabled={(key) => key === "allow-edits" && !!lockedReason}
        disabledReason={() => lockedReason}
        onSelect={handleSelect}
        // The toggle row needs room for its label and switch side by side.
        width={items.includes("allow-edits") ? 230 : 170}
      />
    </div>
  );
}
