"use client";

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import { ChipInput } from "@/components/ui/ChipInput";
import { ChecklistPopover } from "@/components/ui/ChecklistPopover";
import { IconPlus } from "@/components/ui/Icons";
import { Spinner } from "@/components/ui/Spinner";
import { DisplayConfigCatalog, DisplayConfigCatalogItem } from "@/lib/api";
import { useDisplayConfigDraft } from "@/lib/useDisplayConfigDraft";

export interface ColumnGroup {
  title: string;
  items: DisplayConfigCatalogItem[];
  /** "chips" shows the items as a chip row with a + checklist instead of a
   *  toggle each — for one field offered per track, where a dozen tracks is
   *  a dozen near-identical toggles. No chips means the field is off. */
  layout?: "toggles" | "chips";
}

interface ColumnToggleModalProps {
  tournamentId: number;
  /** Display-config surface these columns are saved under. */
  surface: string;
  title: string;
  /** What a viewer with nothing saved sees — mirrors the backend's defaults. */
  defaultColumns: readonly string[];
  /** This surface's slice of the catalog, in the order columns should render. */
  selectColumns: (catalog: DisplayConfigCatalog) => DisplayConfigCatalogItem[];
  /** How to group those columns under headings. One group is fine. */
  buildGroups: (columns: DisplayConfigCatalogItem[]) => ColumnGroup[];
  /** Rewrites saved or default keys before they are read as toggles — for a
   *  surface with an alias that stands for several catalog columns, which
   *  would otherwise show every one of them as off. */
  expandKeys?: (keys: readonly string[], columns: DisplayConfigCatalogItem[]) => string[];
  onClose: () => void;
  onSaved?: () => void;
  width?: number;
}

/**
 * The column picker behind both tables' Display button.
 *
 * Shared rather than duplicated because everything except *which* columns
 * exist is identical: the toggles, the save-merge against the other surfaces
 * (see useDisplayConfigDraft), and the rule that turning a column on puts it
 * back in catalog order rather than at the end. The two tables differ only in
 * their catalog slice and how it groups, so those are the props.
 */
export function ColumnToggleModal({
  tournamentId, surface, title, defaultColumns, selectColumns, buildGroups, expandKeys,
  onClose, onSaved, width = 640,
}: ColumnToggleModalProps) {
  const { catalog, draft, setDraft, saving, error, save, loading } =
    useDisplayConfigDraft(tournamentId, surface);

  const columns = catalog ? selectColumns(catalog) : [];

  // null means "nothing saved" — start from the defaults. An empty array is a
  // real answer ("no data columns") and is left alone.
  const saved = draft?.columns ?? defaultColumns;
  const active = new Set(expandKeys ? expandKeys(saved, columns) : saved);

  function toggle(key: string) {
    const next = new Set(active);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    write(next);
  }

  function write(next: Set<string>) {
    // Written back in catalog order, which is what makes the saved list an
    // order as well as a set.
    setDraft({
      ...(draft ?? { hidden: [] }),
      columns: columns.map((c) => c.key).filter((key) => next.has(key)),
    });
  }

  return (
    <Modal title={title} onClose={onClose} width={width}>
      {error && (
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)", marginBottom: "12px" }}>
          {error}
        </p>
      )}

      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: "40px 0" }}>
          <Spinner size="lg" />
        </div>
      ) : (
        <div style={{ maxHeight: "60vh", overflowY: "auto", paddingRight: "4px" }}>
          {buildGroups(columns).map((group) => group.items.length > 0 && (
            <div key={group.title} style={{ marginBottom: "20px" }}>
              <span style={{
                fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 600,
                letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--color-text-tertiary)",
                display: "block", marginBottom: "8px",
              }}>
                {group.title}
              </span>
              {group.layout === "chips" ? (
                <ChipInput
                  value={group.items.filter((item) => active.has(item.key)).map((item) => item.label)}
                  onChange={(labels) => {
                    const removed = group.items.find((item) => active.has(item.key) && !labels.includes(item.label));
                    if (removed) toggle(removed.key);
                  }}
                  variant="transparent"
                  size="sm"
                  disableInput
                  fullWidth
                  // Turns the whole field off in one press.
                  onClear={() => write(new Set([...active].filter((key) => !group.items.some((item) => item.key === key))))}
                  addButton={
                    <ChecklistPopover
                      trigger={
                        <Button type="button" variant="secondary" size="sm" iconOnly title={`Edit ${group.title.toLowerCase()} columns`} style={{ padding: 0, flexShrink: 0 }}>
                          <IconPlus size={13} />
                        </Button>
                      }
                      items={group.items}
                      getKey={(item) => item.key}
                      renderLabel={(item) => item.label}
                      isSelected={(item) => active.has(item.key)}
                      onToggle={(item) => toggle(item.key)}
                    />
                  }
                />
              ) : (
                /* Two columns: a tournament with a dozen tracks and a dozen
                   custom fields is a long scroll in a single list. */
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 20px" }}>
                  {group.items.map((item) => (
                    <div key={item.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                      <span style={{
                        fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-primary)",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }} title={item.label}>
                        {item.label}
                      </span>
                      <Switch checked={active.has(item.key)} onChange={() => toggle(item.key)} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", marginTop: "8px" }}>
        {/* null, not the default list: "nothing chosen" keeps following the
            defaults if they change, where a copy of them would freeze. */}
        <Button
          type="button" variant="ghost"
          onClick={() => setDraft({ ...(draft ?? { hidden: [] }), columns: null })}
          disabled={saving || !draft}
        >
          Reset
        </Button>
        <div style={{ display: "flex", gap: "8px" }}>
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="button" variant="primary" onClick={() => save(onSaved, onClose)} disabled={saving || !draft}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}
