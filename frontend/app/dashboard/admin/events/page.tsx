"use client";

import { useEffect, useMemo, useState } from "react";
import {
  canonicalEventsApi, eventCategoriesApi, seasonEventsApi,
  CanonicalEvent, EventCategory, SeasonEvent, TournamentDivision, TOURNAMENT_DIVISIONS,
  ApiError,
} from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ButtonGroup } from "@/components/ui/ButtonGroup";
import { Input } from "@/components/ui/Input";
import { Dropdown } from "@/components/ui/Dropdown";
import { Toggle } from "@/components/ui/Toggle";
import { PageHeader } from "@/components/ui/PageHeader";
import { TabStrip } from "@/components/ui/TabStrip";
import { EmptyState } from "@/components/ui/EmptyState";
import { Spinner } from "@/components/ui/Spinner";
import { EditableText } from "@/components/ui/EditableText";
import { BulkDeleteModal } from "@/components/ui/BulkDeleteModal";
import {
  FilterModal, FilterOption, FilterSectionConfig, FilterState,
  emptyFilterState, filterAllows, isFilterActive,
} from "@/components/ui/FilterModal";
import { CategoriesModal } from "@/components/admin/CategoriesModal";
import { NewEventModal } from "@/components/admin/NewEventModal";
import { IconSearch, IconEvents, IconTrash, IconPlus, IconFilter, IconX, IconPresets } from "@/components/ui/Icons";
import table from "@/components/ui/Table.module.css";

type Tab = "events" | "season";

const TABS = [
  { key: "events" as const, label: "Events" },
  { key: "season" as const, label: "Season" },
];

const EVENT_FILTER_KEYS = ["category"] as const;
type EventFilterKey = (typeof EVENT_FILTER_KEYS)[number];

const EVENT_COLUMNS = [
  "minmax(260px, 2fr)",   // name
  "minmax(200px, 1.2fr)", // category
  "44px",                 // actions
].join(" ");

// One row per event, one toggle per division.
const SEASON_COLUMNS = [
  "minmax(260px, 2fr)",   // event
  "minmax(200px, 1.2fr)", // category
  ...TOURNAMENT_DIVISIONS.map(() => "84px"),
].join(" ");

const CELL_TEXT: React.CSSProperties = {
  fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 400,
};

// ─── Events tab ───────────────────────────────────────────────────────────────

