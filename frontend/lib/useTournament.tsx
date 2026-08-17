"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  ReactNode,
} from "react";
import { tournamentsApi, Tournament, TournamentSummary } from "./api";

// Every calendar day between start_date/end_date, inclusive — internal to
// deriving `days` below; nothing else needs a tournament's day list.
function tournamentDays(startDate: string, endDate: string): string[] {
  const days: string[] = [];
  const pad = (n: number) => String(n).padStart(2, "0");
  let cur = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  while (cur <= end) {
    days.push(`${cur.getFullYear()}-${pad(cur.getMonth() + 1)}-${pad(cur.getDate())}`);
    cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1);
  }
  return days;
}

interface TournamentContextValue {
  tournaments: TournamentSummary[];
  selectedTournament: Tournament | null;
  setSelectedTournament: (t: Tournament | null) => void;
  isArchived: boolean;
  /** Every calendar day the tournament spans, inclusive — [] before a tournament is selected. */
  days: string[];
  /** days.length > 1 — whether a day picker is actually meaningful, or should just lock to the one day. */
  isMultiDay: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
}

const TournamentContext = createContext<TournamentContextValue | null>(null);

export function TournamentProvider({ children }: { children: ReactNode }) {
  const [tournaments, setTournaments] = useState<TournamentSummary[]>([]);
  const [selectedTournament, setSelectedTournament] =
    useState<Tournament | null>(null);
  const [loading, setLoading] = useState(true);

  // Only populates the `tournaments` list (used by the Topbar switcher).
  // selectedTournament is never set from here — every route lives under
  // /dashboard/tournaments/[id], so TournamentShell's own fetch keyed to
  // that URL id is the sole writer. Letting this list refresh also assign
  // selectedTournament (previously via localStorage) raced with that fetch:
  // this list call is slower, so it would reliably land second and clobber
  // the correct URL-driven selection with a stale cached one.
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      // Calls GET /tournaments/me/ — returns tournaments the current user
      // has any membership in (admin sees all tournaments)
      const data = await tournamentsApi.list();
      setTournaments(data);
    } catch (err) {
      console.error("Failed to load tournaments", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const days = useMemo(
    () => (selectedTournament ? tournamentDays(selectedTournament.start_date, selectedTournament.end_date) : []),
    [selectedTournament]
  );

  return (
    <TournamentContext.Provider
      value={{
        tournaments,
        selectedTournament,
        setSelectedTournament,
        isArchived: !!selectedTournament?.is_archived,
        days,
        isMultiDay: days.length > 1,
        loading,
        refresh,
      }}
    >
      {children}
    </TournamentContext.Provider>
  );
}

export function useTournament() {
  const ctx = useContext(TournamentContext);
  if (!ctx)
    throw new Error("useTournament must be used within TournamentProvider");
  return ctx;
}