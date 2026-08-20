"use client";

import { use, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formsApi, Form, FormStatus, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { Spinner } from "@/components/ui/Spinner";
import { SplitButton, SplitButtonOption } from "@/components/ui/SplitButton";
import { IconArrowLeft, IconArchive, IconTrash } from "@/components/ui/Icons";

const STATUS_BADGE_VARIANT: Record<FormStatus, "default" | "confirmed" | "removed"> = {
  draft: "default",
  published: "confirmed",
  archived: "removed",
};

function EditableName({ form, onUpdated }: {
  form: Form;
  onUpdated: (form: Form) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(form.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  function startEdit() {
    setValue(form.name);
    setError(undefined);
    setEditing(true);
  }

  async function save() {
    const trimmed = value.trim();
    if (!trimmed || trimmed === form.name) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const updated = await formsApi.update(form.id, { name: trimmed });
      onUpdated(updated);
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update name.");
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <Input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); save(); }
          if (e.key === "Escape") { e.preventDefault(); setEditing(false); }
        }}
        error={error}
        disabled={saving}
        size="sm"
        font="sans"
      />
    );
  }

  return (
    <span
      onClick={startEdit}
      title="Click to edit name"
      style={{
        fontFamily: "var(--font-sans)", fontSize: "15px", fontWeight: 600,
        color: "var(--color-text-primary)", cursor: "pointer",
      }}
    >
      {form.name}
    </span>
  );
}

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
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px",
      padding: "14px 24px", background: "var(--color-surface)", borderBottom: "1px solid var(--color-border)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "14px", minWidth: 0 }}>
        <Button
          type="button" variant="ghost" size="sm" iconOnly
          title="Back to forms"
          onClick={() => (backHref ? router.push(backHref) : router.back())}
        >
          <IconArrowLeft size={14} />
        </Button>
        <EditableName form={form} onUpdated={onUpdated} />
        <Badge variant={STATUS_BADGE_VARIANT[form.status]}>{form.status}</Badge>
      </div>
      <StatusControl form={form} onUpdated={onUpdated} onDeleted={onDeleted} />
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
      <div style={{ padding: "22px 24px" }}>
        <p style={{ fontFamily: "var(--font-sans)", color: "var(--color-text-secondary)" }}>
          Field list and title card land in later steps.
        </p>
      </div>
    </div>
  );
}
