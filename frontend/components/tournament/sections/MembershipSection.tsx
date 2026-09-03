"use client";

import { MembershipFull, MembershipSlim, Role } from "@/lib/api";
import { formatDate } from "@/lib/timeFormat";
import { Badge } from "@/components/ui/Badge";
import { ProfileCard } from "@/components/profile/ProfileCard";
import { SectionHeading } from "@/components/profile/SectionHeading";
import { PanelField, FieldValue, FieldList, FieldGrid } from "@/components/profile/PanelField";
import { RolesCell } from "@/components/tournament/RolesCell";
import { JoinMethodCell } from "@/components/tournament/JoinMethodCell";
import { AgeFlagsBadges } from "@/components/tournament/sections/AgeFlagsBadges";

interface MembershipSectionProps {
  tournamentId: number;
  membership: MembershipFull;
  allRoles: Role[];
  canTouchRole: (role: Role) => boolean;
  locked: boolean;
  collectIsOver18: boolean;
  collectIsOver21: boolean;
  onRolesUpdated: (updated: MembershipSlim) => void;
  /**
   * Field ids the TD turned off for this section — "joined", "join_method",
   * "roles", "age". Individual tracks aren't here: they're entities filtered
   * server-side by the surface's hidden list.
   */
  hiddenFields: Set<string>;
}

// The tournament-specific half of the panel: how they joined, what they're
// signed up for, and what they can do. Split out of MemberPanel so the panel
// can order it against the other sections and hide its fields individually.
export function MembershipSection({
  tournamentId, membership, allRoles, canTouchRole, locked,
  collectIsOver18, collectIsOver21, onRolesUpdated, hiddenFields,
}: MembershipSectionProps) {
  const shows = (field: string) => !hiddenFields.has(field);

  const showJoined = shows("joined");
  const showMethod = shows("join_method");
  // Tracks are hidden individually via the surface's hidden list, which the
  // server already applies — so an empty list here means every track was
  // turned off (or none exist), and the field has nothing to show either way.
  const showTracks = membership.track_statuses.length > 0;
  const showRoles = shows("roles");
  const showAge = shows("age") && (collectIsOver18 || collectIsOver21);

  // Every field off leaves an empty card, which reads as a rendering fault
  // rather than a deliberate choice — hide the section instead.
  if (!showJoined && !showMethod && !showTracks && !showRoles && !showAge) return null;

  return (
    <ProfileCard>
      <SectionHeading title="Membership">
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {(showJoined || showMethod) && (
            <FieldGrid>
              {showJoined && (
                <PanelField label="Joined">
                  <FieldValue>{formatDate(membership.created_at)}</FieldValue>
                </PanelField>
              )}
              {showMethod && (
                <PanelField label="Join Method">
                  <JoinMethodCell membership={membership} />
                </PanelField>
              )}
            </FieldGrid>
          )}

          {(showTracks || showRoles) && (
            <FieldGrid>
              {showTracks && (
                <PanelField label="Tracks">
                  <FieldList>
                    {membership.track_statuses.map((ts) => (
                      // Every live track appears, answered or not — a
                      // "pending" one is a member who still owes an answer,
                      // which absence alone wouldn't show. An archived
                      // track's statuses stay readable — the catalog entry is
                      // retired, the commitment still happened — so it's
                      // dimmed rather than hidden.
                      <div
                        key={ts.track_id}
                        style={{
                          display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px",
                          opacity: ts.is_archived ? 0.55 : undefined,
                        }}
                        title={ts.is_archived ? "Archived track" : undefined}
                      >
                        <FieldValue>{ts.name}</FieldValue>
                        <Badge variant={ts.status === "pending" ? "pending" : ts.status}>{ts.status}</Badge>
                      </div>
                    ))}
                  </FieldList>
                </PanelField>
              )}

              {showRoles && (
                <PanelField label="Roles">
                  <RolesCell
                    tournamentId={tournamentId}
                    membership={membership}
                    allRoles={allRoles}
                    canTouchRole={canTouchRole}
                    locked={locked}
                    emptyLabel="None"
                    onUpdated={onRolesUpdated}
                  />
                </PanelField>
              )}
            </FieldGrid>
          )}

          {showAge && (
            <FieldGrid>
              <PanelField label="Age">
                <AgeFlagsBadges
                  isOver18={membership.is_over_18}
                  isOver21={membership.is_over_21}
                  collectIsOver18={collectIsOver18}
                  collectIsOver21={collectIsOver21}
                />
              </PanelField>
            </FieldGrid>
          )}
        </div>
      </SectionHeading>
    </ProfileCard>
  );
}
