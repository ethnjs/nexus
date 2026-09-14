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
import { PageHeader } from "@/components/ui/PageHeader";
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
import { AddSeasonEventsModal } from "@/components/admin/AddSeasonEventsModal";
import { IconSearch, IconEvents, IconTrash, IconPlus, IconFilter, IconX, IconPresets } from "@/components/ui/Icons";
import { useActionToast } from "@/lib/useActionToast";
import table from "@/components/ui/Table.module.css";

// The season selector's "edit the catalog itself" position. A sentinel rather
// than a separate tab: picking a season and picking the catalog are the same
// decision — which set of events am I looking at — so they belong in one
// control.
const CATALOG = "all";

const EVENT_FILTER_KEYS = ["category"] as const;
type EventFilterKey = (typeof EVENT_FILTER_KEYS)[number];

const EVENT_COLUMNS = [
  "minmax(260px, 2fr)",   // name
  "minmax(200px, 1.2fr)", // category
  "44px",                 // actions
].join(" ");

const SEASON_COLUMNS = [
  "minmax(300px, 2fr)",   // event — name plus its division badges
  "minmax(200px, 1.2fr)", // category
  "168px",                // divisions — three sm pills plus gaps
  "44px",                 // actions
].join(" ");

// Division colours are shared with the tournaments table, so a division reads
// the same everywhere.
const DIVISION_VARIANT: Record<TournamentDivision, "divisionA" | "divisionB" | "divisionC"> = {
  A: "divisionA", B: "divisionB", C: "divisionC",
};

const SEASON_FILTER_KEYS = ["category", "division"] as const;
type SeasonFilterKey = (typeof SEASON_FILTER_KEYS)[number];

const CELL_TEXT: React.CSSProperties = {
  fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 400,
};

const TOOLBAR: React.CSSProperties = {
  display: "flex", gap: "10px", alignItems: "center", marginBottom: "16px", flexWrap: "wrap",
};

const LABEL: React.CSSProperties = {
  fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)",
};

// ─── Catalog view ─────────────────────────────────────────────────────────────

function CatalogView({ events, categories, seasonPicker, onEventsChanged, onCategoriesChanged }: {
  events: CanonicalEvent[];
  categories: EventCategory[];
  seasonPicker: React.ReactNode;
  onEventsChanged: (events: CanonicalEvent[]) => void;
  onCategoriesChanged: (categories: EventCategory[]) => void;
}) {
  const run = useActionToast();
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<FilterState<EventFilterKey>>(() => emptyFilterState(EVENT_FILTER_KEYS));
  const [showFilters, setShowFilters] = useState(false);
  const [showCategories, setShowCategories] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CanonicalEvent | null>(null);

  const categoryOptions: FilterOption[] = useMemo(
    () => categories.map((c) => ({ value: c.name, label: c.name })),
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
    await run(`Renamed to ${name}`, async () => {
      const updated = await canonicalEventsApi.update(id, { name });
      onEventsChanged(events.map((e) => (e.id === id ? updated : e)));
    });
  }

  async function handleRecategorise(id: number, categoryId: number) {
    await run("Category changed", async () => {
      const updated = await canonicalEventsApi.update(id, { category_id: categoryId });
      onEventsChanged(events.map((e) => (e.id === id ? updated : e)));
    });
  }

  const isFiltered = search.trim() !== "" || isFilterActive(filters);

  return (
    <>
      <div style={TOOLBAR}>
        {seasonPicker}
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
        {/* Pushed right so the filtering controls stay grouped on the left and
            the two "change the catalog" actions sit together. */}
        <span style={{ marginLeft: "auto", display: "flex", gap: "10px" }}>
          <Button type="button" variant="secondary" size="md" onClick={() => setShowCategories(true)}>
            <IconPresets size={16} /> Categories
          </Button>
          <Button variant="primary" size="md" onClick={() => setShowNew(true)}>
            <IconPlus />
            Add event
          </Button>
        </span>
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
                  // Recategorising is exactly when you notice the category you
                  // want doesn't exist yet.
                  footerLabel="Add category"
                  footerIcon={<IconPlus />}
                  onFooterClick={() => setShowCategories(true)}
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
          onApply={setFilters}
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
          onDelete={(e) => run(`${e.name} deleted`, () => canonicalEventsApi.delete(e.id))}
          onClose={() => setDeleteTarget(null)}
          onDeleted={(ids) => onEventsChanged(events.filter((e) => !ids.includes(e.id)))}
        />
      )}
    </>
  );
}

