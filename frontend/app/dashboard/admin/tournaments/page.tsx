"use client";

import { useEffect, useMemo, useState } from "react";
import { adminTournamentsApi, tournamentsApi, AdminTournament, ApiError } from "@/lib/api";
import {
  formatDates, formatTrackDates, placeOf, primaryTracks, tournamentDisplayName,
} from "@/lib/tournamentDisplay";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ButtonGroup } from "@/components/ui/ButtonGroup";
import { Input } from "@/components/ui/Input";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Spinner } from "@/components/ui/Spinner";
import { HoverCard } from "@/components/ui/HoverCard";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { BulkDeleteModal } from "@/components/ui/BulkDeleteModal";
import { IconArchive, IconRestore, IconTrash, IconSearch, IconTrophy } from "@/components/ui/Icons";
import table from "@/components/ui/Table.module.css";

// Fixed px wherever the content has a known maximum — a formatted date range,
// a count, a badge — and minmax() only where it is open-ended. The min half
// of each minmax is what stops a narrow window from squeezing a cell until it
// wraps; an `fr` track alone shrinks to nothing.
const COLUMNS = [
  "minmax(180px, 1.3fr)", // name
  "minmax(150px, 0.9fr)", // owner
  "minmax(130px, 0.9fr)", // venue
  "160px",                // dates
  "64px",                 // tracks
  "104px",                // level
  "56px",                 // state
  "88px",                 // division
  "76px",                 // members
  "68px",                 // events
  "116px",                // status
  "84px",                 // created
  "76px",                 // actions
].join(" ");

// Sum of the track floors. The card scrolls horizontally rather than letting
// thirteen columns crush each other — every cell here has a legible minimum
// and none of them truncate usefully.
const MIN_TABLE_WIDTH = 1330;

type StatusFilter = "all" | "active" | "archived";

const STATUS_OPTIONS = [
  { value: "active",   label: "Active" },
  { value: "archived", label: "Archived" },
  { value: "all",      label: "All" },
];

const NUM_CELL: React.CSSProperties = {
  fontFamily: "var(--font-mono)", fontSize: "12px",
  color: "var(--color-text-secondary)", textAlign: "center",
};

const TEXT_CELL: React.CSSProperties = {
  fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--color-text-secondary)",
  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0,
};

function ownerName(owner: AdminTournament["owner"]): string {
  if (!owner) return "—";
  const name = [owner.first_name, owner.last_name].filter(Boolean).join(" ");
  return name || owner.email;
}

/**
 * Where the tournament happens.
 *
 * A tournament's own `location`/`university` resolve only when it has exactly
 * one primary track — with two venues there is no single answer and the
 * backend leaves both null. So those rows say how many sites there are and
 * put the per-track detail behind a hover, rather than showing a blank cell.
 */
function VenueCell({ tournament }: { tournament: AdminTournament }) {
  const primary = primaryTracks(tournament);

  if (primary.length <= 1) {
    return <span style={TEXT_CELL}>{placeOf(tournament) ?? "—"}</span>;
  }

  return (
    <HoverCard
      width={260}
      content={
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {primary.map((track) => (
            <div key={track.id} style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
              <span style={{ fontFamily: "var(--font-sans)", fontSize: "12px", fontWeight: 600 }}>
                {track.name}
              </span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--color-text-secondary)" }}>
                {placeOf(track) ?? "No venue"}
              </span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--color-text-tertiary)" }}>
                {formatTrackDates(track) ?? "No dates"}
              </span>
            </div>
          ))}
        </div>
      }
    >
      <span style={{ ...TEXT_CELL, borderBottom: "1px dotted var(--color-border-strong)", cursor: "help" }}>
        {primary.length} sites
      </span>
    </HoverCard>
  );
}

function divisionVariant(division: string) {
  if (division === "A") return "divisionA" as const;
  if (division === "B") return "divisionB" as const;
  return "divisionC" as const;
}

