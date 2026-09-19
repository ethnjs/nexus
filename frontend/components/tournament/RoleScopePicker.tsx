"use client";

import { useState } from "react";
import { ApiError, type TournamentTrack } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { CheckboxList } from "@/components/ui/CheckboxList";
import { NO_SCOPE, WIDE_SCOPE, isEmptyScope, type RoleScope } from "@/lib/roles/roleScope";

/**
 * Where a role applies, as checkboxes: the whole tournament, or any tracks.
 *
 * Picking "Whole tournament" clears the tracks and locks them — it already
 * covers every one, so a ticked track beside it would read as a narrower claim
 * than the grant makes.
 */
export function RoleScopePicker({ tracks, value, onChange }: {
  tracks: TournamentTrack[];
  value: RoleScope;
  onChange: (scope: RoleScope) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <CheckboxList
        options={[{ value: "wide", label: "Whole tournament" }]}
        value={value.wide ? ["wide"] : []}
        onChange={() => onChange(value.wide ? NO_SCOPE : WIDE_SCOPE)}
      />
      <CheckboxList
        options={tracks.map((t) => ({ value: String(t.id), label: t.name }))}
        value={value.trackIds.map(String)}
        locked={value.wide}
        onChange={(v) => {
          const id = Number(v);
          onChange({
            wide: false,
            trackIds: value.trackIds.includes(id)
              ? value.trackIds.filter((x) => x !== id)
              : [...value.trackIds, id].sort((a, b) => a - b),
          });
        }}
      />
    </div>
  );
}

/** The picker with its own draft, Apply and Cancel — the body of a popover. */
export function RoleScopeForm({ tracks, initial, applyLabel, onApply, onCancel }: {
  tracks: TournamentTrack[];
  initial: RoleScope;
  applyLabel: string;
  onApply: (scope: RoleScope) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<RoleScope>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  async function apply() {
    setSaving(true);
    setError(undefined);
    try {
      await onApply(draft);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That change didn't save.");
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <RoleScopePicker tracks={tracks} value={draft} onChange={setDraft} />
      {error && (
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-danger)", margin: 0 }}>
          {error}
        </p>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
        <Button type="button" variant="secondary" size="sm" onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button type="button" variant="primary" size="sm" loading={saving} disabled={isEmptyScope(draft)} onClick={apply}>
          {applyLabel}
        </Button>
      </div>
    </div>
  );
}
