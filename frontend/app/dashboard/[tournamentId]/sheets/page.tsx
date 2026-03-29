"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { sheetsApi, SheetConfig } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { IconPlus, IconSheets, IconSync, IconWarning, IconDotsVertical, IconEdit, IconTrash, IconExport } from "@/components/ui/Icons";

const SHEET_TYPE_LABELS: Record<string, string> = {
  volunteers: "Volunteers",
  events:     "Events",
  // legacy — kept for configs saved before the migration
  interest:     "Interest Form",
  confirmation: "Confirmation Form",
};

function fmtDateTime(iso: string) {
  const normalized = iso.endsWith('Z') || iso.includes('+') ? iso : iso + 'Z'
  return new Date(normalized).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short",
  })
}

function isSameTab(a: SheetConfig, b: SheetConfig) {
  return a.spreadsheet_id === b.spreadsheet_id && a.sheet_name === b.sheet_name;
}

function getDuplicates(cfg: SheetConfig, all: SheetConfig[]): SheetConfig[] {
  return all.filter((c) => c.id !== cfg.id && isSameTab(c, cfg));
}

// ─── Export helper ────────────────────────────────────────────────────────────

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

// ─── Delete Confirm Modal ─────────────────────────────────────────────────────

function DeleteConfirmModal({
  cfg,
  onConfirm,
  onCancel,
  loading,
}: {
  cfg: SheetConfig;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
}) {
  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: "rgba(0,0,0,0.35)",
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
          width: 400,
          maxWidth: "calc(100vw - 32px)",
          boxShadow: "var(--shadow-lg)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ fontFamily: "Georgia, serif", fontSize: "22px", color: "var(--color-text-primary)", marginBottom: "8px" }}>
          Delete config?
        </h2>
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)", marginBottom: "20px" }}>
          <strong>{cfg.label}</strong> will be permanently deleted. Volunteer data is unaffected.
        </p>
        <div style={{ display: "flex", gap: "10px" }}>
          <Button variant="secondary" size="md" fullWidth onClick={onCancel} disabled={loading}>
            Cancel
          </Button>
          <Button variant="danger" size="md" fullWidth onClick={onConfirm} loading={loading}>
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── 3-dot Menu ───────────────────────────────────────────────────────────────

function CardMenu({
  cfg,
  tournamentId,
  onDelete,
}: {
  cfg: SheetConfig;
  tournamentId: string;
  onDelete: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const menuItems: { label: string; icon: React.ReactNode; action: () => void; danger?: boolean }[] = [
    {
      label: "Export JSON",
      icon: <IconExport size={16} />,
      action: () => { exportJson(cfg); setOpen(false); },
    },
    {
      label: "Edit",
      icon: <IconEdit size={16} />,
      action: () => { router.push(`/dashboard/${tournamentId}/sheets/${cfg.id}/edit`); setOpen(false); },
    },
    {
      label: "Delete",
      icon: <IconTrash size={16} />,
      action: () => { onDelete(); setOpen(false); },
      danger: true,
    },
  ];

  return (
    <div ref={menuRef} style={{ position: "relative" }}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          width: "28px", height: "28px",
          border: "none",
          borderRadius: "var(--radius-sm)",
          background: hovered || open ? "var(--color-bg)" : "transparent",
          color: hovered || open ? "var(--color-text-primary)" : "var(--color-text-tertiary)",
          cursor: "pointer",
          transition: "background 120ms ease, color 120ms ease",
        }}
      >
        <IconDotsVertical size={14} />
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            right: 0,
            zIndex: 20,
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-md)",
            boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
            minWidth: "148px",
            overflow: "hidden",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Export group */}
          <div style={{ padding: "4px 0", borderBottom: "1px solid var(--color-border)" }}>
            <MenuRow item={menuItems[0]} />
          </div>
          {/* Edit + Delete */}
          <div style={{ padding: "4px 0" }}>
            {menuItems.slice(1).map((item) => (
              <MenuRow key={item.label} item={item} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MenuRow({
  item,
}: {
  item: { label: string; icon: React.ReactNode; action: () => void; danger?: boolean };
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={item.action}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex", alignItems: "center", gap: "8px",
        width: "100%", padding: "7px 12px",
        background: hovered ? "var(--color-bg)" : "transparent",
        border: "none",
        cursor: "pointer",
        color: item.danger ? "var(--color-danger)" : "var(--color-text-primary)",
        fontFamily: "var(--font-sans)", fontSize: "13px",
        textAlign: "left",
        transition: "background 80ms ease",
      }}
    >
      {item.icon}
      {item.label}
    </button>
  );
}

// ─── Config Card ──────────────────────────────────────────────────────────────

function ConfigCard({
  cfg,
  tournamentId,
  duplicates,
  onDeleted,
}: {
  cfg: SheetConfig;
  tournamentId: string;
  duplicates: SheetConfig[];
  onDeleted: (id: number) => void;
}) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ created: number; updated: number; skipped: number } | null>(null);
  const [syncError, setSyncError] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [hovered, setHovered] = useState(false);

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

  function handleSyncClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (hasDuplicates) {
      setShowConfirm(true);
    } else {
      doSync();
    }
  }

  async function handleDelete() {
    setDeleteLoading(true);
    try {
      await sheetsApi.deleteConfig(Number(tournamentId), cfg.id);
      onDeleted(cfg.id);
    } catch {
      setDeleteLoading(false);
      setShowDeleteModal(false);
    }
  }

  const mappingCount = Object.keys(cfg.column_mappings).filter(
    (k) => cfg.column_mappings[k].type !== "ignore"
  ).length;

  return (
    <>
      <div
        onClick={() => router.push(`/dashboard/${tournamentId}/sheets/${cfg.id}`)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          background: "var(--color-surface)",
          border: `1px solid ${hasDuplicates ? "var(--color-warning)" : hovered ? "var(--color-border-strong)" : "var(--color-border)"}`,
          borderRadius: "var(--radius-md)",
          padding: "16px 20px",
          cursor: "pointer",
          transition: "border-color 120ms ease, box-shadow 120ms ease",
          boxShadow: hovered ? "var(--shadow-md)" : "var(--shadow-sm)",
        }}
      >
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

          <div
            style={{ display: "flex", gap: "8px", alignItems: "center", flexShrink: 0 }}
            onClick={(e) => e.stopPropagation()}
          >
            {cfg.is_active && (
              <Button
                variant="secondary"
                size="sm"
                onClick={handleSyncClick}
                loading={syncing}
              >
                {!syncing && <IconSync />}
                {syncing ? "Syncing…" : "Sync"}
              </Button>
            )}

            <CardMenu
              cfg={cfg}
              tournamentId={tournamentId}
              onDelete={() => setShowDeleteModal(true)}
            />
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

      {showDeleteModal && (
        <DeleteConfirmModal
          cfg={cfg}
          onConfirm={handleDelete}
          onCancel={() => setShowDeleteModal(false)}
          loading={deleteLoading}
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

  function handleDeleted(id: number) {
    setConfigs((prev) => prev.filter((c) => c.id !== id));
  }

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
              onDeleted={handleDeleted}
            />
          ))}
        </div>
      )}
    </div>
  );
}