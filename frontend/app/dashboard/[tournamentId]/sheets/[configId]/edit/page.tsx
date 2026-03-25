"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { sheetsApi, ColumnMapping, SheetConfig } from "@/lib/api";
import {
  MappingRow,
  MappingsExport,
  ImportSummary,
  parseMappingsJson,
  parseMappingsCsv,
  applyImport,
} from "@/lib/importMappings";
import {
  RichMappingRow,
  makeRichRow,
  SheetConfigMappingTable,
} from "@/components/ui/SheetConfigMappingTable";
import { SplitButton } from "@/components/ui/SplitButton";
import { Button } from "@/components/ui/Button";
import { Banner } from "@/components/ui/Banner";
import { ImportSummaryModal } from "@/components/ui/ImportSummaryModal";
import { FieldLabel } from "@/components/ui/FieldLabel";
import { IconArrowLeft, IconCheckCircle } from "@/components/ui/Icons";
import { StatCard } from "@/components/ui/StatCard";

// ─── Constants ────────────────────────────────────────────────────────────────

const SHEET_TYPES = [
  { value: "interest",     label: "Interest Form" },
  { value: "confirmation", label: "Confirmation Form" },
  { value: "events",       label: "Events" },
];

const selectStyle: React.CSSProperties = {
  height: "36px", padding: "0 10px",
  border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)",
  fontFamily: "var(--font-sans)", fontSize: "12px",
  color: "var(--color-text-primary)", background: "var(--color-bg)",
  outline: "none", cursor: "pointer",
};

// ─── Types ───────────────────────────────────────────────────────────────────

interface SyncResult {
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{ row: number; email: string | null; detail: string }>;
  last_synced_at: string;
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function EditSheetPage() {
  const router = useRouter();
  const params = useParams();
  const tournamentId = Number(params.tournamentId);
  const configId     = Number(params.configId);

  // Config + form fields
  const [config, setConfig]           = useState<SheetConfig | null>(null);
  const [label, setLabel]             = useState("");
  const [sheetType, setSheetType]     = useState("interest");
  const [selectedTab, setSelectedTab] = useState("");
  const [availableTabs, setAvailableTabs] = useState<string[]>([]);
  const [isActive, setIsActive]       = useState(true);

  // Headers + mapping
  const [mappingRows, setMappingRows]       = useState<RichMappingRow[]>([]);
  const [knownFields, setKnownFields]       = useState<string[]>([]);
  const [validTypes, setValidTypes]         = useState<string[]>([]);
  const [headersLoading, setHeadersLoading] = useState(false);
  const [headersError, setHeadersError]     = useState("");

  // Load state
  const [loading, setLoading]     = useState(true);
  const [loadError, setLoadError] = useState("");

  // Save / sync
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveError, setSaveError]     = useState("");
  const [syncLoading, setSyncLoading] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [syncResult, setSyncResult]   = useState<SyncResult | null>(null);

  // Import
  const importInputRef                            = useRef<HTMLInputElement>(null);
  const [importBanner, setImportBanner]           = useState<{ variant: "success" | "error"; message: string; summary?: ImportSummary } | null>(null);
  const [showImportSummary, setShowImportSummary] = useState(false);

  // AbortController ref for header fetches
  const abortRef = useRef<AbortController | null>(null);

  // ── Load config on mount ────────────────────────────────────────────────

