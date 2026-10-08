import type { KeyboardEvent } from "react";

/**
 * Spreadsheet-style arrow keys for a table whose rows carry `data-nav-row`
 * and whose cells carry `data-nav-col`. Attach to the table's onKeyDown.
 *
 * A "stop" is a focusable control inside a cell — a cell's resting control
 * (the text you click to edit), or a button. ←/→ move between stops in the
 * row (from the first stop, ← goes to the row itself); ↑/↓ move to the same
 * cell in the neighbouring row, or to that row when the cell has no stop
 * there (a locked or read-only cell).
 *
 * Hands off while editing: a key from an input, or from inside anything
 * marked `data-editing` (an open chip editor or popover), is the editor's.
 */
const STOP_SELECTOR = 'button:not([disabled]), [tabindex="0"], input:not([disabled])';

function stopsIn(row: HTMLElement): HTMLElement[] {
  return [...row.querySelectorAll<HTMLElement>(STOP_SELECTOR)].filter((el) => (
    // Only stops inside a nav cell (not the Select checkbox), only this
    // row's own, and not inside an open editor.
    el.closest("[data-nav-col]") !== null
    && el.closest("[data-nav-row]") === row
    && el.closest("[data-editing]") === null
  ));
}

function navRow(row: HTMLElement, step: 1 | -1): HTMLElement | null {
  let next = step === 1 ? row.nextElementSibling : row.previousElementSibling;
  while (next && !(next instanceof HTMLElement && next.dataset.navRow !== undefined)) {
    next = step === 1 ? next.nextElementSibling : next.previousElementSibling;
  }
  return next as HTMLElement | null;
}

export function handleGridArrows(e: KeyboardEvent<HTMLElement>) {
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
  const target = e.target as HTMLElement;
  if (target.matches("input, textarea") || target.closest("[data-editing]")) return;
  const row = target.closest<HTMLElement>("[data-nav-row]");
  if (!row) return;

  const stops = stopsIn(row);
  const index = stops.indexOf(target);
  const onRow = target === row;
  if (!onRow && index < 0) return;

  let next: HTMLElement | null | undefined = null;
  if (e.key === "ArrowRight") next = onRow ? stops[0] : stops[index + 1];
  else if (e.key === "ArrowLeft") next = onRow ? null : index === 0 ? (row.tabIndex >= 0 ? row : null) : stops[index - 1];
  else {
    const other = navRow(row, e.key === "ArrowDown" ? 1 : -1);
    if (!other) return;
    if (onRow) next = other;
    else {
      // Same cell, and the same stop within it when a cell has two (building, rooms).
      const col = target.closest<HTMLElement>("[data-nav-col]")!.dataset.navCol;
      const inCell = stops.filter((s) => s.closest<HTMLElement>("[data-nav-col]")!.dataset.navCol === col);
      const there = stopsIn(other).filter((s) => s.closest<HTMLElement>("[data-nav-col]")!.dataset.navCol === col);
      next = there[Math.min(inCell.indexOf(target), there.length - 1)] ?? (other.tabIndex >= 0 ? other : null);
    }
  }
  if (!next) return;
  e.preventDefault();
  next.focus();
}

/**
 * Tab out of a cell whose editor or popover is open: focus the next cell's
 * stop in the row (previous, with Shift), and past the row's last cell, the
 * next row — the same order plain Tab walks. Returns whether it moved focus.
 * The open cell itself is skipped, so its editor can close behind the move.
 */
export function focusAdjacentCell(from: HTMLElement, backwards: boolean): boolean {
  const row = from.closest<HTMLElement>("[data-nav-row]");
  const cell = from.closest<HTMLElement>("[data-nav-col]");
  if (!row || !cell) return false;
  const after = (el: HTMLElement) => !!(cell.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) && !cell.contains(el);
  const before = (el: HTMLElement) => !!(cell.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING) && !cell.contains(el);
  const stops = stopsIn(row);
  let next: HTMLElement | null | undefined = backwards
    ? stops.filter(before).pop() ?? (row.tabIndex >= 0 ? row : null)
    : stops.find(after);
  if (!next && !backwards) {
    const other = navRow(row, 1);
    next = other && (other.tabIndex >= 0 ? other : stopsIn(other)[0]);
  }
  if (!next) return false;
  next.focus();
  return true;
}
