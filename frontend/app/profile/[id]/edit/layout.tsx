"use client";

import { UnsavedChangesProvider } from "@/lib/useUnsavedChanges";

/**
 * Mounted for the edit route alone — the profile view page beneath it has
 * nothing to lose, and the provider only installs its click and beforeunload
 * listeners while something is actually dirty.
 *
 * It has to be a layout rather than a wrapper inside the page: the page calls
 * useBlockNavigation and useUnsavedChanges, which read the nearest provider
 * above them. Without one the context falls back to its pass-through default
 * and every guard silently no-ops (see lib/useUnsavedChanges.tsx).
 */
export default function ProfileEditLayout({ children }: { children: React.ReactNode }) {
  return <UnsavedChangesProvider>{children}</UnsavedChangesProvider>;
}
