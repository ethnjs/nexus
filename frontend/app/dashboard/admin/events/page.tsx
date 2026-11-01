"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AddSeasonEventsModal } from "@/components/admin/AddSeasonEventsModal";
import { CategoriesModal } from "@/components/admin/CategoriesModal";
import { NewEventModal } from "@/components/admin/NewEventModal";
import { SEASON_MASS_EDITOR_WIDTH, SeasonMassEditor } from "@/components/admin/SeasonMassEditor";
import { SelectCell } from "@/components/tournament/events/EditableCells";
import { Badge } from "@/components/ui/Badge";
import { BulkDeleteModal } from "@/components/ui/BulkDeleteModal";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Checkbox } from "@/components/ui/Checkbox";
import { DivisionButtonGroup } from "@/components/ui/DivisionButtonGroup";
import { Dropdown } from "@/components/ui/Dropdown";
import { EditableText } from "@/components/ui/EditableText";
import { EmptyState } from "@/components/ui/EmptyState";
import { FilterButton } from "@/components/ui/FilterButton";
import {
  emptyFilterState,
  FilterModal,
  type FilterOption,
  type FilterSectionConfig,
  type FilterState,
  filterAllows,
  isFilterActive,
} from "@/components/ui/FilterModal";
import { IconEvents, IconPlus, IconPresets, IconSearch, IconTrash } from "@/components/ui/Icons";
import { Input } from "@/components/ui/Input";
import { PageHeader } from "@/components/ui/PageHeader";
import { SelectionBar } from "@/components/ui/SelectionBar";
import { SortButton } from "@/components/ui/SortButton";
import { SortModal } from "@/components/ui/SortModal";
import { Spinner } from "@/components/ui/Spinner";
import table from "@/components/ui/Table.module.css";
import {
  ApiError,
  type CanonicalEvent,
  canonicalEventsApi,
  EVENT_FORMAT_LABELS,
  EVENT_FORMATS,
  type EventCategory,
  type EventFormat,
  eventCategoriesApi,
  type SeasonEvent,
  type SeasonEventInput,
  seasonEventsApi,
  TOURNAMENT_DIVISIONS,
  type TournamentDivision,
} from "@/lib/api";
import { EVENT_SORT_OPTIONS, EVENT_SORT_TIEBREAK, FORMAT_RANK } from "@/lib/eventSort";
import { compareValues, type SortRule, sameSortRules, sortRows } from "@/lib/sorting";
import { stickyHeader } from "@/lib/stickyHeader";
import { currentSeasonYear, formatSeason } from "@/lib/tournamentDisplay";
import { useActionToast } from "@/lib/useActionToast";
import { useSetLayoutPanel } from "@/lib/useLayoutPanel";
import { usePanelSelection } from "@/lib/usePanelSelection";
import { useToast } from "@/lib/useToast";

// The season selector's "edit the catalog itself" position. A sentinel rather
// than a separate tab: picking a season and picking the catalog are the same
// decision — which set of events am I looking at — so they belong in one
// control.
const CATALOG = "all";

const EVENT_FILTER_KEYS = ["category"] as const;
type EventFilterKey = (typeof EVENT_FILTER_KEYS)[number];

const EVENT_COLUMNS = [
  "minmax(260px, 2fr)", // name
  "minmax(200px, 1.2fr)", // category
  "44px", // actions
].join(" ");

// Always a grid track, so Select mode can animate its width from 0.
const SELECT_COLUMN_WIDTH = "28px";

function seasonColumns(selectMode: boolean) {
  return [
    selectMode ? SELECT_COLUMN_WIDTH : "0px",
    "minmax(240px, 1.4fr)", // event — name plus its division badges
    "minmax(140px, 1fr)", // category
    "168px", // divisions — three sm pills plus gaps
    "minmax(96px, 0.6fr)", // format
    "minmax(72px, 0.5fr)", // impound
    "minmax(104px, 0.6fr)", // self-schedule
    "44px", // actions
  ].join(" ");
}

