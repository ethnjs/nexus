"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formsApi, Form, FormStatus, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Spinner } from "@/components/ui/Spinner";
import { EditableText } from "@/components/ui/EditableText";
import { SplitButton, SplitButtonOption } from "@/components/ui/SplitButton";
import { IconArrowLeft, IconArchive, IconTrash } from "@/components/ui/Icons";

// Matches the eventual centered content column (title card, field list) —
// the sub-header's content is constrained the same way, Google-Forms-style,
// rather than stretching edge to edge.
const CONTENT_MAX_WIDTH = 800;

const STATUS_BADGE_VARIANT: Record<FormStatus, "default" | "confirmed" | "removed"> = {
  draft: "default",
  published: "confirmed",
  archived: "removed",
};

function StatusControl({ form, onUpdated, onDeleted }: {
  form: Form;
  onUpdated: (form: Form) => void;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  async function publish() {
    setBusy(true); setError(undefined);
    try {
      onUpdated(await formsApi.update(form.id, { status: "published" }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to publish form.");
    } finally {
      setBusy(false);
    }
  }

  async function archive() {
    setError(undefined);
    try {
      onUpdated(await formsApi.archive(form.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to archive form.");
    }
  }

  async function deleteForm() {
    setError(undefined);
    try {
      await formsApi.delete(form.id);
      onDeleted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete form.");
    }
  }

  const PRIMARY_LABEL: Record<FormStatus, string> = {
    draft: "Publish",
    published: "Published",
    archived: "Archived",
  };

  const options: SplitButtonOption[] = [
    ...(form.status !== "archived"
      ? [{ label: "Archive", subtitle: "Stop accepting responses", icon: <IconArchive size={14} />, action: archive }]
      : []),
    {
      label: "Delete",
      subtitle: "Permanently remove this form",
      icon: <IconTrash size={14} />,
      danger: true,
      disabled: form.response_count > 0,
      disabledReason: form.response_count > 0 ? "Archive instead — this form already has responses" : undefined,
      action: deleteForm,
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px" }}>
      <SplitButton
        label={PRIMARY_LABEL[form.status]}
        variant="primary"
        size="md"
        loading={busy}
        primaryDisabled={form.status !== "draft"}
        onClick={publish}
        options={options}
      />
      {error && (
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-danger)" }}>
          {error}
        </p>
      )}
    </div>
  );
}

function SubHeader({ form, onUpdated, onDeleted }: {
  form: Form;
  onUpdated: (form: Form) => void;
  onDeleted: () => void;
}) {
  const router = useRouter();
  const backHref = form.owner_type === "tournament" ? `/dashboard/tournaments/${form.tournament_id}/forms` : null;

  return (
    <div style={{ maxWidth: `${CONTENT_MAX_WIDTH}px`, margin: "0 auto", padding: "16px 24px 0" }}>
      <Card radius="lg" style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px",
        padding: "12px 20px",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "14px", minWidth: 0 }}>
          <Button
            type="button" variant="ghost" size="sm" iconOnly
            title="Back to forms"
            onClick={() => (backHref ? router.push(backHref) : router.back())}
          >
            <IconArrowLeft size={14} />
          </Button>
          <EditableText
            value={form.name}
            onSave={async (name) => onUpdated(await formsApi.update(form.id, { name }))}
            textStyle={{ fontSize: "15px", fontWeight: 600 }}
            title="Click to edit name"
          />
          <Badge variant={STATUS_BADGE_VARIANT[form.status]}>{form.status}</Badge>
        </div>
        <StatusControl form={form} onUpdated={onUpdated} onDeleted={onDeleted} />
      </Card>
    </div>
  );
}

export default function FormEditPage({ params }: { params: Promise<{ formId: string }> }) {
  const { formId } = use(params);
  const router = useRouter();

  const [form, setForm] = useState<Form | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    formsApi.get(formId)
      .then(setForm)
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : "Failed to load form."));
  }, [formId]);

  function handleDeleted() {
    if (form?.owner_type === "tournament") {
      router.push(`/dashboard/tournaments/${form.tournament_id}/forms`);
    } else {
      router.back();
    }
  }

  if (loadError) {
    return (
      <div style={{ padding: "22px 24px" }}>
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)" }}>
          {loadError}
        </p>
      </div>
    );
  }

  if (!form) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div>
      <SubHeader form={form} onUpdated={setForm} onDeleted={handleDeleted} />
      <div style={{ maxWidth: `${CONTENT_MAX_WIDTH}px`, margin: "0 auto", padding: "22px 24px" }}>
        <p style={{ fontFamily: "var(--font-sans)", color: "var(--color-text-secondary)" }}>
          Field list and title card land in later steps.
        </p>
      </div>
    </div>
  );
}
