"use client";

import { useEffect, useState, useCallback, useMemo, useTransition } from "react";
import { useParams } from "next/navigation";
import {
  eventsApi,
  timeBlocksApi,
  categoriesApi,
  ApiError,
  Event,
  EventCreate,
  TimeBlock,
  TimeBlockCreate,
  TournamentCategory,
} from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { CsvImportBar } from "@/components/events/CsvImportBar";
import { TimeBlocksTable } from "@/components/events/TimeBlocksTable";
import { DeleteBlockModal, AffectedEvent } from "@/components/events/DeleteBlockModal";
import { EventSidePanel } from "@/components/events/EventSidePanel";
import { EventCardGrid } from "@/components/events/EventCardGrid";
import { EventTable } from "@/components/events/EventTable";
import { EventTimeline } from "@/components/events/EventTimeline";

// ─── Tab type ─────────────────────────────────────────────────────────────────

type Tab = "timeline" | "cards" | "table" | "blocks";
type NullToken = "__none__";
const NONE: NullToken = "__none__";

type EventFilters = {
  search: string;
  categoryIds: Array<number | NullToken>;
  divisions: Array<"B" | "C" | NullToken>;
  buildings: string[];
  timeBlockIds: number[];
};

const EMPTY_FILTERS: EventFilters = {
  search: "",
  categoryIds: [],
  divisions: [],
  buildings: [],
  timeBlockIds: [],
};

// ─── Tab bar ──────────────────────────────────────────────────────────────────

