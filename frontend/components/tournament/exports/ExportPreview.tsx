"use client";

import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Spinner } from "@/components/ui/Spinner";
import { Card } from "@/components/ui/Card";
import table from "@/components/ui/Table.module.css";
import { IconCopy, IconExport } from "@/components/ui/Icons";

// The first rows of what will be exported — enough to check the shape.
export const PREVIEW_ROWS = 25;

// Narrowest a column gets before the table scrolls sideways instead.
const MIN_COLUMN_WIDTH = 140;

const CELL_TEXT: React.CSSProperties = {
  fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-primary)",
};

// Long values (an email, a list of events) wrap inside their cell instead of
// overflowing into the next one.
const WRAP: React.CSSProperties = { minWidth: 0, whiteSpace: "normal", overflowWrap: "anywhere" };

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
        <Card radius="lg" className={table.scroll} style={{ padding: "4px 12px" }}>
          {/* The app's table shell. Columns share the width but never get
              narrower than a readable minimum; past that the card scrolls. */}
          <div
            className={table.table}
            style={{
              gridTemplateColumns: `repeat(${width}, minmax(${MIN_COLUMN_WIDTH}px, 1fr))`,
              minWidth: `${width * MIN_COLUMN_WIDTH}px`,
            }}
          >
            {/* Only when the export has one: what shows is what gets exported. */}
            {header && (
              <div className={table.header} style={{ paddingTop: "8px", paddingBottom: "8px" }}>
                {Array.from({ length: width }, (_, i) => <span key={i} style={WRAP}>{header[i] ?? ""}</span>)}
              </div>
            )}
            {shown.map((row, r) => (
              // Thinner than a page table's rows, and top-aligned so a wrapped
              // cell doesn't push its neighbours to the middle.
              <div key={r} className={table.row} style={{ paddingTop: "6px", paddingBottom: "6px", alignItems: "start" }}>
                {Array.from({ length: width }, (_, i) => (
                  <span key={i} style={{ ...CELL_TEXT, ...WRAP }}>{row[i] ?? ""}</span>
                ))}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
