"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from "react";
import { tournamentsApi, Tournament } from "./api";

export type { Tournament };

interface TournamentContextValue {
  tournaments: Tournament[];
  selectedTournament: Tournament | null;
  setSelectedTournament: (t: Tournament | null) => void;
  loading: boolean;
  refresh: () => Promise<void>;
}

const TournamentContext = createContext<TournamentContextValue | null>(null);

export function TournamentProvider({ children }: { children: ReactNode }) {
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [selectedTournament, setSelectedTournamentState] =
    useState<Tournament | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      // Calls GET /tournaments/me/ — returns tournaments the current user
      // has any membership in (admin sees all tournaments)
      const data = await tournamentsApi.list();
      setTournaments(data);

      // Restore last selected from localStorage, or default to first
      const savedId = localStorage.getItem("nexus_selected_tournament");
      if (savedId) {
        const found = data.find((t: Tournament) => t.id === parseInt(savedId));
        if (found) {
          setSelectedTournamentState(found);
          setLoading(false);
          return;
        }
      }
      if (data.length > 0) {
        setSelectedTournamentState(data[0]);
      }
    } catch (err) {
      console.error("Failed to load tournaments", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const setSelectedTournament = useCallback((t: Tournament | null) => {
    setSelectedTournamentState(t);
    if (t) {
      localStorage.setItem("nexus_selected_tournament", String(t.id));
    } else {
      localStorage.removeItem("nexus_selected_tournament");
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