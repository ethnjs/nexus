"use client";

import { createContext, useContext } from "react";
import { Permission, Role } from "@/lib/api";

// Shares the layout's role list (and lock logic) with page.tsx — it looks up
// its own role here and calls refreshRoles() after delete so the nav rail
// updates without the layout remounting.
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

// Per-role field drafts live in the layout, not in page.tsx, so switching
// roles doesn't unmount them — every pending edit stays dirty and stays
// saveable from the one shared save bar.
export interface RoleDraft {
  label:       string;
  permissions: Permission[];
}

export interface RoleDraftsValue {
  /** The role's pending draft, or its live server values if it has none. */
  draftFor: (role: Role) => RoleDraft;
  setDraft: (roleId: number, patch: Partial<RoleDraft>) => void;
}

const RoleDraftsContext = createContext<RoleDraftsValue>({
  draftFor: (role) => ({ label: role.label, permissions: role.permissions as Permission[] }),
  setDraft: () => {},
});
export const RoleDraftsProvider = RoleDraftsContext.Provider;

export function useRoleDrafts() {
  return useContext(RoleDraftsContext);
}

export function draftDiffers(draft: RoleDraft, role: Role): boolean {
  return draft.label.trim() !== role.label
    || JSON.stringify([...draft.permissions].sort()) !== JSON.stringify([...role.permissions].sort());
}
