"use client";

import { useEffect, useMemo, useState } from "react";
import { adminTournamentsApi, tournamentsApi, AdminTournament, ApiError } from "@/lib/api";
import {
  formatDates, formatTrackDates, placeOf, placeOfShort, primaryTracks,
  stateAbbreviation, tournamentDisplayName,
} from "@/lib/tournamentDisplay";
import { formatDuration } from "@/lib/timeFormat";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ButtonGroup } from "@/components/ui/ButtonGroup";
import { Input } from "@/components/ui/Input";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Spinner } from "@/components/ui/Spinner";
import { HoverCard } from "@/components/ui/HoverCard";
import { AvatarCircle } from "@/components/ui/AvatarCircle";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { BulkDeleteModal } from "@/components/ui/BulkDeleteModal";
import { IconArchive, IconRestore, IconTrash, IconSearch, IconTrophy } from "@/components/ui/Icons";
import { useSetLayoutPanel } from "@/lib/useLayoutPanel";
import { AdminUserPanel, ADMIN_USER_PANEL_WIDTH } from "@/components/admin/AdminUserPanel";
import { useActionToast } from "@/lib/useActionToast";
import table from "@/components/ui/Table.module.css";

// Fixed px wherever the content has a known maximum — a formatted date range,
// a count, a badge — and minmax() only where it is open-ended. The min half
// of each minmax is what stops a narrow window from squeezing a cell until it
// wraps; an `fr` track alone shrinks to nothing.
const COLUMNS = [
  "minmax(180px, 1.3fr)", // name
  "minmax(170px, 0.9fr)", // owner — avatar + gap eat ~32px before the name
  "minmax(120px, 0.8fr)", // venue — short form, so narrower than the full name needed
  "minmax(150px, 0.7fr)", // dates — widest is a cross-year pair
  "64px",                 // tracks
  "104px",                // level
  "72px",                 // state
  "88px",                 // division
  "76px",                 // members
  "68px",                 // events
  "128px",                // status
  "88px",                 // created
  "76px",                 // actions
].join(" ");

// Sum of the track floors. The card scrolls horizontally rather than letting
// thirteen columns crush each other — every cell here has a legible minimum
// and none of them truncate usefully.
const MIN_TABLE_WIDTH = 1370;

type StatusFilter = "all" | "active" | "archived";

const STATUS_OPTIONS = [
  { value: "active",   label: "Active" },
  { value: "archived", label: "Archived" },
  { value: "all",      label: "All" },
];

// Mono is for data you compare down a column — the counts. Everything that
// reads as prose (owner, venue, dates) is sans, per the app's font split.
const NUM_CELL: React.CSSProperties = {
  fontFamily: "var(--font-mono)", fontSize: "12px",
  color: "var(--color-text-secondary)", textAlign: "center",
};

const TEXT_CELL: React.CSSProperties = {
  fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)",
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
    const place = placeOfShort(tournament);
    // Full name in the title — the abbreviation is for scanning the column,
    // not for hiding which university it is.
    return <span style={TEXT_CELL} title={placeOf(tournament) ?? undefined}>{place ?? "—"}</span>;
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
              <span style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-secondary)" }}>
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

// Level is a fixed four-value enum; each gets a stable colour so the column
// can be read by shape rather than by reading every word.
const LEVEL_VARIANT: Record<string, "admin" | "confirmed" | "assigned" | "default"> = {
  nationals:     "admin",
  state:         "confirmed",
  regionals:     "assigned",
  invitational:  "default",
};

function divisionVariant(division: string) {
  if (division === "A") return "divisionA" as const;
  if (division === "B") return "divisionB" as const;
  return "divisionC" as const;
}

