"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from "react";
import { tournamentsApi, Tournament, TournamentSummary } from "./api";

interface TournamentContextValue {
  tournaments: TournamentSummary[];
  selectedTournament: Tournament | null;
  setSelectedTournament: (t: Tournament | null) => void;
  isArchived: boolean;
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

  return (
    <TournamentContext.Provider
      value={{
        tournaments,
        selectedTournament,
        setSelectedTournament,
        isArchived: !!selectedTournament?.is_archived,
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