import type { TournamentBuilding } from "@/lib/api";

export const MAX_BUILDING_NAME = 255;
export const MAX_ROOM_NAME = 64;

/** Columns split on tabs (a spreadsheet paste), else commas; null with
 *  neither. Empty trailing columns, which a sheet's blank cells leave, are
 *  dropped. */
export function splitColumns(line: string): string[] | null {
  const sep = line.includes("\t") ? "\t" : line.includes(",") ? "," : null;
  if (!sep) return null;
  const columns = line.split(sep).map((c) => c.trim());
  while (columns.length > 0 && !columns[columns.length - 1]) columns.pop();
  return columns;
}

/** "RH 210" → ["RH", "210"]: the first word is the building. */
export function splitBuildingRoom(text: string): [string, string] {
  const space = text.search(/\s/);
  return space < 0 ? [text, ""] : [text.slice(0, space), text.slice(space).trim()];
}

/** "(Back Court)" → "Back Court"; "164 (Lab)" and "(A) or (B)" stay as typed. */
export function unwrapParens(room: string): string {
  if (!room.startsWith("(") || !room.endsWith(")")) return room;
  const inner = room.slice(1, -1);
  return /[()]/.test(inner) ? room : inner.trim();
}

/** By name, else short name, case-insensitively. */
export function findBuilding(
  buildings: readonly TournamentBuilding[],
  typed: string,
): TournamentBuilding | null {
  const key = typed.toLowerCase();
  return (
    buildings.find((b) => b.name.toLowerCase() === key) ??
    buildings.find((b) => b.short_name?.toLowerCase() === key) ??
    null
  );
}

export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}
