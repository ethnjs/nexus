"use client";

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import { membershipsApi, MembershipMe, Permission } from "./api";

interface MyMembershipContextValue {
  membership: MembershipMe | null;
  loading: boolean;
  hasPermission: (p: Permission) => boolean;
}

const MyMembershipContext = createContext<MyMembershipContextValue | null>(null);

export function MyMembershipProvider({ tournamentId, children }: { tournamentId: string; children: ReactNode }) {
  const [membership, setMembership] = useState<MembershipMe | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    membershipsApi.getMe(Number(tournamentId))
      .then(setMembership)
      .catch(() => setMembership(null))
      .finally(() => setLoading(false));
  }, [tournamentId]);

  const hasPermission = useCallback(
    (p: Permission) => membership?.permissions.includes(p) ?? false,
    [membership]
  );

  return (
    <MyMembershipContext.Provider value={{ membership, loading, hasPermission }}>
      {children}
    </MyMembershipContext.Provider>
  );
}

export function useMyMembership() {
  const ctx = useContext(MyMembershipContext);
  if (!ctx) throw new Error("useMyMembership must be used within MyMembershipProvider");
  return ctx;
}
