"use client";

import { useTournament } from "@/lib/useTournament";

/** Tooltip for every control an archived tournament locks — one wording everywhere. */
export const ARCHIVED_REASON = "This tournament is archived — nothing can be changed.";

/** Archive lock for pages under the tournament layout. Permissions still hide
 *  what you could never do; archiving only locks, so the control stays visible
 *  and says why. Form pages sit outside the layout — they read
 *  `form.tournament_is_archived` with ARCHIVED_REASON instead. */
export function useArchiveLock() {
  const { isArchived } = useTournament();
  return { isArchived, archivedReason: isArchived ? ARCHIVED_REASON : undefined };
}
