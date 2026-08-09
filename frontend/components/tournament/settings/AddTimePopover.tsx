"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { IconPlus } from "@/components/ui/Icons";
import { invitesApi, Invite, ApiError } from "@/lib/api";
import { HOUR_PRESETS } from "@/lib/invitePresets";

interface AddTimePopoverProps {
  tournamentId: number;
  invite: Invite;
  onUpdated: (invite: Invite) => void;
}

export function AddTimePopover({ tournamentId, invite, onUpdated }: AddTimePopoverProps) {
  const [open, setOpen] = useState(false);
  const [addingHours, setAddingHours] = useState<number | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  async function handleAdd(hours: number) {
    setError(undefined);
    setAddingHours(hours);
    try {
      const updated = await invitesApi.update(tournamentId, invite.id, { add_hours: hours });
      onUpdated(updated);
      setOpen(false);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Failed to add time.");
    } finally {
      setAddingHours(null);
    }
  }

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <Button
        type="button" variant="secondary" size="sm" iconOnly
        title="Add time"
        onClick={() => setOpen((v) => !v)}
        style={{ width: "28px", height: "28px", padding: 0 }}
      >
        <IconPlus size={14} />
      </Button>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 50,
          width: "160px", padding: "6px",
          background: "var(--color-surface)", border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)",
        }}>
          {HOUR_PRESETS.map((preset) => (
            <button
              key={preset.value}
              type="button"
              disabled={addingHours !== null}
              onClick={() => handleAdd(preset.hours)}
              style={{
                display: "block", width: "100%", textAlign: "left",
                padding: "7px 10px", border: "none", background: "transparent",
                fontFamily: "var(--font-sans)", fontSize: "13px",
                color: "var(--color-text-primary)", borderRadius: "var(--radius-sm)",
                cursor: addingHours !== null ? "not-allowed" : "pointer",
                opacity: addingHours !== null && addingHours !== preset.hours ? 0.5 : 1,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--color-bg)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              + {preset.label}
            </button>
          ))}
          {error && (
            <p style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-danger)", padding: "4px 10px 2px" }}>
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
