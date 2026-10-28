"use client";

import { useEffect, useState } from "react";
import {
  completeConditions,
  PrerequisiteEditor,
  type RoleOption,
} from "@/components/tournament/forms/PrerequisiteEditor";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { ApiError, formsApi, rolesApi, type TournamentFormPrerequisites } from "@/lib/api";

/** One form's prerequisites, opened from its ⋮ menu. */
export function PrerequisitesModal({
  tournamentId,
  form,
  lockedReason,
  onClose,
  onSaved,
}: {
  tournamentId: number;
  form: { id: string; name: string; prerequisites: TournamentFormPrerequisites | null };
  /** Archived tournament — readable, not editable. */
  lockedReason?: string;
  onClose: () => void;
  onSaved: (prerequisites: TournamentFormPrerequisites) => void;
}) {
  const [draft, setDraft] = useState<TournamentFormPrerequisites>(
    form.prerequisites ?? { roles: [] },
  );
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    rolesApi
      .list(tournamentId)
      .then((list) => setRoles(list.map((r) => ({ id: r.id, label: r.label }))))
      .catch(() => {});
  }, [tournamentId]);

  async function handleSave() {
    if (completeConditions(draft).length !== draft.roles.length) {
      setError("Pick at least one role for each condition, or remove it.");
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      const updated = await formsApi.updatePrerequisites(tournamentId, form.id, draft);
      onSaved(updated.prerequisites ?? { roles: [] });
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save the prerequisites.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={`Prerequisites for ${form.name}`}
      onClose={onClose}
      closeOnOverlayClick={false}
      width={560}
      footer={
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {error && (
            <p
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: "13px",
                color: "var(--color-danger)",
              }}
            >
              {error}
            </p>
          )}
          <div style={{ display: "flex", gap: "8px" }}>
            <Button type="button" variant="secondary" size="md" fullWidth onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              size="md"
              fullWidth
              disabled={!!lockedReason}
              title={lockedReason}
              loading={saving}
              onClick={handleSave}
            >
              Save
            </Button>
          </div>
        </div>
      }
    >
      <PrerequisiteEditor
        tournamentId={tournamentId}
        value={draft}
        onChange={setDraft}
        roles={roles}
        locked={!!lockedReason}
        showMatching={false}
      />
    </Modal>
  );
}
