"use client";

import { useState } from "react";
import { universitiesApi, University, ApiError } from "@/lib/api";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

export function NewUniversityModal({ onClose, onCreated }: {
  onClose: () => void;
  onCreated: (university: University) => void;
}) {
  const [name, setName] = useState("");
  const [abbreviation, setAbbreviation] = useState("");
  const [location, setLocation] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  const canSubmit = name.trim().length > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setError(undefined);
    setSaving(true);
    try {
      const created = await universitiesApi.create({
        name: name.trim(),
        // Empty means "not set", not an empty string — the column is nullable
        // and a "" abbreviation would win over the name in placeOfShort.
        abbreviation: abbreviation.trim() || null,
        location: location.trim() || null,
      });
      onCreated(created);
      onClose();
    } catch (err: unknown) {
      // 409 on a duplicate name is the common one, and its message names the
      // conflict, so it's shown as-is.
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
      setSaving(false);
    }
  }

  return (
    <Modal title="Add university" onClose={onClose}>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        <Input
          label="Name"
          placeholder="California Institute of Technology"
          value={name}
          onChange={(e) => setName(e.target.value)}
          font="sans"
          fullWidth
          required
          autoFocus
        />
        <Input
          label="Abbreviation"
          placeholder="Caltech"
          value={abbreviation}
          onChange={(e) => setAbbreviation(e.target.value)}
          font="sans"
          fullWidth
        />
        <Input
          label="Location"
          placeholder="Pasadena, CA"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          font="sans"
          fullWidth
        />

        {error && (
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)" }}>
            {error}
          </p>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "6px" }}>
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" variant="primary" loading={saving} disabled={!canSubmit}>
            Add university
          </Button>
        </div>
      </form>
    </Modal>
  );
}
