"use client";

import { useEffect, useState } from "react";
import { FormActionIcon } from "@/components/forms/FormActionIcon";
import { FlowPane, FlowSection, FlowTitle } from "@/components/tournament/forms/flow/FlowPane";
import {
  completeConditions,
  PrerequisiteEditor,
  type RoleOption,
} from "@/components/tournament/forms/PrerequisiteEditor";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { IconEdit } from "@/components/ui/Icons";
import { Switch } from "@/components/ui/Switch";
import {
  ApiError,
  type FormListItem,
  type FormStatus,
  formsApi,
  type TournamentFormPrerequisites,
  tournamentOnboardingApi,
} from "@/lib/api";
import { FORM_ARCHIVED_REASON, formStatusActions } from "@/lib/forms/formStatusActions";
import { useToast } from "@/lib/useToast";

const STATUS_BADGE_VARIANT: Record<FormStatus, "warning" | "confirmed" | "removed"> = {
  draft: "warning",
  published: "confirmed",
  archived: "removed",
};

/** One form's settings: status, response edits, onboarding and prerequisites.
 *  Everything but prerequisites saves the moment it's changed. */
export function FormView({
  tournamentId,
  form,
  roles,
  lockedReason,
  onDirtyChange,
  onChanged,
}: {
  tournamentId: number;
  form: FormListItem;
  roles: RoleOption[];
  lockedReason?: string;
  onDirtyChange: (dirty: boolean) => void;
  /** Something saved; the forms list should reload. */
  onChanged: () => void;
}) {
  const { show } = useToast();
  const [busy, setBusy] = useState(false);
  // null until edited, so a reloaded form shows through instead of a stale copy.
  const [edited, setEdited] = useState<TournamentFormPrerequisites | null>(null);
  const prerequisites = edited ?? form.prerequisites ?? { roles: [] };
  const dirty =
    edited !== null &&
    JSON.stringify(edited) !== JSON.stringify(form.prerequisites ?? { roles: [] });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  async function run(action: () => Promise<unknown>, failure: string) {
    setBusy(true);
    try {
      await action();
      onChanged();
    } catch (e) {
      show(e instanceof ApiError ? e.message : failure, "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleSave() {
    if (completeConditions(prerequisites).length !== prerequisites.roles.length) {
      setError("Pick at least one role for each condition, or remove it.");
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      await formsApi.updatePrerequisites(tournamentId, form.id, prerequisites);
      setEdited(null);
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save the prerequisites.");
    } finally {
      setSaving(false);
    }
  }

  const isOnboarding = form.onboarding_order != null;
  const editsLockedReason =
    lockedReason ?? (form.status === "archived" ? FORM_ARCHIVED_REASON : undefined);
  const onboardingLockedReason =
    lockedReason ??
    (form.status === "archived" && !isOnboarding
      ? "Archived forms can't be added to onboarding."
      : undefined);

  return (
    <FlowPane
      title={
        <>
          <FlowTitle>{form.name}</FlowTitle>
          <Badge variant={STATUS_BADGE_VARIANT[form.status]}>{form.status}</Badge>
          {isOnboarding && <Badge variant="default">Onboarding #{form.onboarding_order}</Badge>}
        </>
      }
      actions={
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => window.open(`/forms/${form.id}/edit`, "_blank", "noopener,noreferrer")}
        >
          <IconEdit size={13} /> Edit form
        </Button>
      }
      dirty={dirty}
      saving={saving}
      error={error}
      lockedReason={lockedReason}
      onSave={handleSave}
      onCancel={() => {
        setEdited(null);
        setError(undefined);
      }}
    >
      <FlowSection label="Status">
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {formStatusActions(form, lockedReason)
            .filter((option) => option.action !== "delete")
            .map((option) => (
              <Button
                key={option.action}
                type="button"
                variant="secondary"
                size="sm"
                title={option.disabledReason ?? option.subtitle}
                disabled={!!option.disabledReason || busy}
                onClick={() =>
                  run(
                    () => formsApi.update(form.id, { status: option.target }),
                    `Failed to ${option.label.toLowerCase()}.`,
                  )
                }
              >
                <FormActionIcon action={option.action} size={13} /> {option.label}
              </Button>
            ))}
        </div>
      </FlowSection>

      <FlowSection label="Settings">
        <SwitchRow
          label="Allow response edits"
          description="Members can change their answers after submitting."
          checked={form.allow_response_edits}
          lockedReason={editsLockedReason}
          busy={busy}
          onChange={(allow) =>
            run(
              () => formsApi.update(form.id, { allow_response_edits: allow }),
              "Failed to change response edits.",
            )
          }
        />
        <SwitchRow
          label="Onboarding step"
          description={
            isOnboarding
              ? `Step ${form.onboarding_order} of onboarding. Reorder steps under Onboarding.`
              : "Add it to the end of the onboarding sequence."
          }
          checked={isOnboarding}
          lockedReason={onboardingLockedReason}
          busy={busy}
          onChange={(on) =>
            run(
              () =>
                on
                  ? tournamentOnboardingApi.addForm(tournamentId, form.id)
                  : tournamentOnboardingApi.removeForm(tournamentId, form.id),
              "Failed to change onboarding.",
            )
          }
        />
      </FlowSection>

      <FlowSection label="Prerequisites">
        <PrerequisiteEditor
          tournamentId={tournamentId}
          value={prerequisites}
          onChange={setEdited}
          roles={roles}
          locked={!!lockedReason}
        />
      </FlowSection>
    </FlowPane>
  );
}

function SwitchRow({
  label,
  description,
  checked,
  lockedReason,
  busy,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  lockedReason?: string;
  busy: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div
      title={lockedReason}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "16px",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
        <span style={{ fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 500 }}>
          {label}
        </span>
        <span
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: "12px",
            color: "var(--color-text-tertiary)",
          }}
        >
          {description}
        </span>
      </div>
      <Switch checked={checked} onChange={onChange} locked={!!lockedReason || busy} />
    </div>
  );
}