// Division colours are shared with the tournaments table, so a division reads
// the same everywhere.
const DIVISION_VARIANT: Record<TournamentDivision, "divisionA" | "divisionB" | "divisionC"> = {
  A: "divisionA",
  B: "divisionB",
  C: "divisionC",
};

const SEASON_FILTER_KEYS = ["category", "division", "format", "impound", "self_schedule"] as const;
type SeasonFilterKey = (typeof SEASON_FILTER_KEYS)[number];

// The filter's value for an unset format, which FilterState can't hold as null.
const NO_FORMAT = "none";

const YES_NO_OPTIONS: FilterOption[] = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

/** Shared by every division of an event in a season; the backend keeps them in step. */
type SeasonDetails = Pick<SeasonEventInput, "format" | "has_impound" | "has_self_schedule">;

// The TD events table's sorts that a season row can answer; start time,
// staffing and location come from a tournament's shifts and rooms.
const SEASON_SORT_FIELDS = [
  "name",
  "division",
  "category",
  "format",
  "impound",
  "self_schedule",
] as const;
type SeasonSortField = (typeof SEASON_SORT_FIELDS)[number];
const SEASON_SORT_OPTIONS = EVENT_SORT_OPTIONS.filter((o) =>
  (SEASON_SORT_FIELDS as readonly string[]).includes(o.value),
);
const DEFAULT_SEASON_SORT: SortRule<SeasonSortField>[] = [{ field: "name", direction: "asc" }];

const CENTERED: React.CSSProperties = { display: "flex", justifyContent: "center" };

const CELL_TEXT: React.CSSProperties = {
  fontFamily: "var(--font-sans)",
  fontSize: "13px",
  fontWeight: 400,
};

const TOOLBAR: React.CSSProperties = {
  display: "flex",
  gap: "10px",
  alignItems: "center",
  marginBottom: "16px",
  flexWrap: "wrap",
};

// ─── Catalog view ─────────────────────────────────────────────────────────────

