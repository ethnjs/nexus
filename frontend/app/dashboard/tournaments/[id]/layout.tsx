"use client";

import { ReactNode, useState, useEffect } from "react";
import { use } from "react";
import { usePathname, useRouter } from "next/navigation";
import { TournamentProvider, useTournament } from "@/lib/useTournament";
import { MyMembershipProvider, useMyMembership } from "@/lib/useMyMembership";
import { AgeDisclosureModal } from "@/components/tournament/AgeDisclosureModal";
import { UnsavedChangesProvider } from "@/lib/useUnsavedChanges";
import { LayoutPanelProvider, useLayoutPanelContent, LayoutPanel } from "@/lib/useLayoutPanel";
import { Sidebar, COLLAPSED_W, EXPANDED_W } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { Button } from "@/components/ui/Button";
import { IconWarning } from "@/components/ui/Icons";
import { tournamentsApi, ApiError } from "@/lib/api";

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

// Renders whatever a descendant registered via useSetLayoutPanel as a sibling
// of the Topbar+main column, so it consumes layout width instead of covering
// the page.
//
// mounted lags behind panel on close (stays mounted through the collapse
// transition instead of vanishing instantly); expanded flips a frame after
// mount so there's an actual 0 -> full-width transition to animate rather
// than appearing already-open. Same technique as ShiftsTab's own split-view
// panel (panelMountedId/panelExpanded there).
function LayoutPanelSlot() {
  const panel = useLayoutPanelContent();
  const [mounted, setMounted] = useState<LayoutPanel | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (panel) {
      setMounted(panel);
      // A single rAF often fires before the browser has actually painted
      // the just-mounted width:0 state, so the width:full flip lands in the
      // same paint and there's nothing to visibly transition from. Nesting
      // a second rAF guarantees one real paint happens in between.
      let raf2 = 0;
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setExpanded(true));
      });
      return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); };
    }
    setExpanded(false);
  }, [panel]);

  if (!mounted) return null;

  return (
    <div
      onTransitionEnd={() => { if (!expanded) setMounted(null); }}
      style={{
        width: expanded ? mounted.width : 0,
        opacity: expanded ? 1 : 0,
        flexShrink: 0, overflow: "hidden", height: "100%",
        transition: "width 220ms ease, opacity 200ms ease",
      }}
    >
      <div style={{ width: mounted.width, height: "100%" }}>
        {mounted.content}
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
  // reserve its full width there instead of letting it overlay content.
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
    <div style={{ display: "flex", height: "100vh", overflow: "hidden", background: "var(--color-bg)" }}>
      <Sidebar
        onExpandedChange={setSidebarExpanded}
        tournamentId={tournamentId}
      />
      <div style={{
        flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden",
        marginLeft: onSettingsRoute ? EXPANDED_W : COLLAPSED_W,
        transition: "margin-left 0.2s ease",
      }}>
        <Topbar showDropdown tournamentId={tournamentId} showAvatar sidebarExpanded={sidebarExpanded && !onSettingsRoute} />
        <main style={{ flex: 1, overflowY: "auto", padding: "22px 24px" }}>
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
            <TournamentShell tournamentId={tournamentId}>
              {children}
            </TournamentShell>
          </LayoutPanelProvider>
        </UnsavedChangesProvider>
      </MyMembershipProvider>
    </TournamentProvider>
  );
}