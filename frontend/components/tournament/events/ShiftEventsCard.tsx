"use client";

import { useMemo, useState } from "react";
import { tournamentShiftsApi, ApiError, TournamentEvent, TournamentShift } from "@/lib/api";
import { formatDateTime } from "@/lib/timeFormat";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Popover } from "@/components/ui/Popover";
import { IconX, IconPlus, IconCalendar } from "@/components/ui/Icons";

function eventName(e: TournamentEvent): string {
  return e.event?.name ?? e.name ?? "—";
}

interface ShiftEventsCardProps {
  tournamentId: number;
  shift: TournamentShift;
  events: TournamentEvent[];
  locked: boolean;
  onClose: () => void;
  onAttached: (event: TournamentEvent) => void;
  onDetached: (event: TournamentEvent) => void;
}

export function ShiftEventsCard({ tournamentId, shift, events, locked, onClose, onAttached, onDetached }: ShiftEventsCardProps) {
  const [error, setError] = useState<string | undefined>(undefined);

  const attachedEvents = useMemo(
    () => events.filter((e) => e.shifts.some((s) => s.id === shift.id)),
    [events, shift.id]
  );

  // Same bounds rule as the event panel's own shift picker, just from the
  // opposite direction — only offer events this shift fits entirely within.
  const eligibleEvents = useMemo(() => {
    const attachedIds = new Set(attachedEvents.map((e) => e.id));
    return events.filter((e) =>
      !attachedIds.has(e.id) && e.start_time && e.end_time && shift.start >= e.start_time && shift.end <= e.end_time
    );
  }, [events, attachedEvents, shift]);

  async function handleAttach(event: TournamentEvent) {
    setError(undefined);
    try {
      await tournamentShiftsApi.attach(tournamentId, event.id, shift.id);
      onAttached(event);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to attach event.");
      throw err;
    }
  }

  async function handleDetach(event: TournamentEvent) {
    setError(undefined);
    try {
      await tournamentShiftsApi.detach(tournamentId, event.id, shift.id);
      onDetached(event);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to detach event.");
    }
  }

  return (
    <Card radius="lg" style={{
      padding: "16px", display: "flex", flexDirection: "column",
      // Stretches down to roughly the bottom of the viewport (topbar +
      // page header/toolbar above it) instead of only being as tall as
      // its own content; scrolls internally if the event list runs long.
      height: "calc(100vh - 255px)", overflowY: "auto",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px", marginBottom: "14px" }}>
        <div style={{ minWidth: 0 }}>
          <h3 style={{ fontFamily: "var(--font-serif)", fontSize: "17px" }}>{shift.label}</h3>
          <div style={{ marginTop: "4px", display: "flex", flexDirection: "column", gap: "2px" }}>
            <p style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--color-text-secondary)" }}>
              <span style={{ color: "var(--color-text-tertiary)" }}>Start: </span>{formatDateTime(shift.start)}
            </p>
            <p style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--color-text-secondary)" }}>
              <span style={{ color: "var(--color-text-tertiary)" }}>End: </span>{formatDateTime(shift.end)}
            </p>
          </div>
        </div>
        <Button type="button" variant="secondary" size="sm" iconOnly title="Close" onClick={onClose} style={{ flexShrink: 0 }}>
          <IconX size={13} />
        </Button>
      </div>

      <div style={{
        fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 600,
        letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--color-text-tertiary)",
        marginBottom: "8px",
      }}>
        Events — {attachedEvents.length}
      </div>

      {attachedEvents.length === 0 ? (
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-tertiary)", marginBottom: "12px" }}>
          No events yet.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "12px" }}>
          {attachedEvents.map((event) => (
            <div
              key={event.id}
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px",
                padding: "8px 10px", borderRadius: "var(--radius-md)",
                border: "1px solid var(--color-border)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                <IconCalendar size={13} style={{ color: "var(--color-text-tertiary)", flexShrink: 0 }} />
                <span style={{
                  fontFamily: "var(--font-sans)", fontSize: "13px",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {eventName(event)}
                </span>
              </div>
              {!locked && (
                <button
                  type="button"
                  onClick={() => handleDetach(event)}
                  title="Remove"
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    border: "none", background: "transparent", padding: "2px",
                    color: "var(--color-text-tertiary)", cursor: "pointer", flexShrink: 0,
                  }}
                >
                  <IconX size={12} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {!locked && (
        <Popover
          trigger={
            <Button type="button" variant="secondary" size="sm" fullWidth>
              <IconPlus size={12} /> Add event
            </Button>
          }
          items={eligibleEvents}
          getKey={(e) => e.id}
          renderLabel={(e) => eventName(e)}
          emptyMessage="No events fit within this shift's time window."
          onSelect={handleAttach}
          width={260}
          checklist
          // Every item here is, by construction, not yet attached — checking
          // one attaches it and it drops out of this list on the next
          // render. Checklist mode just keeps the popover open across
          // several picks instead of closing after each one.
          isSelected={() => false}
        />
      )}

      {error && (
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-danger)", marginTop: "10px" }}>
          {error}
        </p>
      )}
    </Card>
  );
}
