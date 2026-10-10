import type { DuosmiumRole, TorusRole } from "@/lib/api";

// Per-viewer memory for the Export button, in localStorage: the last export
// per tournament and page, and which output each preset was last sent to.
// Conveniences only — every read tolerates a missing, stale or blocked store.

export type ExportPage = "members" | "assignments";
export type ExportOutput = "copy" | "csv" | "txt";

/** Enough to rerun an export. A saved preset is stored by id and looked up
 *  fresh, so an edit to it is picked up and a deleted one is forgotten. */
export type RememberedExport =
  | { kind: "torus"; trackId: number; role: TorusRole }
  | { kind: "duosmium"; trackId: number; division: string; roles: DuosmiumRole[] }
  | { kind: "email_list" }
  | { kind: "saved"; presetId: number; trackId: number | null };

const lastKey = (tournamentId: number, page: ExportPage) => `nexus.export.last.${tournamentId}.${page}`;
const outputKey = (tournamentId: number) => `nexus.export.output.${tournamentId}`;

/** Which preset an output preference belongs to. */
export function presetKey(remembered: RememberedExport): string {
  return remembered.kind === "saved" ? `saved:${remembered.presetId}` : remembered.kind;
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or a full store: the button just won't remember.
  }
}

export function readLastExport(tournamentId: number, page: ExportPage): RememberedExport | null {
  const value = read<RememberedExport>(lastKey(tournamentId, page));
  return value && typeof value === "object" && "kind" in value ? value : null;
}

export function writeLastExport(tournamentId: number, page: ExportPage, value: RememberedExport): void {
  write(lastKey(tournamentId, page), value);
}

export function forgetLastExport(tournamentId: number, page: ExportPage): void {
  try {
    localStorage.removeItem(lastKey(tournamentId, page));
  } catch {
    // Nothing to forget.
  }
}

/** The output this preset was last sent to; Copy the first time. */
export function readOutput(tournamentId: number, key: string): ExportOutput {
  const value = read<Record<string, ExportOutput>>(outputKey(tournamentId))?.[key];
  return value === "csv" || value === "txt" ? value : "copy";
}

export function writeOutput(tournamentId: number, key: string, output: ExportOutput): void {
  write(outputKey(tournamentId), { ...(read<Record<string, ExportOutput>>(outputKey(tournamentId)) ?? {}), [key]: output });
}