// ─── Season view ──────────────────────────────────────────────────────────────

function SeasonView({ year, events, categories, seasonPicker, onSeasonAdded }: {
  year: number;
  events: CanonicalEvent[];
  categories: EventCategory[];
  seasonPicker: React.ReactNode;
  /** Bubbles a new season's year up so the picker gains it. */
  onSeasonAdded: (year: number) => void;
}) {
  const run = useActionToast();
  const [seasonEvents, setSeasonEvents] = useState<SeasonEvent[] | null>(null);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<FilterState<SeasonFilterKey>>(() => emptyFilterState(SEASON_FILTER_KEYS));
  const [showFilters, setShowFilters] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<CanonicalEvent | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState<Set<string>>(new Set());

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

  // (event_id, division) -> row, so a cell is one lookup.
  const byCell = useMemo(() => {
    const map = new Map<string, SeasonEvent>();
    for (const s of seasonEvents ?? []) map.set(`${s.event.id}:${s.division}`, s);
    return map;
  }, [seasonEvents]);

  // Only events this season actually holds — the catalog lives in the CATALOG
  // position of the picker, and adding is the modal's job, so there's no
  // reason to list 180 rows of mostly-off toggles here.
  const rows = useMemo(() => {
    const ids = new Set((seasonEvents ?? []).map((s) => s.event.id));
    const query = search.trim().toLowerCase();
    return events.filter((e) => {
      if (!ids.has(e.id)) return false;
      if (!filterAllows(filters.category, e.category.name)) return false;
      // Matches an event *active* in any of the picked divisions, which is
      // what its badges show — filtering on mere presence would surface rows
      // whose badge for that division isn't there.
      if (filters.division.size > 0) {
        const active = TOURNAMENT_DIVISIONS.filter((d) => byCell.get(`${e.id}:${d}`)?.is_active);
        if (!active.some((d) => filters.division.has(d))) return false;
      }
      if (!query) return true;
      return e.name.toLowerCase().includes(query) || e.category.name.toLowerCase().includes(query);
    });
  }, [events, seasonEvents, search, filters, byCell]);

  const seasonSections: FilterSectionConfig<SeasonFilterKey>[] = [
    {
      key: "category", title: "Category", control: "checkbox",
      options: categories.map((c) => ({ value: c.name, label: c.name })),
    },
    {
      key: "division", title: "Division", control: "buttons",
      options: TOURNAMENT_DIVISIONS.map((d) => ({ value: d, label: `Division ${d}` })),
    },
  ];

  async function toggle(event: CanonicalEvent, division: TournamentDivision, next: boolean) {
    const key = `${event.id}:${division}`;
    if (busy.has(key)) return;
    setBusy((prev) => new Set(prev).add(key));
    setError(undefined);
    const label = `${event.name} — Division ${division} ${next ? "on" : "off"} for ${year}`;
    try {
      await run(label, async () => {
        const existing = byCell.get(key);
        if (existing) {
          // Patched, not deleted — the row carries created_at, and dropping it
          // loses when the decision was first made. Removing the event from the
          // season entirely is the row's own action.
          const updated = await seasonEventsApi.update(existing.id, { is_active: next });
          setSeasonEvents((prev) => (prev ?? []).map((s) => (s.id === existing.id ? updated : s)));
        } else {
          const created = await seasonEventsApi.create({
            event_id: event.id, year, division, is_active: next,
          });
          setSeasonEvents((prev) => [...(prev ?? []), created]);
        }
      });
    } catch {
      // Already toasted — the inline line is for the error staying put next to
      // the control after the toast auto-dismisses.
      setError("Couldn't save that change.");
    } finally {
      setBusy((prev) => {
        const nextSet = new Set(prev);
        nextSet.delete(key);
        return nextSet;
      });
    }
  }

  /** Divisions this event is actively in — what both the badges and the
   *  button group read from, so the two can't disagree. */
  function activeDivisions(event: CanonicalEvent): TournamentDivision[] {
    return TOURNAMENT_DIVISIONS.filter((d) => byCell.get(`${event.id}:${d}`)?.is_active);
  }

  const existingPairs = useMemo(() => new Set(byCell.keys()), [byCell]);
  const activeCount = (seasonEvents ?? []).filter((s) => s.is_active).length;

  // Every division row for the event being removed — the confirm deletes the
  // event from the season, not one division of it.
  const removeRows = removeTarget
    ? (seasonEvents ?? []).filter((s) => s.event.id === removeTarget.id)
    : [];

  return (
    <>
      <div style={TOOLBAR}>
        {seasonPicker}
        <Input
          placeholder="Search this season"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onClear={() => setSearch("")}
          icon={<IconSearch size={16} />}
          size="md"
          font="sans"
          variant="secondary"
          style={{ width: "320px" }}
        />
        <Button type="button" variant="secondary" size="md" onClick={() => setShowFilters(true)}>
          <IconFilter size={16} /> Filter
        </Button>
        {isFilterActive(filters) && (
          <Button
            type="button" variant="secondary" size="md"
            onClick={() => setFilters(emptyFilterState(SEASON_FILTER_KEYS))}
          >
            <IconX size={16} /> Clear filters
          </Button>
        )}
        <span style={LABEL}>{activeCount} active</span>
        <Button variant="primary" size="md" onClick={() => setShowAdd(true)} style={{ marginLeft: "auto" }}>
          <IconPlus />
          Add events
        </Button>
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
      ) : rows.length === 0 ? (
        <Card radius="lg" style={{ padding: "8px 12px" }}>
          <EmptyState
            icon={<IconEvents size={26} />}
            title={search.trim() ? "No matching events" : `Nothing set for ${year} yet`}
            description={search.trim()
              ? "Try adjusting your search."
              : "Add the events that run this season — tournaments load their defaults from this list."}
            action={search.trim() ? undefined : (
              <Button variant="secondary" size="md" onClick={() => setShowAdd(true)}>
                <IconPlus />
                Add events
              </Button>
            )}
          />
        </Card>
      ) : (
        <Card radius="lg" style={{ padding: "8px 12px", overflowX: "auto" }}>
          <div className={table.table} style={{ gridTemplateColumns: SEASON_COLUMNS, minWidth: "760px" }}>
            <div className={table.header}>
              <span>Event — {rows.length}</span>
              <span>Category</span>
              <span>Divisions</span>
              <span />
            </div>

            {rows.map((event) => (
              <div key={event.id} className={table.row}>
                {/* Badges sit with the name as the read-out — the control is
                    the button group two cells over. Only active divisions show:
                    an entry switched off isn't in this season's defaults, which
                    is what the colour is reporting. */}
                <span style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                  <span style={{
                    ...CELL_TEXT, fontWeight: 500, color: "var(--color-text-primary)",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {event.name}
                  </span>
                  <span style={{ display: "flex", gap: "3px", flexShrink: 0 }}>
                    {activeDivisions(event).map((division) => (
                      <Badge key={division} variant={DIVISION_VARIANT[division]}>{division}</Badge>
                    ))}
                  </span>
                </span>
                <span style={{ display: "flex", minWidth: 0 }}>
                  <Badge variant="default">{event.category.name}</Badge>
                </span>
                {/* All three divisions always offered, so a division can be
                    added to an event already in the season without going back
                    through the add modal. */}
                <ButtonGroup
                  options={TOURNAMENT_DIVISIONS.map((d) => ({ value: d, label: d }))}
                  value={activeDivisions(event)}
                  onChange={(v) => {
                    const division = v as TournamentDivision;
                    toggle(event, division, !byCell.get(`${event.id}:${division}`)?.is_active);
                  }}
                  locked={TOURNAMENT_DIVISIONS.some((d) => busy.has(`${event.id}:${d}`))}
                />
                <div style={{ display: "flex", justifyContent: "center" }}>
                  <Button
                    type="button" variant="secondary" size="sm" iconOnly
                    title={`Remove from ${year}`} onClick={() => setRemoveTarget(event)}
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
          title="Filter season"
          sections={seasonSections}
          filters={filters}
          onApply={setFilters}
          onClose={() => setShowFilters(false)}
        />
      )}

      {showAdd && (
        <AddSeasonEventsModal
          year={year}
          events={events}
          categories={categories}
          existing={existingPairs}
          onClose={() => setShowAdd(false)}
          onAdded={(created) => {
            setSeasonEvents((prev) => [...(prev ?? []), ...created]);
            onSeasonAdded(year);
          }}
        />
      )}

      {removeTarget && (
        <BulkDeleteModal
          items={removeRows}
          noun="entry"
          description={
            <>
              Remove <strong>{removeTarget.name}</strong> from {year}? This drops it from every
              division it&rsquo;s in this season. The event stays in the catalog — switch a
              division off instead if you only want it out of the defaults.
            </>
          }
          onDelete={(row) => run(
            `${row.event.name} removed from ${year}`,
            () => seasonEventsApi.delete(row.id),
          )}
          onClose={() => setRemoveTarget(null)}
          onDeleted={(ids) =>
            setSeasonEvents((prev) => (prev ?? []).filter((s) => !ids.includes(s.id)))
          }
        />
      )}
    </>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminEventsPage() {
  const thisYear = new Date().getFullYear();
  const [view, setView] = useState<string>(CATALOG);
  const [events, setEvents] = useState<CanonicalEvent[] | null>(null);
  const [categories, setCategories] = useState<EventCategory[]>([]);
  const [knownYears, setKnownYears] = useState<number[]>([]);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);

  // The catalog backs both views, so it's fetched once here.
  useEffect(() => {
    Promise.all([canonicalEventsApi.list(), eventCategoriesApi.list(), seasonEventsApi.list()])
      .then(([e, c, s]) => {
        setEvents(e);
        setCategories([...c].sort((a, b) => a.name.localeCompare(b.name)));
        setKnownYears([...new Set(s.map((row) => row.year))]);
      })
      .catch((err: unknown) => {
        setEvents([]);
        setLoadError(err instanceof ApiError ? err.message : "Couldn't load the event catalog.");
      });
  }, []);

  // Seasons that exist, plus this year and next, so a new one can be started
  // before it holds a single row.
  const viewOptions = useMemo(() => {
    const years = [...new Set([...knownYears, thisYear, thisYear + 1])].sort((a, b) => b - a);
    return [
      { value: CATALOG, label: "All events" },
      ...years.map((y) => ({ value: String(y), label: String(y) })),
    ];
  }, [knownYears, thisYear]);

  const seasonPicker = (
    <Dropdown
      value={view}
      onChange={setView}
      options={viewOptions}
      size="md"
      variant="secondary"
      width={168}
    />
  );

  return (
    <>
      <PageHeader heading="Events" />

      {loadError && (
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)", marginBottom: "10px" }}>
          {loadError}
        </p>
      )}

      {events === null ? (
        <div style={{ display: "flex", justifyContent: "center", padding: "60px 0" }}>
          <Spinner />
        </div>
      ) : view === CATALOG ? (
        <CatalogView
          events={events}
          categories={categories}
          seasonPicker={seasonPicker}
          onEventsChanged={setEvents}
          onCategoriesChanged={setCategories}
        />
      ) : (
        <SeasonView
          // Remounts per season, so its fetch and search reset together.
          key={view}
          year={Number(view)}
          events={events}
          categories={categories}
          seasonPicker={seasonPicker}
          onSeasonAdded={(y) =>
            setKnownYears((prev) => (prev.includes(y) ? prev : [...prev, y]))
          }
        />
      )}
    </>
  );
}
