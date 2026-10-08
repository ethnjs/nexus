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
import {
  tournamentsApi,
  Tournament,
  TournamentSummary,
  TournamentTrack,
} from "./api";

/**
 * Whether a tournament renders in simple mode: exactly one live track.
 *
 * Derived, not stored — there is no mode flag anywhere, and deliberately so.
 * A flag could disagree with the track count, and then every screen would
 * have to decide which one to believe. Adding a second track *is* switching
 * to advanced.
 *
 * A cosmetic track counts. Test Writing is a real second workstream with its
 * own events and staffing, so a tournament that has one is past the point
 * where the simplified UI helps.
 *
 * Zero tracks is advanced, not simple: simple mode writes dates, venue and
 * division through to the sole track, and with no track there is nothing to
 * write to. Advanced shows the Tracks section, which is what that tournament
 * actually needs.
 *
 * Takes the tracks rather than the tournament so a settings page can ask
 * about its own local, unsaved track list mid-edit.
 */
export function isSimpleMode(tracks: TournamentTrack[] | null | undefined): boolean {
  return (tracks?.length ?? 0) === 1;
}

interface TournamentContextValue {
  tournaments: TournamentSummary[];
  selectedTournament: Tournament | null;
  setSelectedTournament: (t: Tournament | null) => void;
  isArchived: boolean;
  /** Every day the tournament actually runs — [] before one is selected.
   *  Not a span: a tournament with Day 1 on Feb 13 and Day 2 on Feb 20 has
   *  two days here, not eight. Comes straight from the API. */
  days: string[];
  /** days.length > 1 — whether a day picker is actually meaningful, or should just lock to the one day. */
  isMultiDay: boolean;
  /** The tournament's live tracks — [] before one is selected. Pending-delete
   *  tracks are already excluded by the API. */
  tracks: TournamentTrack[];
  /** See isSimpleMode. Hides the Tracks section, moves track metadata into
   *  Details, locks every track picker, and drops the assignments tab bar. */
  isSimple: boolean;
  /** The one track in simple mode, null otherwise. What the locked pickers
   *  preselect and what the Details rows write through to — so a caller never
   *  has to repeat the `tracks[0]` reach, or guess when it's safe. */
  soleTrack: TournamentTrack | null;
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

  const days = useMemo(() => selectedTournament?.dates ?? [], [selectedTournament]);
  const tracks = useMemo(() => selectedTournament?.tracks ?? [], [selectedTournament]);
  const isSimple = isSimpleMode(tracks);

  return (
    <TournamentContext.Provider
      value={{
        tournaments,
        selectedTournament,
        setSelectedTournament,
        isArchived: !!selectedTournament?.is_archived,
        days,
        isMultiDay: !!selectedTournament?.is_multi_day,
        tracks,
        isSimple,
        soleTrack: isSimple ? tracks[0] : null,
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