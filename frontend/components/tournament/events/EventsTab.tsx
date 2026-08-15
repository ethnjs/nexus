"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { tournamentEventsApi, ApiError, TournamentEvent, TournamentDivision } from "@/lib/api";
import { formatDateTime } from "@/lib/timeFormat";
import { useTournament } from "@/lib/useTournament";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Spinner } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { Dropdown } from "@/components/ui/Dropdown";
import { IconSearch, IconArrowDown, IconEvents, IconWarning, IconExpand, IconPlus, IconTrash, IconFilter, IconX } from "@/components/ui/Icons";
import { LoadDefaultEventsModal } from "@/components/tournament/events/LoadDefaultEventsModal";
import { EventPanel } from "@/components/tournament/events/EventPanel";
import { DeleteEventModal } from "@/components/tournament/events/DeleteEventModal";
import { EventsFilterModal, EventsFilterState, isEventsFilterActive } from "@/components/tournament/events/EventsFilterModal";

// Name doesn't need much room (event names are short); Start/End are 50%
// wider than before so a full date+time doesn't get clipped.
const EVENT_ROW_COLUMNS = "1.3fr 90px 100px 1.1fr 195px 195px 70px";

const DIVISION_BADGE_VARIANT: Record<string, "divisionA" | "divisionB" | "divisionC"> = {
  A: "divisionA",
  B: "divisionB",
  C: "divisionC",
};

type SortField = "name" | "division" | "start_time";
type SortDir = "asc" | "desc";

// Sentinel for the null case of a nullable field (division/category) so it
// can sit in the same filter Set as real values.
const UNSET = "__unset__";

const TYPE_OPTIONS = [
  { value: "standard", label: "Standard" },
  { value: "trial", label: "Trial" },
];

const SORT_FIELD_OPTIONS = [
  { value: "name", label: "Name" },
  { value: "division", label: "Division" },
  { value: "start_time", label: "Start" },
];

function eventName(e: TournamentEvent): string {
  return e.event?.name ?? e.name ?? "—";
}

function categoryKey(e: TournamentEvent): string {
  return e.event?.category.name ?? UNSET;
}

function sortValue(e: TournamentEvent, field: SortField): string | number {
  switch (field) {
    case "name": return eventName(e).toLowerCase();
    case "division": return e.division ?? "";
    case "start_time": return e.start_time ? new Date(e.start_time).getTime() : 0;
  }
}

interface EventsTabProps {
  tournamentId: number;
  canManageEvents: boolean;
}

