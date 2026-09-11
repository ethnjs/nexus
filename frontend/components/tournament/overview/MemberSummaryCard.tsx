"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MemberSummary, MemberSummaryAvailabilityOption, MemberSummaryTrack, membersApi } from "@/lib/api";
import { useMemberRoleLock } from "@/lib/roles/useMemberRoleLock";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ProgressRing } from "@/components/ui/ProgressRing";
import { Tooltip } from "@/components/ui/Tooltip";

// Narrowest a track's column gets — what four status tiles need side by side.
const TRACK_MIN_WIDTH = 420;
const TRACK_GAP = 24;
const CARD_PADDING = 16;
// Past this many tracks the card grows down instead of across.
const MAX_TRACKS_ACROSS = 3;

// One green, two steps: committed reads darker than tentative. The lighter
// step is the success token; paler greens fail 2:1 contrast on the white card.
const CONFIRMED_COLOR = "#15803D";
const INTERESTED_COLOR = "var(--color-success)";

const STATUS_TILES = [
  { key: "confirmed", label: "Confirmed", color: CONFIRMED_COLOR },
  { key: "interested", label: "Interested", color: INTERESTED_COLOR },
  { key: "declined", label: "Declined", color: "var(--color-danger)" },
  { key: "pending", label: "Pending", color: "var(--color-border-strong)" },
] as const;

// Room kept past the longest bar for its "11 (8 + 3)" tip label.
const TIP_LABEL_WIDTH = 72;

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

  // Tells the overview's mosaic how many columns to span, so the card grows
  // across before it grows down.
  const across = Math.min(summary.tracks.length, MAX_TRACKS_ACROSS);
  const minWidth = across * TRACK_MIN_WIDTH + (across - 1) * TRACK_GAP + CARD_PADDING * 2;

  return (
    <Card
      radius="lg"
      data-min-width={across > 0 ? minWidth : undefined}
      style={{ padding: `${CARD_PADDING}px`, display: "flex", flexDirection: "column", gap: "20px" }}
    >
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "8px 20px" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
          <span style={{ fontFamily: "var(--font-sans)", fontSize: "14px", fontWeight: 600 }}>Members</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "13px", color: "var(--color-text-tertiary)" }}>
            {memberCount}
          </span>
        </div>
        {onboarding && (
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <ProgressRing
              completed={onboarding.completed} total={memberCount} size={20} strokeWidth={16}
              color={onboarding.completed >= memberCount ? "var(--color-success)" : "var(--color-accent)"}
            />
            <span style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)" }}>
              {onboarding.completed} of {memberCount} onboarded
              {onboarding.started > 0 && ` · ${onboarding.started} partway`}
            </span>
          </div>
        )}
        <div style={{ marginLeft: "auto" }}>
          <Button
            type="button" variant="ghost" size="sm"
            onClick={() => router.push(`/dashboard/tournaments/${tournamentId}/members`)}
          >
            View roster
          </Button>
        </div>
      </div>

      <div style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${TRACK_MIN_WIDTH}px), 1fr))`,
        gap: `20px ${TRACK_GAP}px`,
      }}>
        {summary.tracks.map((track) => <TrackColumn key={track.track_id} track={track} />)}
      </div>
    </Card>
  );
}

function TrackColumn({ track }: { track: MemberSummaryTrack }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px", minWidth: 0 }}>
      <span style={{ fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 600 }}>{track.name}</span>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px" }}>
        {STATUS_TILES.map((tile) => (
          <StatusTile key={tile.key} label={tile.label} value={track[tile.key]} color={tile.color} />
        ))}
      </div>
      {track.availability.length > 0 && <AvailabilityBars options={track.availability} />}
    </div>
  );
}

// The number stays in ink; the dot beside the label carries the status colour,
// so the count reads the same for anyone who can't tell the colours apart.
function StatusTile({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{
      minWidth: 0, padding: "10px", borderRadius: "var(--radius-md)",
      background: "var(--color-bg)", border: "1px solid var(--color-border)",
    }}>
      <div style={{ fontFamily: "var(--font-sans)", fontSize: "28px", fontWeight: 600, lineHeight: 1, color: "var(--color-text-primary)" }}>
        {value}
      </div>
      <div style={{
        display: "flex", alignItems: "center", gap: "6px", marginTop: "6px",
        fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-secondary)",
      }}>
        <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: color, flexShrink: 0 }} />
        {label}
      </div>
    </div>
  );
}

function AvailabilityBars({ options }: { options: MemberSummaryAvailabilityOption[] }) {
  // Scaled to the track's biggest option, so the largest pool reads as full width.
  const max = Math.max(1, ...options.map((option) => option.confirmed + option.interested));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <span style={{
          fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 600, textTransform: "uppercase",
          letterSpacing: "0.06em", color: "var(--color-text-tertiary)",
        }}>
          Availability
        </span>
        <div style={{ display: "flex", gap: "12px", marginLeft: "auto" }}>
          <LegendKey color={CONFIRMED_COLOR} label="Confirmed" />
          <LegendKey color={INTERESTED_COLOR} label="Interested" />
        </div>
      </div>
      {options.map((option) => (
        <AvailabilityBar key={option.option_id} option={option} max={max} />
      ))}
    </div>
  );
}

function AvailabilityBar({ option, max }: { option: MemberSummaryAvailabilityOption; max: number }) {
  const total = option.confirmed + option.interested;
  // Zero-width segments are skipped, so the 2px gap only ever sits between two real ones.
  const segments = [
    { key: "confirmed", value: option.confirmed, color: CONFIRMED_COLOR },
    { key: "interested", value: option.interested, color: INTERESTED_COLOR },
  ].filter((segment) => segment.value > 0);

  return (
    // The whole row is the hover target — a 12px bar is too thin to aim at.
    <Tooltip
      variant="info" showIcon={false} style={{ width: "100%" }}
      message={`${option.confirmed} confirmed · ${option.interested} interested`}
    >
      <div style={{ width: "100%", display: "grid", gridTemplateColumns: "110px 1fr", alignItems: "center", gap: "12px", padding: "3px 0" }}>
        <span
          title={option.label}
          style={{
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)",
          }}
        >
          {option.label}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
          {total > 0 && (
            <div style={{ display: "flex", gap: "2px", flex: `0 0 calc((100% - ${TIP_LABEL_WIDTH}px) * ${total / max})` }}>
              {segments.map((segment, i) => (
                <div
                  key={segment.key}
                  style={{
                    flex: `${segment.value} 0 0`, height: "12px", background: segment.color,
                    // Rounded at the data end only; square where the bar starts.
                    borderRadius: i === segments.length - 1 ? "0 4px 4px 0" : 0,
                  }}
                />
              ))}
            </div>
          )}
          <span style={{ whiteSpace: "nowrap", fontFamily: "var(--font-sans)", fontSize: "13px" }}>
            <span style={{ fontWeight: 600, color: "var(--color-text-primary)" }}>{total}</span>
            {total > 0 && (
              <span style={{ color: "var(--color-text-tertiary)" }}> ({option.confirmed} + {option.interested})</span>
            )}
          </span>
        </div>
      </div>
    </Tooltip>
  );
}

function LegendKey({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: "6px", fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-secondary)" }}>
      <span style={{ width: "8px", height: "8px", borderRadius: "2px", background: color }} />
      {label}
    </span>
  );
}
