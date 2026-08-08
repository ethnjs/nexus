"use client";

import { createContext, useContext, useEffect } from "react";

// Lets the detail page plug its own label/permissions draft into the layout's
// single FloatingSaveBar, so reordering roles and editing a role's fields
// never show two save bars — one Save commits whichever of the two is dirty.
export interface RoleFieldSave {
  isDirty: boolean;
  saving:  boolean;
  error?:  string;
  save:    () => Promise<void>;
  cancel:  () => void;
}

const RoleFieldSaveContext = createContext<(state: RoleFieldSave | null) => void>(() => {});
export const RoleFieldSaveProvider = RoleFieldSaveContext.Provider;

// Caller should useMemo `state` (keyed on its own draft/isDirty/saving/error)
// so this only re-registers — and the closures `save`/`cancel` capture the
// latest draft — when something actually changed.
export function useRegisterRoleFieldSave(state: RoleFieldSave | null) {
  const register = useContext(RoleFieldSaveContext);
  useEffect(() => {
    register(state);
    return () => register(null);
  }, [register, state]);
}
