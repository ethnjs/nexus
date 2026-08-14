"use client";

import { useEffect, useMemo, useState } from "react";
import { tournamentEventsApi, ApiError, TournamentEvent, TournamentDivision } from "@/lib/api";
import { formatDateTime } from "@/lib/timeFormat";
import { useTournament } from "@/lib/useTournament";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { Dropdown } from "@/components/ui/Dropdown";
import { IconSearch, IconArrowDown, IconEvents } from "@/components/ui/Icons";

const EVENT_ROW_COLUMNS = "2fr 80px 90px 1.2fr 130px 130px";

type SortField = "name" | "division" | "start_time";
type SortDir = "asc" | "desc";

const TYPE_FILTER_OPTIONS = [
  { value: "all", label: "All types" },
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
  const { selectedTournament, isArchived } = useTournament();

  const [events, setEvents] = useState<TournamentEvent[] | null>(null);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const [loadingDefaults, setLoadingDefaults] = useState(false);

  const [search, setSearch] = useState("");
  const [divisionFilter, setDivisionFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
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

  async function handleLoadDefaults() {
    setLoadingDefaults(true);
    setLoadError(undefined);
    try {
      const result = await tournamentEventsApi.loadDefaults(tournamentId);
      setEvents((prev) => [...(prev ?? []), ...result.created]);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "Failed to load default events.");
    } finally {
      setLoadingDefaults(false);
    }
  }

  const divisionOptions = useMemo(
    () => (selectedTournament?.division ?? []).map((d: TournamentDivision) => ({ value: d, label: `Division ${d}` })),
    [selectedTournament]
  );

  const visibleEvents = useMemo(() => {
    if (!events) return [];
    const q = search.trim().toLowerCase();
    const filtered = events.filter((e) => {
      if (q && !eventName(e).toLowerCase().includes(q)) return false;
      if (divisionFilter !== "all" && e.division !== divisionFilter) return false;
      if (typeFilter !== "all" && e.event_type !== typeFilter) return false;
      return true;
    });
    const sorted = [...filtered].sort((a, b) => {
      const av = sortValue(a, sortField);
      const bv = sortValue(b, sortField);
      const cmp = typeof av === "string" ? av.localeCompare(bv as string) : av - (bv as number);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [events, search, divisionFilter, typeFilter, sortField, sortDir]);

  if (events === null) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
        <Spinner size="lg" />
      </div>
    );
  }

  const isFiltered = search.trim() !== "" || divisionFilter !== "all" || typeFilter !== "all";

  return (
    <div>
      {loadError && (
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)", marginBottom: "10px" }}>
          {loadError}
        </p>
      )}

      {events.length === 0 ? (
        <Card radius="lg" style={{ padding: "8px" }}>
          <EmptyState
            icon={<IconEvents size={28} />}
            title="No events yet"
            description="Load this tournament's events from the season catalog, or add them one at a time."
            action={
              canManageEvents && !isArchived ? (
                <Button type="button" variant="primary" size="sm" loading={loadingDefaults} onClick={handleLoadDefaults}>
                  Load from season catalog
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "flex-end", gap: "10px", marginBottom: "12px", flexWrap: "wrap" }}>
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
            <Dropdown
              label="Division"
              value={divisionFilter}
              onChange={setDivisionFilter}
              options={[{ value: "all", label: "All divisions" }, ...divisionOptions]}
              size="md"
              variant="secondary"
              width={160}
            />
            <Dropdown
              label="Type"
              value={typeFilter}
              onChange={setTypeFilter}
              options={TYPE_FILTER_OPTIONS}
              size="md"
              variant="secondary"
              width={150}
            />
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
            </div>

            {visibleEvents.length === 0 ? (
              <EmptyState title="No matching events" description="Try adjusting your search or filters." />
            ) : (
              visibleEvents.map((e, i) => (
                <EventRow key={e.id} event={e} isLast={i === visibleEvents.length - 1} />
              ))
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function EventRow({ event, isLast }: { event: TournamentEvent; isLast: boolean }) {
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
      <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--color-text-secondary)", textAlign: "center" }}>
        {event.division ?? "—"}
      </span>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--color-text-secondary)", textAlign: "center" }}>
        {event.event_type === "trial" ? "Trial" : "Standard"}
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
    </div>
  );
}
