"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { sheetsApi, SheetConfig } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { SplitButton } from "@/components/ui/SplitButton";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { IconPlus, IconSheets, IconSync, IconWarning } from "@/components/ui/Icons";

const SHEET_TYPE_LABELS: Record<string, string> = {
  interest:     "Interest Form",
  confirmation: "Confirmation Form",
  events:       "Events",
};

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

/** Returns true if two configs point at the exact same Google Sheet tab. */
function isSameTab(a: SheetConfig, b: SheetConfig) {
  return a.spreadsheet_id === b.spreadsheet_id && a.sheet_name === b.sheet_name;
}

/** Returns the other configs that share the same tab as `cfg`. */
function getDuplicates(cfg: SheetConfig, all: SheetConfig[]): SheetConfig[] {
  return all.filter((c) => c.id !== cfg.id && isSameTab(c, cfg));
}

// ─── Export helpers ───────────────────────────────────────────────────────────

function exportJson(cfg: SheetConfig) {
  const payload = {
    label: cfg.label,
    sheet_type: cfg.sheet_type,
    sheet_name: cfg.sheet_name,
    column_mappings: cfg.column_mappings,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${cfg.label.replace(/\s+/g, "_")}_mappings.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportCsv(cfg: SheetConfig) {
  const rows: string[][] = [
    ["header", "field", "type", "row_key", "extra_key"],
  ];
  for (const [header, mapping] of Object.entries(cfg.column_mappings)) {
    rows.push([
      header,
      mapping.field,
      mapping.type,
      mapping.row_key ?? "",
      mapping.extra_key ?? "",
    ]);
  }
  const csv = rows
    .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${cfg.label.replace(/\s+/g, "_")}_mappings.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Sync Confirmation Modal ──────────────────────────────────────────────────

function SyncConfirmModal({
  cfg,
  duplicates,
  onConfirm,
  onCancel,
}: {
  cfg: SheetConfig;
  duplicates: SheetConfig[];
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      style={{
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,0.35)",
        zIndex: 200,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onClick={onCancel}
    >
      <div
        style={{
          background: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-lg)",
          padding: "28px",
          width: 420,
          maxWidth: "calc(100vw - 32px)",
          boxShadow: "var(--shadow-lg)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ fontFamily: "Georgia, serif", fontSize: "22px", color: "var(--color-text-primary)", marginBottom: "12px" }}>
          Sync this sheet?
        </h2>
        <div style={{
          background: "var(--color-warning-subtle)",
          border: "1px solid var(--color-warning)",
          borderRadius: "var(--radius-md)",
          padding: "12px 14px",
          marginBottom: "20px",
        }}>
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-primary)", marginBottom: "6px", fontWeight: 600, display: "flex", alignItems: "center", gap: "6px" }}>
            <IconWarning size={14} style={{ color: "var(--color-warning)", flexShrink: 0 }} />
            This tab is also used by:
          </p>
          <ul style={{ margin: 0, paddingLeft: "18px" }}>
            {duplicates.map((d) => (
              <li key={d.id} style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)" }}>
                <strong>{d.label}</strong> ({SHEET_TYPE_LABELS[d.sheet_type] ?? d.sheet_type})
              </li>
            ))}
          </ul>
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-secondary)", marginTop: "8px" }}>
            Syncing <strong>{cfg.label}</strong> may overwrite data written by those configs if they map to the same fields.
          </p>
        </div>
        <div style={{ display: "flex", gap: "10px" }}>
          <Button variant="secondary" size="md" fullWidth onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" size="md" fullWidth onClick={onConfirm}>
            Sync anyway
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Config Card ──────────────────────────────────────────────────────────────

function ConfigCard({
  cfg,
  tournamentId,
  duplicates,
}: {
  cfg: SheetConfig;
  tournamentId: string;
  duplicates: SheetConfig[];
}) {
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ created: number; updated: number; skipped: number } | null>(null);
  const [syncError, setSyncError] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);

  const hasDuplicates = duplicates.length > 0;

  async function doSync() {
    setShowConfirm(false);
    setSyncing(true);
    setSyncResult(null);
    setSyncError("");
    try {
      const result = await sheetsApi.sync(Number(tournamentId), cfg.id);
      setSyncResult({ created: result.created, updated: result.updated, skipped: result.skipped });
    } catch {
      setSyncError("Sync failed. Check that the sheet is still accessible.");
    } finally {
      setSyncing(false);
    }
  }

  function handleSyncClick() {
    if (hasDuplicates) {
      setShowConfirm(true);
    } else {
      doSync();
    }
  }

  const mappingCount = Object.keys(cfg.column_mappings).filter(
    (k) => cfg.column_mappings[k].type !== "ignore"
  ).length;

  return (
    <>
      <div style={{
        background: "var(--color-surface)",
        border: `1px solid ${hasDuplicates ? "var(--color-warning)" : "var(--color-border)"}`,
        borderRadius: "var(--radius-md)",
        padding: "16px 20px",
      }}>
        {/* Duplicate tab warning banner */}
        {hasDuplicates && (
          <div style={{
            display: "flex", alignItems: "flex-start", gap: "8px",
            background: "var(--color-warning-subtle)",
            border: "1px solid var(--color-warning)",
            borderRadius: "var(--radius-sm)",
            padding: "8px 12px",
            marginBottom: "12px",
          }}>
            <IconWarning size={13} style={{ color: "var(--color-warning)", flexShrink: 0, marginTop: "1px" }} />
            <p style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-primary)" }}>
              Same tab as{" "}
              {duplicates.map((d, i) => (
                <span key={d.id}>
                  <strong>{d.label}</strong>
                  {i < duplicates.length - 1 ? ", " : ""}
                </span>
              ))}
              . Syncing may overwrite data from {duplicates.length === 1 ? "that config" : "those configs"}.
            </p>
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
              <span style={{ fontFamily: "var(--font-sans)", fontSize: "14px", fontWeight: 600, color: "var(--color-text-primary)" }}>
                {cfg.label}
              </span>
              <span style={{
                fontFamily: "var(--font-sans)", fontSize: "10px", fontWeight: 600,
                textTransform: "uppercase", letterSpacing: "0.07em",
                color: "var(--color-text-secondary)", background: "var(--color-accent-subtle)",
                padding: "2px 7px", borderRadius: "var(--radius-sm)",
              }}>
                {SHEET_TYPE_LABELS[cfg.sheet_type] ?? cfg.sheet_type}
              </span>
              {!cfg.is_active && (
                <span style={{
                  fontFamily: "var(--font-sans)", fontSize: "10px", fontWeight: 600,
                  textTransform: "uppercase", letterSpacing: "0.07em",
                  color: "var(--color-text-tertiary)", background: "var(--color-bg)",
                  padding: "2px 7px", borderRadius: "var(--radius-sm)",
                  border: "1px solid var(--color-border)",
                }}>
                  Inactive
                </span>
              )}
            </div>
            <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--color-text-tertiary)" }}>
                {cfg.sheet_name}
              </span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--color-text-tertiary)" }}>
                {mappingCount} mapped column{mappingCount !== 1 ? "s" : ""}
              </span>
              {cfg.last_synced_at && (
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--color-text-tertiary)" }}>
                  Last synced {fmtDateTime(cfg.last_synced_at)}
                </span>
              )}
            </div>
            {syncResult && (
              <div style={{ marginTop: "8px", fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-success)" }}>
                ✓ Sync complete — {syncResult.created} created, {syncResult.updated} updated, {syncResult.skipped} skipped
              </div>
            )}
            {syncError && (
              <div style={{ marginTop: "8px", fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-danger)" }}>
                {syncError}
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: "8px", alignItems: "center", flexShrink: 0 }}>
            {/* Export — SplitButton: primary action = JSON, dropdown adds CSV */}
            <SplitButton
              label="Export"
              onClick={() => exportJson(cfg)}
              variant="secondary"
              size="sm"
              options={[
                { label: "Export JSON", action: () => exportJson(cfg) },
                { label: "Export CSV",  action: () => exportCsv(cfg) },
              ]}
            />

            {cfg.is_active && (
              <Button
                variant="secondary"
                size="sm"
                onClick={handleSyncClick}
                loading={syncing}
              >
                <IconSync />
                {syncing ? "Syncing…" : "Sync"}
              </Button>
            )}
          </div>
        </div>
      </div>

      {showConfirm && (
        <SyncConfirmModal
          cfg={cfg}
          duplicates={duplicates}
          onConfirm={doSync}
          onCancel={() => setShowConfirm(false)}
        />
      )}
    </>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SheetsPage() {
  const router = useRouter();
  const params = useParams();
  const tournamentId = params.tournamentId as string;

  const [configs, setConfigs] = useState<SheetConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    sheetsApi.listConfigs(Number(tournamentId))
      .then(setConfigs)
      .catch(() => setError("Failed to load sheet configurations."))
      .finally(() => setLoading(false));
  }, [tournamentId]);

  return (
    <div style={{ width: "100%" }}>
      <PageHeader
        title="Sheets"
        subtitle="Connect Google Sheets to sync volunteer data into NEXUS."
        action={
          <Button
            variant="primary"
            size="sm"
            onClick={() => router.push(`/dashboard/${tournamentId}/sheets/new`)}
          >
            <IconPlus />
            Add Sheet
          </Button>
        }
      />

      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {[1, 2].map((i) => (
            <div key={i} style={{
              height: "80px",
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-md)",
              opacity: 0.5,
            }} />
          ))}
        </div>
      ) : error ? (
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)" }}>{error}</p>
      ) : configs.length === 0 ? (
        <EmptyState
          icon={<IconSheets size={24} />}
          title="No sheets connected"
          description="Connect a Google Sheet to start importing volunteer responses."
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => router.push(`/dashboard/${tournamentId}/sheets/new`)}
            >
              <IconPlus />
              Add your first sheet
            </Button>
          }
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {configs.map((cfg) => (
            <ConfigCard
              key={cfg.id}
              cfg={cfg}
              tournamentId={tournamentId}
              duplicates={getDuplicates(cfg, configs)}
            />
          ))}
        </div>
      )}
    </div>
  );
}