"use client";

import { Fragment, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MemberSummary, MemberSummaryTrack, membersApi } from "@/lib/api";
import { useMemberRoleLock } from "@/lib/roles/useMemberRoleLock";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ProgressRing } from "@/components/ui/ProgressRing";
import { PanelField, FieldValue } from "@/components/profile/PanelField";

const numberStyle = {
  fontFamily: "var(--font-mono)", fontSize: "13px", textAlign: "right", color: "var(--color-text-primary)",
} as const;

const columnHeadStyle = {
  fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 600, textAlign: "right",
  textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-text-tertiary)",
} as const;

/** Staff view of the roster in numbers: onboarding, then each track's statuses and availability. */
export function MemberSummaryCard({ tournamentId }: { tournamentId: number }) {
  const router = useRouter();
  // Same gate as the members page itself, so the widget and its "View roster" agree.
  const { canManageMembers } = useMemberRoleLock();
  const [summary, setSummary] = useState<MemberSummary | null>(null);

  useEffect(() => {
    if (!canManageMembers) return;
    membersApi.summary(tournamentId).then(setSummary).catch(() => setSummary(null));
  }, [tournamentId, canManageMembers]);

  if (!canManageMembers || !summary) return null;
  const { onboarding, member_count: memberCount } = summary;

  return (
    <Card radius="lg" style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <span style={{ fontFamily: "var(--font-sans)", fontSize: "14px", fontWeight: 600 }}>Members</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "13px", color: "var(--color-text-tertiary)" }}>
          {memberCount}
        </span>
        <div style={{ marginLeft: "auto" }}>
          <Button
            type="button" variant="ghost" size="sm"
            onClick={() => router.push(`/dashboard/tournaments/${tournamentId}/members`)}
          >
            View roster
          </Button>
        </div>
      </div>

      {onboarding && (
        <PanelField label="Onboarding">
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <ProgressRing
              completed={onboarding.completed} total={memberCount} size={36} strokeWidth={14}
              color={onboarding.completed >= memberCount ? "var(--color-success)" : "var(--color-accent)"}
            />
            <div>
              <FieldValue>{onboarding.completed} of {memberCount} finished</FieldValue>
              {onboarding.started > 0 && <FieldValue muted>{onboarding.started} partway through</FieldValue>}
            </div>
          </div>
        </PanelField>
      )}

      {summary.tracks.map((track) => <TrackRow key={track.track_id} track={track} />)}
    </Card>
  );
}

function TrackRow({ track }: { track: MemberSummaryTrack }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px", paddingTop: "14px", borderTop: "1px solid var(--color-border)" }}>
      <span style={{ fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 600 }}>{track.name}</span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
        <Badge variant="confirmed">{track.confirmed} confirmed</Badge>
        <Badge variant="interested">{track.interested} interested</Badge>
        <Badge variant="declined">{track.declined} declined</Badge>
        <Badge variant="pending">{track.pending} pending</Badge>
      </div>

      {track.availability.length > 0 && (
        // One grid for header and rows so the number columns line up.
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", columnGap: "16px", rowGap: "4px", alignItems: "center" }}>
          <span />
          <span style={columnHeadStyle}>Confirmed</span>
          <span style={columnHeadStyle}>Interested</span>
          {track.availability.map((option) => (
            <Fragment key={option.option_id}>
              <span style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)" }}>
                {option.label}
              </span>
              <span style={numberStyle}>{option.confirmed}</span>
              <span style={numberStyle}>{option.interested}</span>
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
