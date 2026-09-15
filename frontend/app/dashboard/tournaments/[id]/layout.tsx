"use client";

import { ReactNode, useState, useEffect } from "react";
import { use } from "react";
import { usePathname, useRouter } from "next/navigation";
import { TournamentProvider, useTournament } from "@/lib/useTournament";
import { MyMembershipProvider, useMyMembership } from "@/lib/useMyMembership";
import { AgeDisclosureModal } from "@/components/tournament/AgeDisclosureModal";
import { UnsavedChangesProvider } from "@/lib/useUnsavedChanges";
import { LayoutPanelProvider } from "@/lib/useLayoutPanel";
import { LayoutPanelSlot } from "@/components/layout/LayoutPanelSlot";
import { NavDrawerProvider } from "@/lib/useNavDrawer";
import styles from "@/components/layout/Shell.module.css";
import { TournamentSidebar } from "@/components/tournament/TournamentSidebar";
import { Topbar } from "@/components/layout/Topbar";
import { Button } from "@/components/ui/Button";
import { IconWarning } from "@/components/ui/Icons";
import { tournamentsApi, ApiError } from "@/lib/api";
import { BoardDndProvider } from "@/components/assignments/BoardDnd";

function TournamentNotFound() {
  const router = useRouter();
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      height: "100vh", gap: "12px", textAlign: "center", background: "var(--color-bg)",
    }}>
      <div style={{ color: "var(--color-text-tertiary)" }}>
        <IconWarning size={28} />
      </div>
      <p style={{ fontFamily: "Georgia, serif", fontSize: "20px", color: "var(--color-text-primary)" }}>
        Tournament not found
      </p>
      <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)", maxWidth: "300px" }}>
        It may have been deleted, or you may not have access to it.
      </p>
      <div style={{ marginTop: "4px" }}>
        <Button variant="secondary" onClick={() => router.push("/dashboard")}>
          Back to dashboard
        </Button>
      </div>
    </div>
  );
}

function TournamentShell({
  tournamentId,
  children,
}: {
  tournamentId: string;
  children: ReactNode;
}) {
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const { selectedTournament, setSelectedTournament } = useTournament();
  const { membership, setMembership } = useMyMembership();
  const pathname = usePathname();
  // Sidebar is locked open (not just hover-expanded) on settings routes —
  // reserve its full width there instead of letting it overlay content. The
  // mobile override (the drawer reserves nothing) is in Shell.module.css.
  const onSettingsRoute = pathname.startsWith(`/dashboard/tournaments/${tournamentId}/settings`);

  useEffect(() => {
    tournamentsApi.get(Number(tournamentId))
      .then(setSelectedTournament)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) {
          setNotFound(true);
        } else {
          console.error(err);
        }
      });
  }, [tournamentId, setSelectedTournament]);

  if (notFound) {
    return <TournamentNotFound />;
  }

  return (
    <div className={styles.shell}>
      <TournamentSidebar
        onExpandedChange={setSidebarExpanded}
        tournamentId={tournamentId}
      />
      <div className={onSettingsRoute ? `${styles.column} ${styles.columnWide}` : styles.column}>
        {/* The rail carries the wordmark on desktop, but it's an off-canvas
            drawer on mobile — so the bar takes over there, and the tournament
            switcher moves into the drawer for want of room. */}
        <Topbar
          showWordmark="mobile-only"
          showDropdown
          tournamentId={tournamentId}
          showAvatar
          sidebarExpanded={sidebarExpanded && !onSettingsRoute}
          showNavToggle
        />
        <main className={styles.main}>
          {children}
        </main>
      </div>
      {/* Third flex sibling, not an overlay: it shrinks the column above
          (Topbar included) instead of covering it, so the page stays live. */}
      <LayoutPanelSlot />

      {membership?.needs_age_consent && (
        <AgeDisclosureModal
          tournamentId={Number(tournamentId)}
          tournament={selectedTournament}
          onResolved={setMembership}
        />
      )}
    </div>
  );
}

export default function TournamentLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id: tournamentId } = use(params);

  return (
    <TournamentProvider>
      <MyMembershipProvider tournamentId={tournamentId}>
        {/* Above the shell so Sidebar/Topbar can read the dirty flag a nested
            page (e.g. the roles editor) registers. */}
        <UnsavedChangesProvider>
          <LayoutPanelProvider>
            {/* Above the shell so the assignments board's drag context
                reaches both <main> and the panel slot — its member belt is
                rendered into the latter, a sibling of <main> rather than a
                descendant of it. Inert on every other tab. */}
            <BoardDndProvider>
              {/* Above the shell so the Topbar's drawer toggle and the rail
                  it opens share one state — they're siblings inside it. */}
              <NavDrawerProvider>
                <TournamentShell tournamentId={tournamentId}>
                  {children}
                </TournamentShell>
              </NavDrawerProvider>
            </BoardDndProvider>
          </LayoutPanelProvider>
        </UnsavedChangesProvider>
      </MyMembershipProvider>
    </TournamentProvider>
  );
}