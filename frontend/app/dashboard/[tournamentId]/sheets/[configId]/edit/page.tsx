"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { sheetsApi, ColumnMapping, SheetConfig, SheetType, MappedHeader, FormQuestionOption } from "@/lib/api";
import {
  MappingRow,
  MappingsExport,
  ImportSummary,
  parseMappingsJson,
  applyImport,
} from "@/lib/importMappings";
import {
  RichMappingRow,
  makeRichRow,
  SheetConfigMappingTable,
} from "@/components/ui/SheetConfigMappingTable";
import { Button } from "@/components/ui/Button";
import { Banner } from "@/components/ui/Banner";
import { ImportSummaryModal } from "@/components/ui/ImportSummaryModal";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { FieldLabel } from "@/components/ui/FieldLabel";
import { IconArrowLeft, IconCheckCircle } from "@/components/ui/Icons";
import { StatCard } from "@/components/ui/StatCard";
import { useSheetValidation } from "@/lib/useSheetValidation";
import { SheetMappingValidationWarningsModal, SheetMappingValidationErrorsModal } from "@/components/ui/SheetMappingValidationModals";

// ─── Constants ────────────────────────────────────────────────────────────────

const SHEET_TYPES: { value: SheetType; label: string }[] = [
  { value: "volunteers", label: "Volunteers" },
  { value: "events",     label: "Events" },
];

// ─── Types ───────────────────────────────────────────────────────────────────

