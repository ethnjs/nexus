"use client";

import { startTransition, useEffect, useState } from "react";
import {
  ApiError, DisplayConfigSection, MembershipFull, Role,
  TournamentShift, TournamentTrack, displayConfigApi, membersApi, tournamentShiftsApi,
  tournamentTracksApi,
} from "@/lib/api";
import { DockedPanel } from "@/components/layout/DockedPanel";
import { Spinner } from "@/components/ui/Spinner";
import { ProfileHeader } from "@/components/profile/sections/ProfileHeader";
import { MemberSections } from "@/components/tournament/sections/MemberSections";
import { MEMBERS_PANEL } from "@/lib/displayConfigSurfaces";
import { MemberPanelConfigModal } from "@/components/tournament/MemberPanelConfigModal";
import { Button } from "@/components/ui/Button";
import { IconExpand, IconEye, IconTrash } from "@/components/ui/Icons";

// Exported so the caller registering this panel in the layout slot reserves
// exactly the width the panel itself renders at.
export const MEMBER_PANEL_WIDTH = 700;

interface MemberPanelProps {
  tournamentId: number;
  membershipId: number;
  allRoles: Role[];
  canTouchRole: (role: Role) => boolean;
  canEditMember: (target: MembershipFull) => boolean;
  /** Tournament's age-disclosure toggles — the Age field is dropped entirely when neither is on, since there's nothing to show for any member. */
  collectIsOver18: boolean;
  collectIsOver21: boolean;
  /** Archived tournaments hide the Remove control entirely rather than showing it disabled — same rule the table row follows. */
  isArchived?: boolean;
  /** This panel is showing the current user's own membership — removal redirects to the General Settings leave flow. */
  isSelf?: boolean;
  /** Opens the caller's remove-member confirmation. Omit to hide the control (e.g. a surface with no removal flow). */
  onRemove?: (membership: MembershipFull) => void;
  onSelfRemove?: (membership: MembershipFull) => void;
  onClose: () => void;
  /** Bubbles role changes up so the caller's list stays in sync. */
  onUpdated?: (updated: MembershipFull) => void;
  /** Fires after the assignments section writes, so a board beside this panel can re-read. */
  onAssignmentsChanged?: () => void;
  /** Bumped by the caller after it writes this member's assignments elsewhere — re-reads the member. */
  assignmentsVersion?: number;
  /** Prev/next through the table's current filtered/sorted order — omit both to hide the controls (e.g. while this panel is showing one member of a multi-select). */
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
}

