"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { formsApi, Form, FormListItem, FormStatus, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/useAuth";
import { useMyMembership } from "@/lib/useMyMembership";
import { Card } from "@/components/ui/Card";
import table from "@/components/ui/Table.module.css";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { IconForms, IconLock, IconEdit, IconEye, IconPlus } from "@/components/ui/Icons";
import { formatRelativeTime } from "@/lib/timeFormat";
import { CreatorHoverCard } from "@/components/tournament/CreatorHoverCard";
import { NewFormModal } from "@/components/tournament/forms/NewFormModal";
import { BulkDeleteModal } from "@/components/ui/BulkDeleteModal";
import { FormActionIcon } from "@/components/forms/FormActionIcon";
import { FormActionOption, formStatusActions } from "@/lib/forms/formStatusActions";
import { useToast } from "@/lib/useToast";
import { useArchiveLock } from "@/lib/useArchiveLock";

// Name / Status / Creator / Responses / Updated / Actions. Name and Creator
// share the free space (Name used to take ~5x Creator's share). Actions is
// fixed, not auto: each row is its own grid, so a width that followed the
// button count would misalign rows. 170px fits the most a row ever shows —
// edit, preview, a status move, archive, delete.
const FORM_ROW_COLUMNS = "minmax(0, 1.2fr) 100px minmax(0, 1fr) 90px 100px 170px";

const STATUS_BADGE_VARIANT: Record<FormStatus, "default" | "confirmed" | "removed"> = {
  draft: "default",
  published: "confirmed",
  archived: "removed",
};

function FormRow({ form, onAction, lockedReason }: {
  form: FormListItem;
  onAction: (form: FormListItem, option: FormActionOption) => Promise<void>;
  lockedReason?: string;
}) {
  const [busy, setBusy] = useState(false);

  async function act(option: FormActionOption) {
    setBusy(true);
    await onAction(form, option);
    setBusy(false);
  }

  return (
    <div
      className={`${table.row} ${table.clickable}`}
      // New tab, same as the Edit button: the builder is a long-lived editing
      // session, and losing this list (with its filters and scroll) to go back
      // and forth is worse than an extra tab.
      onClick={() => window.open(`/forms/${form.id}/edit`, "_blank", "noopener,noreferrer")}
    >
      <span style={{
        fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 500,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {form.name}
      </span>
      <Badge variant={STATUS_BADGE_VARIANT[form.status]} style={{ justifySelf: "center" }}>
        {form.status}
      </Badge>
      <CreatorHoverCard
        creator={form.creator}
        noMembershipLabel={form.owner_type === "tournament" ? "No membership in this tournament" : "No membership in this chapter"}
        style={{ justifyContent: "flex-start", justifySelf: "start", width: "100%" }}
      />
      <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--color-text-secondary)", textAlign: "center" }}>
        {form.response_count}
      </span>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--color-text-secondary)", textAlign: "center" }}>
        {formatRelativeTime(form.updated_at)}
      </span>
      {/* stopPropagation on the whole strip, so a click in a gap doesn't open the builder. */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "6px" }} onClick={(e) => e.stopPropagation()}>
        {/* Which moves exist depends on the status and on whether anyone has
            responded — the same rules the builder's status menu uses. */}
        {formStatusActions(form, lockedReason).map((option) => (
          <Button
            key={option.action}
            type="button" variant="secondary" size="sm" iconOnly
            title={option.disabledReason ?? option.label}
            disabled={!!option.disabledReason || busy}
            onClick={() => act(option)}
            style={option.danger ? { color: "var(--color-danger)" } : undefined}
          >
            <FormActionIcon action={option.action} />
          </Button>
        ))}
        <Button
          type="button" variant="secondary" size="sm" iconOnly
          title="Edit"
          onClick={(e) => { e.stopPropagation(); window.open(`/forms/${form.id}/edit`, "_blank", "noopener,noreferrer"); }}
        >
          <IconEdit size={14} />
        </Button>
        <Button
          type="button" variant="secondary" size="sm" iconOnly
          title="Preview"
          onClick={(e) => { e.stopPropagation(); window.open(`/forms/${form.id}/preview`, "_blank", "noopener,noreferrer"); }}
        >
          <IconEye size={14} />
        </Button>
      </div>
    </div>
  );
}

