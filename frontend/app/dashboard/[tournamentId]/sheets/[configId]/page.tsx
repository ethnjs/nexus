"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { membershipsApi, sheetsApi, SheetConfig } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Banner } from "@/components/ui/Banner";
import { FieldLabel } from "@/components/ui/FieldLabel";
import { IconArrowLeft, IconEdit, IconWarning, IconExport } from "@/components/ui/Icons";
import {
  RichMappingRow,
  makeRichRow,
  SheetConfigMappingTable,
} from "@/components/ui/SheetConfigMappingTable";

// ─── Constants ────────────────────────────────────────────────────────────────

const SHEET_TYPE_LABELS: Record<string, string> = {
  interest:     "Interest Form",
  confirmation: "Confirmation Form",
  events:       "Events",
};

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short",
  });
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

// ─── Delete Confirmation Modals ───────────────────────────────────────────────

function DeleteConfigModal({
  label,
  onConfirm,
  onCancel,
}: {
  label: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={onCancel}
    >
      <div
        style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-lg)", padding: "28px", width: 420, maxWidth: "calc(100vw - 32px)", boxShadow: "var(--shadow-lg)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ fontFamily: "Georgia, serif", fontSize: "22px", color: "var(--color-text-primary)", marginBottom: "12px" }}>
          Delete sheet config?
        </h2>
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)", marginBottom: "20px" }}>
          <strong>{label}</strong> will be permanently deleted. Volunteer data that was synced from this sheet will not be affected.
        </p>
        <div style={{ display: "flex", gap: "10px" }}>
          <Button variant="secondary" size="md" fullWidth onClick={onCancel}>Cancel</Button>
          <Button variant="danger" size="md" fullWidth onClick={onConfirm}>Delete config</Button>
        </div>
      </div>
    </div>
  );
}

