"use client";

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Toggle } from "@/components/ui/Toggle";
import { Spinner } from "@/components/ui/Spinner";
import { DisplayConfigCatalogItem } from "@/lib/api";
import { useDisplayConfigDraft } from "@/lib/useDisplayConfigDraft";
import { MEMBERS_TABLE } from "@/lib/displayConfigSurfaces";

// Mirrors the backend's DEFAULT_COLUMNS — what a tournament with nothing
// saved shows, and therefore what the toggles start from.
const DEFAULT_COLUMNS = ["email", "phone", "account_age", "joined", "method"];

interface TableColumnsModalProps {
  tournamentId: number;
  onClose: () => void;
  onSaved?: () => void;
}

// Column order follows the catalog (fixed columns first, then one per track /
// availability day / lunch category / custom field), so turning a column on
// puts it where a TD would expect rather than at the end.
export function TableColumnsModal({ tournamentId, onClose, onSaved }: TableColumnsModalProps) {
  const { catalog, draft, setDraft, saving, error, save, loading } =
    useDisplayConfigDraft(tournamentId, MEMBERS_TABLE);

  // null means "nothing saved" — start from the defaults. An empty array is a
  // real answer ("no data columns") and is left alone.
  const active = new Set(draft?.columns ?? DEFAULT_COLUMNS);

  function toggle(key: string) {
    const next = new Set(active);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    // Written back in catalog order, which is what makes the saved list an
    // order as well as a set.
    setDraft({
      ...(draft ?? { hidden: [] }),
      columns: (catalog?.columns ?? []).map((c) => c.key).filter((key) => next.has(key)),
    });
  }

  const groups: { title: string; items: DisplayConfigCatalogItem[] }[] = [
    { title: "Member", items: (catalog?.columns ?? []).filter((c) => !c.key.includes(":")) },
    { title: "Tracks", items: (catalog?.columns ?? []).filter((c) => c.key.startsWith("track:")) },
    { title: "Availability", items: (catalog?.columns ?? []).filter((c) => c.key.startsWith("availability_day:")) },
    { title: "Lunch", items: (catalog?.columns ?? []).filter((c) => c.key.startsWith("lunch_category:")) },
    { title: "Custom fields", items: (catalog?.columns ?? []).filter((c) => c.key.startsWith("form_field:")) },
  ];

  return (
    <Modal title="Configure table columns" onClose={onClose} width={640}>
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
          {groups.map((group) => group.items.length > 0 && (
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