  useEffect(() => {
    async function load() {
      setLoading(true);
      setLoadError("");
      try {
        const cfg = await sheetsApi.getConfig(tournamentId, configId);
        setConfig(cfg);
        setLabel(cfg.label);
        setSheetType(cfg.sheet_type);
        setSelectedTab(cfg.sheet_name);
        setIsActive(cfg.is_active);

        const validated = await sheetsApi.validate(tournamentId, cfg.sheet_url);
        setAvailableTabs(validated.sheet_names);

        await fetchHeaders(cfg, cfg.sheet_name);
      } catch {
        setLoadError("Failed to load sheet configuration.");
      } finally {
        setLoading(false);
      }
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournamentId, configId]);

  // ── Fetch headers (cancellable) ─────────────────────────────────────────

  async function fetchHeaders(cfg: SheetConfig, tabName: string) {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setHeadersLoading(true);
    setHeadersError("");

    try {
      const result = await sheetsApi.headers(tournamentId, cfg.sheet_url, tabName);

      if (controller.signal.aborted) return;

      setKnownFields(result.known_fields);
      setValidTypes(result.valid_types);

      const liveHeaders  = new Set(result.headers);
      const savedHeaders = new Set(Object.keys(cfg.column_mappings));

      const rows: RichMappingRow[] = [];

      // Live headers that are in the saved config → "same" baseline against saved value
      // Live headers NOT in saved config → "new" (suggestions as baseline)
      for (const header of result.headers) {
        const saved = cfg.column_mappings[header];
        if (saved) {
          const base: MappingRow = {
            header,
            field:     saved.field     ?? "__ignore__",
            type:      saved.type      ?? "ignore",
            row_key:   saved.row_key   ?? "",
            extra_key: saved.extra_key ?? "",
          };
          rows.push(makeRichRow(base, base));
        } else {
          const s = result.suggestions[header];
          const base: MappingRow = {
            header,
            field:     s?.field     ?? "__ignore__",
            type:      s?.type      ?? "ignore",
            row_key:   s?.row_key   ?? "",
            extra_key: s?.extra_key ?? "",
          };
          rows.push(makeRichRow(base, base, "new"));
        }
      }

      // Saved headers no longer in the live sheet → "removed"
      for (const header of savedHeaders) {
        if (!liveHeaders.has(header)) {
          const saved = cfg.column_mappings[header];
          const base: MappingRow = {
            header,
            field:     saved.field     ?? "__ignore__",
            type:      saved.type      ?? "ignore",
            row_key:   saved.row_key   ?? "",
            extra_key: saved.extra_key ?? "",
          };
          rows.push(makeRichRow(base, base, "removed"));
        }
      }

      setMappingRows(rows);
    } catch {
      if (controller.signal.aborted) return;
      setHeadersError("Failed to fetch sheet headers. Check that the sheet is still accessible.");
    } finally {
      if (!controller.signal.aborted) setHeadersLoading(false);
    }
  }

  // ── Tab change ──────────────────────────────────────────────────────────

  function handleTabChange(tab: string) {
    setSelectedTab(tab);
    if (config) fetchHeaders({ ...config, sheet_name: tab }, tab);
  }

  // ── Update a row + recompute state ──────────────────────────────────────

  function updateRow(idx: number, patch: Partial<MappingRow>) {
    setMappingRows((prev) =>
      prev.map((r, i) => {
        if (i !== idx) return r;
        const next = { ...r, ...patch };
        // "new" and "removed" states are locked — only "same"/"changed" can flip
        if (r.state === "new" || r.state === "removed") return { ...next, state: r.state };
        return makeRichRow(next, r.baseline, undefined, r.importedValue);
      })
    );
  }

  // ── Import ──────────────────────────────────────────────────────────────

  function triggerImport(accept: string) {
    setImportBanner(null);
    if (importInputRef.current) {
      importInputRef.current.accept = accept;
      importInputRef.current.click();
    }
  }

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    const isJson = file.name.endsWith(".json") || file.type === "application/json";
    const isCsv  = file.name.endsWith(".csv")  || file.type === "text/csv";

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      let parsed: MappingsExport | null = null;

      if (isJson) {
        parsed = parseMappingsJson(text);
        if (!parsed) {
          setImportBanner({ variant: "error", message: "Invalid JSON file — expected { column_mappings: { ... } }" });
          return;
        }
      } else if (isCsv) {
        parsed = parseMappingsCsv(text);
        if (!parsed) {
          setImportBanner({ variant: "error", message: "Invalid CSV file — expected columns: header, field, type, row_key, extra_key" });
          return;
        }
      } else {
        setImportBanner({ variant: "error", message: "Unsupported file type. Please upload a .json or .csv file." });
        return;
      }

      // Only apply import to non-removed rows
      const activeRows: MappingRow[] = mappingRows
        .filter((r) => r.state !== "removed")
        .map((r) => ({ header: r.header, field: r.field, type: r.type, row_key: r.row_key, extra_key: r.extra_key }));

      const { updatedRows, summary } = applyImport(activeRows, parsed);

      setMappingRows((prev) =>
        prev.map((r) => {
          if (r.state === "removed") return r;
          const updated = updatedRows.find((u) => u.header === r.header);
          if (!updated) return r;
          // importedValue records what the import set for this row
          const importedValue: MappingRow = { ...updated };
          // "new" state is preserved; others recompute vs baseline
          if (r.state === "new") return { ...r, ...updated, importedValue };
          return makeRichRow(updated, r.baseline, undefined, importedValue);
        })
      );

      if (parsed.label && !label) setLabel(parsed.label);
      if (parsed.sheet_type) setSheetType(parsed.sheet_type);

      const { updated: updatedList, unchanged, notInSheet, notInFile } = summary;
      const shortMsg = `${updatedList.length} updated, ${unchanged} unchanged, ${notInSheet.length} ignored, ${notInFile.length} untouched`;
      setImportBanner({ variant: "success", message: `Import successful: ${shortMsg}`, summary });
    };
    reader.readAsText(file);
  }

  // ── Build column mappings for save ──────────────────────────────────────

  const buildColumnMappings = useCallback((): Record<string, ColumnMapping> => {
    const result: Record<string, ColumnMapping> = {};
    for (const row of mappingRows) {
      if (row.state === "removed") continue;
      const mapping: ColumnMapping = { field: row.field, type: row.type as ColumnMapping["type"] };
      if (row.type === "matrix_row" && row.row_key) mapping.row_key = row.row_key;
      if (row.field === "extra_data" && row.extra_key) mapping.extra_key = row.extra_key;
      result[row.header] = mapping;
    }
    return result;
  }, [mappingRows]);

  // ── Save ────────────────────────────────────────────────────────────────

  async function handleSave() {
    setSaveLoading(true);
    setSaveError("");
    setSaveSuccess(false);
    try {
      await sheetsApi.updateConfig(tournamentId, configId, {
        label,
        sheet_type: sheetType as SheetConfig["sheet_type"],
        sheet_name: selectedTab,
        column_mappings: buildColumnMappings(),
        is_active: isActive,
      });
      setSaveSuccess(true);
    } catch {
      setSaveError("Failed to save changes.");
    } finally {
      setSaveLoading(false);
    }
  }

  // ── Save & Sync ─────────────────────────────────────────────────────────

  async function handleSaveAndSync() {
    setSyncLoading(true);
    setSaveError("");
    setSaveSuccess(false);
    setSyncResult(null);
    try {
      await sheetsApi.updateConfig(tournamentId, configId, {
        label,
        sheet_type: sheetType as SheetConfig["sheet_type"],
        sheet_name: selectedTab,
        column_mappings: buildColumnMappings(),
        is_active: isActive,
      });
      const result = await sheetsApi.sync(tournamentId, configId);
      setSyncResult(result);
    } catch {
      setSaveError("Failed to save or sync.");
    } finally {
      setSyncLoading(false);
    }
  }

  // ── Summary counts ──────────────────────────────────────────────────────

  const sameCount    = mappingRows.filter((r) => r.state === "same").length;
  const newCount     = mappingRows.filter((r) => r.state === "new").length;
  const removedCount = mappingRows.filter((r) => r.state === "removed").length;
  const changedCount = mappingRows.filter((r) => r.state === "changed").length;

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: "80px 0" }}>
        <div style={{ width: "36px", height: "36px", border: "3px solid var(--color-border)", borderTopColor: "var(--color-accent)", borderRadius: "50%", animation: "spin 700ms linear infinite" }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (loadError) {
    return (
      <div style={{ width: "100%" }}>
        <BackLink onClick={() => router.push(`/dashboard/${tournamentId}/sheets/${configId}`)} />
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)" }}>{loadError}</p>
      </div>
    );
  }

  return (
    <div style={{ width: "100%" }}>
      <BackLink onClick={() => router.push(`/dashboard/${tournamentId}/sheets/${configId}`)} />

      <h1 style={{ fontSize: "28px", lineHeight: 1.2, marginBottom: "4px" }}>Edit Sheet Config</h1>
      <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)", marginBottom: "28px" }}>
        {config?.sheet_url && (
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--color-text-tertiary)" }}>
            {config.sheet_url}
          </span>
        )}
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>

        {/* ── Config fields ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
          <div>
            <FieldLabel htmlFor="label">Label</FieldLabel>
            <input
              id="label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              style={{ ...selectStyle, width: "100%", height: "44px", padding: "0 14px" }}
            />
          </div>
          <div>
            <FieldLabel>Sheet Type</FieldLabel>
            <select value={sheetType} onChange={(e) => setSheetType(e.target.value)} style={{ ...selectStyle, width: "100%", height: "44px" }}>
              {SHEET_TYPES.map(({ value, label: l }) => (
                <option key={value} value={value}>{l}</option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "16px", alignItems: "end" }}>
          <div>
            <FieldLabel>Sheet Tab</FieldLabel>
            <select value={selectedTab} onChange={(e) => handleTabChange(e.target.value)} style={{ ...selectStyle, width: "100%", height: "44px" }}>
              {availableTabs.map((tab) => (
                <option key={tab} value={tab}>{tab}</option>
              ))}
            </select>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: "8px", height: "44px", cursor: "pointer", fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-primary)", flexShrink: 0 }}>
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              style={{ accentColor: "var(--color-accent)", width: "14px", height: "14px" }}
            />
            Active
          </label>
        </div>

        {/* ── Mapping table ── */}
        <div>
          {/* Toolbar */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", marginBottom: "10px" }}>
            {!headersLoading && mappingRows.length > 0 && (
              <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                {[
                  { label: `${sameCount} unchanged`,          color: "var(--color-text-tertiary)", show: true },
                  { label: `${changedCount} edited`,          color: "#854D0E",                    show: changedCount > 0 },
                  { label: `${newCount} new`,                 color: "#16A34A",                    show: newCount > 0 },
                  { label: `${removedCount} removed`,         color: "#DC2626",                    show: removedCount > 0 },
                ].filter((s) => s.show).map(({ label: l, color }) => (
                  <span key={l} style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color }}>{l}</span>
                ))}
              </div>
            )}
            {headersLoading && (
              <span style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)" }}>
                Fetching headers…
              </span>
            )}

            <div style={{ flexShrink: 0 }}>
              <SplitButton
                label="Import JSON"
                onClick={() => triggerImport(".json,application/json")}
                variant="secondary"
                size="sm"
                options={[
                  { label: "Import JSON", action: () => triggerImport(".json,application/json") },
                  { label: "Import CSV",  action: () => triggerImport(".csv,text/csv") },
                ]}
              />
              <input
                ref={importInputRef}
                type="file"
                accept=".json,.csv,application/json,text/csv"
                style={{ display: "none" }}
                onChange={handleImportFile}
              />
            </div>
          </div>

          {importBanner && (
            <div style={{ marginBottom: "10px" }}>
              <Banner
                variant={importBanner.variant}
                message={importBanner.message}
                onDismiss={() => setImportBanner(null)}
                action={importBanner.summary ? (
                  <Button variant="ghost" size="sm" onClick={() => setShowImportSummary(true)}>
                    Show summary
                  </Button>
                ) : undefined}
              />
            </div>
          )}

          {headersError && (
            <p style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-danger)", marginBottom: "10px" }}>
              {headersError}
            </p>
          )}

          {!headersLoading && mappingRows.length > 0 && (
            <SheetConfigMappingTable
              rows={mappingRows}
              knownFields={knownFields}
              validTypes={validTypes}
              onChangeRow={updateRow}
              baselineLabel="saved"
            />
          )}
        </div>

        {/* ── Save actions ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {saveError && (
            <p style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-danger)" }}>{saveError}</p>
          )}
          {saveSuccess && (
            <Banner variant="success" message="Changes saved successfully." onDismiss={() => setSaveSuccess(false)} />
          )}
          <div style={{ display: "flex", gap: "10px" }}>
            <Button variant="secondary" size="md" onClick={() => router.push(`/dashboard/${tournamentId}/sheets/${configId}`)}>
              Cancel
            </Button>
            <Button variant="secondary" size="md" loading={saveLoading} onClick={handleSave}>
              Save
            </Button>
            <Button variant="primary" size="md" loading={syncLoading} onClick={handleSaveAndSync}>
              Save &amp; Sync
            </Button>
          </div>
        </div>

        {/* ── Sync results ── */}
        {syncResult && (
          <div style={{ display: "flex", flexDirection: "column", gap: "16px", borderTop: "1px solid var(--color-border)", paddingTop: "24px" }}>
            <p style={{ fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--color-text-tertiary)" }}>
              Sync Results
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px" }}>
              <StatCard label="Created" value={syncResult.created} color="var(--color-success)" />
              <StatCard label="Updated" value={syncResult.updated} />
              <StatCard label="Skipped" value={syncResult.skipped} color="var(--color-warning)" />
            </div>

            {syncResult.errors.length > 0 ? (
              <div style={{ border: "1px solid var(--color-danger)", borderRadius: "var(--radius-md)", overflow: "hidden" }}>
                <div style={{ padding: "10px 16px", background: "var(--color-danger-subtle)", borderBottom: "1px solid var(--color-danger)" }}>
                  <span style={{ fontFamily: "var(--font-sans)", fontSize: "12px", fontWeight: 600, color: "var(--color-danger)" }}>
                    {syncResult.errors.length} row{syncResult.errors.length !== 1 ? "s" : ""} had errors
                  </span>
                </div>
                <div style={{ maxHeight: "200px", overflowY: "auto" }}>
                  {syncResult.errors.map((err, i) => (
                    <div key={i} style={{
                      padding: "10px 16px",
                      borderBottom: i < syncResult.errors.length - 1 ? "1px solid var(--color-border)" : "none",
                      display: "flex", gap: "12px",
                    }}>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--color-text-tertiary)", flexShrink: 0 }}>Row {err.row}</span>
                      {err.email && <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--color-text-secondary)", flexShrink: 0 }}>{err.email}</span>}
                      <span style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-primary)" }}>{err.detail}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{
                background: "var(--color-surface)", border: "1px solid var(--color-border)",
                borderRadius: "var(--radius-md)", padding: "16px",
                display: "flex", alignItems: "center", gap: "10px",
              }}>
                <span style={{ color: "var(--color-success)" }}><IconCheckCircle /></span>
                <span style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-primary)" }}>
                  All rows imported successfully — no errors.
                </span>
              </div>
            )}

            <div>
              <Button variant="primary" size="lg" onClick={() => router.push(`/dashboard/${tournamentId}/sheets`)}>
                Back to Sheets
              </Button>
            </div>
          </div>
        )}

      </div>

      {showImportSummary && importBanner?.summary && (
        <ImportSummaryModal
          summary={importBanner.summary}
          onClose={() => setShowImportSummary(false)}
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
      Back to Config
    </button>
  );
}