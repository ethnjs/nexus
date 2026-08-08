"use client";

import { createContext, useContext, useEffect } from "react";
import { Role } from "@/lib/api";

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

// Shares the layout's role list (and lock logic) with /new and /[roleId] —
// /new picks a default rank from it, /[roleId] looks up its own role and
// re-reads it after save; both call refreshRoles() after create/delete so the
// nav rail updates without the layout remounting.
export interface RoleListValue {
  roles:        Role[];
  refreshRoles: () => Promise<void>;
  lockReason:   (role: Role) => string | null;
}

const RoleListContext = createContext<RoleListValue>({
  roles: [], refreshRoles: async () => {}, lockReason: () => null,
});
export const RoleListProvider = RoleListContext.Provider;

export function useRoleList() {
  return useContext(RoleListContext);
}
