"use client";

import { type ReactNode, useState } from "react";
import { AssignToModal } from "@/components/tournament/assignments/AssignToModal";
import { MemberCardBody } from "@/components/tournament/assignments/MemberCard";
import type { MemberDisplayState } from "@/components/tournament/assignments/MemberDisplayModal";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import type { MembershipFull, TournamentEvent, TournamentShift, TournamentTrack } from "@/lib/api";
import { fullName } from "@/lib/assignments/board";

/** Up to four members' belt cards side by side, shown with the belt's own card
 *  settings, each assignable on its own. */
export function CompareMembersModal({
  members,
  display,
  displayButton,
  allShifts,
  tracks,
  initialTrackId,
  events,
  onAssign,
  onClose,
}: {
  members: MembershipFull[];
  /** The member belt's card settings, and its button for changing them. */
  display: MemberDisplayState;
  displayButton: ReactNode;
  allShifts: TournamentShift[];
  tracks: TournamentTrack[];
  /** The track the assign picker opens on — the board tab's, when it is one. */
  initialTrackId: number | null;
  events: TournamentEvent[];
  onAssign: (membershipId: number, eventId: number, trackId: number) => void;
  onClose: () => void;
}) {
  const [assigning, setAssigning] = useState<MembershipFull | null>(null);

  return (
    <>
      <Modal
        title={`Compare ${members.length} members`}
        onClose={onClose}
        showClose
        headerActions={displayButton}
        contentStyle={{ width: "100%", minHeight: "100%", boxSizing: "border-box" }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${members.length}, minmax(240px, 1fr))`,
            gap: "16px",
            alignItems: "start",
            overflowX: "auto",
          }}
        >
          {members.map((member) => (
            <div
              key={member.id}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "6px",
                padding: "12px",
                minWidth: 0,
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius-md)",
              }}
            >
              <MemberCardBody member={member} display={display} allShifts={allShifts} />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                fullWidth
                style={{ marginTop: "6px" }}
                onClick={() => setAssigning(member)}
              >
                Assign to…
              </Button>
            </div>
          ))}
        </div>
      </Modal>
      {assigning && (
        <AssignToModal
          count={1}
          title={`Assign ${fullName(assigning.user ?? { first_name: null, last_name: null })}`}
          tracks={tracks}
          initialTrackId={initialTrackId}
          events={events}
          onAssign={(eventId, trackId) => onAssign(assigning.id, eventId, trackId)}
          onClose={() => setAssigning(null)}
        />
      )}
    </>
  );
}
