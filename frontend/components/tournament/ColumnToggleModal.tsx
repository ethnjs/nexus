"use client";

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Toggle } from "@/components/ui/Toggle";
import { Spinner } from "@/components/ui/Spinner";
import { DisplayConfigCatalog, DisplayConfigCatalogItem } from "@/lib/api";
import { useDisplayConfigDraft } from "@/lib/useDisplayConfigDraft";

export interface ColumnGroup {
  title: string;
  items: DisplayConfigCatalogItem[];
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
  tournamentId, surface, title, defaultColumns, selectColumns, buildGroups,
  onClose, onSaved, width = 640,
}: ColumnToggleModalProps) {
  const { catalog, draft, setDraft, saving, error, save, loading } =
    useDisplayConfigDraft(tournamentId, surface);

  const columns = catalog ? selectColumns(catalog) : [];

  // null means "nothing saved" — start from the defaults. An empty array is a
  // real answer ("no data columns") and is left alone.
  const active = new Set(draft?.columns ?? defaultColumns);

  function toggle(key: string) {
    const next = new Set(active);
    if (next.has(key)) next.delete(key);
    else next.add(key);
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
              {/* Two columns: a tournament with a dozen tracks and a dozen
                  custom fields is a long scroll in a single list. */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 20px" }}>
                {group.items.map((item) => (
                  <div key={item.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                    <span style={{
                      fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-primary)",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }} title={item.label}>
                      {item.label}
                    </span>
                    <Toggle checked={active.has(item.key)} onChange={() => toggle(item.key)} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "8px" }}>
        <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button type="button" variant="primary" onClick={() => save(onSaved, onClose)} disabled={saving || !draft}>
          Save
        </Button>
      </div>
    </Modal>
  );
}
