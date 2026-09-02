"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ApiError, DisplayConfig, DisplayConfigCatalog, DisplayConfigSurface, displayConfigApi,
} from "@/lib/api";

/**
 * Loads the display-config catalog plus one surface's saved settings, and
 * saves edits back without disturbing the other surfaces.
 *
 * The whole config is kept as-loaded rather than re-fetched at save time: a
 * PUT replaces every surface at once, so writing back only the edited one
 * would silently wipe whatever the others hold.
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
      await displayConfigApi.set(tournamentId, { ...fullConfig, [surface]: draft });
      onSaved?.();
      onClose?.();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to save display settings.");
      setSaving(false);
    }
  }, [tournamentId, surface, fullConfig, draft]);

  return { catalog, draft, setDraft, saving, error, setError, save, loading: catalog === null && error === null };
}
