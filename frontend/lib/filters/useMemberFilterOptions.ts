"use client";

import { useCallback, useState } from "react";
import { type MemberFilterOptions, membersApi } from "@/lib/api";

export interface MemberFilterOptionsState {
  options: MemberFilterOptions | null;
  /** Set when the last fetch failed; `load` tries again. */
  error: string | null;
  /** Fetches the options unless they're already here. */
  load: () => void;
}

/** The roster filter's options, fetched the first time a filter modal opens. */
export function useMemberFilterOptions(tournamentId: number): MemberFilterOptionsState {
  const [options, setOptions] = useState<MemberFilterOptions | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (options !== null) return;
    setError(null);
    membersApi
      .filterOptions(tournamentId)
      .then(setOptions)
      .catch(() => setError("Couldn't load the filter options. Close and reopen to try again."));
  }, [options, tournamentId]);

  return { options, error, load };
}