// Read-only member detail panel — reuses the same profile section
// components as /profile/[id] (header, education, experience, logistics),
// plus the tournament-specific membership info those don't cover
// (status, join method, roles). Meant to be dropped into any tournament
// page that lists members (roster, event rosters, etc.) behind an
// "expand" action.
export function MemberPanel({
  tournamentId, membershipId, allRoles, canTouchRole, canEditMember,
  collectIsOver18, collectIsOver21, onClose, onUpdated, onAssignmentsChanged, assignmentsVersion,
  isArchived, isSelf, onRemove, onSelfRemove,
  onPrev, onNext, hasPrev, hasNext,
}: MemberPanelProps) {
  const [full, setFull] = useState<MembershipFull | null>(null);
  // Sets the availability timeline's window — without it the bar can only
  // show gaps between the member's own shifts, never hours they declined.
  const [shifts, setShifts] = useState<TournamentShift[]>([]);
  // The assignments section draws one timeline per competition day, so it
  // needs the tracks themselves — a shift names its track by id only.
  const [tracks, setTracks] = useState<TournamentTrack[]>([]);
  // Which tracks this viewer turned off, read from the same surface config
  // the section list comes from.
  const [hiddenItems, setHiddenItems] = useState<string[]>([]);
  // Section order, per-section visibility, and the TD's custom sections.
  const [sectionConfig, setSectionConfig] = useState<DisplayConfigSection[] | null>(null);
  const [showSectionsModal, setShowSectionsModal] = useState(false);
  // Bumped when the display config is saved. Refetching the *membership* is
  // the point, not just the section list: hidden items are stripped
  // server-side (see apply_display_config), so a track turned back on in the
  // modal isn't in the payload this panel is already holding.
  const [reloadKey, setReloadKey] = useState(0);
  // Bumped after this panel's own assignment writes — re-reads only the member.
  const [memberVersion, setMemberVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // These usually resolve inside the ~220ms the panel spends sliding open,
  // and the commit they trigger swaps a spinner for the full section stack
  // (availability timeline, experience tables, logistics). As an urgent update
  // that render blocks the frame and visibly stutters the slide; marked as a
  // transition, React can slice it across frames and let the animation win.
  useEffect(() => {
    // Superseded responses are dropped: back-to-back writes each trigger a
    // re-read, and an older one landing last would show stale assignments.
    let current = true;
    membersApi.get(tournamentId, membershipId, MEMBERS_PANEL)
      .then((data) => { if (current) startTransition(() => setFull(data)); })
      .catch((e) => { if (current) setError(e instanceof ApiError ? e.message : "Failed to load member."); });
    return () => { current = false; };
  }, [tournamentId, membershipId, reloadKey, memberVersion, assignmentsVersion]);

  useEffect(() => {
    tournamentShiftsApi.list(tournamentId).then((data) => startTransition(() => setShifts(data))).catch(() => {});
    tournamentTracksApi.list(tournamentId).then((data) => startTransition(() => setTracks(data))).catch(() => {});
    displayConfigApi.get(tournamentId)
      .then((config) => startTransition(() => {
        setSectionConfig(config?.[MEMBERS_PANEL]?.sections ?? null);
        setHiddenItems(config?.[MEMBERS_PANEL]?.hidden ?? []);
      }))
      .catch(() => {});
  }, [tournamentId, membershipId, reloadKey]);

  // "track:3" is the panel surface's own vocabulary for a hidden track — the
  // same keys the config modal writes.
  const hiddenTrackIds = new Set(
    hiddenItems
      .filter((item) => item.startsWith("track:"))
      .map((item) => Number(item.slice("track:".length)))
      .filter((id) => Number.isInteger(id)),
  );

  function handleRolesUpdated(updated: MembershipFull) {
    setFull((f) => (f ? { ...f, roles: updated.roles } : f));
    onUpdated?.(updated);
  }

  return (
    <DockedPanel
      onClose={onClose}
      width={MEMBER_PANEL_WIDTH}
      onPrev={onPrev}
      onNext={onNext}
      prevDisabled={!hasPrev}
      nextDisabled={!hasNext}
      headerActions={
        <>
          {/* The table's Actions column collapses while this panel is open, so
              Remove lives here instead. Same gate the row used: archived hides
              it, outranked/owner disables it, and your own row redirects to the
              leave flow. Waits for `full` — the lock can't be judged without
              the member it applies to. */}
          {full && !isArchived && (onRemove || onSelfRemove) && (
            <Button
              type="button" variant="secondary" size="sm" iconOnly
              title={isSelf ? "Leave tournament" : !canEditMember(full) ? "You can't remove this member." : "Remove member"}
              disabled={!isSelf && !canEditMember(full)}
              onClick={() => (isSelf ? onSelfRemove?.(full) : onRemove?.(full))}
            >
              <IconTrash size={14} style={{ color: "var(--color-danger)" }} />
            </Button>
          )}
          {/* The panel is the configurable, skimmable view; the page is the
              whole record with nothing hidden. */}
          <Button
            type="button" variant="secondary" size="sm" iconOnly
            title="Open full page"
            onClick={() => window.open(
              `/dashboard/tournaments/${tournamentId}/members/${membershipId}`,
              "_blank", "noopener,noreferrer",
            )}
          >
            <IconExpand size={14} />
          </Button>
          <Button
            type="button" variant="secondary" size="sm" iconOnly
            title="Configure panel"
            onClick={() => setShowSectionsModal(true)}
          >
            <IconEye size={14} />
          </Button>
        </>
      }
    >
      <div style={{ padding: "20px 28px", display: "flex", flexDirection: "column", gap: "20px" }}>
        {error ? (
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)" }}>{error}</p>
        ) : !full ? (
          <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
            <Spinner size="lg" />
          </div>
        ) : (
          <>
            <ProfileHeader user={full.user} />

            <MemberSections
              tournamentId={tournamentId}
              membership={full}
              sectionConfig={sectionConfig}
              shifts={shifts}
              tracks={tracks}
              hiddenTrackIds={hiddenTrackIds}
              membershipId={membershipId}
              onAssignmentsChanged={() => {
                setMemberVersion((v) => v + 1);
                onAssignmentsChanged?.();
              }}
              allRoles={allRoles}
              canTouchRole={canTouchRole}
              rolesLocked={!canEditMember(full)}
              collectIsOver18={collectIsOver18}
              collectIsOver21={collectIsOver21}
              onRolesUpdated={handleRolesUpdated}
            />
          </>
        )}
      </div>
      {showSectionsModal && (
        <MemberPanelConfigModal
          tournamentId={tournamentId}
          onSaved={() => setReloadKey((key) => key + 1)}
          onClose={() => setShowSectionsModal(false)}
        />
      )}
    </DockedPanel>
  );
}