interface SyncResult {
  created:       number;
  updated:       number;
  skipped:       number;
  errors:        Array<{ row: number; email: string | null; detail: string }>;
  last_synced_at: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function emptyMappingRow(header: string, s?: ColumnMapping): MappingRow {
  return {
    header,
    field:     s?.field     ?? "__ignore__",
    type:      s?.type      ?? "ignore",
    row_key:   s?.row_key   ?? "",
    extra_key: s?.extra_key ?? "",
    delimiter: s?.delimiter ?? "",
    rules:     s?.rules     ?? [],
  };
}

/**
 * Resolve options for a header: prefer live MappedHeader options (freshest),
 * fall back to saved ColumnMapping options (persisted from wizard).
 */
function resolveOptions(
  liveMapping?: MappedHeader,
  savedMapping?: ColumnMapping,
): FormQuestionOption[] | undefined {
  return liveMapping?.options ?? savedMapping?.options ?? undefined;
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function EditSheetPage() {
  const router       = useRouter();
  const params       = useParams();
  const tournamentId = Number(params.tournamentId);
  const configId     = Number(params.configId);

  // Config + form fields
  const [config,        setConfig]        = useState<SheetConfig | null>(null);
  const [label,         setLabel]         = useState("");
  const [sheetType,     setSheetType]     = useState<SheetType>("volunteers");
  const [selectedTab,   setSelectedTab]   = useState("");
  const [availableTabs, setAvailableTabs] = useState<string[]>([]);
  const [isActive,      setIsActive]      = useState(true);

  // Headers + mapping
  const [mappingRows,     setMappingRows]     = useState<RichMappingRow[]>([]);
  const [knownFields,     setKnownFields]     = useState<string[]>([]);
  const [validTypes,      setValidTypes]      = useState<string[]>([]);
  const [validConditions, setValidConditions] = useState<string[]>([]);
  const [validActions,    setValidActions]    = useState<string[]>([]);
  const [headersLoading,  setHeadersLoading]  = useState(false);
  const [headersError,    setHeadersError]    = useState("");

  // Track options per header for buildColumnMappings persistence
  const [headerOptions, setHeaderOptions] = useState<Map<string, { options?: FormQuestionOption[]; grid_rows?: string[]; grid_columns?: string[] }>>(new Map());

  // Load state
  const [loading,   setLoading]   = useState(true);
  const [loadError, setLoadError] = useState("");

  // Save / sync
  const [saveLoading,          setSaveLoading]          = useState(false);
  const [syncLoading,          setSyncLoading]          = useState(false);
  const [saveSuccess,          setSaveSuccess]          = useState(false);
  const [syncResult,           setSyncResult]           = useState<SyncResult | null>(null);
  const [showWarningsConfirm,  setShowWarningsConfirm]  = useState(false);
  const [showErrorsModal,      setShowErrorsModal]      = useState(false);

  // Validation
  const {
    validationErrors, validationWarnings, validationGeneration,
    clearAll, clearRow, handle422, handleSaveSuccess, handleValidateResult, setGenericError, renderErrorBanner,
  } = useSheetValidation();

  // Import
  const importInputRef                             = useRef<HTMLInputElement>(null);
  const [importBanner,      setImportBanner]       = useState<{ variant: "success" | "error"; message: string; summary?: ImportSummary } | null>(null);
  const [showImportSummary, setShowImportSummary]  = useState(false);

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
        setSheetType(cfg.sheet_type as SheetType);
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
      const result = await sheetsApi.headers(
        tournamentId,
        cfg.sheet_url,
        tabName,
        cfg.sheet_type as SheetType,
      );
      if (controller.signal.aborted) return;

      setKnownFields(result.known_fields);
      setValidTypes(result.valid_types);
      setValidConditions(result.valid_rule_conditions);
      setValidActions(result.valid_rule_actions);

      const liveHeaders  = new Set(result.mappings.map((m: MappedHeader) => m.header));
      const savedHeaders = new Set(Object.keys(cfg.column_mappings));
      const rows: RichMappingRow[] = [];
      const optionsMap = new Map<string, { options?: FormQuestionOption[]; grid_rows?: string[]; grid_columns?: string[] }>();

      for (const m of result.mappings) {
        const saved = cfg.column_mappings[m.header];
        // Resolve options: prefer live (freshest), fall back to saved (persisted from wizard)
        const options = resolveOptions(m, saved);
        const enrichment = {
          options: options,
          grid_rows: m.grid_rows ?? saved?.grid_rows,
          grid_columns: m.grid_columns ?? saved?.grid_columns,
        };
        if (enrichment.options || enrichment.grid_rows || enrichment.grid_columns) {
          optionsMap.set(m.header, enrichment);
        }

        if (saved) {
          const base = emptyMappingRow(m.header, saved);
          rows.push(makeRichRow(base, base, undefined, undefined, (saved.rules?.length ?? 0) > 0, options));
        } else {
          const base = emptyMappingRow(m.header, {
            field:     m.field,
            type:      m.type as ColumnMapping["type"],
            row_key:   m.row_key,
            extra_key: m.extra_key,
            rules:     m.rules,
            delimiter: m.delimiter,
          });
          rows.push(makeRichRow(base, base, "new", undefined, undefined, options));
        }
      }

      // Saved headers no longer in live sheet — mark as removed
      for (const header of savedHeaders) {
        if (!liveHeaders.has(header)) {
          const saved = cfg.column_mappings[header];
          const base = emptyMappingRow(header, saved);
          const options = saved?.options ?? undefined;
          if (saved?.options || saved?.grid_rows || saved?.grid_columns) {
            optionsMap.set(header, { options: saved.options, grid_rows: saved.grid_rows, grid_columns: saved.grid_columns });
          }
          rows.push(makeRichRow(base, base, "removed", undefined, undefined, options));
        }
      }

      setHeaderOptions(optionsMap);
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

  // ── Update row ──────────────────────────────────────────────────────────

  function updateRow(idx: number, patch: Partial<RichMappingRow>) {
    setMappingRows((prev) =>
      prev.map((r, i) => {
        if (i !== idx) return r;
        const next = { ...r, ...patch };
        if (r.state === "new" || r.state === "removed") return { ...next, state: r.state };
        return makeRichRow(next, r.baseline, undefined, r.importedValue, undefined, r.options);
      })
    );
    const header = mappingRows[idx]?.header;
    if (header) clearRow(header);
  }

  // ── Import ──────────────────────────────────────────────────────────────

  function triggerImport() {
    setImportBanner(null);
    importInputRef.current?.click();
  }

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    const isJson = file.name.endsWith(".json") || file.type === "application/json";
    if (!isJson) {
      setImportBanner({ variant: "error", message: "Unsupported file type. Please upload a .json file." });
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const parsed: MappingsExport | null = parseMappingsJson(text);

      if (!parsed) {
        setImportBanner({ variant: "error", message: "Invalid JSON file — expected { column_mappings: { ... } }" });
        return;
      }

      const activeRows: MappingRow[] = mappingRows
        .filter((r) => r.state !== "removed")
        .map((r) => ({
          header: r.header, field: r.field, type: r.type,
          row_key: r.row_key, extra_key: r.extra_key,
          delimiter: r.delimiter, rules: r.rules,
        }));

      const { updatedRows, summary } = applyImport(activeRows, parsed);
      const { updated: updatedList, unchanged, notInSheet, notInFile } = summary;

      setMappingRows((prev) =>
        prev.map((r) => {
          if (r.state === "removed") return r;
          const updated = updatedRows.find((u) => u.header === r.header);
          if (!updated) return r;
          const importedValue: MappingRow = { ...updated };
          const hadRuleChanges = updatedList.some(
            (entry) => entry.header === r.header && entry.ruleDiffs.some((d) => d.status !== "unchanged")
          );
          const base = r.state === "new"
            ? { ...r, ...updated, importedValue }
            : makeRichRow(updated, r.baseline, undefined, importedValue, undefined, r.options);
          return { ...base, openOnMount: hadRuleChanges || undefined };
        })
      );

      if (parsed.label && !label) setLabel(parsed.label);
      if (parsed.sheet_type) setSheetType(parsed.sheet_type as SheetType);

      const shortMsg = `${updatedList.length} updated, ${unchanged} unchanged, ${notInSheet.length} ignored, ${notInFile.length} untouched`;
      setImportBanner({ variant: "success", message: `Import successful: ${shortMsg}`, summary });
      setTimeout(() => setMappingRows((prev) => prev.map((r) => ({ ...r, openOnMount: undefined }))), 100);
    };
    reader.readAsText(file);
  }

  // ── Build column mappings ───────────────────────────────────────────────

  const buildColumnMappings = useCallback((): Record<string, ColumnMapping> => {
    const result: Record<string, ColumnMapping> = {};
    for (const row of mappingRows) {
      if (row.state === "removed") continue;
      const mapping: ColumnMapping = { field: row.field, type: row.type as ColumnMapping["type"] };
      if (row.type === "matrix_row"   && row.row_key)    mapping.row_key   = row.row_key;
      if (row.field === "extra_data"  && row.extra_key)  mapping.extra_key = row.extra_key;
      if (row.type === "multi_select" && row.delimiter)  mapping.delimiter = row.delimiter;
      if (row.rules.length > 0) mapping.rules = row.rules;
      // Persist form enrichment so alias editor works on next edit + in exports
      const enrichment = headerOptions.get(row.header);
      if (enrichment?.options)      mapping.options      = enrichment.options;
      if (enrichment?.grid_rows)    mapping.grid_rows    = enrichment.grid_rows;
      if (enrichment?.grid_columns) mapping.grid_columns = enrichment.grid_columns;
      result[row.header] = mapping;
    }
    return result;
  }, [mappingRows, headerOptions]);

  // ── Save & Sync ─────────────────────────────────────────────────────────

  function buildPayload() {
    return {
      label,
      sheet_type:      sheetType,
      sheet_name:      selectedTab,
      column_mappings: buildColumnMappings(),
      is_active:       isActive,
    };
  }

  async function doSave() {
    setSaveLoading(true);
    try {
      const saved = await sheetsApi.updateConfig(tournamentId, configId, buildPayload());
      handleSaveSuccess(saved);
      setSaveSuccess(true);
    } catch (e: unknown) {
      if (!handle422(e)) setGenericError("Failed to save changes.");
    } finally {
      setSaveLoading(false);
    }
  }

  async function doSaveAndSync() {
    setShowWarningsConfirm(false);
    setSyncLoading(true);
    setSaveSuccess(false);
    setSyncResult(null);
    try {
      const saved = await sheetsApi.updateConfig(tournamentId, configId, buildPayload());
      handleSaveSuccess(saved);
      const result = await sheetsApi.sync(tournamentId, configId);
      setSyncResult(result);
    } catch (e: unknown) {
      if (!handle422(e)) setGenericError("Failed to save or sync.");
    } finally {
      setSyncLoading(false);
    }
  }

  async function handleSave() {
    setSaveLoading(true);
    try {
      const validation = await sheetsApi.validateMappings(tournamentId, buildColumnMappings());
      const { ok } = handleValidateResult(validation);
      if (!ok) { setShowErrorsModal(true); return; }
      await doSave();
    } catch (e: unknown) {
      if (!handle422(e)) setGenericError("Failed to save changes.");
    } finally {
      setSaveLoading(false);
    }
  }

  async function handleSaveAndSync() {
    setSyncLoading(true);
    try {
      const validation = await sheetsApi.validateMappings(tournamentId, buildColumnMappings());
      const { ok, shouldConfirm } = handleValidateResult(validation);
      if (!ok) { setShowErrorsModal(true); return; }
      if (shouldConfirm) { setShowWarningsConfirm(true); return; }
      if (validation.warnings.length > 0) return;
      await doSaveAndSync();
    } catch {
      setGenericError("Failed to validate.");
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
          <Input label="Label" id="label" value={label} onChange={(e) => setLabel(e.target.value)} font="sans" fullWidth />
          <Select label="Sheet Type" value={sheetType} onChange={(v) => setSheetType(v as SheetType)} options={SHEET_TYPES} fullWidth />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "16px", alignItems: "end" }}>
          <Select label="Sheet Tab" value={selectedTab} onChange={handleTabChange} options={availableTabs.map((tab) => ({ value: tab, label: tab }))} fullWidth />
          <label style={{ display: "flex", alignItems: "center", gap: "8px", height: "44px", cursor: "pointer", fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-primary)", flexShrink: 0 }}>
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} style={{ accentColor: "var(--color-accent)", width: "14px", height: "14px" }} />
            Active
          </label>
        </div>

        {/* ── Mapping table ── */}
        <div>
          {(validationErrors.length > 0 || validationWarnings.length > 0) && (
            <div style={{ marginBottom: "12px" }}>{renderErrorBanner()}</div>
          )}

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", marginBottom: "10px" }}>
            {!headersLoading && mappingRows.length > 0 && (
              <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                {[
                  { label: `${sameCount} unchanged`,  color: "var(--color-text-tertiary)", show: true },
                  { label: `${changedCount} edited`,  color: "#854D0E",                    show: changedCount  > 0 },
                  { label: `${newCount} new`,          color: "#16A34A",                    show: newCount      > 0 },
                  { label: `${removedCount} removed`, color: "#DC2626",                    show: removedCount  > 0 },
                ].filter((s) => s.show).map(({ label: l, color }) => (
                  <span key={l} style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color }}>{l}</span>
                ))}
              </div>
            )}
            {headersLoading && (
              <span style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)" }}>Fetching headers…</span>
            )}
            <div style={{ flexShrink: 0 }}>
              <Button variant="secondary" size="sm" onClick={triggerImport}>Import JSON</Button>
              <input ref={importInputRef} type="file" accept=".json,application/json" style={{ display: "none" }} onChange={handleImportFile} />
            </div>
          </div>

          {importBanner && (
            <div style={{ marginBottom: "10px" }}>
              <Banner variant={importBanner.variant} message={importBanner.message} onDismiss={() => setImportBanner(null)} action={importBanner.summary ? (<Button variant="ghost" size="sm" onClick={() => setShowImportSummary(true)}>Show summary</Button>) : undefined} />
            </div>
          )}

          {headersError && (
            <p style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-danger)", marginBottom: "10px" }}>{headersError}</p>
          )}

          {!headersLoading && mappingRows.length > 0 && (
            <SheetConfigMappingTable
              rows={mappingRows}
              knownFields={knownFields}
              validTypes={validTypes}
              validConditions={validConditions}
              validActions={validActions}
              onChangeRow={updateRow}
              baselineLabel="saved"
              validationErrors={validationErrors}
              validationWarnings={validationWarnings}
              validationGeneration={validationGeneration}
            />
          )}
        </div>

        {/* ── Save actions ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {renderErrorBanner()}
          {saveSuccess && (
            <Banner variant="success" message="Changes saved successfully." onDismiss={() => setSaveSuccess(false)} />
          )}
          <div style={{ display: "flex", gap: "10px" }}>
            <Button variant="secondary" size="md" onClick={() => router.push(`/dashboard/${tournamentId}/sheets/${configId}`)}>Cancel</Button>
            <Button variant="secondary" size="md" loading={saveLoading} onClick={handleSave}>Save</Button>
            <Button variant="primary" size="md" loading={syncLoading} onClick={handleSaveAndSync}>Save &amp; Sync</Button>
          </div>
        </div>

        {/* ── Sync results ── */}
        {syncResult && (
          <div style={{ display: "flex", flexDirection: "column", gap: "16px", borderTop: "1px solid var(--color-border)", paddingTop: "24px" }}>
            <p style={{ fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--color-text-tertiary)" }}>Sync Results</p>
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
                    <div key={i} style={{ padding: "10px 16px", borderBottom: i < syncResult.errors.length - 1 ? "1px solid var(--color-border)" : "none", display: "flex", gap: "12px" }}>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--color-text-tertiary)", flexShrink: 0 }}>Row {err.row}</span>
                      {err.email && <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--color-text-secondary)", flexShrink: 0 }}>{err.email}</span>}
                      <span style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-primary)" }}>{err.detail}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)", padding: "16px", display: "flex", alignItems: "center", gap: "10px" }}>
                <span style={{ color: "var(--color-success)" }}><IconCheckCircle /></span>
                <span style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-primary)" }}>All rows imported successfully — no errors.</span>
              </div>
            )}
            <div><Button variant="primary" size="lg" onClick={() => router.push(`/dashboard/${tournamentId}/sheets`)}>Back to Sheets</Button></div>
          </div>
        )}

      </div>

      {showImportSummary && importBanner?.summary && (
        <ImportSummaryModal summary={importBanner.summary} onClose={() => setShowImportSummary(false)} />
      )}

      {showWarningsConfirm && (
        <SheetMappingValidationWarningsModal warnings={validationWarnings} onConfirm={doSaveAndSync} onCancel={() => setShowWarningsConfirm(false)} />
      )}

      {showErrorsModal && (
        <SheetMappingValidationErrorsModal errors={validationErrors} warnings={validationWarnings} onClose={() => setShowErrorsModal(false)} />
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