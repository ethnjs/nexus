"use client";

import { Banner } from "@/components/ui/Banner";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Spinner } from "@/components/ui/Spinner";
import table from "@/components/ui/Table.module.css";

// Narrowest a column gets before the table scrolls sideways instead.
const MIN_COLUMN_WIDTH = 140;

const CELL_TEXT: React.CSSProperties = {
  fontFamily: "var(--font-sans)",
  fontSize: "13px",
  color: "var(--color-text-primary)",
};

// Long values (an email, a list of events) wrap inside their cell instead of
// overflowing into the next one.
const WRAP: React.CSSProperties = { minWidth: 0, whiteSpace: "normal", overflowWrap: "anywhere" };

interface ExportPreviewProps {
  header: string[] | null;
  rows: string[][];
  warnings: string[];
  loading: boolean;
  // Something blocks the export (e.g. no columns yet); replaces the table.
  blocked?: string | null;
}

// Every row, so what's checked is exactly what's exported.
export function ExportPreview({ header, rows, warnings, loading, blocked }: ExportPreviewProps) {
  // A loop, not Math.max(...spread): spreading thousands of rows can overflow the call stack.
  let width = Math.max(header?.length ?? 0, 1);
  for (const row of rows) width = Math.max(width, row.length);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px", minWidth: 0 }}>
      {warnings.map((warning) => (
        <Banner key={warning} variant="warning" message={warning} />
      ))}

      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: "40px" }}>
          <Spinner />
        </div>
      ) : blocked ? (
        <EmptyState size="sm" title={blocked} />
      ) : rows.length === 0 ? (
        <EmptyState
          size="sm"
          title="Nothing to export"
          description="No one matches this export and its filters."
        />
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
                {Array.from({ length: width }, (_, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: preview cells are positional
                  <span key={i} style={WRAP}>
                    {header[i] ?? ""}
                  </span>
                ))}
              </div>
            )}
            {rows.map((row, r) => (
              // Thinner than a page table's rows, and top-aligned so a wrapped
              // cell doesn't push its neighbours to the middle.
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: preview cells are positional
                key={r}
                className={table.row}
                style={{ paddingTop: "6px", paddingBottom: "6px", alignItems: "start" }}
              >
                {Array.from({ length: width }, (_, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: preview cells are positional
                  <span key={i} style={{ ...CELL_TEXT, ...WRAP }}>
                    {row[i] ?? ""}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
