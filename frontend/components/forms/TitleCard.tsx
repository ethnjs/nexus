"use client";

import { useState } from "react";
import { formsApi, Form, ApiError } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";

// Respondent-facing title/description — the first, most prominent card in
// the field list. Always editable-looking (not click-to-reveal like the
// sub-header's dashboard-facing name), using the app's standard Input/
// Textarea rather than an underline-only Google-Forms-style treatment.
export function TitleCard({ form, onUpdated }: {
  form: Form;
  onUpdated: (form: Form) => void;
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
    <Card radius="lg" style={{ padding: "24px", marginBottom: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
      <Input
        label="Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={saveTitle}
        font="sans"
        size="lg"
        fullWidth
      />
      <Textarea
        label="Description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onBlur={saveDescription}
        font="sans"
        rows={2}
        fullWidth
      />
      {error && (
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-danger)" }}>
          {error}
        </p>
      )}
    </Card>
  );
}