function CatalogView({
  events,
  categories,
  seasonPicker,
  onEventsChanged,
  onCategoriesChanged,
}: {
  events: CanonicalEvent[];
  categories: EventCategory[];
  seasonPicker: React.ReactNode;
  onEventsChanged: (events: CanonicalEvent[]) => void;
  onCategoriesChanged: (categories: EventCategory[]) => void;
}) {
  const run = useActionToast();
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<FilterState<EventFilterKey>>(() =>
    emptyFilterState(EVENT_FILTER_KEYS),
  );
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
    return events
      .filter((e) => {
        if (!filterAllows(filters.category, e.category.name)) return false;
        if (!query) return true;
        return (
          e.name.toLowerCase().includes(query) || e.category.name.toLowerCase().includes(query)
        );
      })
      .sort((a, b) => compareValues(a.name, b.name) || a.id - b.id);
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
        {/* Takes all the room the toolbar leaves, and is the first thing to
            give it back — narrows before anything else has to wrap. */}
        <div style={{ flex: "1 1 220px", minWidth: "180px" }}>
          <Input
            placeholder="Search events"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onClear={() => setSearch("")}
            icon={<IconSearch size={16} />}
            size="md"
            font="sans"
            variant="secondary"
            fullWidth
          />
        </div>
        <FilterButton
          active={isFilterActive(filters)}
          onOpen={() => setShowFilters(true)}
          onClear={() => setFilters(emptyFilterState(EVENT_FILTER_KEYS))}
        />
        {/* Pushed right so the filtering controls stay grouped on the left and
            the two "change the catalog" actions sit together. */}
        <span style={{ marginLeft: "auto", display: "flex", gap: "10px" }}>
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={() => setShowCategories(true)}
          >
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
            description={
              isFiltered
                ? "Try adjusting your search or filters."
                : "Add the first event — tournaments pick from this catalog."
            }
          />
        </Card>
      ) : (
        <Card radius="lg" className={table.scroll} style={{ padding: "8px 12px" }}>
          <div
            className={table.table}
            style={{ gridTemplateColumns: EVENT_COLUMNS, minWidth: "620px" }}
          >
            <div ref={stickyHeader} className={table.header}>
              <span>
                Event — {visible.length}
                {isFiltered ? ` of ${events.length}` : ""}
              </span>
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
                    type="button"
                    variant="secondary"
                    size="sm"
                    iconOnly
                    title="Delete event"
                    onClick={() => setDeleteTarget(event)}
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
              anyone has experience recorded against it. Tournaments already using it keep their own
              copy.
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

function SeasonView({
  year,
  events,
  categories,
  seasonPicker,
  onSeasonAdded,
}: {
  year: number;
  events: CanonicalEvent[];
  categories: EventCategory[];
  seasonPicker: React.ReactNode;
  /** Bubbles a new season's year up so the picker gains it. */
  onSeasonAdded: (year: number) => void;
}) {
  const run = useActionToast();
  const { show } = useToast();
  const { setPanel, clearPanel } = useSetLayoutPanel();
  const [seasonEvents, setSeasonEvents] = useState<SeasonEvent[] | null>(null);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<FilterState<SeasonFilterKey>>(() =>
    emptyFilterState(SEASON_FILTER_KEYS),
  );
  const [showFilters, setShowFilters] = useState(false);
  const [sortRules, setSortRules] = useState<SortRule<SeasonSortField>[]>(DEFAULT_SEASON_SORT);
  const [showSort, setShowSort] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [removeTargets, setRemoveTargets] = useState<CanonicalEvent[] | null>(null);
  const {
    selectMode,
    selectedIds,
    massPanelOpen,
    panelDirty,
    setPanelDirty,
    toggleSelectMode,
    toggleSelected,
    toggleSelectAll,
    openMassPanel,
    clearSelection,
    forgetItem,
  } = usePanelSelection();
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState<Set<string>>(new Set());

  useEffect(() => {
    setSeasonEvents(null);
    let cancelled = false;
    seasonEventsApi
      .list({ year })
      .then((rows) => {
        if (!cancelled) setSeasonEvents(rows);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setSeasonEvents([]);
        setError(err instanceof ApiError ? err.message : "Couldn't load this season.");
      });
    return () => {
      cancelled = true;
    };
  }, [year]);

  // Without the spinner reset above, so the table stays put behind the panel.
  const reload = useCallback(() => {
    seasonEventsApi
      .list({ year })
      .then(setSeasonEvents)
      .catch(() => setError("Couldn't reload this season."));
  }, [year]);

  // Selection is of events, which leave the season when their last division goes.
  useEffect(() => {
    if (seasonEvents === null) return;
    const present = new Set(seasonEvents.map((s) => s.event.id));
    const gone = [...selectedIds].filter((id) => !present.has(id));
    if (gone.length > 0) forgetItem(gone);
  }, [seasonEvents, selectedIds, forgetItem]);

  // (event_id, division) -> row, so a cell is one lookup.
  const byCell = useMemo(() => {
    const map = new Map<string, SeasonEvent>();
    for (const s of seasonEvents ?? []) map.set(`${s.event.id}:${s.division}`, s);
    return map;
  }, [seasonEvents]);

  // The row an event's format and flags are read from and written through.
  // Any division's would do, since the backend keeps them in step; an active
  // one is preferred over a leftover switched-off row.
  const detailsRow = useMemo(() => {
    const map = new Map<number, SeasonEvent>();
    for (const s of seasonEvents ?? []) {
      if (!map.get(s.event.id)?.is_active) map.set(s.event.id, s);
    }
    return map;
  }, [seasonEvents]);

  async function saveDetails(event: CanonicalEvent, patch: SeasonDetails) {
    const row = detailsRow.get(event.id);
    if (!row) return;
    await seasonEventsApi.update(row.id, patch);
    // The backend copied the change to every division, so mirror that here.
    setSeasonEvents((prev) =>
      (prev ?? []).map((s) => (s.event.id === event.id ? { ...s, ...patch } : s)),
    );
  }

  function setFlag(
    event: CanonicalEvent,
    field: "has_impound" | "has_self_schedule",
    next: boolean,
  ) {
    const noun = field === "has_impound" ? "Impound" : "Self-schedule";
    run(`${event.name} — ${noun} ${next ? "on" : "off"}`, () =>
      saveDetails(event, { [field]: next }),
    ).catch(() => setError("Couldn't save that change."));
  }

  // Only events this season actually holds — the catalog lives in the CATALOG
  // position of the picker, and adding is the modal's job, so there's no
  // reason to list 180 rows of mostly-off toggles here.
  const rows = useMemo(() => {
    const ids = new Set((seasonEvents ?? []).map((s) => s.event.id));
    const query = search.trim().toLowerCase();
    const matching = events.filter((e) => {
      if (!ids.has(e.id)) return false;
      if (!filterAllows(filters.category, e.category.name)) return false;
      // Matches an event *active* in any of the picked divisions, which is
      // what its badges show — filtering on mere presence would surface rows
      // whose badge for that division isn't there.
      if (filters.division.size > 0) {
        const active = TOURNAMENT_DIVISIONS.filter((d) => byCell.get(`${e.id}:${d}`)?.is_active);
        if (!active.some((d) => filters.division.has(d))) return false;
      }
      const details = detailsRow.get(e.id);
      const yesNo = (v: boolean | undefined) => (v ? "yes" : "no");
      if (!filterAllows(filters.format, details?.format ?? NO_FORMAT)) return false;
      if (!filterAllows(filters.impound, yesNo(details?.has_impound))) return false;
      if (!filterAllows(filters.self_schedule, yesNo(details?.has_self_schedule))) return false;
      if (!query) return true;
      return e.name.toLowerCase().includes(query) || e.category.name.toLowerCase().includes(query);
    });
    return sortRows(
      matching,
      sortRules,
      (e, field) => {
        switch (field) {
          case "name":
            return e.name;
          // Its lowest active division, so an event in B and C files with the B events.
          case "division":
            return TOURNAMENT_DIVISIONS.find((d) => byCell.get(`${e.id}:${d}`)?.is_active) ?? null;
          case "category":
            return e.category.name;
          case "format": {
            const format = detailsRow.get(e.id)?.format;
            return format ? FORMAT_RANK[format] : null;
          }
          case "impound":
            return detailsRow.get(e.id)?.has_impound ? 0 : 1;
          case "self_schedule":
            return detailsRow.get(e.id)?.has_self_schedule ? 0 : 1;
        }
      },
      (a, b) => compareValues(a.name, b.name) || a.id - b.id,
    );
  }, [events, seasonEvents, search, filters, byCell, detailsRow, sortRules]);

  const seasonSections: FilterSectionConfig<SeasonFilterKey>[] = [
    {
      key: "category",
      title: "Category",
      control: "checkbox",
      options: categories.map((c) => ({ value: c.name, label: c.name })),
    },
    {
      key: "division",
      title: "Division",
      control: "divisions",
      options: TOURNAMENT_DIVISIONS.map((d) => ({ value: d, label: `Division ${d}` })),
    },
    {
      key: "format",
      title: "Format",
      control: "buttons",
      options: [
        ...EVENT_FORMATS.map((f) => ({ value: f, label: EVENT_FORMAT_LABELS[f] })),
        { value: NO_FORMAT, label: "Not set" },
      ],
    },
    { key: "impound", title: "Impound", control: "buttons", options: YES_NO_OPTIONS },
    { key: "self_schedule", title: "Self-schedule", control: "buttons", options: YES_NO_OPTIONS },
  ];

  async function toggle(event: CanonicalEvent, division: TournamentDivision, next: boolean) {
    const key = `${event.id}:${division}`;
    if (busy.has(key)) return;
    setBusy((prev) => new Set(prev).add(key));
    setError(undefined);
    const label = `${event.name} — Division ${division} ${next ? "on" : "off"} for ${formatSeason(year)}`;
    try {
      await run(label, async () => {
        const existing = byCell.get(key);
        if (!next && existing) {
          await seasonEventsApi.delete(existing.id);
          setSeasonEvents((prev) => (prev ?? []).filter((s) => s.id !== existing.id));
        } else if (existing) {
          const updated = await seasonEventsApi.update(existing.id, { is_active: true });
          setSeasonEvents((prev) => (prev ?? []).map((s) => (s.id === existing.id ? updated : s)));
        } else {
          // The backend gives a new division the event's existing format and flags.
          const created = await seasonEventsApi.create({
            event_id: event.id,
            year,
            division,
            is_active: true,
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

  const selectedEvents = useMemo(
    () => events.filter((e) => selectedIds.has(e.id)),
    [events, selectedIds],
  );

  // The slot lives in the layout and would outlive this view otherwise.
  useEffect(() => clearPanel, [clearPanel]);

  useEffect(() => {
    if (!massPanelOpen || selectedEvents.length === 0) {
      clearPanel();
      return;
    }
    setPanel(
      <SeasonMassEditor
        year={year}
        events={selectedEvents}
        seasonEvents={seasonEvents ?? []}
        onClose={clearSelection}
        onSaved={reload}
        onDirtyChange={setPanelDirty}
      />,
      SEASON_MASS_EDITOR_WIDTH,
    );
  }, [
    massPanelOpen,
    selectedEvents,
    seasonEvents,
    year,
    reload,
    clearSelection,
    setPanelDirty,
    setPanel,
    clearPanel,
  ]);

  const visibleIds = rows.map((e) => e.id);
  // As on the TD tables: in Select mode a click on a cell selects the row.
  const lockReason = selectMode ? "Leave Select mode to edit in the table" : undefined;

  return (
    <>
      <div style={TOOLBAR}>
        {seasonPicker}
        {/* Takes all the room the toolbar leaves, and is the first thing to
            give it back — narrows before anything else has to wrap. */}
        <div style={{ flex: "1 1 220px", minWidth: "180px" }}>
          <Input
            placeholder="Search this season"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onClear={() => setSearch("")}
            icon={<IconSearch size={16} />}
            size="md"
            font="sans"
            variant="secondary"
            fullWidth
          />
        </div>
        <FilterButton
          active={isFilterActive(filters)}
          onOpen={() => setShowFilters(true)}
          onClear={() => setFilters(emptyFilterState(SEASON_FILTER_KEYS))}
        />
        <SortButton
          active={!sameSortRules(sortRules, DEFAULT_SEASON_SORT)}
          onOpen={() => setShowSort(true)}
          onReset={() => setSortRules(DEFAULT_SEASON_SORT)}
        />
        <Button
          type="button"
          variant={selectMode ? "primary" : "secondary"}
          size="md"
          onClick={toggleSelectMode}
          disabled={panelDirty}
          title={panelDirty ? "Save or discard your changes first" : undefined}
        >
          Select
        </Button>
        <Button
          variant="primary"
          size="md"
          onClick={() => setShowAdd(true)}
          style={{ marginLeft: "auto" }}
        >
          <IconPlus />
          Add events
        </Button>
      </div>

      {error && (
        <p
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: "13px",
            color: "var(--color-danger)",
            marginBottom: "10px",
          }}
        >
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
            title={
              search.trim() ? "No matching events" : `Nothing set for ${formatSeason(year)} yet`
            }
            description={
              search.trim()
                ? "Try adjusting your search."
                : "Add the events that run this season — tournaments load their defaults from this list."
            }
            action={
              search.trim() ? undefined : (
                <Button variant="secondary" size="md" onClick={() => setShowAdd(true)}>
                  <IconPlus />
                  Add events
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <Card radius="lg" className={table.scroll} style={{ padding: "8px 12px" }}>
          <div
            className={`${table.table} ${table.animatedTracks}`}
            style={{ gridTemplateColumns: seasonColumns(selectMode), minWidth: "960px" }}
          >
            <div ref={stickyHeader} className={table.header}>
              <span
                className={`${table.collapsible} ${selectMode ? "" : table.collapsed}`}
                style={CENTERED}
                title={panelDirty ? "Save or discard your changes first" : undefined}
              >
                <Checkbox
                  checked={rows.length > 0 && rows.every((e) => selectedIds.has(e.id))}
                  locked={panelDirty}
                  onChange={(checked) => toggleSelectAll(visibleIds, checked)}
                />
              </span>
              <span>Event — {rows.length}</span>
              <span>Category</span>
              <span>Divisions</span>
              <span style={CENTERED}>Format</span>
              <span style={CENTERED}>Impound</span>
              <span style={CENTERED}>Self-schedule</span>
              <span />
            </div>

            {rows.map((event) => (
              <div
                key={event.id}
                className={table.row}
                data-active={selectMode && selectedIds.has(event.id) ? "true" : undefined}
                onClick={
                  selectMode
                    ? (e) => {
                        // Controls keep their own clicks. So does anything portalled
                        // out of the row, like a cell's popover, whose clicks still
                        // bubble here through React.
                        const target = e.target as Element;
                        if (!e.currentTarget.contains(target)) return;
                        if (target.closest("button, input, a, [role='button']")) return;
                        toggleSelected(event.id, visibleIds);
                      }
                    : undefined
                }
                // A Shift-click selects a range of rows, not the text between them.
                onMouseDown={selectMode ? (e) => e.shiftKey && e.preventDefault() : undefined}
                style={selectMode ? { cursor: panelDirty ? "not-allowed" : "pointer" } : undefined}
              >
                <span
                  className={`${table.collapsible} ${selectMode ? "" : table.collapsed}`}
                  style={CENTERED}
                >
                  <Checkbox
                    checked={selectedIds.has(event.id)}
                    locked={panelDirty}
                    onChange={() => toggleSelected(event.id, visibleIds)}
                  />
                </span>
                {/* Badges sit with the name as the read-out — the control is
                    the button group two cells over. Only active divisions show:
                    an entry switched off isn't in this season's defaults, which
                    is what the colour is reporting. */}
                <span style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                  <span
                    style={{
                      ...CELL_TEXT,
                      fontWeight: 500,
                      color: "var(--color-text-primary)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {event.name}
                  </span>
                  <span style={{ display: "flex", gap: "3px", flexShrink: 0 }}>
                    {activeDivisions(event).map((division) => (
                      <Badge key={division} variant={DIVISION_VARIANT[division]}>
                        {division}
                      </Badge>
                    ))}
                  </span>
                </span>
                <span style={{ display: "flex", minWidth: 0 }}>
                  <Badge variant="default">{event.category.name}</Badge>
                </span>
                {/* All three divisions always offered, so a division can be
                    added to an event already in the season without going back
                    through the add modal. */}
                <SelectLock lockReason={lockReason}>
                  <DivisionButtonGroup
                    options={TOURNAMENT_DIVISIONS.map((d) => ({ value: d, label: d }))}
                    value={activeDivisions(event)}
                    onChange={(v) => {
                      const division = v as TournamentDivision;
                      toggle(event, division, !byCell.get(`${event.id}:${division}`)?.is_active);
                    }}
                    locked={TOURNAMENT_DIVISIONS.some((d) => busy.has(`${event.id}:${d}`))}
                  />
                </SelectLock>
                <FormatCell
                  event={event}
                  value={detailsRow.get(event.id)?.format ?? null}
                  lockReason={lockReason}
                  onSave={saveDetails}
                />
                {(["has_impound", "has_self_schedule"] as const).map((field) => (
                  <SelectLock key={field} lockReason={lockReason} centered>
                    <Checkbox
                      checked={detailsRow.get(event.id)?.[field] ?? false}
                      onChange={(next) => setFlag(event, field, next)}
                    />
                  </SelectLock>
                ))}
                <div style={{ display: "flex", justifyContent: "center" }}>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    iconOnly
                    title={`Remove from ${formatSeason(year)}`}
                    onClick={() => setRemoveTargets([event])}
                  >
                    <IconTrash size={13} style={{ color: "var(--color-danger)" }} />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {showSort && (
        <SortModal
          title="Sort season"
          fields={SEASON_SORT_OPTIONS}
          rules={sortRules}
          defaults={DEFAULT_SEASON_SORT}
          tiebreakLabel={EVENT_SORT_TIEBREAK}
          onApply={(next) => setSortRules(next as SortRule<SeasonSortField>[])}
          onClose={() => setShowSort(false)}
        />
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

      <SelectionBar
        visible={selectMode && !massPanelOpen}
        count={selectedIds.size}
        onEdit={openMassPanel}
        onCancel={toggleSelectMode}
        actions={
          <Button
            type="button"
            variant="secondary"
            size="sm"
            iconOnly
            title={`Remove selected from ${formatSeason(year)}`}
            disabled={selectedIds.size === 0}
            onClick={() => setRemoveTargets(selectedEvents)}
          >
            <IconTrash size={13} style={{ color: "var(--color-danger)" }} />
          </Button>
        }
      />

      {removeTargets && (
        <BulkDeleteModal
          items={removeTargets}
          noun="event"
          verb="Remove"
          verbPast="removed"
          description={
            <>
              Remove{" "}
              {removeTargets.length === 1 ? (
                <strong>{removeTargets[0].name}</strong>
              ) : (
                `${removeTargets.length} events`
              )}{" "}
              from {formatSeason(year)}? This drops every division they&rsquo;re in this season. The
              events stay in the catalog.
            </>
          }
          onDelete={(event) =>
            Promise.all(
              (seasonEvents ?? [])
                .filter((s) => s.event.id === event.id)
                .map((s) => seasonEventsApi.delete(s.id)),
            )
          }
          onClose={() => setRemoveTargets(null)}
          onDeleted={(ids) => {
            setSeasonEvents((prev) => (prev ?? []).filter((s) => !ids.includes(s.event.id)));
            forgetItem(ids);
            show(
              ids.length === 1
                ? `${events.find((e) => e.id === ids[0])?.name ?? "Event"} removed from ${formatSeason(year)}`
                : `${ids.length} events removed from ${formatSeason(year)}`,
              "success",
            );
          }}
        />
      )}
    </>
  );
}

/** Makes a control inert while locked, so a click on it reaches the row. */
function SelectLock({
  lockReason,
  centered = false,
  children,
}: {
  lockReason?: string;
  centered?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      title={lockReason}
      style={{
        ...(centered ? CENTERED : { display: "flex" }),
        cursor: lockReason ? "not-allowed" : undefined,
      }}
    >
      <span style={{ display: "flex", pointerEvents: lockReason ? "none" : undefined }}>
        {children}
      </span>
    </span>
  );
}

function FormatCell({
  event,
  value,
  lockReason,
  onSave,
}: {
  event: CanonicalEvent;
  value: EventFormat | null;
  lockReason?: string;
  onSave: (event: CanonicalEvent, patch: SeasonDetails) => Promise<void>;
}) {
  return (
    <SelectCell
      display={
        value ? (
          <Badge variant="default">{EVENT_FORMAT_LABELS[value]}</Badge>
        ) : (
          <span style={{ ...CELL_TEXT, color: "var(--color-text-tertiary)" }}>—</span>
        )
      }
      value={value ?? ""}
      options={[
        ...EVENT_FORMATS.map((f) => ({ value: f, label: EVENT_FORMAT_LABELS[f] })),
        { value: "", label: "None" },
      ]}
      lockReason={lockReason}
      onPick={(next) => onSave(event, { format: (next || null) as EventFormat | null })}
    />
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminEventsPage() {
  const thisSeason = currentSeasonYear();
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

  // Seasons that exist, plus this one and next, so a new one can be started
  // before it holds a single row.
  const viewOptions = useMemo(() => {
    const years = [...new Set([...knownYears, thisSeason, thisSeason + 1])].sort((a, b) => b - a);
    return [
      { value: CATALOG, label: "All events" },
      ...years.map((y) => ({ value: String(y), label: formatSeason(y) })),
    ];
  }, [knownYears, thisSeason]);

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
        <p
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: "13px",
            color: "var(--color-danger)",
            marginBottom: "10px",
          }}
        >
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
          onSeasonAdded={(y) => setKnownYears((prev) => (prev.includes(y) ? prev : [...prev, y]))}
        />
      )}
    </>
  );
}
