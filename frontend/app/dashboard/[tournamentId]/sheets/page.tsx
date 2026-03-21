"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { sheetsApi, SheetConfig } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { IconPlus, IconSheets, IconSync } from "@/components/ui/Icons";

const SHEET_TYPE_LABELS: Record<string, string> = {
  interest:     "Interest Form",
  confirmation: "Confirmation Form",
  events:       "Events",
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

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
            <ConfigCard key={cfg.id} cfg={cfg} tournamentId={tournamentId} />
          ))}
        </div>
      )}
    </div>
  );
}

function ConfigCard({ cfg, tournamentId }: { cfg: SheetConfig; tournamentId: string }) {
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ created: number; updated: number; skipped: number } | null>(null);
  const [syncError, setSyncError] = useState("");

  async function handleSync() {
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

  const mappingCount = Object.keys(cfg.column_mappings).filter(
    (k) => cfg.column_mappings[k].type !== "ignore"
  ).length;

  return (
    <div style={{
      background: "var(--color-surface)",
      border: "1px solid var(--color-border)",
      borderRadius: "var(--radius-md)",
      padding: "16px 20px",
    }}>
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
                Last synced {fmtDate(cfg.last_synced_at)}
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

        {cfg.is_active && (
          <Button
            variant="secondary"
            size="sm"
            onClick={handleSync}
            loading={syncing}
            style={{ flexShrink: 0 }}
          >
            <IconSync />
            {syncing ? "Syncing…" : "Sync"}
          </Button>
        )}
      </div>
    </div>
  );
}