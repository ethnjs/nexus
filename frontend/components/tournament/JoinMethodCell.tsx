"use client";

import { MembershipSlim } from "@/lib/api";
import { personName } from "@/lib/personDisplay";
import { SOURCE_LABELS } from "@/lib/membershipDisplay";
import { Badge } from "@/components/ui/Badge";
import { HoverCard } from "@/components/ui/HoverCard";

// How a member joined — a plain badge for public/manual, or the join code
// itself with a hover card (label, inviter) for join-code sourced members.
// The code is on the badge rather than behind the hover so two members'
// invites can be told apart at a glance down the roster column.
// Shared between the roster table and the member detail panel.
export function JoinMethodCell({ membership, style }: { membership: MembershipSlim; style?: React.CSSProperties }) {
  if (membership.source !== "join_code" || !membership.join_code) {
    return (
      <Badge variant="default" style={style}>
        {SOURCE_LABELS[membership.source] ?? membership.source}
      </Badge>
    );
  }

  const jc = membership.join_code;
  return (
    <HoverCard
      style={style}
      content={
        <>
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 600, color: "var(--color-text-primary)" }}>
            {jc.label ?? "Invite"}
          </p>
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)", marginTop: "8px" }}>
            Invited by {personName(jc.creator)}
          </p>
        </>
      }
    >
      <Badge variant="default" copyValue={jc.code}>{jc.code}</Badge>
    </HoverCard>
  );
}
