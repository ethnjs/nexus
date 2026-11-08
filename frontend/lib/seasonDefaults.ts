"use client";

import { useEffect, useState } from "react";
import {
  type SeasonEvent,
  seasonEventsApi,
  type TournamentEvent,
  type TournamentEventInput,
} from "@/lib/api";

export const SEASON_FIELDS = ["format", "has_impound", "has_self_schedule"] as const;

export type SeasonDefaults = Required<Pick<TournamentEventInput, (typeof SEASON_FIELDS)[number]>>;

export const NO_SEASON_DEFAULTS = "This season's events don't list this event and division.";

/** The season's events, or null while they load. Empty for a tournament with no dates yet. */
export function useSeasonEvents(seasonYear: number | null): SeasonEvent[] | null {
  const [loaded, setLoaded] = useState<{ year: number; events: SeasonEvent[] } | null>(null);
  useEffect(() => {
    if (seasonYear === null) return;
    let active = true;
    seasonEventsApi
      .list({ year: seasonYear })
      .catch(() => [])
      .then((events) => {
        if (active) setLoaded({ year: seasonYear, events });
      });
    return () => {
      active = false;
    };
  }, [seasonYear]);
  if (seasonYear === null) return [];
  return loaded?.year === seasonYear ? loaded.events : null;
}

/** Matched like the backend fills a new event: catalog event and division, active or not. */
export function seasonDefaultsFor(
  event: Pick<TournamentEvent, "event_id" | "division">,
  seasonEvents: SeasonEvent[],
): SeasonDefaults | null {
  if (event.event_id === null || event.division === null) return null;
  const match = seasonEvents.find(
    (se) => se.event.id === event.event_id && se.division === event.division,
  );
  if (!match) return null;
  return {
    format: match.format,
    has_impound: match.has_impound,
    has_self_schedule: match.has_self_schedule,
  };
}
