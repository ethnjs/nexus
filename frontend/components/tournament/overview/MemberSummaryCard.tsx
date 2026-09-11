"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MemberSummary, MemberSummaryAvailabilityOption, MemberSummaryTrack, membersApi } from "@/lib/api";
import { useMemberRoleLock } from "@/lib/roles/useMemberRoleLock";
import { Button } from "@/components/ui/Button";
import { OverviewCard, OVERVIEW_CARD_PADDING } from "@/components/tournament/overview/OverviewCard";
import { ProgressRing } from "@/components/ui/ProgressRing";
import { Tooltip } from "@/components/ui/Tooltip";

// Narrowest a track's column gets — what four status tiles need side by side.
const TRACK_MIN_WIDTH = 420;
const TRACK_GAP = 24;
// Past this many tracks the card grows down instead of across.
const MAX_TRACKS_ACROSS = 3;

const STATUS_TILES = [
  { key: "confirmed", label: "Confirmed", background: "var(--color-success-subtle)" },
  { key: "interested", label: "Interested", background: "var(--color-accent-subtle)" },
  { key: "declined", label: "Declined", background: "var(--color-danger-subtle)" },
  // White rather than a grey: accent-subtle is already interested's.
  { key: "pending", label: "Pending", background: "var(--color-surface)" },
] as const;

// Room kept past the longest bar for its total.
const TIP_LABEL_WIDTH = 32;

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
  const minWidth = across * TRACK_MIN_WIDTH + (across - 1) * TRACK_GAP + OVERVIEW_CARD_PADDING * 2;

  return (
    <OverviewCard
      title="Members"
      meta={memberCount}
      action={
        <Button
          type="button" variant="ghost" size="sm"
          onClick={() => router.push(`/dashboard/tournaments/${tournamentId}/members`)}
        >
          View roster
        </Button>
      }
      data-min-width={across > 0 ? minWidth : undefined}
    >

      {onboarding && (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <SectionLabel>Onboarding</SectionLabel>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <ProgressRing
              completed={onboarding.completed} total={memberCount} size={28} strokeWidth={14}
              color={onboarding.completed >= memberCount ? "var(--color-success)" : "var(--color-accent)"}
            />
            <span style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)" }}>
              <span style={{ fontWeight: 600, color: "var(--color-text-primary)" }}>{onboarding.completed}</span>
              {` of ${memberCount} onboarded`}
              {onboarding.started > 0 && ` · ${onboarding.started} partway through`}
            </span>
          </div>
        </div>
      )}

      <div style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${TRACK_MIN_WIDTH}px), 1fr))`,
        gap: `20px ${TRACK_GAP}px`,
      }}>
        {summary.tracks.map((track) => <TrackColumn key={track.track_id} track={track} />)}
      </div>
    </OverviewCard>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <span style={{
      fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 600, textTransform: "uppercase",
      letterSpacing: "0.06em", color: "var(--color-text-tertiary)",
    }}>
      {children}
    </span>
  );
}

function TrackColumn({ track }: { track: MemberSummaryTrack }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px", minWidth: 0 }}>
      <span style={{ fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 600 }}>{track.name}</span>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px" }}>
        {STATUS_TILES.map((tile) => (
          <StatusTile key={tile.key} label={tile.label} value={track[tile.key]} background={tile.background} />
        ))}
      </div>
      {track.availability.length > 0 && <AvailabilityBars options={track.availability} />}
    </div>
  );
}

// The tint is a hint, not the message: the label names the status, and the
// number stays in ink so it reads the same without colour.
function StatusTile({ label, value, background }: { label: string; value: number; background: string }) {
  return (
    <div style={{ minWidth: 0, padding: "10px", borderRadius: "var(--radius-md)", background, border: "1px solid var(--color-border)" }}>
      <div style={{ fontFamily: "var(--font-sans)", fontSize: "28px", fontWeight: 600, lineHeight: 1, color: "var(--color-text-primary)" }}>
        {value}
      </div>
      <div style={{ marginTop: "6px", fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-secondary)" }}>
        {label}
      </div>
    </div>
  );
}

const SEGMENTS = [
  { key: "confirmed", label: "confirmed", color: "var(--color-status-confirmed)" },
  { key: "interested", label: "interested", color: "var(--color-status-interested)" },
] as const;

function AvailabilityBars({ options }: { options: MemberSummaryAvailabilityOption[] }) {
  // Scaled to the track's biggest option, so the largest pool reads as full width.
  const max = Math.max(1, ...options.map((option) => option.confirmed + option.interested));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "4px" }}>
        <SectionLabel>Availability</SectionLabel>
        <div style={{ display: "flex", gap: "12px", marginLeft: "auto" }}>
          {SEGMENTS.map((segment) => (
            <LegendKey key={segment.key} color={segment.color} label={segment.label} />
          ))}
        </div>
      </div>
      {options.map((option) => (
        <AvailabilityBar key={option.option_id} option={option} max={max} />
      ))}
    </div>
  );
}

function AvailabilityBar({ option, max }: { option: MemberSummaryAvailabilityOption; max: number }) {
  const [hovered, setHovered] = useState<string | null>(null);
  const total = option.confirmed + option.interested;
  // Zero-width segments are skipped, so the 2px gap only ever sits between two real ones.
  const segments = SEGMENTS.filter((segment) => option[segment.key] > 0);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "110px 1fr", alignItems: "center", gap: "12px" }}>
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
              // Each segment is its own hover target; the wrapper's padding
              // makes it 24px tall around a 12px bar.
              <Tooltip
                key={segment.key}
                variant="info" showIcon={false}
                message={`${option[segment.key]} ${segment.label}`}
                style={{ flex: `${option[segment.key]} 0 0`, minWidth: 0, padding: "6px 0" }}
              >
                <div
                  onMouseEnter={() => setHovered(segment.key)}
                  onMouseLeave={() => setHovered(null)}
                  style={{
                    width: "100%", height: "12px", background: segment.color,
                    // Rounded at the data end only; square where the bar starts.
                    borderRadius: i === segments.length - 1 ? "0 4px 4px 0" : 0,
                    filter: hovered === segment.key ? "brightness(0.8)" : undefined,
                    transition: "filter 100ms ease",
                  }}
                />
              </Tooltip>
            ))}
          </div>
        )}
        <span style={{ fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 600, color: "var(--color-text-primary)" }}>
          {total}
        </span>
      </div>
    </div>
  );
}

function LegendKey({ color, label }: { color: string; label: string }) {
  return (
    <span style={{
      display: "flex", alignItems: "center", gap: "6px", textTransform: "capitalize",
      fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-secondary)",
    }}>
      <span style={{ width: "8px", height: "8px", borderRadius: "2px", background: color }} />
      {label}
    </span>
  );
}
