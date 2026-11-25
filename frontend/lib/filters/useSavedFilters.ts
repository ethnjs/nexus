"use client";

import { useCallback, useEffect, useState } from "react";
import { type FilterGroup, type SavedFilter, savedFiltersApi, usersApi } from "@/lib/api";

export interface SavedFilters {
  items: SavedFilter[];
  create: (name: string, filter: FilterGroup) => Promise<SavedFilter>;
  update: (id: number, patch: { name?: string; filter?: FilterGroup }) => Promise<SavedFilter>;
  remove: (id: number) => Promise<void>;
}

function byName(list: SavedFilter[]): SavedFilter[] {
  return [...list].sort((a, b) => a.name.localeCompare(b.name));
}

/** The viewer's named filters on one table: a tournament's when
 *  `tournamentId` is given, else their own (the admin users table). */
export function useSavedFilters(surface: string, tournamentId?: number | null): SavedFilters {
  const [items, setItems] = useState<SavedFilter[]>([]);

  useEffect(() => {
    let cancelled = false;
    const request =
      tournamentId == null
        ? usersApi.listSavedFilters(surface)
        : savedFiltersApi.list(tournamentId, surface);
    request.then((list) => !cancelled && setItems(list)).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [surface, tournamentId]);

  const create = useCallback(
    async (name: string, filter: FilterGroup) => {
      const body = { surface, name, filter };
      const saved =
        tournamentId == null
          ? await usersApi.createSavedFilter(body)
          : await savedFiltersApi.create(tournamentId, body);
      setItems((list) => byName([...list, saved]));
      return saved;
    },
    [surface, tournamentId],
  );

  const update = useCallback(
    async (id: number, patch: { name?: string; filter?: FilterGroup }) => {
      const saved =
        tournamentId == null
          ? await usersApi.updateSavedFilter(id, patch)
          : await savedFiltersApi.update(tournamentId, id, patch);
      setItems((list) => byName(list.map((item) => (item.id === id ? saved : item))));
      return saved;
    },
    [tournamentId],
  );

  const remove = useCallback(
    async (id: number) => {
      if (tournamentId == null) await usersApi.deleteSavedFilter(id);
      else await savedFiltersApi.delete(tournamentId, id);
      setItems((list) => list.filter((item) => item.id !== id));
    },
    [tournamentId],
  );

  return { items, create, update, remove };
}
