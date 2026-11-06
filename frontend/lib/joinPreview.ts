import type { JoinPreviewResponse, JoinPreviewTournament } from "@/lib/api";
import { tournamentFactRows, tournamentYear } from "@/lib/tournamentDisplay";

const API_URL = process.env.API_URL ?? "http://localhost:8001";
const API_KEY = process.env.API_KEY ?? "";

/**
 * Server-only: the tournament an invite code points at, or null for a chapter code
 * or an invalid, expired or unreachable one. lib/api.ts can't be used on the server
 * because it fetches the relative /api/proxy path.
 */
export async function fetchJoinPreview(code: string): Promise<JoinPreviewTournament | null> {
  const res = await fetch(`${API_URL}/join/preview/?code=${encodeURIComponent(code)}`, {
    headers: API_KEY ? { "X-API-Key": API_KEY } : {},
  }).catch(() => null);
  if (!res?.ok) return null;
  const preview: JoinPreviewResponse = await res.json();
  return preview.type === "tournament" ? preview : null;
}

/** "2027 SoCal Regional", as the join page heads its card. */
export function joinPreviewTitle(preview: JoinPreviewTournament): string {
  const year = tournamentYear(preview);
  return year ? `${year} ${preview.name}` : preview.name;
}

/** Each where-and-when row as one line: "Main Site · UCLA · February 13, 2027". */
export function joinPreviewFactLines(preview: JoinPreviewTournament): string[] {
  return tournamentFactRows(preview, "long")
    .map((row) => [row.name, row.place, row.dates].filter(Boolean).join(" · "))
    .filter(Boolean);
}
