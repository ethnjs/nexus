// Turning an export's rows into text, and getting that text to the TD.
// Clipboard, .csv and .txt all carry the same text.

/** Joins several values inside one cell. Not a comma, so a cell holding a
 *  list never needs quoting. */
export const MULTI_VALUE_SEPARATOR = "; ";

/** Quoted only when it has to be: a comma, quote or line break would
 *  otherwise split the cell or the row. */
export function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** "\n" rather than RFC 4180's "\r\n": most of these get pasted into a
 *  textarea, where a stray \r shows up as junk. Spreadsheets accept either. */
export function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

export function copyText(text: string): Promise<void> {
  return navigator.clipboard.writeText(text);
}

export function downloadText(filename: string, text: string, kind: "csv" | "txt"): void {
  const type = kind === "csv" ? "text/csv;charset=utf-8" : "text/plain;charset=utf-8";
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${filename}.${kind}`;
  link.click();
  URL.revokeObjectURL(url);
}
