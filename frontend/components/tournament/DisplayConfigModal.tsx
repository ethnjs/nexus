"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { ChipInput } from "@/components/ui/ChipInput";
import { Toggle } from "@/components/ui/Toggle";
import { Popover } from "@/components/ui/Popover";
import { Spinner } from "@/components/ui/Spinner";
import { IconPlus } from "@/components/ui/Icons";
import {
  ApiError, DisplayConfig, DisplayConfigCatalog, DisplayConfigCatalogItem, displayConfigApi,
} from "@/lib/api";

interface DisplayConfigModalProps {
  tournamentId: number;
  /** Which surface's hidden set this instance edits — e.g. "members_panel". */
  surface: string;
  title?: string;
  onClose: () => void;
  /** Fires after a successful save, before the modal closes — lets the caller refetch anything gated on the new config. */
  onSaved?: () => void;
}

// Chips are the *shown* items — removing one hides it, and the "+" popover
// is a checklist of everything in the catalog, so a hidden item is one click
// from coming back. Same ChipInput + Popover pairing as RolesCell.
function ChipSection({
  title, items, hidden, onToggle,
}: {
  title: string;
  // Optional because the response is an unchecked cast: a backend that
  // predates this group sends no key at all, and `tsc` can't see that.
  items?: DisplayConfigCatalogItem[];
  hidden: Set<string>;
  onToggle: (key: string) => void;
}) {
  if (!items?.length) return null;

  const shown = items.filter((item) => !hidden.has(item.key));

  return (
    <div style={{ marginBottom: "20px" }}>
      <SectionHeading title={title} />
      <ChipInput
        value={shown.map((item) => item.label)}
        onChange={(labels) => {
          // ChipInput reports the surviving labels, not which one left, so
          // the removed item is whichever shown label is no longer there.
          const removed = shown.find((item) => !labels.includes(item.label));
          if (removed) onToggle(removed.key);
        }}
        variant="transparent"
        size="sm"
        disableInput
        fullWidth
        addButton={
          <Popover
            trigger={
              <Button
                type="button" variant="secondary" size="sm" iconOnly
                title={`Edit ${title.toLowerCase()}`}
                style={{ padding: 0, flexShrink: 0 }}
              >
                <IconPlus size={14} />
              </Button>
            }
            items={items}
            getKey={(item) => item.key}
            renderLabel={(item) => item.label}
            checklist
            isSelected={(item) => !hidden.has(item.key)}
            onSelect={(item) => onToggle(item.key)}
            emptyMessage="Nothing to configure"
          />
        }
      />
    </div>
  );
}


function SectionHeading({ title }: { title: string }) {
  return (
    <span style={{
      fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 600,
      letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--color-text-tertiary)",
      display: "block", marginBottom: "8px",
    }}>
      {title}
    </span>
  );
}

// Custom-field labels are long enough that chips would wrap badly — a plain
// row per field with its own toggle stays readable.
function ToggleSection({
  title, items, hidden, onToggle,
}: {
  title: string;
  items?: DisplayConfigCatalogItem[];
  hidden: Set<string>;
  onToggle: (key: string) => void;
}) {
  if (!items?.length) return null;
  return (
    <div style={{ marginBottom: "20px" }}>
      <SectionHeading title={title} />
      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {items.map((item) => (
          <div key={item.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
            <span style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-primary)" }}>
              {item.label}
            </span>
            <Toggle checked={!hidden.has(item.key)} onChange={() => onToggle(item.key)} />
          </div>
        ))}
      </div>
    </div>
  );
}


// Reuses MembersFilterModal's shape (Modal wrapper, local draft seeded on
// mount, Cancel throws it away, only Apply/Save commits) but with Toggle
// controls instead of checkboxes — this is "show/hide one item", not
// "narrow a result set", so there's no bulk select-all/deselect-all header.
export function DisplayConfigModal({ tournamentId, surface, title = "Configure display", onClose, onSaved }: DisplayConfigModalProps) {
  const [catalog, setCatalog] = useState<DisplayConfigCatalog | null>(null);
  // The full multi-surface config, kept as-loaded so Save can merge this
  // surface's edited `hidden` set back in without clobbering other surfaces'
  // saved state with a second, possibly-stale GET.
  const [fullConfig, setFullConfig] = useState<DisplayConfig | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([displayConfigApi.getCatalog(tournamentId), displayConfigApi.get(tournamentId)])
      .then(([cat, config]) => {
        setCatalog(cat);
        setFullConfig(config);
        setHidden(new Set(config[surface]?.hidden ?? []));
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load display settings."));
  }, [tournamentId, surface]);

  function toggle(key: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  async function handleSave() {
    if (!fullConfig) return;
    setSaving(true);
    setError(null);
    try {
      await displayConfigApi.set(tournamentId, { ...fullConfig, [surface]: { hidden: Array.from(hidden) } });
      onSaved?.();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to save display settings.");
      setSaving(false);
    }
  }

  const isEmpty = catalog !== null
    && !catalog.tracks?.length && !catalog.availability?.length
    && !catalog.lunch_categories?.length && !catalog.event_preferences?.length
    && !catalog.custom_fields?.length;

  return (
    <Modal title={title} onClose={onClose} width={420}>
      {error && (
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)", marginBottom: "12px" }}>
          {error}
        </p>
      )}

      {!catalog ? (
        <div style={{ display: "flex", justifyContent: "center", padding: "40px 0" }}>
          <Spinner size="lg" />
        </div>
      ) : isEmpty ? (
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)" }}>
          Nothing to configure yet — items appear here once members have tracks, lunch selections,
          event preferences, or custom form answers.
        </p>
      ) : (
        <>
          <ChipSection title="Tracks" items={catalog.tracks} hidden={hidden} onToggle={toggle} />
          <ToggleSection title="Availability" items={catalog.availability} hidden={hidden} onToggle={toggle} />
          <ToggleSection title="Lunch categories" items={catalog.lunch_categories} hidden={hidden} onToggle={toggle} />
          <ChipSection title="Event preferences" items={catalog.event_preferences} hidden={hidden} onToggle={toggle} />
          <ToggleSection title="Custom fields" items={catalog.custom_fields} hidden={hidden} onToggle={toggle} />
        </>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "4px" }}>
        <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button type="button" variant="primary" onClick={handleSave} disabled={saving || !catalog}>Save</Button>
      </div>
    </Modal>
  );
}