export function EventsTab({ tournamentId, canManageEvents }: EventsTabProps) {
  const router = useRouter();
  const { selectedTournament, isArchived } = useTournament();
  const divisions = selectedTournament?.division ?? [];
  const hasDivisions = divisions.length > 0;

  const [events, setEvents] = useState<TournamentEvent[] | null>(null);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [panelTarget, setPanelTarget] = useState<TournamentEvent | "new" | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TournamentEvent | null>(null);

  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<EventsFilterState>({ division: new Set(), type: new Set(), category: new Set() });
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [sortField, setSortField] = useState<SortField>("start_time");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  async function loadEvents() {
    try {
      const next = await tournamentEventsApi.list(tournamentId);
      setEvents(next);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "Failed to load events.");
    }
  }

  useEffect(() => {
    loadEvents();
  }, [tournamentId]);

  const divisionOptions = useMemo(() => {
    const opts = (selectedTournament?.division ?? []).map((d: TournamentDivision) => ({ value: d, label: `Division ${d}` }));
    return (events ?? []).some((e) => e.division === null) ? [...opts, { value: UNSET, label: "No division" }] : opts;
  }, [selectedTournament, events]);

  const categoryOptions = useMemo(() => {
    const names = new Set((events ?? []).filter((e) => e.event).map((e) => e.event!.category.name));
    const opts = [...names].sort((a, b) => a.localeCompare(b)).map((name) => ({ value: name, label: name }));
    return (events ?? []).some((e) => !e.event) ? [...opts, { value: UNSET, label: "No category" }] : opts;
  }, [events]);

  const visibleEvents = useMemo(() => {
    if (!events) return [];
    const q = search.trim().toLowerCase();
    const filtered = events.filter((e) => {
      if (q && !eventName(e).toLowerCase().includes(q)) return false;
      if (filters.division.has(e.division ?? UNSET)) return false;
      if (filters.type.has(e.event_type)) return false;
      if (filters.category.has(categoryKey(e))) return false;
      return true;
    });
    const sorted = [...filtered].sort((a, b) => {
      const av = sortValue(a, sortField);
      const bv = sortValue(b, sortField);
      const cmp = typeof av === "string" ? av.localeCompare(bv as string) : av - (bv as number);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [events, search, filters, sortField, sortDir]);

  if (events === null) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
        <Spinner size="lg" />
      </div>
    );
  }

  const isFiltered = search.trim() !== "" || isEventsFilterActive(filters);

  return (
    <div>
      {loadError && (
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)", marginBottom: "10px" }}>
          {loadError}
        </p>
      )}

      {events.length === 0 ? (
        <Card radius="lg" style={{ padding: "8px" }}>
          {canManageEvents && !isArchived && !hasDivisions ? (
            <EmptyState
              icon={<IconWarning size={28} />}
              title="No divisions assigned"
              description="This tournament has no divisions assigned yet. Assign at least one before loading default events."
              action={
                <Button type="button" variant="primary" size="sm" onClick={() => router.push(`/dashboard/tournaments/${tournamentId}/settings/general`)}>
                  Go to settings
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={<IconEvents size={28} />}
              title="No events yet"
              description="Load this tournament's default events, or add them one at a time."
              action={
                canManageEvents && !isArchived ? (
                  <div style={{ display: "flex", gap: "10px" }}>
                    <Button type="button" variant="primary" size="sm" onClick={() => setShowLoadModal(true)}>
                      Load default events
                    </Button>
                    <Button type="button" variant="secondary" size="sm" onClick={() => setPanelTarget("new")}>
                      <IconPlus size={12} /> Add event
                    </Button>
                  </div>
                ) : undefined
              }
            />
          )}
        </Card>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: "10px", marginBottom: "12px", flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: "10px", flexWrap: "wrap" }}>
              <div style={{ width: "300px" }}>
                <Input
                  label="Search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search event name"
                  icon={<IconSearch size={14} />}
                  font="sans"
                  size="md"
                  variant="secondary"
                  fullWidth
                />
              </div>
              <Button
                type="button" variant="secondary" size="md"
                onClick={() => setShowFilterModal(true)}
              >
                <IconFilter size={16} /> Filter
              </Button>
              {isEventsFilterActive(filters) && (
                <Button
                  type="button" variant="ghost" size="md"
                  onClick={() => setFilters({ division: new Set(), type: new Set(), category: new Set() })}
                >
                  <IconX size={16} /> Clear filters
                </Button>
              )}
              <Dropdown
                label="Sort by"
                value={sortField}
                onChange={(v) => setSortField(v as SortField)}
                options={SORT_FIELD_OPTIONS}
                size="md"
                variant="secondary"
                width={150}
              />
              <Button
                type="button" variant="secondary" size="md" iconOnly
                title={sortDir === "asc" ? "Ascending" : "Descending"}
                onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
              >
                <IconArrowDown size={18} style={{ transition: "transform 150ms ease", transform: sortDir === "asc" ? "rotate(180deg)" : "rotate(0deg)" }} />
              </Button>
            </div>

            {canManageEvents && !isArchived && (
              <Button type="button" variant="primary" size="md" onClick={() => setPanelTarget("new")}>
                <IconPlus size={14} /> Add event
              </Button>
            )}
          </div>

          <Card radius="lg" style={{ padding: "8px 12px" }}>
            <div style={{
              display: "grid", gridTemplateColumns: EVENT_ROW_COLUMNS, gap: "10px",
              padding: "12px 12px", fontFamily: "var(--font-sans)", fontSize: "11px",
              fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase",
              color: "var(--color-text-tertiary)",
            }}>
              <span>Events — {isFiltered ? `${visibleEvents.length} of ${events.length}` : events.length}</span>
              <span style={{ textAlign: "center" }}>Division</span>
              <span style={{ textAlign: "center" }}>Type</span>
              <span>Category</span>
              <span style={{ textAlign: "center" }}>Start</span>
              <span style={{ textAlign: "center" }}>End</span>
              <span style={{ textAlign: "center" }}>Actions</span>
            </div>

            {visibleEvents.length === 0 ? (
              <EmptyState title="No matching events" description="Try adjusting your search or filters." />
            ) : (
              visibleEvents.map((e, i) => (
                <EventRow
                  key={e.id}
                  event={e}
                  isLast={i === visibleEvents.length - 1}
                  canDelete={canManageEvents && !isArchived}
                  onExpand={() => setPanelTarget(e)}
                  onDelete={() => setDeleteTarget(e)}
                />
              ))
            )}
          </Card>
        </>
      )}

      {showFilterModal && (
        <EventsFilterModal
          divisionOptions={divisionOptions}
          typeOptions={TYPE_OPTIONS}
          categoryOptions={categoryOptions}
          filters={filters}
          onChange={setFilters}
          onClose={() => setShowFilterModal(false)}
        />
      )}

      {showLoadModal && (
        <LoadDefaultEventsModal
          tournamentId={tournamentId}
          divisions={divisions}
          existingEvents={events}
          onClose={() => setShowLoadModal(false)}
          onLoaded={(created) => setEvents((prev) => [...(prev ?? []), ...created])}
        />
      )}

      {panelTarget !== null && (
        <EventPanel
          tournamentId={tournamentId}
          event={panelTarget === "new" ? null : panelTarget}
          locked={isArchived}
          onClose={() => setPanelTarget(null)}
          onSaved={(saved) => setEvents((prev) => {
            const list = prev ?? [];
            const exists = list.some((e) => e.id === saved.id);
            return exists ? list.map((e) => (e.id === saved.id ? saved : e)) : [...list, saved];
          })}
          onDeleted={(id) => setEvents((prev) => (prev ?? []).filter((e) => e.id !== id))}
        />
      )}

      {deleteTarget && (
        <DeleteEventModal
          tournamentId={tournamentId}
          eventId={deleteTarget.id}
          eventName={eventName(deleteTarget)}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => {
            setEvents((prev) => (prev ?? []).filter((e) => e.id !== deleteTarget.id));
            setDeleteTarget(null);
          }}
        />
      )}
    </div>
  );
}