function FormTable({ forms, onAction, lockedReason }: {
  forms: FormListItem[];
  onAction: (form: FormListItem, option: FormActionOption) => Promise<void>;
  lockedReason?: string;
}) {
  return (
    <Card radius="lg" style={{ padding: "8px 12px", marginBottom: "16px" }}>
      <div
        className={table.table}
        style={{ gridTemplateColumns: FORM_ROW_COLUMNS }}
      >
      <div className={table.header}>
        <span>Forms — {forms.length}</span>
        <span style={{ textAlign: "center" }}>Status</span>
        <span>Creator</span>
        <span style={{ textAlign: "center" }}>Responses</span>
        <span style={{ textAlign: "center" }}>Updated</span>
        <span />
      </div>

      {forms.map((form) => (
        <FormRow key={form.id} form={form} onAction={onAction} lockedReason={lockedReason} />
      ))}
      </div>
    </Card>
  );
}

export default function FormsPage() {
  const params = useParams();
  const tournamentId = Number(params.id);

  const { user: currentUser } = useAuth();
  const { membership, hasPermission, loading: membershipLoading } = useMyMembership();
  const canManageForms = currentUser?.role === "admin" || !!membership?.is_owner || hasPermission("manage_forms");
  const { isArchived, archivedReason } = useArchiveLock();

  const [forms, setForms] = useState<FormListItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<FormListItem | null>(null);
  const { show } = useToast();

  useEffect(() => {
    if (!canManageForms) return;
    formsApi.listForTournament(tournamentId)
      .then(setForms)
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : "Failed to load forms."));
  }, [tournamentId, canManageForms]);

  if (membershipLoading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
        <Spinner size="lg" />
      </div>
    );
  }

  if (!canManageForms) {
    return (
      <Card radius="lg" style={{ padding: "8px" }}>
        <EmptyState
          icon={<IconLock size={28} />}
          title="No access"
          description="You need the manage forms permission to view this page."
        />
      </Card>
    );
  }

  if (forms === null) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
        <Spinner size="lg" />
      </div>
    );
  }

  // Delete confirms first; every other move is one PATCH. The server's
  // message is the one worth showing on failure — publishing validates the
  // form, and an onboarding form refuses to archive.
  async function handleAction(form: FormListItem, option: FormActionOption) {
    if (option.action === "delete") {
      setDeleteTarget(form);
      return;
    }
    try {
      const updated = await formsApi.update(form.id, { status: option.target });
      setForms((prev) => prev && prev.map((f) => (
        f.id === updated.id ? { ...f, status: updated.status, updated_at: updated.updated_at } : f
      )));
    } catch (err) {
      show(err instanceof ApiError ? err.message : `Failed to ${option.label.toLowerCase()}.`, "error");
    }
  }

  // Submit -> POST -> builder in a new tab. title/description are set later,
  // inside the builder — not part of this modal.
  function handleCreated(form: Form) {
    window.open(`/forms/${form.id}/edit`, "_blank", "noopener,noreferrer");
    setCreating(false);
    // The builder opened in the other tab, so this list would otherwise sit
    // here without the row that was just created.
    formsApi.listForTournament(tournamentId).then(setForms).catch(() => {});
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "16px" }}>
        <Button
          type="button" variant="primary" size="md" onClick={() => setCreating(true)}
          disabled={isArchived} title={archivedReason}
        >
          <IconPlus size={14} /> New Form
        </Button>
      </div>

      {loadError && (
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)", marginBottom: "10px" }}>
          {loadError}
        </p>
      )}

      {forms.length === 0 ? (
        <Card radius="lg" style={{ padding: "8px" }}>
          <EmptyState
            icon={<IconForms size={28} />}
            title="No forms yet"
            description="Create a form to start collecting responses from members."
            action={
              <Button
                type="button" variant="primary" size="sm" onClick={() => setCreating(true)}
                disabled={isArchived} title={archivedReason}
              >
                <IconPlus size={14} /> New Form
              </Button>
            }
          />
        </Card>
      ) : (
        <FormTable forms={forms} onAction={handleAction} lockedReason={archivedReason} />
      )}

      {deleteTarget && (
        <BulkDeleteModal
          items={[deleteTarget]}
          noun="form"
          description={<>Delete <strong>{deleteTarget.name}</strong>? It has no responses, so nothing else is lost. This can&rsquo;t be undone.</>}
          onDelete={(form) => formsApi.delete(form.id)}
          onClose={() => setDeleteTarget(null)}
          onDeleted={(ids) => setForms((prev) => prev && prev.filter((f) => !ids.includes(f.id)))}
        />
      )}

      {creating && (
        <NewFormModal
          tournamentId={tournamentId}
          onClose={() => setCreating(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}