function TournamentRow({ tournament, onArchive, onUnarchive, onDelete }: {
  tournament: AdminTournament;
  onArchive: () => void;
  onUnarchive: () => void;
  onDelete: () => void;
}) {
  const primary = primaryTracks(tournament);

  return (
    <div className={table.row} data-dimmed={tournament.is_archived ? "true" : undefined}>
      <span style={{
        fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 500,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0,
      }} title={tournament.name}>
        {tournamentDisplayName(tournament)}
      </span>

      {tournament.owner ? (
        <HoverCard
          width={220}
          content={
            <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
              <span style={{ fontFamily: "var(--font-sans)", fontSize: "12px", fontWeight: 600 }}>
                {ownerName(tournament.owner)}
              </span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--color-text-secondary)" }}>
                {tournament.owner.email}
              </span>
            </div>
          }
          style={{ width: "100%" }}
        >
          <span style={TEXT_CELL}>{ownerName(tournament.owner)}</span>
        </HoverCard>
      ) : (
        <span style={TEXT_CELL}>—</span>
      )}

      <VenueCell tournament={tournament} />

      <span style={TEXT_CELL}>{formatDates(tournament.dates) ?? "—"}</span>

      {/* Primary over total: a cosmetic track carries no dates or venue, so
          the two numbers explain an empty Venue or Dates cell. */}
      <span style={NUM_CELL} title={`${primary.length} primary of ${tournament.tracks.length} tracks`}>
        {primary.length}/{tournament.tracks.length}
      </span>

      <span style={{ ...TEXT_CELL, textAlign: "center" }}>{tournament.level}</span>
      <span style={{ ...TEXT_CELL, textAlign: "center" }}>{tournament.state}</span>

      <span style={{ display: "flex", gap: "3px", justifyContent: "center", flexWrap: "wrap" }}>
        {tournament.division.length === 0
          ? <span style={NUM_CELL}>—</span>
          : tournament.division.map((d) => (
              <Badge key={d} variant={divisionVariant(d)}>{d}</Badge>
            ))}
      </span>

      <span style={NUM_CELL}>{tournament.volunteer_count}</span>
      <span style={NUM_CELL}>{tournament.event_count}</span>

      <span style={{ display: "flex", gap: "3px", justifyContent: "center", flexWrap: "wrap" }}>
        {tournament.is_archived && <Badge variant="removed">Archived</Badge>}
        {tournament.is_verified && <Badge variant="confirmed">Verified</Badge>}
        {tournament.is_public && <Badge variant="default">Public</Badge>}
      </span>

      <span style={{ ...TEXT_CELL, fontSize: "11px", textAlign: "center" }}>
        {new Date(tournament.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" })}
      </span>

      <div style={{ display: "flex", justifyContent: "center", gap: "4px" }}>
        {tournament.is_archived ? (
          <Button type="button" variant="secondary" size="sm" iconOnly title="Unarchive" onClick={onUnarchive}>
            <IconRestore size={13} />
          </Button>
        ) : (
          <Button type="button" variant="secondary" size="sm" iconOnly title="Archive" onClick={onArchive}>
            <IconArchive size={13} />
          </Button>
        )}
        <Button type="button" variant="secondary" size="sm" iconOnly title="Delete tournament" onClick={onDelete}>
          <IconTrash size={13} style={{ color: "var(--color-danger)" }} />
        </Button>
      </div>
    </div>
  );
}

export default function AdminTournamentsPage() {
  const [tournaments, setTournaments] = useState<AdminTournament[] | null>(null);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");

  const [archiveTarget, setArchiveTarget] = useState<AdminTournament | null>(null);
  const [unarchiveTarget, setUnarchiveTarget] = useState<AdminTournament | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminTournament | null>(null);

  useEffect(() => {
    adminTournamentsApi.list()
      .then(setTournaments)
      .catch((err: unknown) => {
        setTournaments([]);
        setLoadError(err instanceof ApiError ? err.message : "Couldn't load tournaments.");
      });
  }, []);

  const visible = useMemo(() => {
    const rows = tournaments ?? [];
    const query = search.trim().toLowerCase();
    return rows.filter((t) => {
      if (status === "active" && t.is_archived) return false;
      if (status === "archived" && !t.is_archived) return false;
      if (!query) return true;
      return (
        t.name.toLowerCase().includes(query) ||
        (t.short_name?.toLowerCase().includes(query) ?? false) ||
        ownerName(t.owner).toLowerCase().includes(query) ||
        (t.owner?.email.toLowerCase().includes(query) ?? false)
      );
    });
  }, [tournaments, search, status]);

  /** Replaces one row in place — archive and unarchive both return the row. */
  function replaceRow(updated: { id: number }) {
    setTournaments((prev) =>
      (prev ?? []).map((t) => (t.id === updated.id ? { ...t, ...updated } : t))
    );
  }

  function removeRows(ids: (number | string)[]) {
    setTournaments((prev) => (prev ?? []).filter((t) => !ids.includes(t.id)));
  }

  const isFiltered = search.trim() !== "" || status !== "all";

  return (
    <>
      <PageHeader
          heading="Tournaments"
          subheading={
            tournaments === null
              ? ""
              : `${visible.length}${isFiltered ? ` of ${tournaments.length}` : ""} tournament${tournaments.length === 1 ? "" : "s"} platform-wide`
          }
        />

        {loadError && (
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)", marginBottom: "10px" }}>
            {loadError}
          </p>
        )}

        <div style={{ display: "flex", gap: "10px", alignItems: "center", marginBottom: "16px", flexWrap: "wrap" }}>
          <Input
            placeholder="Search name or owner"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onClear={() => setSearch("")}
            icon={<IconSearch size={16} />}
            size="md"
            variant="secondary"
            style={{ width: "420px" }}
          />
          <ButtonGroup
            options={STATUS_OPTIONS}
            value={status}
            onChange={(v) => setStatus(v as StatusFilter)}
            size="md"
          />
        </div>

        {tournaments === null ? (
          <div style={{ display: "flex", justifyContent: "center", padding: "60px 0" }}>
            <Spinner />
          </div>
        ) : visible.length === 0 ? (
          <Card radius="lg" style={{ padding: "8px 12px" }}>
            <EmptyState
              icon={<IconTrophy size={26} />}
              title={isFiltered ? "No matching tournaments" : "No tournaments yet"}
              description={isFiltered ? "Try adjusting your search or filter." : "Nothing has been created on the platform."}
            />
          </Card>
        ) : (
          <Card radius="lg" style={{ padding: "8px 12px", overflowX: "auto" }}>
            {/* One grid owns the tracks; header and rows are subgrids of it. */}
            <div
              className={table.table}
              style={{ gridTemplateColumns: COLUMNS, minWidth: `${MIN_TABLE_WIDTH}px` }}
            >
              <div className={table.header}>
                <span>Name</span>
                <span>Owner</span>
                <span>Venue</span>
                <span>Dates</span>
                <span style={{ textAlign: "center" }}>Tracks</span>
                <span style={{ textAlign: "center" }}>Level</span>
                <span style={{ textAlign: "center" }}>State</span>
                <span style={{ textAlign: "center" }}>Division</span>
                <span style={{ textAlign: "center" }}>Members</span>
                <span style={{ textAlign: "center" }}>Events</span>
                <span style={{ textAlign: "center" }}>Status</span>
                <span style={{ textAlign: "center" }}>Created</span>
                <span style={{ textAlign: "center" }}>Actions</span>
              </div>

              {visible.map((t) => (
                <TournamentRow
                  key={t.id}
                  tournament={t}
                  onArchive={() => setArchiveTarget(t)}
                  onUnarchive={() => setUnarchiveTarget(t)}
                  onDelete={() => setDeleteTarget(t)}
                />
              ))}
            </div>
          </Card>
        )}

      {archiveTarget && (
        <ConfirmModal
          title="Archive tournament"
          confirmLabel="Archive"
          description={
            <>
              Archive <strong>{tournamentDisplayName(archiveTarget)}</strong>? It stays readable to
              its members but nothing in it can be changed while archived.
            </>
          }
          onConfirm={() => tournamentsApi.archive(archiveTarget.id).then(replaceRow)}
          onClose={() => setArchiveTarget(null)}
        />
      )}

      {unarchiveTarget && (
        <ConfirmModal
          title="Unarchive tournament"
          variant="primary"
          confirmLabel="Unarchive"
          description={
            <>
              Unarchive <strong>{tournamentDisplayName(unarchiveTarget)}</strong>? Its members will
              be able to make changes again. A tournament past its end date stays out of the
              auto-archive job once you do this.
            </>
          }
          onConfirm={() => tournamentsApi.unarchive(unarchiveTarget.id).then(replaceRow)}
          onClose={() => setUnarchiveTarget(null)}
        />
      )}

      {deleteTarget && (
        <BulkDeleteModal
          items={[deleteTarget]}
          noun="tournament"
          description={
            <>
              Delete <strong>{tournamentDisplayName(deleteTarget)}</strong>? This destroys its
              events, shifts, roles, forms and every membership in it — {deleteTarget.volunteer_count} member
              {deleteTarget.volunteer_count === 1 ? "" : "s"} and {deleteTarget.event_count} event
              {deleteTarget.event_count === 1 ? "" : "s"}. This can&rsquo;t be undone.
            </>
          }
          onDelete={(t) => tournamentsApi.delete(t.id)}
          onClose={() => setDeleteTarget(null)}
          onDeleted={removeRows}
        />
      )}
    </>
  );
}
