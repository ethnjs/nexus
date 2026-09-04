"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { formsApi, Form, FormListItem, FormStatus, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/useAuth";
import { useMyMembership } from "@/lib/useMyMembership";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { IconForms, IconLock, IconEdit, IconEye, IconPlus } from "@/components/ui/Icons";
import { formatRelativeTime } from "@/lib/timeFormat";
import { CreatorHoverCard } from "@/components/tournament/CreatorHoverCard";
import { NewFormModal } from "@/components/tournament/forms/NewFormModal";

// Name / Status / Creator / Responses / Updated / Actions
const FORM_ROW_COLUMNS = "1.4fr 110px 0.275fr 100px 110px 76px";

const STATUS_BADGE_VARIANT: Record<FormStatus, "default" | "confirmed" | "removed"> = {
  draft: "default",
  published: "confirmed",
  archived: "removed",
};

function FormRow({ form, isLast }: {
  form: FormListItem;
  isLast: boolean;
}) {
  const router = useRouter();
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => router.push(`/forms/${form.id}/edit`)}
      style={{
        display: "grid", gridTemplateColumns: FORM_ROW_COLUMNS, alignItems: "center",
        gap: "8px", padding: "10px 12px", cursor: "pointer",
        borderBottom: isLast ? "none" : "1px solid var(--color-border)",
        background: hovered ? "var(--color-bg)" : "transparent",
        transition: "background 100ms ease",
      }}
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
      <div style={{ display: "flex", justifyContent: "center", gap: "6px" }}>
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
          onClick={(e) => { e.stopPropagation(); router.push(`/forms/${form.id}/preview`); }}
        >
          <IconEye size={14} />
        </Button>
      </div>
    </div>
  );
}

function FormTable({ forms }: { forms: FormListItem[] }) {
  return (
    <Card radius="lg" style={{ padding: "8px 12px", marginBottom: "16px" }}>
      <div style={{
        display: "grid", gridTemplateColumns: FORM_ROW_COLUMNS, gap: "8px",
        padding: "12px 12px", fontFamily: "var(--font-sans)", fontSize: "11px",
        fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase",
        color: "var(--color-text-tertiary)",
      }}>
        <span>Forms — {forms.length}</span>
        <span style={{ textAlign: "center" }}>Status</span>
        <span>Creator</span>
        <span style={{ textAlign: "center" }}>Responses</span>
        <span style={{ textAlign: "center" }}>Updated</span>
        <span />
      </div>

      {forms.map((form, i) => (
        <FormRow key={form.id} form={form} isLast={i === forms.length - 1} />
      ))}
    </Card>
  );
}

export default function FormsPage() {
  const params = useParams();
  const tournamentId = Number(params.id);

  const { user: currentUser } = useAuth();
  const { membership, hasPermission, loading: membershipLoading } = useMyMembership();
  const canManageForms = currentUser?.role === "admin" || !!membership?.is_owner || hasPermission("manage_forms");

  const [forms, setForms] = useState<FormListItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

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

  // Submit -> POST -> redirect straight into the builder. title/description
  // are set later, inside the builder — not part of this modal.
  function handleCreated(form: Form) {
    window.open(`/forms/${form.id}/edit`, "_blank", "noopener,noreferrer");
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "16px" }}>
        <Button type="button" variant="primary" size="md" onClick={() => setCreating(true)}>
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
              <Button type="button" variant="primary" size="sm" onClick={() => setCreating(true)}>
                <IconPlus size={14} /> New Form
              </Button>
            }
          />
        </Card>
      ) : (
        <FormTable forms={forms} />
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