function TabBar({
  active,
  onChange,
}: {
  active: Tab;
  onChange: (t: Tab) => void;
}) {
  const tabs: { id: Tab; label: string }[] = [
    { id: "timeline", label: "Timeline" },
    { id: "cards",    label: "Cards" },
    { id: "table",    label: "Table" },
    { id: "blocks",   label: "Time Blocks" },
  ];

  return (
    <div
      style={{
        display: "flex",
        gap: "2px",
        borderBottom: "1px solid var(--color-border)",
        marginBottom: "24px",
      }}
    >
      {tabs.map((t) => {
        const isActive = t.id === active;
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: "13px",
              fontWeight: isActive ? 600 : 400,
              color: isActive
                ? "var(--color-text-primary)"
                : "var(--color-text-secondary)",
              background: "none",
              border: "none",
              borderBottom: isActive
                ? "2px solid var(--color-accent)"
                : "2px solid transparent",
              padding: "8px 14px",
              cursor: "pointer",
              marginBottom: "-1px",
              transition: "color var(--transition-fast), border-color var(--transition-fast)",
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

function toggleInSet<T>(arr: T[], value: T): T[] {
  return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
}

function checkboxRow(label: string, checked: boolean, onChange: () => void) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: "8px", fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-primary)" }}>
      <input type="checkbox" checked={checked} onChange={onChange} />
      {label}
    </label>
  );
}

function FiltersModal({
  open,
  filters,
  categories,
  buildings,
  timeBlocks,
  onChange,
  onClear,
  onClose,
}: {
  open: boolean;
  filters: EventFilters;
  categories: TournamentCategory[];
  buildings: string[];
  timeBlocks: TimeBlock[];
  onChange: (next: EventFilters) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 120, background: "rgba(0,0,0,0.15)" }} />
      <div style={{ position: "fixed", top: "80px", left: "50%", transform: "translateX(-50%)", zIndex: 130, width: "min(760px, calc(100vw - 32px))", maxHeight: "calc(100vh - 120px)", overflow: "auto", background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderBottom: "1px solid var(--color-border)" }}>
          <h3 style={{ fontFamily: "var(--font-serif)", fontSize: "20px", fontWeight: 400, color: "var(--color-text-primary)" }}>Filters</h3>
          <button onClick={onClose} style={{ border: "none", background: "none", cursor: "pointer", color: "var(--color-text-secondary)", fontSize: "18px" }}>×</button>
        </div>

        <div style={{ display: "grid", gap: "18px", padding: "14px 16px" }}>
          <section>
            <h4 style={{ fontFamily: "var(--font-sans)", fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--color-text-secondary)", marginBottom: "8px" }}>Category</h4>
            <div style={{ display: "grid", gap: "6px" }}>
              {checkboxRow("No category", filters.categoryIds.includes(NONE), () => onChange({ ...filters, categoryIds: toggleInSet(filters.categoryIds, NONE) }))}
              {categories.map((c) => (
                <div key={`cat-${c.id}`}>
                  {checkboxRow(c.name, filters.categoryIds.includes(c.id), () => onChange({ ...filters, categoryIds: toggleInSet(filters.categoryIds, c.id) }))}
                </div>
              ))}
            </div>
          </section>

          <section>
            <h4 style={{ fontFamily: "var(--font-sans)", fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--color-text-secondary)", marginBottom: "8px" }}>Division</h4>
            <div style={{ display: "grid", gap: "6px" }}>
              {checkboxRow("Division B", filters.divisions.includes("B"), () => onChange({ ...filters, divisions: toggleInSet(filters.divisions, "B") }))}
              {checkboxRow("Division C", filters.divisions.includes("C"), () => onChange({ ...filters, divisions: toggleInSet(filters.divisions, "C") }))}
              {checkboxRow("No division", filters.divisions.includes(NONE), () => onChange({ ...filters, divisions: toggleInSet(filters.divisions, NONE) }))}
            </div>
          </section>

          <section>
            <h4 style={{ fontFamily: "var(--font-sans)", fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--color-text-secondary)", marginBottom: "8px" }}>Building</h4>
            <div style={{ display: "grid", gap: "6px" }}>
              {buildings.length === 0 ? <span style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)" }}>No building values yet.</span> : buildings.map((b) => (
                <div key={`bld-${b}`}>
                  {checkboxRow(b, filters.buildings.includes(b), () => onChange({ ...filters, buildings: toggleInSet(filters.buildings, b) }))}
                </div>
              ))}
            </div>
          </section>

          <section>
            <h4 style={{ fontFamily: "var(--font-sans)", fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--color-text-secondary)", marginBottom: "8px" }}>Time Blocks</h4>
            <div style={{ display: "grid", gap: "6px" }}>
              {timeBlocks.length === 0 ? <span style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)" }}>No time blocks yet.</span> : timeBlocks.map((b) => (
                <div key={`tb-${b.id}`}>
                  {checkboxRow(`${b.label}`, filters.timeBlockIds.includes(b.id), () => onChange({ ...filters, timeBlockIds: toggleInSet(filters.timeBlockIds, b.id) }))}
                </div>
              ))}
            </div>
          </section>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderTop: "1px solid var(--color-border)" }}>
          <button onClick={onClear} style={{ border: "none", background: "none", color: "var(--color-text-secondary)", cursor: "pointer", fontFamily: "var(--font-sans)", fontSize: "13px" }}>Clear all</button>
          <button onClick={onClose} style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)", borderRadius: "var(--radius-sm)", padding: "6px 10px", cursor: "pointer", fontFamily: "var(--font-sans)", fontSize: "13px" }}>Done</button>
        </div>
      </div>
    </>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function EventsPage() {
  const params = useParams();
  const tournamentId = Number(params.tournamentId);

  const [activeTab, setActiveTab] = useState<Tab>("timeline");
  const [isPendingTab, startTabTransition] = useTransition();
  const [visitedTabs, setVisitedTabs] = useState<Set<Tab>>(new Set(["timeline"]));
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<EventFilters>(EMPTY_FILTERS);

  // Data
  const [events,     setEvents]     = useState<Event[]>([]);
  const [timeBlocks, setTimeBlocks] = useState<TimeBlock[]>([]);
  const [categories, setCategories] = useState<TournamentCategory[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);

  const activeFilterCount = useMemo(() => {
    return Number(filters.search.trim().length > 0)
      + Number(filters.categoryIds.length > 0)
      + Number(filters.divisions.length > 0)
      + Number(filters.buildings.length > 0)
      + Number(filters.timeBlockIds.length > 0);
  }, [filters]);

  const loadAll = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const [rawEvts, blocks, cats] = await Promise.all([
        eventsApi.listByTournament(tournamentId),
        timeBlocksApi.listByTournament(tournamentId),
        categoriesApi.listByTournament(tournamentId),
      ]);
      // Normalize: derive time_block_ids from time_blocks when the API omits the id array
      const evts = rawEvts.map((e) => ({
        ...e,
        time_block_ids: (e.time_blocks ?? []).map((b) => b.id),
      }));
      setEvents(evts);
      setTimeBlocks(blocks);
      setCategories(cats);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load events");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [tournamentId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const buildingOptions = useMemo(() => {
    const set = new Set<string>();
    for (const e of events) {
      const b = e.building?.trim();
      if (b) set.add(b);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [events]);

  const filteredEvents = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    const hasCategory = filters.categoryIds.length > 0;
    const hasDivision = filters.divisions.length > 0;
    const hasBuilding = filters.buildings.length > 0;
    const hasTimeBlocks = filters.timeBlockIds.length > 0;
    const categorySet = new Set(filters.categoryIds);
    const divisionSet = new Set(filters.divisions);
    const buildingSet = new Set(filters.buildings);
    const blockSet = new Set(filters.timeBlockIds);

    return events.filter((e) => {
      if (q && !e.name.toLowerCase().includes(q)) return false;

      if (hasCategory) {
        const catVal: number | NullToken = e.category_id ?? NONE;
        if (!categorySet.has(catVal)) return false;
      }

      if (hasDivision) {
        const divVal: "B" | "C" | NullToken = (e.division ?? NONE) as "B" | "C" | NullToken;
        if (!divisionSet.has(divVal)) return false;
      }

      if (hasBuilding) {
        const b = e.building?.trim() ?? "";
        if (!buildingSet.has(b)) return false;
      }

      if (hasTimeBlocks) {
        const ids = e.time_block_ids ?? [];
        if (!ids.some((id) => blockSet.has(id))) return false;
      }

      return true;
    });
  }, [events, filters]);

  // Keep panel.event in sync with fresh data after any silent refresh
  useEffect(() => {
    setPanel((prev) => {
      if (prev?.type !== "edit") return prev;
      const updated = events.find((e) => e.id === prev.event.id);
      return updated ? { type: "edit", event: updated } : prev;
    });
  }, [events]);

  // ── Time block handlers ───────────────────────────────────────────────────

  const handleAddBlock = async (data: TimeBlockCreate) => {
    await timeBlocksApi.create(tournamentId, data);
    await loadAll(true);
  };

  const handleEditBlock = async (id: number, data: Partial<TimeBlockCreate>) => {
    await timeBlocksApi.update(tournamentId, id, data);
    await loadAll(true);
  };

  // ── Delete block (with 409 modal guard) ──────────────────────────────────

  // ── Event side panel ─────────────────────────────────────────────────────

  type PanelMode = { type: "add" } | { type: "edit"; event: Event } | { type: "multi-edit"; ids: number[] } | null;
  const [panel, setPanel] = useState<PanelMode>(null);

  // Normalize a single freshly-fetched/updated event the same way loadAll does
  const normalizeEvent = useCallback((e: Event) => ({
    ...e,
    time_block_ids: (e.time_blocks ?? []).map((b) => b.id),
  }), []);

  const patchEventsState = useCallback((updated: Event) => {
    const normalized = normalizeEvent(updated);
    setEvents((prev) => prev.map((e) => e.id === normalized.id ? normalized : e));
  }, [normalizeEvent]);

  // Open edit panel: show immediately with cached data, then refresh just that event
  const openEditPanel = useCallback(async (event: Event) => {
    setPanel({ type: "edit", event });
    try {
      const fresh = await eventsApi.get(tournamentId, event.id);
      const normalized = normalizeEvent(fresh);
      setPanel({ type: "edit", event: normalized });
      setEvents((prev) => prev.map((e) => e.id === normalized.id ? normalized : e));
    } catch {
      // keep the cached data already shown in the panel
    }
  }, [tournamentId, normalizeEvent]);

  const handleSaveEvent = async (data: Omit<EventCreate, 'tournament_id'>) => {
    if (panel?.type === "edit") {
      const updated = await eventsApi.update(tournamentId, panel.event.id, data);
      patchEventsState(updated);
    } else {
      await eventsApi.create(tournamentId, { ...data, tournament_id: tournamentId });
      await loadAll(true);
    }
  };

  const handleMultiSave = async (data: Partial<Omit<EventCreate, 'tournament_id'>>) => {
    if (panel?.type !== "multi-edit") return;
    await eventsApi.batchUpdate(tournamentId, panel.ids, data);
    await loadAll(true);
    // select mode intentionally stays active after save
  };

  const handleUpdateEvent = async (id: number, delta: Partial<EventCreate>) => {
    const updated = await eventsApi.update(tournamentId, id, delta);
    patchEventsState(updated);
  };

  const handleCreateCategory = async (name: string) => {
    const cat = await categoriesApi.create(tournamentId, name);
    await loadAll(true);
    return cat;
  };

  // ── Select mode ───────────────────────────────────────────────────────────

  const [selectMode,   setSelectMode]   = useState(false);
  const [selectedIds,  setSelectedIds]  = useState<Set<number>>(new Set());
  const [filteredIds,  setFilteredIds]  = useState<number[]>([]);
  useEffect(() => {
    setFilteredIds(filteredEvents.map((e) => e.id));
  }, [filteredEvents]);

  const handleEnterSelectMode = () => setSelectMode(true);
  const handleExitSelectMode  = () => { setSelectMode(false); setSelectedIds(new Set()); };
  const handleTabChange = (next: Tab) => {
    startTabTransition(() => setActiveTab(next));
    setVisitedTabs((prev) => {
      const copy = new Set(prev);
      copy.add(next);
      return copy;
    });
  };
  const handleToggleSelect    = (id: number) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const handleSelectAll = () => setSelectedIds(new Set(filteredIds));

  // ── Delete block ──────────────────────────────────────────────────────────

  const [deleteTarget,    setDeleteTarget]    = useState<TimeBlock | null>(null);
  const [affectedEvents,  setAffectedEvents]  = useState<AffectedEvent[]>([]);

  const handleDeleteClick = async (block: TimeBlock) => {
    try {
      await timeBlocksApi.delete(tournamentId, block.id);
      await loadAll(true);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const detail = e.detail as { affected_events?: AffectedEvent[] };
        setAffectedEvents(detail?.affected_events ?? []);
        setDeleteTarget(block);
      } else {
        throw e;
      }
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    await timeBlocksApi.delete(tournamentId, deleteTarget.id, true);
    setDeleteTarget(null);
    setAffectedEvents([]);
    await loadAll(true);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ position: "relative" }}>
      <PageHeader
        title="Events"
        subtitle="Manage tournament events, schedule time blocks, and track locations."
      />

      <CsvImportBar
        tournamentId={tournamentId}
        events={events}
        categories={categories}
        timeBlocks={timeBlocks}
        onImportComplete={() => loadAll(true)}
      />

      <TabBar active={activeTab} onChange={handleTabChange} />

      {activeTab !== "blocks" && (
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px", flexWrap: "wrap" }}>
          <input
            type="text"
            value={filters.search}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
            placeholder="Search events..."
            style={{
              width: "min(320px, 100%)",
              height: "32px",
              padding: "0 10px",
              fontFamily: "var(--font-mono)",
              fontSize: "12px",
              color: "var(--color-text-primary)",
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-md)",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
          <button
            onClick={() => setFiltersOpen(true)}
            style={{
              height: "32px",
              padding: "0 10px",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-sm)",
              background: activeFilterCount > 0 ? "var(--color-accent-subtle)" : "var(--color-surface)",
              color: "var(--color-text-primary)",
              fontFamily: "var(--font-sans)",
              fontSize: "12px",
              cursor: "pointer",
            }}
          >
            Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
          </button>
          {activeFilterCount > 0 && (
            <button
              onClick={() => setFilters(EMPTY_FILTERS)}
              style={{ border: "none", background: "none", color: "var(--color-text-secondary)", fontFamily: "var(--font-sans)", fontSize: "12px", cursor: "pointer" }}
            >
              Clear filters
            </button>
          )}
          <div style={{ flex: 1 }} />
          <span style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)", whiteSpace: "nowrap" }}>
            {filteredEvents.length} event{filteredEvents.length !== 1 ? "s" : ""}
            {isPendingTab ? " · switching..." : ""}
          </span>
          {!selectMode && activeTab !== "timeline" && (
            <button
              onClick={handleEnterSelectMode}
              style={{ height: "32px", padding: "0 10px", border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", background: "var(--color-surface)", color: "var(--color-text-primary)", fontFamily: "var(--font-sans)", fontSize: "12px", cursor: "pointer" }}
            >
              Select
            </button>
          )}
          <button
            onClick={() => setPanel({ type: "add" })}
            style={{ height: "32px", padding: "0 10px", border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", background: "var(--color-accent)", color: "var(--color-text-inverse)", fontFamily: "var(--font-sans)", fontSize: "12px", cursor: "pointer" }}
          >
            Add event
          </button>
        </div>
      )}

      {error && (
        <div
          style={{
            padding: "10px 14px",
            background: "var(--color-danger-subtle)",
            border: "1px solid var(--color-danger)",
            borderRadius: "var(--radius-md)",
            color: "var(--color-danger)",
            fontFamily: "var(--font-sans)",
            fontSize: "13px",
            marginBottom: "20px",
          }}
        >
          {error}
        </div>
      )}

      {loading ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: "200px",
            color: "var(--color-text-tertiary)",
            fontFamily: "var(--font-sans)",
            fontSize: "13px",
          }}
        >
          Loading…
        </div>
      ) : (
        <>
          {visitedTabs.has("timeline") && (
            <div style={{ display: activeTab === "timeline" ? "block" : "none" }}>
              <EventTimeline
                events={filteredEvents}
                timeBlocks={timeBlocks}
                categories={categories}
                onEventClick={openEditPanel}
                onAddClick={() => setPanel({ type: "add" })}
              />
            </div>
          )}

          {visitedTabs.has("cards") && (
            <div style={{ display: activeTab === "cards" ? "block" : "none" }}>
              <EventCardGrid
                events={filteredEvents}
                categories={categories}
                onCardClick={openEditPanel}
                onAddClick={() => setPanel({ type: "add" })}
                hideFilters
                selectMode={selectMode}
                selectedIds={selectedIds}
                onToggleSelect={handleToggleSelect}
                onEnterSelectMode={handleEnterSelectMode}
              />
            </div>
          )}

          {visitedTabs.has("table") && (
            <div style={{ display: activeTab === "table" ? "block" : "none" }}>
              <EventTable
                events={filteredEvents}
                categories={categories}
                timeBlocks={timeBlocks}
                onUpdate={handleUpdateEvent}
                onCreateCategory={handleCreateCategory}
                onAddClick={() => setPanel({ type: "add" })}
                hideFilters
                selectMode={selectMode}
                selectedIds={selectedIds}
                onToggleSelect={handleToggleSelect}
                onEnterSelectMode={handleEnterSelectMode}
              />
            </div>
          )}

          {activeTab === "blocks" && (
            <TimeBlocksTable
              timeBlocks={timeBlocks}
              events={events}
              onAdd={handleAddBlock}
              onEdit={handleEditBlock}
              onDelete={handleDeleteClick}
            />
          )}
        </>
      )}

      <FiltersModal
        open={filtersOpen}
        filters={filters}
        categories={categories}
        buildings={buildingOptions}
        timeBlocks={timeBlocks}
        onChange={setFilters}
        onClear={() => setFilters(EMPTY_FILTERS)}
        onClose={() => setFiltersOpen(false)}
      />

      {/* ── Select mode floating toolbar ── */}
      {selectMode && (
        <div style={{
          position:       "fixed",
          bottom:         "28px",
          left:           "50%",
          transform:      "translateX(-50%)",
          zIndex:         200,
          display:        "flex",
          alignItems:     "center",
          gap:            "14px",
          padding:        "10px 18px",
          background:     "var(--color-surface)",
          border:         "1px solid var(--color-border)",
          borderRadius:   "var(--radius-lg)",
          boxShadow:      "var(--shadow-lg)",
          fontFamily:     "var(--font-sans)",
          fontSize:       "13px",
          whiteSpace:     "nowrap",
        }}>
          <span style={{ color: "var(--color-text-secondary)" }}>
            <strong style={{ color: "var(--color-text-primary)" }}>{selectedIds.size}</strong> selected
          </span>
          <div style={{ width: 1, height: 16, background: "var(--color-border)" }} />
          <button
            onClick={handleSelectAll}
            disabled={filteredIds.length === 0}
            style={{
              fontFamily: "var(--font-sans)",
              fontSize:   "13px",
              fontWeight: 500,
              color:      filteredIds.length === 0 ? "var(--color-text-tertiary)" : "var(--color-text-secondary)",
              background: "none",
              border:     "none",
              cursor:     filteredIds.length === 0 ? "default" : "pointer",
              padding:    0,
            }}
          >
            Select all
          </button>
          <div style={{ width: 1, height: 16, background: "var(--color-border)" }} />
          <button
            onClick={() => setPanel({ type: "multi-edit", ids: [...selectedIds] })}
            disabled={selectedIds.size === 0}
            style={{
              fontFamily:  "var(--font-sans)",
              fontSize:    "13px",
              fontWeight:  500,
              color:       selectedIds.size === 0 ? "var(--color-text-tertiary)" : "var(--color-accent)",
              background:  "none",
              border:      "none",
              cursor:      selectedIds.size === 0 ? "default" : "pointer",
              padding:     0,
            }}
          >
            Edit
          </button>
          <div style={{ width: 1, height: 16, background: "var(--color-border)" }} />
          <button
            onClick={handleExitSelectMode}
            style={{
              fontFamily: "var(--font-sans)",
              fontSize:   "16px",
              lineHeight: 1,
              color:      "var(--color-text-tertiary)",
              background: "none",
              border:     "none",
              cursor:     "pointer",
              padding:    "0 2px",
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* ── Event side panel ── */}
      {panel && (
        <EventSidePanel
          mode={panel.type === "multi-edit" ? "multi-edit" : panel.type}
          event={panel.type === "edit" ? panel.event : undefined}
          eventCount={panel.type === "multi-edit" ? panel.ids.length : undefined}
          timeBlocks={timeBlocks}
          categories={categories}
          onSave={handleSaveEvent}
          onMultiSave={handleMultiSave}
          onCreateCategory={handleCreateCategory}
          onClose={() => setPanel(null)}
        />
      )}

      {/* ── Delete block modal ── */}
      {deleteTarget && (
        <DeleteBlockModal
          block={deleteTarget}
          affectedEvents={affectedEvents}
          onConfirm={handleDeleteConfirm}
          onCancel={() => { setDeleteTarget(null); setAffectedEvents([]); }}
        />
      )}
    </div>
  );
}
