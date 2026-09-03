'use client'

import { CSSProperties } from "react";
import { PersonRef } from "@/lib/api";
import { personName, personRoles } from "@/lib/personDisplay";
import { AvatarCircle } from "@/components/ui/AvatarCircle";
import { HoverCard } from "@/components/ui/HoverCard";
import { Badge } from "@/components/ui/Badge";

interface CreatorHoverCardProps {
  creator: PersonRef;
  /** What to show when the reference holds no membership here (roles null).
   * Wording differs by container (tournament/chapter). */
  noMembershipLabel?: string;
  /** Merged onto the HoverCard's trigger wrapper — e.g. to center/stretch
   * within a grid cell. */
  style?: CSSProperties;
}

// Shared "who did this" cell — avatar + name, hover for roles. No contact
// details: a reference carries a name and roles and nothing else.
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
        <AvatarCircle user={creator} size="xs" />
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
