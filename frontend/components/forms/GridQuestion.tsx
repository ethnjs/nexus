"use client";

import { useId } from "react";
import styles from "@/components/forms/GridQuestion.module.css";
import { Badge } from "@/components/ui/Badge";
import { Checkbox } from "@/components/ui/Checkbox";
import { CheckboxList } from "@/components/ui/CheckboxList";
import { RadioCircle } from "@/components/ui/RadioCircle";
import { RadioList } from "@/components/ui/RadioList";
import type { FormFieldOption } from "@/lib/api";

/** Row option_id to the picked column option_id, or a list of them on a checkbox grid. */
export type GridAnswer = Record<string, string | string[]>;

const labelStyle = {
  fontFamily: "var(--font-sans)",
  fontSize: "15px",
  color: "var(--color-text-primary)",
} as const;

export function GridQuestion({
  rows,
  columns,
  multiple,
  onePerColumn = false,
  value,
  onChange,
  editable,
  removedIds,
}: {
  rows: FormFieldOption[];
  columns: FormFieldOption[];
  multiple: boolean;
  onePerColumn?: boolean;
  value: GridAnswer;
  onChange?: (value: GridAnswer) => void;
  editable: boolean;
  /** Rows and columns no longer offered that a past answer still uses, marked Removed. */
  removedIds: Set<string>;
}) {
  const picked = (rowId: string): string[] => {
    const selection = value[rowId];
    if (selection === undefined) return [];
    return Array.isArray(selection) ? selection : [selection];
  };

  function pick(rowId: string, columnId: string) {
    if (!editable) return;
    const next: GridAnswer = { ...value };
    if (multiple) {
      const current = picked(rowId);
      const toggled = current.includes(columnId)
        ? current.filter((id) => id !== columnId)
        : [...current, columnId];
      if (toggled.length > 0) next[rowId] = toggled;
      else delete next[rowId];
    } else {
      // A column already used in another row moves here, as one per column allows only one.
      if (onePerColumn)
        for (const [otherRow, selection] of Object.entries(next))
          if (otherRow !== rowId && selection === columnId) delete next[otherRow];
      next[rowId] = columnId;
    }
    onChange?.(next);
  }

  const name = useId();
  const badge = (id: string) =>
    removedIds.has(id) ? <Badge variant="declined">Removed</Badge> : undefined;

  return (
    <>
      <table className={styles.table}>
        <thead>
          <tr>
            <th />
            {columns.map((column) => (
              <th
                key={column.option_id}
                scope="col"
                style={{
                  ...labelStyle,
                  fontSize: "13px",
                  fontWeight: 400,
                  color: "var(--color-text-secondary)",
                  padding: "0 4px 8px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "4px",
                  }}
                >
                  {column.label}
                  {badge(column.option_id)}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const selected = picked(row.option_id);
            const background = index % 2 === 0 ? "var(--color-bg)" : "var(--color-surface)";
            return (
              <tr key={row.option_id} style={{ background }}>
                <th
                  scope="row"
                  style={{
                    ...labelStyle,
                    fontWeight: 400,
                    textAlign: "left",
                    padding: "8px 12px",
                    borderRadius: "var(--radius-md) 0 0 var(--radius-md)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    {row.label}
                    {badge(row.option_id)}
                  </div>
                </th>
                {columns.map((column, colIndex) => {
                  const checked = selected.includes(column.option_id);
                  const last = colIndex === columns.length - 1;
                  return (
                    <td
                      key={column.option_id}
                      style={{
                        padding: 0,
                        borderRadius: last ? "0 var(--radius-md) var(--radius-md) 0" : 0,
                      }}
                    >
                      {multiple ? (
                        <div className={styles.cell}>
                          <Checkbox
                            checked={checked}
                            onChange={() => pick(row.option_id, column.option_id)}
                            locked={!editable}
                            size={18}
                            ariaLabel={`${row.label}: ${column.label}`}
                          />
                        </div>
                      ) : (
                        <label
                          className={styles.cell}
                          style={{ cursor: editable ? "pointer" : "default" }}
                        >
                          <input
                            type="radio"
                            className={styles.input}
                            name={`${name}-${row.option_id}`}
                            checked={checked}
                            disabled={!editable}
                            onChange={() => pick(row.option_id, column.option_id)}
                            aria-label={`${row.label}: ${column.label}`}
                          />
                          <RadioCircle checked={checked} disabled={!editable} size={19} />
                        </label>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className={styles.stacked}>
        {rows.map((row) => {
          const options = columns.map((column) => ({
            value: column.option_id,
            label: column.label,
            badge: badge(column.option_id),
          }));
          return (
            <div
              key={row.option_id}
              style={{ display: "flex", flexDirection: "column", gap: "4px" }}
            >
              <div style={{ ...labelStyle, fontWeight: 500, display: "flex", gap: "8px" }}>
                {row.label}
                {badge(row.option_id)}
              </div>
              {multiple ? (
                <CheckboxList
                  options={options}
                  value={picked(row.option_id)}
                  onChange={(columnId) => pick(row.option_id, columnId)}
                  locked={!editable}
                  size={19}
                  fontSize="15px"
                  gap="4px"
                  rowHeight="36px"
                  labelGap="16px"
                />
              ) : (
                <RadioList
                  options={options}
                  value={picked(row.option_id)[0] ?? ""}
                  onChange={(columnId) => pick(row.option_id, columnId)}
                  locked={!editable}
                  size={19}
                  fontSize="15px"
                  gap="4px"
                />
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
