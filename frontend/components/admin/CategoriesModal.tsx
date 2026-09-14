"use client";

import { useState } from "react";
import { eventCategoriesApi, EventCategory, ApiError } from "@/lib/api";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { EditableText } from "@/components/ui/EditableText";
import { IconPlus, IconTrash } from "@/components/ui/Icons";

/**
 * Categories get a modal rather than a table of their own: there are five of
 * them and each is a single name, so a column on the events page would be
 * more chrome than content.
 *
 * Writes go straight through — there's no draft to cancel, and the caller
 * needs the updated list either way since the events table renders category
 * names.
 */
export function CategoriesModal({ categories, onChanged, onClose }: {
  categories: EventCategory[];
  /** Fires after every successful write, with the new full list. */
  onChanged: (categories: EventCategory[]) => void;
  onClose: () => void;
}) {
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  function sorted(list: EventCategory[]) {
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setError(undefined);
    setAdding(true);
    try {
      const created = await eventCategoriesApi.create({ name });
      onChanged(sorted([...categories, created]));
      setNewName("");
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Couldn't add that category.");
    } finally {
      setAdding(false);
    }
  }

  /** Rethrows so EditableText keeps the field open with the server's message. */
  async function handleRename(id: number, name: string) {
    const updated = await eventCategoriesApi.update(id, { name });
    onChanged(sorted(categories.map((c) => (c.id === id ? updated : c))));
  }

  async function handleDelete(category: EventCategory) {
    setError(undefined);
    setDeletingId(category.id);
    try {
      await eventCategoriesApi.delete(category.id);
      onChanged(categories.filter((c) => c.id !== category.id));
    } catch (err: unknown) {
      // 409 while events still point at it — the message names the reason.
      setError(err instanceof ApiError ? err.message : "Couldn't delete that category.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <Modal title="Event categories" onClose={onClose} width={480}>
      <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {categories.length === 0 ? (
            <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-tertiary)" }}>
              No categories yet.
            </p>
          ) : (
            categories.map((category, i) => (
              <div
                key={category.id}
                style={{
                  display: "flex", alignItems: "center", gap: "10px",
                  padding: "10px 0",
                  borderBottom: i === categories.length - 1 ? "none" : "1px solid var(--color-border)",
                }}
              >
                <span style={{ flex: 1, minWidth: 0 }}>
                  <EditableText
                    value={category.name}
                    textStyle={{ fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 500 }}
                    title="Click to rename"
                    onSave={(name) => handleRename(category.id, name)}
                  />
                </span>
                <Button
                  type="button" variant="secondary" size="sm" iconOnly
                  title="Delete category"
                  loading={deletingId === category.id}
                  onClick={() => handleDelete(category)}
                >
                  <IconTrash size={13} style={{ color: "var(--color-danger)" }} />
                </Button>
              </div>
            ))
          )}
        </div>

        <form onSubmit={handleAdd} style={{ display: "flex", gap: "8px", alignItems: "flex-end" }}>
          <Input
            placeholder="New category name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            font="sans"
            size="sm"
            fullWidth
          />
          <Button type="submit" variant="secondary" size="sm" loading={adding} disabled={!newName.trim()}>
            <IconPlus size={13} /> Add
          </Button>
        </form>

        {error && (
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)" }}>
            {error}
          </p>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button type="button" variant="secondary" onClick={onClose}>Done</Button>
        </div>
      </div>
    </Modal>
  );
}
