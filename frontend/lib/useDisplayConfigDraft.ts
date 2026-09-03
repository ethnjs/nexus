"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ApiError, DisplayConfig, DisplayConfigCatalog, DisplayConfigSurface, displayConfigApi,
} from "@/lib/api";

/**
 * Loads the display-config catalog plus one surface's saved settings, and
 * saves edits back without disturbing the other surfaces.
 *
 * A PUT replaces every surface at once, so the save re-reads the config
 * first and lays only this draft's own keys over it. The config loaded when
 * the modal opened isn't good enough: the members table writes filters and
 * sort into the same surface while a modal is open, and a stale copy would
 * put them back to whatever they were at open time.
 */
export function useDisplayConfigDraft(tournamentId: number, surface: string) {
  const [catalog, setCatalog] = useState<DisplayConfigCatalog | null>(null);
  const [fullConfig, setFullConfig] = useState<DisplayConfig | null>(null);
  const [draft, setDraft] = useState<DisplayConfigSurface | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([displayConfigApi.getCatalog(tournamentId), displayConfigApi.get(tournamentId)])
      .then(([loadedCatalog, config]) => {
        setCatalog(loadedCatalog);
        setFullConfig(config);
        setDraft(config[surface] ?? { hidden: [] });
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load display settings."));
  }, [tournamentId, surface]);

  const save = useCallback(async (onSaved?: () => void, onClose?: () => void) => {
    if (!fullConfig || !draft) return;
    setSaving(true);
    setError(null);
    try {
      const fresh = await displayConfigApi.get(tournamentId).catch(() => fullConfig);
      await displayConfigApi.set(tournamentId, {
        ...fresh,
        [surface]: {
          ...fresh[surface],
          hidden: draft.hidden,
          columns: draft.columns,
          sections: draft.sections,
        },
      });
      onSaved?.();
      onClose?.();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to save display settings.");
      setSaving(false);
    }
  }, [tournamentId, surface, fullConfig, draft]);

  return { catalog, draft, setDraft, saving, error, setError, save, loading: catalog === null && error === null };
}
