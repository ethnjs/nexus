"use client";

/**
 * Which optional pieces of metadata an event row shows on the assignments
 * board, and the modal that configures it.
 */
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Toggle } from "@/components/ui/Toggle";

/** The metadata toggles. Split out from EventDisplayState because these are
 *  the part stored as `columns` — a flat list of what is on — while the
 *  tracks below are stored as `hidden`. */
interface EventMetaDisplay {
  division: boolean;
  type: boolean;
  room: boolean;
  /** The event's window — earliest shift start to latest shift end. */
  time: boolean;
  tracks: boolean;
}

export interface EventDisplayState extends EventMetaDisplay {
  /** Track ids dropped from the board entirely: a primary track's shifts stop
   *  being timeline columns, a cosmetic one's column leaves the no-shift
   *  area. Hidden-by-exception, so a track added later shows without anyone
   *  having to re-save. */
  hiddenTracks: number[];
}

export const DEFAULT_EVENT_DISPLAY: EventDisplayState = {
  division: true,
  type: true,
  room: true,
  time: true,
  tracks: true,
  hiddenTracks: [],
};

// Mirrors TRACK_NAMESPACE in core/tournament/display_config.py.
const TRACK_PREFIX = "track:";

// No "shifts" entry: the timeline in the people area *is* the shift display,
// so listing them again in the metadata would say the same thing twice.
const DISPLAY_FIELDS: { key: keyof EventMetaDisplay; label: string }[] = [
  { key: "division", label: "Division" },
  { key: "type", label: "Trial tag" },
  { key: "room", label: "Location" },
  { key: "time", label: "Time range" },
  { key: "tracks", label: "Tracks" },
];

/** The saved wire shape (a list of the turned-on keys, like a table's
    `columns`) into display state. Absent means "never saved" and falls back
    to the default — an empty array is a real answer, "show no metadata", and
    is why null and [] are kept apart. A key added to the modal later is off
    for anyone with a saved list, which is the price of storing what's on
    rather than what's off; with five fixed keys that beats a migration. */
export function eventDisplayFromColumns(
  columns: string[] | null | undefined,
  hidden?: string[] | null,
): EventDisplayState {
  const hiddenTracks = (hidden ?? [])
    .filter((item) => item.startsWith(TRACK_PREFIX))
    .map((item) => Number(item.slice(TRACK_PREFIX.length)))
    .filter((id) => Number.isInteger(id));
  if (!Array.isArray(columns)) return { ...DEFAULT_EVENT_DISPLAY, hiddenTracks };
  const on = new Set(columns);
  const meta = Object.fromEntries(
    DISPLAY_FIELDS.map(({ key }) => [key, on.has(key)]),
  ) as unknown as EventMetaDisplay;
  return { ...meta, hiddenTracks };
}

/** Hidden tracks as the stored wire shape. Namespaced the same way every
 *  other surface names a track, so one vocabulary covers them all. */
export function eventDisplayToHidden(display: EventDisplayState): string[] {
  return display.hiddenTracks.map((id) => `${TRACK_PREFIX}${id}`);
}

/** Display state as the stored wire shape. Order follows DISPLAY_FIELDS so
    two saves of the same config are byte-identical. */
export function eventDisplayToColumns(display: EventDisplayState): string[] {
  return DISPLAY_FIELDS.filter(({ key }) => display[key]).map(({ key }) => key);
}

export function EventDisplayModal({
  display,
  tracks,
  onApply,
  onClose,
}: {
  display: EventDisplayState;
  /** Every track the tournament runs, primary and cosmetic — the toggles
   *  below. Ordered as the catalog gives them, which is schedule order. */
  tracks: { id: number; name: string; is_primary: boolean }[];
  onApply: (next: EventDisplayState) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<EventDisplayState>(display);

  return (
    <Modal title="Configure event rows" onClose={onClose} width={640}>
      <div style={{ maxHeight: "60vh", overflowY: "auto", paddingRight: "4px" }}>
        <span style={{
          fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 600,
          letterSpacing: "0.06em", textTransform: "uppercase",
          color: "var(--color-text-tertiary)", display: "block", marginBottom: "8px",
        }}>
          Row metadata
        </span>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 20px" }}>
          {DISPLAY_FIELDS.map(({ key, label }) => (
            <div key={key} style={{
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px",
            }}>
              <span style={{ fontFamily: "var(--font-sans)", fontSize: "13px" }}>{label}</span>
              <Toggle
                checked={draft[key]}
                onChange={(checked) => setDraft((d) => ({ ...d, [key]: checked }))}
              />
            </div>
          ))}
        </div>

        {tracks.length > 0 && (
          <>
            <span style={{
              fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 600,
              letterSpacing: "0.06em", textTransform: "uppercase",
              color: "var(--color-text-tertiary)", display: "block",
              marginTop: "16px", marginBottom: "4px",
            }}>
              Tracks
            </span>
            <p style={{
              fontFamily: "var(--font-sans)", fontSize: "11px",
              color: "var(--color-text-tertiary)", margin: "0 0 8px",
            }}>
              Turning one off drops it from every row — a competition day loses its
              shift columns, a workstream loses its column in the no-shift area.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 20px" }}>
              {tracks.map((track) => (
                <div key={track.id} style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px",
                }}>
                  <span style={{
                    fontFamily: "var(--font-sans)", fontSize: "13px", minWidth: 0,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {track.name}
                  </span>
                  <Toggle
                    checked={!draft.hiddenTracks.includes(track.id)}
                    onChange={(checked) => setDraft((d) => ({
                      ...d,
                      hiddenTracks: checked
                        ? d.hiddenTracks.filter((id) => id !== track.id)
                        : [...d.hiddenTracks, track.id],
                    }))}
                  />
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", marginTop: "8px" }}>
        <Button type="button" variant="ghost" onClick={() => setDraft(DEFAULT_EVENT_DISPLAY)}>
          Reset
        </Button>
        <div style={{ display: "flex", gap: "8px" }}>
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="button" variant="primary" onClick={() => { onApply(draft); onClose(); }}>
            Apply
          </Button>
        </div>
      </div>
    </Modal>
  );
}
