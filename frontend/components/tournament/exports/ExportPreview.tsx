"use client";

import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Spinner } from "@/components/ui/Spinner";
import { IconCopy, IconExport } from "@/components/ui/Icons";

// The first rows of what will be exported — enough to check the shape.
export const PREVIEW_ROWS = 25;

interface ExportPreviewProps {
  header:   string[] | null;
  rows:     string[][];
  warnings: string[];
  loading:  boolean;
  // Something blocks the export (e.g. no columns yet); replaces the table.
  blocked?: string | null;
  onCopy:   () => void;
  onDownload: (kind: "csv" | "txt") => void;
}

export function ExportPreview({ header, rows, warnings, loading, blocked, onCopy, onDownload }: ExportPreviewProps) {
  const disabled = loading || Boolean(blocked) || rows.length === 0;
  const shown = rows.slice(0, PREVIEW_ROWS);
  const width = Math.max(header?.length ?? 0, ...shown.map((r) => r.length), 1);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
        <span style={{ fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 600, color: "var(--color-text-primary)" }}>
          Preview
          <span style={{ fontWeight: 400, color: "var(--color-text-secondary)", marginLeft: "8px" }}>
            {loading
              ? "Loading…"
              : rows.length > PREVIEW_ROWS
                ? `First ${PREVIEW_ROWS} of ${rows.length} rows`
                : `${rows.length} row${rows.length === 1 ? "" : "s"}`}
          </span>
        </span>
        <div style={{ display: "flex", gap: "8px" }}>
          <Button type="button" variant="primary" size="sm" disabled={disabled} onClick={onCopy}>
            <IconCopy size={12} /> Copy
          </Button>
          <Button type="button" variant="secondary" size="sm" disabled={disabled} onClick={() => onDownload("csv")}>
            <IconExport size={12} /> CSV
          </Button>
          <Button type="button" variant="secondary" size="sm" disabled={disabled} onClick={() => onDownload("txt")}>
            <IconExport size={12} /> TXT
          </Button>
        </div>
      </div>

      {warnings.map((warning) => <Banner key={warning} variant="warning" message={warning} />)}

      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: "40px" }}><Spinner /></div>
      ) : blocked ? (
        <EmptyState size="sm" title={blocked} />
      ) : rows.length === 0 ? (
        <EmptyState size="sm" title="Nothing to export" description="No one matches this export and its filters." />
      ) : (
        <div style={{ overflowX: "auto", border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontFamily: "var(--font-mono)", fontSize: "12px" }}>
            {header && (
              <thead>
                <tr>
                  {header.map((cell, i) => (
                    <th key={i} style={{
                      textAlign: "left", padding: "6px 10px", whiteSpace: "nowrap",
                      fontFamily: "var(--font-sans)", fontWeight: 600, color: "var(--color-text-secondary)",
                      background: "var(--color-surface)", borderBottom: "1px solid var(--color-border)",
                    }}>
                      {cell}
                    </th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {shown.map((row, r) => (
                <tr key={r}>
                  {Array.from({ length: width }, (_, i) => (
                    <td key={i} style={{
                      padding: "6px 10px", whiteSpace: "nowrap", color: "var(--color-text-primary)",
                      borderTop: r === 0 ? "none" : "1px solid var(--color-border)",
                    }}>
                      {row[i] ?? ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
