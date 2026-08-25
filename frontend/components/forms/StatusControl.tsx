"use client";

import { useState } from "react";
import { formsApi, Form, FormStatus, ApiError } from "@/lib/api";
import { SplitButton, SplitButtonOption } from "@/components/ui/SplitButton";
import { IconArchive, IconTrash } from "@/components/ui/Icons";

const PRIMARY_LABEL: Record<FormStatus, string> = {
  draft: "Publish",
  published: "Published",
  archived: "Archived",
};

export function StatusControl({ form, onUpdated, onDeleted }: {
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
