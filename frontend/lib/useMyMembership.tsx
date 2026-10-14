"use client";

import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { type MembershipMe, membersApi, type Permission } from "./api";

interface MyMembershipContextValue {
  membership: MembershipMe | null;
  loading: boolean;
  hasPermission: (p: Permission) => boolean;
  /** Replaces the cached membership — used after POST .../age-disclosure/
   * resolves, so the blocking consent modal can clear without a refetch. */
  setMembership: (m: MembershipMe | null) => void;
}

const MyMembershipContext = createContext<MyMembershipContextValue | null>(null);

export function MyMembershipProvider({
  tournamentId,
  children,
}: {
  tournamentId: string;
  children: ReactNode;
}) {
  const [membership, setMembership] = useState<MembershipMe | null>(null);
  // Loading until the fetch for the current tournament settles, so switching
  // tournaments reads as loading on the very first render.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const loading = loadedFor !== tournamentId;

  useEffect(() => {
    membersApi
      .getMe(Number(tournamentId), ["roles"])
      .then(setMembership)
      .catch(() => setMembership(null))
      .finally(() => setLoadedFor(tournamentId));
  }, [tournamentId]);

  const hasPermission = useCallback(
    (p: Permission) => membership?.permissions.includes(p) ?? false,
    [membership],
  );

  return (
    <MyMembershipContext.Provider value={{ membership, loading, hasPermission, setMembership }}>
      {children}
    </MyMembershipContext.Provider>
  );
}

export function useMyMembership() {
  const ctx = useContext(MyMembershipContext);
  if (!ctx) throw new Error("useMyMembership must be used within MyMembershipProvider");
  return ctx;
}
