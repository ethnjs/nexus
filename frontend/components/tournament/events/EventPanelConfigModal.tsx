"use client";

import { EVENT_PANEL } from "@/lib/displayConfigSurfaces";
import { useDisplayConfigDraft } from "@/lib/useDisplayConfigDraft";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { ChipInput } from "@/components/ui/ChipInput";
import { Popover } from "@/components/ui/Popover";
import { Spinner } from "@/components/ui/Spinner";
import { IconPlus } from "@/components/ui/Icons";

interface EventPanelConfigModalProps {
  tournamentId: number;
  onClose: () => void;
  /** Lets the open panel re-read its config without closing. */
  onSaved?: () => void;
}

/**
 * Which tracks' location and staffing blocks the event panel shows, for this
 * viewer. Saved to their display config under `event_panel`, as `track:{id}`
 * items in `hidden` — the same vocabulary the member panel uses.
 *
 * Hidden-by-exception: a track added later shows without anyone re-saving,
 * which is the right default for a track nobody has decided about yet.
 */
export function EventPanelConfigModal({ tournamentId, onClose, onSaved }: EventPanelConfigModalProps) {
  const { catalog, draft, setDraft, saving, error, save, loading } =
    useDisplayConfigDraft(tournamentId, EVENT_PANEL);

  const tracks = catalog?.tracks ?? [];
  const hidden = new Set(draft?.hidden ?? []);
  const isShown = (key: string) => !hidden.has(key);

  function toggle(key: string) {
    const next = new Set(hidden);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setDraft({ ...(draft ?? { hidden: [] }), hidden: [...next] });
  }

  return (
    <Modal title="Configure event panel" onClose={onClose} width={420}>
      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: "24px 0" }}><Spinner size="md" /></div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <span style={{
            fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 600,
            letterSpacing: "0.06em", textTransform: "uppercase",
            color: "var(--color-text-tertiary)",
          }}>
            Location &amp; staffing
          </span>
          {/* Tracks as chips, the member panel modal's convention: a
              tournament can have a dozen, and a chip row reads as "these are
              shown" far faster than a column of toggles. The x hides one; the
              + checklist brings any back. */}
          <ChipInput
            value={tracks.filter((t) => isShown(t.key)).map((t) => t.label)}
            onChange={(labels) => {
              const removed = tracks.find((t) => isShown(t.key) && !labels.includes(t.label));
              if (removed) toggle(removed.key);
            }}
            variant="transparent"
            size="sm"
            disableInput
            fullWidth
            addButton={
              <Popover
                trigger={
                  <Button type="button" variant="secondary" size="sm" iconOnly title="Edit visible tracks" style={{ padding: 0, flexShrink: 0 }}>
                    <IconPlus size={13} />
                  </Button>
                }
                items={tracks}
                getKey={(t) => t.key}
                renderLabel={(t) => t.label}
                checklist
                isSelected={(t) => isShown(t.key)}
                onSelect={(t) => toggle(t.key)}
                emptyMessage="No tracks yet."
              />
            }
          />
        </div>
      )}

      {error && (
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)", margin: "8px 0 0" }}>
          {error}
        </p>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "12px" }}>
        <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button type="button" variant="primary" onClick={() => save(onSaved, onClose)} disabled={saving || !draft}>
          Save
        </Button>
      </div>
    </Modal>
  );
}
