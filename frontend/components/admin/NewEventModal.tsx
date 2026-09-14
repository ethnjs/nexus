"use client";

import { useState } from "react";
import { canonicalEventsApi, CanonicalEvent, EventCategory, ApiError } from "@/lib/api";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Dropdown } from "@/components/ui/Dropdown";
import { Button } from "@/components/ui/Button";
import { useActionToast } from "@/lib/useActionToast";

export function NewEventModal({ categories, onClose, onCreated }: {
  categories: EventCategory[];
  onClose: () => void;
  onCreated: (event: CanonicalEvent) => void;
}) {
  const run = useActionToast();
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState<string>(
    categories.length === 1 ? String(categories[0].id) : "",
  );
  const [error, setError] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  const canSubmit = name.trim().length > 0 && categoryId !== "";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setError(undefined);
    setSaving(true);
    try {
      const created = await run(`${name.trim()} added`, () => canonicalEventsApi.create({
        name: name.trim(),
        category_id: Number(categoryId),
      }));
      onCreated(created);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
      setSaving(false);
    }
  }

  return (
    <Modal title="Add event" onClose={onClose}>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        <Input
          label="Name"
          placeholder="Anatomy & Physiology"
          value={name}
          onChange={(e) => setName(e.target.value)}
          font="sans"
          fullWidth
          required
          autoFocus
        />
        {/* Category is required by the API, so there's no "none" option —
            an event with no category has nowhere to sit in the catalog. */}
        <Dropdown
          label="Category"
          required
          value={categoryId}
          onChange={setCategoryId}
          options={categories.map((c) => ({ value: String(c.id), label: c.name }))}
          placeholder="Pick a category…"
          fullWidth
        />

        {categories.length === 0 && (
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-tertiary)" }}>
            Add a category first — every event belongs to one.
          </p>
        )}

        {error && (
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)" }}>
            {error}
          </p>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "6px" }}>
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" variant="primary" loading={saving} disabled={!canSubmit}>
            Add event
          </Button>
        </div>
      </form>
    </Modal>
  );
}
