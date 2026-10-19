"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { RichTextInput } from "@/components/ui/RichTextInput";
import { ApiError, type Form, formsApi } from "@/lib/api";

// Respondent-facing title/description — the first, most prominent card in
// the field list. Always editable-looking, unlike the sub-header's
// click-to-reveal dashboard-facing name.
export function TitleCard({
  form,
  onUpdated,
  locked = false,
}: {
  form: Form;
  onUpdated: (form: Form) => void;
  locked?: boolean;
}) {
  const [title, setTitle] = useState(form.title ?? "");
  const [description, setDescription] = useState(form.description ?? "");
  const [error, setError] = useState<string | undefined>(undefined);

  async function saveTitle() {
    const trimmed = title.trim();
    if (trimmed === (form.title ?? "")) return;
    try {
      onUpdated(await formsApi.update(form.id, { title: trimmed }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update title.");
    }
  }

  async function saveDescription() {
    const trimmed = description.trim();
    if (trimmed === (form.description ?? "")) return;
    try {
      onUpdated(await formsApi.update(form.id, { description: trimmed }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update description.");
    }
  }

  return (
    <Card
      radius="lg"
      style={{
        padding: "24px",
        marginBottom: "16px",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
      }}
    >
      <RichTextInput
        label="Title"
        variant="inline"
        singleLine
        value={title}
        onChange={setTitle}
        onBlur={saveTitle}
        size="lg"
        fullWidth
        locked={locked}
      />
      <RichTextInput
        label="Description"
        variant="rich"
        value={description}
        onChange={setDescription}
        onBlur={saveDescription}
        fullWidth
        locked={locked}
      />
      {error && (
        <p
          style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-danger)" }}
        >
          {error}
        </p>
      )}
    </Card>
  );
}
