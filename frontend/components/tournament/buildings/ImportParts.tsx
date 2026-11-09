"use client";

import { type ReactNode, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { IconChevronRight } from "@/components/ui/Icons";
import table from "@/components/ui/Table.module.css";

const TEXT = { fontFamily: "var(--font-sans)", fontSize: "13px" } as const;

/** Stands in for a tab in an example, which would otherwise read as a space. */
export const TAB = " [tab] ";

/** Open until the first keystroke or paste in the box, then a toggle. It
 *  doesn't reopen when the box is cleared, so nothing jumps mid-edit. */
export function useImportHelp() {
  const [open, setOpen] = useState(true);
  const collapsedOnce = useRef(false);
  return {
    open,
    toggle: () => setOpen((o) => !o),
    onInput: (text: string) => {
      if (collapsedOnce.current || !text) return;
      collapsedOnce.current = true;
      setOpen(false);
    },
  };
}

/** What a tab accepts: example lines beside the columns each one reads as,
 *  then a few short rules, under a "Format" row that folds them away. */
export function ImportHelp({
  open,
  onToggle,
  columns,
  examples,
  notes,
}: {
  open: boolean;
  onToggle: () => void;
  columns: string[];
  examples: { input: string; parts: string[] }[];
  notes: ReactNode[];
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{
          ...TEXT,
          alignSelf: "flex-start",
          display: "flex",
          alignItems: "center",
          gap: "4px",
          padding: 0,
          border: "none",
          background: "transparent",
          fontWeight: 500,
          color: "var(--color-text-secondary)",
          cursor: "pointer",
        }}
      >
        <IconChevronRight
          size={13}
          style={{
            transform: open ? "rotate(90deg)" : undefined,
            transition: "transform 180ms ease",
          }}
        />
        Format
      </button>
      {/* 0fr -> 1fr animates to the content's natural height, which a
          max-height transition can't do without a hardcoded guess. */}
      <div
        aria-hidden={!open}
        inert={!open}
        style={{
          display: "grid",
          gridTemplateRows: open ? "1fr" : "0fr",
          transition: "grid-template-rows 180ms ease",
        }}
      >
        <div style={{ overflow: "hidden", minHeight: 0 }}>
          <div style={{ paddingTop: "10px" }}>
            <ImportHelpBody columns={columns} examples={examples} notes={notes} />
          </div>
        </div>
      </div>
    </div>
  );
}

function ImportHelpBody({
  columns,
  examples,
  notes,
}: {
  columns: string[];
  examples: { input: string; parts: string[] }[];
  notes: ReactNode[];
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <div
        className={table.table}
        style={{
          // The example sizes to its longest line; the parsed columns share the rest.
          gridTemplateColumns: `max-content repeat(${columns.length}, minmax(0, 1fr))`,
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-md)",
        }}
      >
        <div className={table.header} style={{ position: "static", padding: "8px 12px" }}>
          <span>You paste</span>
          {columns.map((column) => (
            <span key={column}>{column}</span>
          ))}
        </div>
        {examples.map((example) => (
          <div key={example.input} className={table.row} style={{ padding: "6px 12px" }}>
            <code
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "12px",
                whiteSpace: "pre",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {example.input}
            </code>
            {example.parts.map((part, i) => (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: parts are positional columns.
                key={i}
                style={{ ...TEXT, color: "var(--color-text-secondary)", minWidth: 0 }}
              >
                {part}
              </span>
            ))}
          </div>
        ))}
      </div>
      <ul
        style={{
          ...TEXT,
          color: "var(--color-text-secondary)",
          margin: 0,
          paddingLeft: "18px",
          // Preflight strips list markers.
          listStyle: "disc",
          display: "flex",
          flexDirection: "column",
          gap: "2px",
        }}
      >
        {notes.map((note, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list of sentences.
          <li key={i}>{note}</li>
        ))}
      </ul>
    </div>
  );
}

/** The live preview under the paste box: one row per change, then any lines
 *  that couldn't be read. */
export function ImportPreview({ rows, errors }: { rows: ReactNode[]; errors: string[] }) {
  if (rows.length === 0 && errors.length === 0) return null;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        maxHeight: "220px",
        overflowY: "auto",
      }}
    >
      {rows}
      {errors.map((message) => (
        <span key={message} style={{ ...TEXT, color: "var(--color-danger)" }}>
          {message}
        </span>
      ))}
    </div>
  );
}

export function ImportPreviewRow({ children }: { children: ReactNode }) {
  return (
    <div
      style={{ ...TEXT, display: "flex", alignItems: "center", flexWrap: "wrap", gap: "4px 8px" }}
    >
      {children}
    </div>
  );
}

export function ImportFooter({
  error,
  saving,
  disabled,
  hasErrors,
  label,
  onCancel,
  onImport,
}: {
  error?: string;
  saving: boolean;
  disabled: boolean;
  hasErrors: boolean;
  label: string;
  onCancel: () => void;
  onImport: () => void;
}) {
  return (
    <>
      {error && <span style={{ ...TEXT, color: "var(--color-danger)" }}>{error}</span>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "6px" }}>
        <Button type="button" variant="secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="primary"
          loading={saving}
          disabled={disabled || hasErrors}
          title={hasErrors ? "Fix the lines above first" : undefined}
          onClick={onImport}
        >
          {label}
        </Button>
      </div>
    </>
  );
}
