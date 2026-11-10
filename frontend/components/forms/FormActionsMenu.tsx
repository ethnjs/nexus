"use client";

import { useState } from "react";
import { FormActionIcon } from "@/components/forms/FormActionIcon";
import { Button } from "@/components/ui/Button";
import {
  IconCopy,
  IconDotsVertical,
  IconEdit,
  IconEye,
  IconFilter,
  IconLink,
  IconMembers,
} from "@/components/ui/Icons";
import { Popover } from "@/components/ui/Popover";
import { Switch } from "@/components/ui/Switch";
import { ApiError, type FormStatus, formsApi, tournamentOnboardingApi } from "@/lib/api";
import { FORM_ARCHIVED_REASON, type FormActionOption } from "@/lib/forms/formStatusActions";
import { useToast } from "@/lib/useToast";

export type FormMenuKey =
  | "edit"
  | "preview"
  | "responses"
  | "copy-link"
  | "allow-edits"
  | "onboarding"
  | "prerequisites"
  | "copy-json";

const LABELS: Record<FormMenuKey, string> = {
  edit: "Edit",
  preview: "Preview",
  responses: "View responses",
  "copy-link": "Copy link",
  "allow-edits": "Allow response edits",
  onboarding: "Onboarding step",
  prerequisites: "Edit prerequisites",
  "copy-json": "Copy JSON",
};

type MenuItem = FormMenuKey | FormActionOption;

function openInNewTab(path: string) {
  window.open(path, "_blank", "noopener,noreferrer");
}

export function copyFormLink(formId: string) {
  return navigator.clipboard.writeText(`${window.location.origin}/forms/${formId}`);
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
  onEditPrerequisites,
  statusActions = [],
  onStatusAction,
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
  /** Opens the form's prerequisites editor — the caller owns the modal. */
  onEditPrerequisites?: () => void;
  /** Listed under a Status heading after `items`. */
  statusActions?: FormActionOption[];
  onStatusAction?: (option: FormActionOption) => Promise<void>;
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
    await copyFormLink(form.id);
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

  async function handleSelect(item: MenuItem) {
    if (typeof item !== "string") return onStatusAction?.(item);
    const key = item;
    if (key === "edit") return openInNewTab(`/forms/${form.id}/edit`);
    if (key === "preview") return openInNewTab(`/forms/${form.id}/preview`);
    if (key === "responses") return openInNewTab(`/forms/${form.id}/responses`);
    if (key === "prerequisites") return onEditPrerequisites?.();
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
        items={[...items, ...statusActions]}
        getKey={(item) => (typeof item === "string" ? item : item.action)}
        getGroup={(item) => (typeof item === "string" ? undefined : "Status")}
        renderLabel={(item) =>
          typeof item === "string" ? (
            <span style={{ display: "flex", alignItems: "center", gap: "8px", width: "100%" }}>
              {item === "edit" && <IconEdit size={13} />}
              {item === "preview" && <IconEye size={13} />}
              {item === "responses" && <IconMembers size={13} />}
              {item === "copy-link" && <IconLink size={13} />}
              {item === "copy-json" && <IconCopy size={13} />}
              {item === "prerequisites" && <IconFilter size={13} />}
              <span style={{ flex: 1 }}>{LABELS[item]}</span>
              {(item === "allow-edits" || item === "onboarding") && (
                // Display only — selecting the row is what toggles it.
                <span style={{ pointerEvents: "none", display: "flex" }}>
                  <Switch
                    checked={item === "onboarding" ? isOnboarding : form.allow_response_edits}
                    onChange={() => {}}
                  />
                </span>
              )}
            </span>
          ) : (
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                color: item.danger ? "var(--color-danger)" : undefined,
              }}
            >
              <FormActionIcon action={item.action} size={13} />
              {item.label}
            </span>
          )
        }
        isDisabled={(item) =>
          typeof item !== "string"
            ? !!item.disabledReason
            : item === "copy-link"
              ? form.status !== "published"
              : item === "onboarding"
                ? !!onboardingLockedReason
                : item === "allow-edits" && !!editsLockedReason
        }
        disabledReason={(item) =>
          typeof item !== "string"
            ? item.disabledReason
            : item === "copy-link"
              ? "Publish the form to share its link."
              : item === "onboarding"
                ? onboardingLockedReason
                : editsLockedReason
        }
        onSelect={handleSelect}
        width="auto"
      />
    </div>
  );
}
