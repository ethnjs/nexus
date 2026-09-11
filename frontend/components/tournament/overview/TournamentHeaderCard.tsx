"use client";

import { ReactNode } from "react";
import type { TournamentTrack } from "@/lib/api";
import { useTournament } from "@/lib/useTournament";
import { formatTrackDates, placeOf, primaryTracks, tournamentYear } from "@/lib/tournamentDisplay";
import { Badge } from "@/components/ui/Badge";
import { IconCalendar, IconLocation } from "@/components/ui/Icons";
import { OverviewCard, OVERVIEW_CARD_PADDING } from "./OverviewCard";

const TILE_MIN_WIDTH = 220;
const TILE_GAP = 8;
// Past this many primary tracks the tiles wrap instead of widening the card.
const MAX_TILES_ACROSS = 3;

/**
 * The overview's title card: the tournament's name and tags, then a tile per
 * primary track. Tiles because a multi-site tournament has no single
 * where/when, and one line per track ran them together.
 */
export function TournamentHeaderCard() {
  const { selectedTournament: tournament } = useTournament();
  if (!tournament) return null;

  const year = tournamentYear(tournament);
  const tracks = primaryTracks(tournament);
  // Divisions live on each track's tile; only a tournament with no tiles
  // shows them up here, so they never appear twice.
  const tags = [
    tournament.state,
    tournament.level && tournament.level[0].toUpperCase() + tournament.level.slice(1),
    ...(tracks.length === 0 ? tournament.division ?? [] : []),
  ].filter(Boolean) as string[];

  // Tells the mosaic how many columns to span — one tile needs no more than one.
  const across = Math.min(tracks.length, MAX_TILES_ACROSS);
  const minWidth = across * TILE_MIN_WIDTH + (across - 1) * TILE_GAP + OVERVIEW_CARD_PADDING * 2;

  return (
    <OverviewCard
      title={[year, tournament.name].filter(Boolean).join(" ")}
      // The page's title, so it reads as one: larger, serif, and wrapping
      // rather than truncating a long name.
      titleStyle={{ fontFamily: "Georgia, serif", fontSize: "28px", fontWeight: 400, lineHeight: 1.2, whiteSpace: "normal" }}
      data-min-width={across > 1 ? minWidth : undefined}    >
      {tags.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
          {tags.map((tag) => <Badge key={tag}>{tag}</Badge>)}
        </div>
      )}

      {tracks.length > 0 && (
        <div style={{
          display: "grid",
          gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${TILE_MIN_WIDTH}px), 1fr))`,
          gap: `${TILE_GAP}px`,
        }}>
          {tracks.map((track) => <TrackTile key={track.id} track={track} />)}
        </div>
      )}
    </OverviewCard>
  );
}

function TrackTile({ track }: { track: TournamentTrack }) {
  const place = placeOf(track);
  const dates = formatTrackDates(track, "weekday");

  return (
    <div style={{
      minWidth: 0, padding: "12px", display: "flex", flexDirection: "column", gap: "6px",
      borderRadius: "var(--radius-md)", border: "1px solid var(--color-border)",
    }}>
      <span style={{ fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 600, color: "var(--color-text-primary)" }}>
        {track.name}
      </span>
      {place && <Fact icon={<IconLocation />}>{place}</Fact>}
      {dates && <Fact icon={<IconCalendar />}>{dates}</Fact>}
      {!!track.division?.length && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "2px" }}>
          {track.division.map((division) => <Badge key={division}>{division}</Badge>)}
        </div>
      )}
    </div>
  );
}

function Fact({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span style={{
      display: "flex", alignItems: "center", gap: "6px",
      fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)",
    }}>
      {icon}
      {children}
    </span>
  );
}