function TournamentRow({ tournament, onOpenOwner, onArchive, onUnarchive, onDelete }: {
  tournament: AdminTournament;
  onOpenOwner: (userId: number) => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onDelete: () => void;
}) {
  const primary = primaryTracks(tournament);

  return (
    // Deliberately not dimmed. A dimmed row reads as "unavailable to you",
    // which is backwards here: an archived tournament is exactly the one an
    // admin is here to unarchive or purge. The Archived badge carries the state.
    <div className={table.row}>
      <span style={{
        fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 500,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0,
      }} title={tournament.name}>
        {tournamentDisplayName(tournament)}
      </span>

      {tournament.owner ? (
        <button
          type="button"
          onClick={() => onOpenOwner(tournament.owner!.id)}
          title={`${tournament.owner.email} — open profile`}
          style={{
            display: "flex", alignItems: "center", gap: "8px", minWidth: 0,
            border: "none", background: "transparent", padding: 0, cursor: "pointer",
            font: "inherit", textAlign: "left", color: "inherit",
          }}
        >
          {/* "sm" (28px) matches the roster table's avatar. */}
          <AvatarCircle user={tournament.owner} size="sm" />
          <span style={{ ...TEXT_CELL, color: "var(--color-text-primary)" }}>
            {ownerName(tournament.owner)}
          </span>
        </button>
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

      <span style={{ display: "flex", justifyContent: "center" }}>
        <Badge variant={LEVEL_VARIANT[tournament.level] ?? "default"}>{tournament.level}</Badge>
      </span>
      <span style={{ display: "flex", justifyContent: "center" }}>
        <Badge variant="default" title={tournament.state}>{stateAbbreviation(tournament.state)}</Badge>
      </span>

      <span style={{ display: "flex", gap: "3px", justifyContent: "center", flexWrap: "wrap" }}>
        {tournament.division.length === 0
          ? <span style={NUM_CELL}>—</span>
          : tournament.division.map((d) => (
              <Badge key={d} variant={divisionVariant(d)}>{d}</Badge>
            ))}
      </span>

      <span style={NUM_CELL}>{tournament.volunteer_count}</span>
      <span style={NUM_CELL}>{tournament.event_count}</span>

      {/* Active was previously implied by the absence of an Archived badge,
          which left the cell blank for most rows. It's a state, so it says so. */}
      <span style={{ display: "flex", gap: "3px", justifyContent: "center", flexWrap: "wrap" }}>
        <Badge variant={tournament.is_archived ? "removed" : "confirmed"}>
          {tournament.is_archived ? "Archived" : "Active"}
        </Badge>
        {tournament.is_verified && <Badge variant="assigned">Verified</Badge>}
        {tournament.is_public && <Badge variant="interested">Public</Badge>}
      </span>

      {/* Relative is what an admin actually reads this for ("made last week");
          the exact timestamp is one hover away rather than spending the column. */}
      <HoverCard
        width="fit"
        style={{ justifyContent: "center", width: "100%" }}
        content={
          // One line, in a card sized to it — dateStyle:"full" spells the
          // weekday and month out, which wrapped to two lines.
          <span style={{ fontFamily: "var(--font-sans)", fontSize: "12px", whiteSpace: "nowrap" }}>
            {new Date(tournament.created_at).toLocaleString("en-US", {
              weekday: "short", month: "short", day: "numeric", year: "numeric",
              hour: "numeric", minute: "2-digit",
            })}
          </span>
        }
      >
        <span style={{ ...NUM_CELL, borderBottom: "1px dotted var(--color-border-strong)", cursor: "help" }}>
          {formatDuration(tournament.created_at)} ago
        </span>
      </HoverCard>

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

  const run = useActionToast();
  const [ownerUserId, setOwnerUserId] = useState<number | null>(null);
  const { setPanel, clearPanel } = useSetLayoutPanel();

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

  // Registered into the layout's panel slot rather than rendered here, so it
  // takes horizontal space beside the table instead of covering it.
  useEffect(() => {
    if (ownerUserId === null) {
      clearPanel();
      return;
    }
    setPanel(
      <AdminUserPanel userId={ownerUserId} onClose={() => setOwnerUserId(null)} />,
      ADMIN_USER_PANEL_WIDTH,
    );
  }, [ownerUserId, setPanel, clearPanel]);

  // Leaving the page has to drop the panel too — the slot lives in the layout
  // and would otherwise outlive the table that registered it.
  useEffect(() => clearPanel, [clearPanel]);

  const isFiltered = search.trim() !== "" || status !== "all";

  return (
    <>
      <PageHeader heading="Tournaments" />

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
            font="sans"
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
                  onOpenOwner={setOwnerUserId}
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
          onConfirm={() => run(
            `${tournamentDisplayName(archiveTarget)} archived`,
            () => tournamentsApi.archive(archiveTarget.id).then(replaceRow),
          )}
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
          onConfirm={() => run(
            `${tournamentDisplayName(unarchiveTarget)} unarchived`,
            () => tournamentsApi.unarchive(unarchiveTarget.id).then(replaceRow),
          )}
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
          onDelete={(t) => run(`${tournamentDisplayName(t)} deleted`, () => tournamentsApi.delete(t.id))}
          onClose={() => setDeleteTarget(null)}
          onDeleted={removeRows}
        />
      )}
    </>
  );
}
