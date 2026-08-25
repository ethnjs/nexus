'use client'

import { CSSProperties } from "react";
import { PersonRef, personUser, personName, personRoles } from "@/lib/personDisplay";
import { AvatarCircle } from "@/components/ui/AvatarCircle";
import { HoverCard } from "@/components/ui/HoverCard";
import { Badge } from "@/components/ui/Badge";

interface CreatorHoverCardProps {
  creator: PersonRef;
  /** What to show when personRoles() is null — the bare-UserSlim fallback,
   * no membership at all. Wording differs by container (tournament/chapter). */
  noMembershipLabel?: string;
  /** Merged onto the HoverCard's trigger wrapper — e.g. to center/stretch
   * within a grid cell. */
  style?: CSSProperties;
}

// Shared "who did this" cell — avatar + name, hover for email + roles.
// Used anywhere a row surfaces a PersonRef (Invite.creator, FormListItem.creator, ...).
export function CreatorHoverCard({ creator, noMembershipLabel = "No membership", style }: CreatorHoverCardProps) {
  return (
    <HoverCard
      style={style}
      content={
        <>
          <p style={{
            fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 600, color: "var(--color-text-primary)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {personName(creator)}
          </p>
          <p style={{
            fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--color-text-secondary)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: "2px",
          }}>
            {personUser(creator).email}
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "8px" }}>
            {(() => {
              const roles = personRoles(creator);
              if (roles === null) {
                return (
                  <span style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)" }}>
                    {noMembershipLabel}
                  </span>
                );
              }
              if (roles.length === 0) {
                return (
                  <span style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)" }}>
                    No roles
                  </span>
                );
              }
              return roles.map((role) => <Badge key={role.id} variant="default">{role.label}</Badge>);
            })()}
          </div>
        </>
      }
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", minWidth: 0, cursor: "default" }}>
        <AvatarCircle user={personUser(creator)} size="xs" />
        <span style={{
          fontFamily: "var(--font-sans)", fontSize: "13px",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {personName(creator)}
        </span>
      </div>
    </HoverCard>
  );
}
