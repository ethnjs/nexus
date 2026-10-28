"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  IconCopy,
  IconDotsVertical,
  IconEdit,
  IconEye,
  IconLink,
  IconMembers,
} from "@/components/ui/Icons";
import { Popover } from "@/components/ui/Popover";
import { Switch } from "@/components/ui/Switch";
import { ApiError, type FormStatus, formsApi, tournamentOnboardingApi } from "@/lib/api";
import { FORM_ARCHIVED_REASON } from "@/lib/forms/formStatusActions";
import { useToast } from "@/lib/useToast";

export type FormMenuKey =
  | "edit"
  | "preview"
  | "responses"
  | "copy-link"
  | "allow-edits"
  | "onboarding"
  | "copy-json";

const LABELS: Record<FormMenuKey, string> = {
  edit: "Edit",
  preview: "Preview",
  responses: "View responses",
  "copy-link": "Copy link",
  "allow-edits": "Allow response edits",
  onboarding: "Onboarding step",
  "copy-json": "Copy JSON",
};

function openInNewTab(path: string) {
  window.open(path, "_blank", "noopener,noreferrer");
}

// The ⋮ menu for a form — in the builder's header and on each forms-list row,
// which pass different `items`. "Copy JSON" is a debug/support escape hatch,
// not a TD feature: it copies the form as a respondent's renderer sees it
// (formsApi.get, hydrated options included), not getForEdit's raw shape.
export function FormActionsMenu({
  form,
  items,
  onAllowEditsChange,
  onOnboardingChange,
  lockedReason,
  size = "md",
}: {
  form: {
    id: string;
    status: FormStatus;
    allow_response_edits: boolean;
    tournament_id?: number | null;
    /** Required with the "onboarding" item. */
    onboarding_order?: number | null;
  };
  items: FormMenuKey[];
  /** Called with the saved value once the toggle's PATCH succeeds. */
  onAllowEditsChange: (allow: boolean) => void;
  /** Called with the form's new step number (null once it left) after the
   *  change saves. Leaving renumbers the steps after it. */
  onOnboardingChange?: (order: number | null) => void;
  /** Archived tournament — the toggle is a write, so it locks. */
  lockedReason?: string;
  /** "sm" on a table row, to match the row's other buttons. */
  size?: "sm" | "md";
}) {
  const { show } = useToast();
  const [busy, setBusy] = useState(false);
  const editsLockedReason =
    lockedReason ?? (form.status === "archived" ? FORM_ARCHIVED_REASON : undefined);
  const isOnboarding = form.onboarding_order != null;
  // An archived step can still be taken out; only joining needs a live form.
  const onboardingLockedReason =
    lockedReason ??
    (form.status === "archived" && !isOnboarding
      ? "Archived forms can't be added to onboarding."
      : undefined);

  async function copyJson() {
    const full = await formsApi.get(form.id);
    await navigator.clipboard.writeText(JSON.stringify(full, null, 2));
    show("Copied form JSON to clipboard");
  }

  async function copyLink() {
    await navigator.clipboard.writeText(`${window.location.origin}/forms/${form.id}`);
    show("Copied form link");
  }

  async function toggleEdits() {
    const updated = await formsApi.update(form.id, {
      allow_response_edits: !form.allow_response_edits,
    });
    onAllowEditsChange(updated.allow_response_edits);
    show(
      updated.allow_response_edits
        ? "Members can now edit their responses"
        : "Response edits locked",
    );
  }

  async function toggleOnboarding() {
    if (form.tournament_id == null) return;
    if (isOnboarding) {
      await tournamentOnboardingApi.removeForm(form.tournament_id, form.id);
      show("Removed from onboarding");
      onOnboardingChange?.(null);
    } else {
      const added = await tournamentOnboardingApi.addForm(form.tournament_id, form.id);
      show(`Added to onboarding as step ${added.order}`);
      onOnboardingChange?.(added.order ?? null);
    }
  }

  async function handleSelect(key: FormMenuKey) {
    if (key === "edit") return openInNewTab(`/forms/${form.id}/edit`);
    if (key === "preview") return openInNewTab(`/forms/${form.id}/preview`);
    if (key === "responses") return openInNewTab(`/forms/${form.id}/responses`);
    setBusy(true);
    try {
      if (key === "copy-link") await copyLink();
      else if (key === "copy-json") await copyJson();
      else if (key === "onboarding") await toggleOnboarding();
      else await toggleEdits();
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
          <Button
            type="button"
            variant={size === "sm" ? "secondary" : "ghost"}
            size={size}
            iconOnly
            title="More options"
            disabled={busy}
          >
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
            {key === "copy-link" && <IconLink size={13} />}
            {key === "copy-json" && <IconCopy size={13} />}
            <span style={{ flex: 1 }}>{LABELS[key]}</span>
            {(key === "allow-edits" || key === "onboarding") && (
              // Display only — selecting the row is what toggles it.
              <span style={{ pointerEvents: "none", display: "flex" }}>
                <Switch
                  checked={key === "onboarding" ? isOnboarding : form.allow_response_edits}
                  onChange={() => {}}
                />
              </span>
            )}
          </span>
        )}
        isDisabled={(key) =>
          key === "copy-link"
            ? form.status !== "published"
            : key === "onboarding"
              ? !!onboardingLockedReason
              : key === "allow-edits" && !!editsLockedReason
        }
        disabledReason={(key) =>
          key === "copy-link"
            ? "Publish the form to share its link."
            : key === "onboarding"
              ? onboardingLockedReason
              : editsLockedReason
        }
        onSelect={handleSelect}
        // A toggle row needs room for its label and switch side by side.
        width={items.includes("allow-edits") || items.includes("onboarding") ? 230 : 170}
      />
    </div>
  );
}