function DeleteMembershipsModal({
  label,
  onConfirm,
  onCancel,
  loading,
}: {
  label: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const [typed, setTyped] = useState("");
  const confirmed = typed === "DELETE";

  const inputStyle: React.CSSProperties = {
    height: "36px", padding: "0 10px", width: "100%",
    border: `1px solid ${typed && !confirmed ? "var(--color-danger)" : "var(--color-border)"}`,
    borderRadius: "var(--radius-sm)",
    fontFamily: "var(--font-mono)", fontSize: "13px",
    color: "var(--color-text-primary)", background: "var(--color-bg)",
    outline: "none",
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={onCancel}
    >
      <div
        style={{ background: "var(--color-surface)", border: "2px solid var(--color-danger)", borderRadius: "var(--radius-lg)", padding: "28px", width: 480, maxWidth: "calc(100vw - 32px)", boxShadow: "var(--shadow-lg)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ fontFamily: "Georgia, serif", fontSize: "22px", color: "var(--color-danger)", marginBottom: "16px" }}>
          Delete config + memberships?
        </h2>

        <div style={{ background: "var(--color-danger-subtle)", border: "1px solid var(--color-danger)", borderRadius: "var(--radius-md)", padding: "14px", marginBottom: "20px", display: "flex", flexDirection: "column", gap: "8px" }}>
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 600, color: "var(--color-danger)", display: "flex", alignItems: "center", gap: "6px" }}>
            <IconWarning size={14} style={{ flexShrink: 0 }} />
            Read carefully before continuing
          </p>
          <ul style={{ margin: 0, paddingLeft: "18px", display: "flex", flexDirection: "column", gap: "5px" }}>
            {[
              `The sheet config "${label}" will be permanently deleted.`,
              "All memberships in this tournament will be deleted — even if they have positions assigned. (Temp behavior: does not cross-reference live sheet rows.)",
              "If this sheet tab is shared with another config, those memberships will also be deleted.",
              "User accounts are never deleted.",
              "This action cannot be undone.",
            ].map((w, i) => (
              <li key={i} style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-danger)" }}>{w}</li>
            ))}
          </ul>
        </div>

        <div style={{ marginBottom: "20px" }}>
          <FieldLabel>Type DELETE to confirm</FieldLabel>
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="DELETE"
            autoFocus
            style={inputStyle}
          />
        </div>

        <div style={{ display: "flex", gap: "10px" }}>
          <Button variant="secondary" size="md" fullWidth onClick={onCancel}>Cancel</Button>
          <Button
            variant="danger"
            size="md"
            fullWidth
            disabled={!confirmed}
            loading={loading}
            onClick={onConfirm}
          >
            Delete config + memberships
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ViewSheetConfigPage() {
  const router = useRouter();
  const params = useParams();
  const tournamentId = Number(params.tournamentId);
  const configId     = Number(params.configId);

  const [config, setConfig]       = useState<SheetConfig | null>(null);
  const [loading, setLoading]     = useState(true);
  const [loadError, setLoadError] = useState("");

  const [showDeleteConfig, setShowDeleteConfig]           = useState(false);
  const [showDeleteMemberships, setShowDeleteMemberships] = useState(false);
  const [deleteLoading, setDeleteLoading]                 = useState(false);
  const [deleteError, setDeleteError]                     = useState("");

  const [viewRows, setViewRows] = useState<RichMappingRow[]>([]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setLoadError("");
      try {
        const cfg = await sheetsApi.getConfig(tournamentId, configId);
        setConfig(cfg);

        const rows: RichMappingRow[] = cfg.column_mappings.map((mapping) => {
          const base = {
            column_index: mapping.column_index,
            header: mapping.header,
            field:     mapping.field     ?? "__ignore__",
            type:      mapping.type      ?? "ignore",
            row_key:   mapping.row_key   ?? "",
            extra_key: mapping.extra_key ?? "",
            delimiter: mapping.delimiter ?? "",
            rules:     mapping.rules     ?? [],
          };
          return makeRichRow(base, base);
        });
        setViewRows(rows);
      } catch {
        setLoadError("Failed to load sheet configuration.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [tournamentId, configId]);

  async function handleDeleteConfig() {
    setDeleteLoading(true);
    setDeleteError("");
    try {
      await sheetsApi.deleteConfig(tournamentId, configId);
      router.push(`/dashboard/${tournamentId}/sheets`);
    } catch {
      setDeleteError("Failed to delete config.");
      setDeleteLoading(false);
    }
  }

  async function handleDeleteMemberships() {
    if (!config) return;
    setDeleteLoading(true);
    setDeleteError("");
    try {
      const memberships = await membershipsApi.listByTournament(tournamentId);
      await Promise.all(
        memberships.map((m) => membershipsApi.delete(tournamentId, m.id))
      );
      await sheetsApi.deleteConfig(tournamentId, configId);
      router.push(`/dashboard/${tournamentId}/sheets`);
    } catch {
      setDeleteError("Failed to delete memberships. Try deleting them manually from the Volunteers page.");
      setDeleteLoading(false);
      setShowDeleteMemberships(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: "80px 0" }}>
        <div style={{ width: "36px", height: "36px", border: "3px solid var(--color-border)", borderTopColor: "var(--color-accent)", borderRadius: "50%", animation: "spin 700ms linear infinite" }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (loadError || !config) {
    return (
      <div style={{ width: "100%" }}>
        <BackLink onClick={() => router.push(`/dashboard/${tournamentId}/sheets`)} />
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)" }}>
          {loadError || "Config not found."}
        </p>
      </div>
    );
  }

  const mappingEntries = config.column_mappings;
  const mappedCount    = mappingEntries.filter((m) => m.type !== "ignore").length;
  const ignoredCount   = mappingEntries.filter((m) => m.type === "ignore").length;

  return (
    <div style={{ width: "100%" }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <BackLink onClick={() => router.push(`/dashboard/${tournamentId}/sheets`)} />
        <div style={{ display: "flex", gap: "8px" }}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => exportJson(config)}
          >
            <IconExport size={18} />
            Export JSON
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => router.push(`/dashboard/${tournamentId}/sheets/${configId}/edit`)}
          >
            <IconEdit size={18} />
            Edit
          </Button>
        </div>
      </div>

      <h1 style={{ fontSize: "28px", lineHeight: 1.2, marginBottom: "4px" }}>{config.label}</h1>
      <p style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--color-text-tertiary)", marginBottom: "28px" }}>
        {config.sheet_url}
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>

        {/* ── Metadata ── */}
        <div style={{
          display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr",
          border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)", overflow: "hidden",
        }}>
          {[
            { label: "Type",        value: SHEET_TYPE_LABELS[config.sheet_type] ?? config.sheet_type },
            { label: "Sheet Tab",   value: config.sheet_name },
            { label: "Status",      value: config.is_active ? "Active" : "Inactive" },
            { label: "Last Synced", value: config.last_synced_at ? fmtDateTime(config.last_synced_at) : "Never" },
          ].map(({ label, value }, i, arr) => (
            <div
              key={label}
              style={{
                padding: "14px 18px",
                borderRight: i < arr.length - 1 ? "1px solid var(--color-border)" : "none",
                background: "var(--color-surface)",
              }}
            >
              <p style={{ fontFamily: "var(--font-sans)", fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--color-text-tertiary)", marginBottom: "4px" }}>
                {label}
              </p>
              <p style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--color-text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {value}
              </p>
            </div>
          ))}
        </div>

        {/* ── Mapping table ── */}
        <div>
          <div style={{ marginBottom: "10px" }}>
            <span style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)" }}>
              {mappedCount} mapped, {ignoredCount} ignored
            </span>
          </div>
          <SheetConfigMappingTable
            rows={viewRows}
            knownFields={[]}
            validTypes={[]}
            viewOnly
          />
        </div>

        {/* ── Danger zone ── */}
        <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: "24px", display: "flex", flexDirection: "column", gap: "12px" }}>
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--color-text-tertiary)" }}>
            Danger Zone
          </p>

          {deleteError && (
            <Banner variant="error" message={deleteError} onDismiss={() => setDeleteError("")} />
          )}

          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            <Button variant="danger" size="sm" onClick={() => setShowDeleteConfig(true)}>
              Delete config
            </Button>
            <Button
              variant="danger"
              size="sm"
              interactive={false}
              style={{ background: "transparent", color: "var(--color-danger)", borderColor: "var(--color-danger)" }}
              onClick={() => setShowDeleteMemberships(true)}
            >
              Delete config + memberships
            </Button>
          </div>
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)" }}>
            &quot;Delete config&quot; removes this configuration only — volunteer data is unaffected.
            &quot;Delete config + memberships&quot; also removes all memberships in this tournament whose email appears in the current sheet.
          </p>
        </div>

      </div>

      {showDeleteConfig && (
        <DeleteConfigModal
          label={config.label}
          onConfirm={handleDeleteConfig}
          onCancel={() => setShowDeleteConfig(false)}
        />
      )}
      {showDeleteMemberships && (
        <DeleteMembershipsModal
          label={config.label}
          onConfirm={handleDeleteMemberships}
          onCancel={() => setShowDeleteMemberships(false)}
          loading={deleteLoading}
        />
      )}
    </div>
  );
}

// ─── Back link ────────────────────────────────────────────────────────────────

function BackLink({ onClick }: { onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex", alignItems: "center", gap: "6px", marginBottom: "20px",
        background: "none", border: "none", cursor: "pointer", padding: 0,
        fontFamily: "var(--font-sans)", fontSize: "13px",
        color: hovered ? "var(--color-text-primary)" : "var(--color-text-tertiary)",
        transition: "color 120ms ease",
      }}
    >
      <IconArrowLeft />
      Back to Sheets
    </button>
  );
}