function EventsTab({ events, categories, onEventsChanged, onCategoriesChanged }: {
  events: CanonicalEvent[];
  categories: EventCategory[];
  onEventsChanged: (events: CanonicalEvent[]) => void;
  onCategoriesChanged: (categories: EventCategory[]) => void;
}) {
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<FilterState<EventFilterKey>>(() => emptyFilterState(EVENT_FILTER_KEYS));
  const [showFilters, setShowFilters] = useState(false);
  const [showCategories, setShowCategories] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CanonicalEvent | null>(null);

  const categoryOptions: FilterOption[] = useMemo(
    () => [...categories]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => ({ value: c.name, label: c.name })),
    [categories],
  );

  const sections: FilterSectionConfig<EventFilterKey>[] = [
    { key: "category", title: "Category", options: categoryOptions, control: "checkbox" },
  ];

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return events.filter((e) => {
      if (!filterAllows(filters.category, e.category.name)) return false;
      if (!query) return true;
      return e.name.toLowerCase().includes(query) || e.category.name.toLowerCase().includes(query);
    });
  }, [events, search, filters]);

  /** Rethrows so EditableText keeps the field open with the server's message. */
  async function handleRename(id: number, name: string) {
    const updated = await canonicalEventsApi.update(id, { name });
    onEventsChanged(events.map((e) => (e.id === id ? updated : e)));
  }

  async function handleRecategorise(id: number, categoryId: number) {
    const updated = await canonicalEventsApi.update(id, { category_id: categoryId });
    onEventsChanged(events.map((e) => (e.id === id ? updated : e)));
  }

  const isFiltered = search.trim() !== "" || isFilterActive(filters);

  return (
    <>
      <div style={{ display: "flex", gap: "10px", alignItems: "center", marginBottom: "16px", flexWrap: "wrap" }}>
        <Input
          placeholder="Search events"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onClear={() => setSearch("")}
          icon={<IconSearch size={16} />}
          size="md"
          font="sans"
          variant="secondary"
          style={{ width: "360px" }}
        />
        <Button type="button" variant="secondary" size="md" onClick={() => setShowFilters(true)}>
          <IconFilter size={16} /> Filter
        </Button>
        {isFilterActive(filters) && (
          <Button
            type="button" variant="secondary" size="md"
            onClick={() => setFilters(emptyFilterState(EVENT_FILTER_KEYS))}
          >
            <IconX size={16} /> Clear filters
          </Button>
        )}
        <Button type="button" variant="secondary" size="md" onClick={() => setShowCategories(true)}>
          <IconPresets size={16} /> Categories
        </Button>
        <Button variant="primary" size="md" onClick={() => setShowNew(true)} style={{ marginLeft: "auto" }}>
          <IconPlus />
          Add event
        </Button>
      </div>

      {visible.length === 0 ? (
        <Card radius="lg" style={{ padding: "8px 12px" }}>
          <EmptyState
            icon={<IconEvents size={26} />}
            title={isFiltered ? "No matching events" : "No events yet"}
            description={isFiltered
              ? "Try adjusting your search or filters."
              : "Add the first event — tournaments pick from this catalog."}
          />
        </Card>
      ) : (
        <Card radius="lg" style={{ padding: "8px 12px", overflowX: "auto" }}>
          <div className={table.table} style={{ gridTemplateColumns: EVENT_COLUMNS, minWidth: "620px" }}>
            <div className={table.header}>
              <span>Event — {visible.length}{isFiltered ? ` of ${events.length}` : ""}</span>
              <span>Category</span>
              <span />
            </div>

            {visible.map((event) => (
              <div key={event.id} className={table.row}>
                <EditableText
                  value={event.name}
                  textStyle={{ ...CELL_TEXT, fontWeight: 500 }}
                  title="Click to rename"
                  onSave={(name) => handleRename(event.id, name)}
                />
                {/* A dropdown, not editable text: the category is a foreign key
                    into a five-row list, so free text would only invite typos. */}
                <Dropdown
                  value={String(event.category.id)}
                  onChange={(v) => handleRecategorise(event.id, Number(v))}
                  options={categories.map((c) => ({ value: String(c.id), label: c.name }))}
                  size="sm"
                  variant="secondary"
                />
                <div style={{ display: "flex", justifyContent: "center" }}>
                  <Button
                    type="button" variant="secondary" size="sm" iconOnly
                    title="Delete event" onClick={() => setDeleteTarget(event)}
                  >
                    <IconTrash size={13} style={{ color: "var(--color-danger)" }} />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {showFilters && (
        <FilterModal
          title="Filter events"
          sections={sections}
          filters={filters}
          onApply={(next) => setFilters(next)}
          onClose={() => setShowFilters(false)}
        />
      )}

      {showCategories && (
        <CategoriesModal
          categories={categories}
          onChanged={onCategoriesChanged}
          onClose={() => setShowCategories(false)}
        />
      )}

      {showNew && (
        <NewEventModal
          categories={categories}
          onClose={() => setShowNew(false)}
          onCreated={(created) =>
            onEventsChanged([...events, created].sort((a, b) => a.name.localeCompare(b.name)))
          }
        />
      )}

      {deleteTarget && (
        <BulkDeleteModal
          items={[deleteTarget]}
          noun="event"
          description={
            <>
              Delete <strong>{deleteTarget.name}</strong> from the catalog? This is refused while
              anyone has experience recorded against it. Tournaments already using it keep their
              own copy.
            </>
          }
          onDelete={(e) => canonicalEventsApi.delete(e.id)}
          onClose={() => setDeleteTarget(null)}
          onDeleted={(ids) => onEventsChanged(events.filter((e) => !ids.includes(e.id)))}
        />
      )}
    </>
  );
}

// ─── Season tab ───────────────────────────────────────────────────────────────

const ACTIVE_OPTIONS = [
  { value: "all", label: "All events" },
  { value: "active", label: "In this season" },
];

function SeasonTab({ events }: { events: CanonicalEvent[] }) {
  const thisYear = new Date().getFullYear();
  const [seasonEvents, setSeasonEvents] = useState<SeasonEvent[] | null>(null);
  const [year, setYear] = useState(thisYear);
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState<"all" | "active">("active");
  const [error, setError] = useState<string | undefined>(undefined);
  // Cells mid-write, so a toggle can't be clicked twice into two POSTs.
  const [busy, setBusy] = useState<Set<string>>(new Set());

  // Seasons that exist, plus this year and next, so a new one can be started
  // before it has a single row.
  const [knownYears, setKnownYears] = useState<number[]>([]);
  const yearOptions = useMemo(() => {
    const years = new Set([...knownYears, thisYear, thisYear + 1]);
    return [...years].sort((a, b) => b - a).map((y) => ({ value: String(y), label: String(y) }));
  }, [knownYears, thisYear]);

  useEffect(() => {
    seasonEventsApi.list()
      .then((all) => setKnownYears([...new Set(all.map((s) => s.year))]))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setSeasonEvents(null);
    let cancelled = false;
    seasonEventsApi.list({ year })
      .then((rows) => { if (!cancelled) setSeasonEvents(rows); })
      .catch((err: unknown) => {
        if (cancelled) return;
        setSeasonEvents([]);
        setError(err instanceof ApiError ? err.message : "Couldn't load this season.");
      });
    return () => { cancelled = true; };
  }, [year]);

  // (event_id, division) -> the season row, so a cell is one lookup.
  const byCell = useMemo(() => {
    const map = new Map<string, SeasonEvent>();
    for (const s of seasonEvents ?? []) map.set(`${s.event.id}:${s.division}`, s);
    return map;
  }, [seasonEvents]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return events.filter((e) => {
      if (scope === "active") {
        const anyActive = TOURNAMENT_DIVISIONS.some((d) => byCell.get(`${e.id}:${d}`)?.is_active);
        if (!anyActive) return false;
      }
      if (!query) return true;
      return e.name.toLowerCase().includes(query) || e.category.name.toLowerCase().includes(query);
    });
  }, [events, search, scope, byCell]);

  async function toggle(event: CanonicalEvent, division: TournamentDivision, next: boolean) {
    const key = `${event.id}:${division}`;
    if (busy.has(key)) return;
    setBusy((prev) => new Set(prev).add(key));
    setError(undefined);
    try {
      const existing = byCell.get(key);
      if (existing) {
        // Patched, not deleted, when switched off — the row carries created_at
        // and dropping it loses when the decision was first made.
        const updated = await seasonEventsApi.update(existing.id, { is_active: next });
        setSeasonEvents((prev) => (prev ?? []).map((s) => (s.id === existing.id ? updated : s)));
      } else {
        const created = await seasonEventsApi.create({
          event_id: event.id, year, division, is_active: next,
        });
        setSeasonEvents((prev) => [...(prev ?? []), created]);
        setKnownYears((prev) => (prev.includes(year) ? prev : [...prev, year]));
      }
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Couldn't save that change.");
    } finally {
      setBusy((prev) => {
        const nextSet = new Set(prev);
        nextSet.delete(key);
        return nextSet;
      });
    }
  }

  const activeCount = (seasonEvents ?? []).filter((s) => s.is_active).length;

  return (
    <>
      <div style={{ display: "flex", gap: "10px", alignItems: "center", marginBottom: "16px", flexWrap: "wrap" }}>
        <Dropdown
          value={String(year)}
          onChange={(v) => setYear(Number(v))}
          options={yearOptions}
          size="md"
          variant="secondary"
          width={120}
        />
        <Input
          placeholder="Search events"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onClear={() => setSearch("")}
          icon={<IconSearch size={16} />}
          size="md"
          font="sans"
          variant="secondary"
          style={{ width: "320px" }}
        />
        <ButtonGroup
          options={ACTIVE_OPTIONS}
          value={scope}
          onChange={(v) => setScope(v as "all" | "active")}
          size="md"
        />
        <span style={{
          marginLeft: "auto", fontFamily: "var(--font-sans)", fontSize: "13px",
          color: "var(--color-text-secondary)",
        }}>
          {activeCount} active in {year}
        </span>
      </div>

      {error && (
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)", marginBottom: "10px" }}>
          {error}
        </p>
      )}

      {seasonEvents === null ? (
        <div style={{ display: "flex", justifyContent: "center", padding: "60px 0" }}>
          <Spinner />
        </div>
      ) : visible.length === 0 ? (
        <Card radius="lg" style={{ padding: "8px 12px" }}>
          <EmptyState
            icon={<IconEvents size={26} />}
            title={scope === "active" ? `Nothing set for ${year} yet` : "No matching events"}
            description={scope === "active"
              ? "Switch to All events and toggle the ones that run this season."
              : "Try adjusting your search."}
          />
        </Card>
      ) : (
        <Card radius="lg" style={{ padding: "8px 12px", overflowX: "auto" }}>
          <div className={table.table} style={{ gridTemplateColumns: SEASON_COLUMNS, minWidth: "720px" }}>
            <div className={table.header}>
              <span>Event — {visible.length}</span>
              <span>Category</span>
              {TOURNAMENT_DIVISIONS.map((d) => (
                <span key={d} style={{ textAlign: "center" }}>Div {d}</span>
              ))}
            </div>

            {visible.map((event) => (
              <div key={event.id} className={table.row}>
                <span style={{ ...CELL_TEXT, fontWeight: 500, color: "var(--color-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {event.name}
                </span>
                <span style={{ display: "flex", minWidth: 0 }}>
                  <Badge variant="default">{event.category.name}</Badge>
                </span>
                {TOURNAMENT_DIVISIONS.map((division) => {
                  const key = `${event.id}:${division}`;
                  const row = byCell.get(key);
                  return (
                    <span key={division} style={{ display: "flex", justifyContent: "center" }}>
                      <Toggle
                        checked={!!row?.is_active}
                        locked={busy.has(key)}
                        onChange={(next) => toggle(event, division, next)}
                      />
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminEventsPage() {
  const [tab, setTab] = useState<Tab>("events");
  const [events, setEvents] = useState<CanonicalEvent[] | null>(null);
  const [categories, setCategories] = useState<EventCategory[]>([]);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);

  // Both tabs render the catalog, so it's fetched once here rather than per tab.
  useEffect(() => {
    Promise.all([canonicalEventsApi.list(), eventCategoriesApi.list()])
      .then(([e, c]) => {
        setEvents(e);
        setCategories([...c].sort((a, b) => a.name.localeCompare(b.name)));
      })
      .catch((err: unknown) => {
        setEvents([]);
        setLoadError(err instanceof ApiError ? err.message : "Couldn't load the event catalog.");
      });
  }, []);

  return (
    <>
      <PageHeader heading="Events" />

      {loadError && (
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)", marginBottom: "10px" }}>
          {loadError}
        </p>
      )}

      <TabStrip tabs={TABS} activeKey={tab} onChange={setTab} />

      {events === null ? (
        <div style={{ display: "flex", justifyContent: "center", padding: "60px 0" }}>
          <Spinner />
        </div>
      ) : tab === "events" ? (
        <EventsTab
          events={events}
          categories={categories}
          onEventsChanged={setEvents}
          onCategoriesChanged={setCategories}
        />
      ) : (
        <SeasonTab events={events} />
      )}
    </>
  );
}