function EventRow({ event, isLast, canDelete, onExpand, onDelete }: {
  event: TournamentEvent;
  isLast: boolean;
  canDelete: boolean;
  onExpand: () => void;
  onDelete: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "grid", gridTemplateColumns: EVENT_ROW_COLUMNS, alignItems: "center",
        gap: "10px", padding: "10px 12px",
        borderBottom: isLast ? "none" : "1px solid var(--color-border)",
        background: hovered ? "var(--color-bg)" : "transparent",
        transition: "background 100ms ease",
      }}
    >
      <span style={{
        fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 500,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {eventName(event)}
      </span>
      <span style={{ display: "flex", justifyContent: "center" }}>
        {event.division ? (
          <Badge variant={DIVISION_BADGE_VARIANT[event.division]}>{event.division}</Badge>
        ) : (
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--color-text-tertiary)" }}>—</span>
        )}
      </span>
      <span style={{ display: "flex", justifyContent: "center" }}>
        <Badge variant={event.event_type === "trial" ? "warning" : "default"}>
          {event.event_type === "trial" ? "Trial" : "Standard"}
        </Badge>
      </span>
      <span style={{
        fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {event.event?.category.name ?? ""}
      </span>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--color-text-secondary)", textAlign: "center" }}>
        {event.start_time ? formatDateTime(event.start_time) : "—"}
      </span>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--color-text-secondary)", textAlign: "center" }}>
        {event.end_time ? formatDateTime(event.end_time) : "—"}
      </span>
      <div style={{ display: "flex", justifyContent: "center", gap: "4px" }}>
        {canDelete && (
          <Button type="button" variant="secondary" size="sm" iconOnly title="Delete event" onClick={onDelete}>
            <IconTrash size={13} style={{ color: "var(--color-danger)" }} />
          </Button>
        )}
        <Button type="button" variant="secondary" size="sm" iconOnly title="Expand" onClick={onExpand}>
          <IconExpand size={13} />
        </Button>
      </div>
    </div>
  );
}
