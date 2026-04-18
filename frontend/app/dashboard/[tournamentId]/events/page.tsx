"use client";

import { useEffect, useState, useCallback } from "react";
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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function EventsPage() {
  const params = useParams();
  const tournamentId = Number(params.tournamentId);

  const [activeTab, setActiveTab] = useState<Tab>("timeline");

  // Data
  const [events,     setEvents]     = useState<Event[]>([]);
  const [timeBlocks, setTimeBlocks] = useState<TimeBlock[]>([]);
  const [categories, setCategories] = useState<TournamentCategory[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);

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

  // Keep panel.event in sync with fresh data after any silent refresh
  useEffect(() => {
    setPanel((prev) => {
      if (prev?.type !== "edit") return prev;
      const updated = events.find((e) => e.id === prev.event.id);
      return updated ? { type: "edit", event: updated } : prev;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const handleSaveEvent = async (data: EventCreate) => {
    if (panel?.type === "edit") {
      const updated = await eventsApi.update(tournamentId, panel.event.id, data);
      patchEventsState(updated);
    } else {
      await eventsApi.create(tournamentId, data);
      await loadAll(true);
    }
  };

  const handleMultiSave = async (data: Partial<EventCreate>) => {
    if (panel?.type !== "multi-edit") return;
    await Promise.all(panel.ids.map((id) => eventsApi.update(tournamentId, id, data)));
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

  const handleEnterSelectMode = () => setSelectMode(true);
  const handleExitSelectMode  = () => { setSelectMode(false); setSelectedIds(new Set()); };
  const handleToggleSelect    = (id: number) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

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

      <TabBar active={activeTab} onChange={setActiveTab} />

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
          {activeTab === "timeline" && (
            <EventTimeline
              events={events}
              timeBlocks={timeBlocks}
              categories={categories}
              onEventClick={openEditPanel}
              onAddClick={() => setPanel({ type: "add" })}
            />
          )}

          {activeTab === "cards" && (
            <EventCardGrid
              events={events}
              categories={categories}
              onCardClick={openEditPanel}
              onAddClick={() => setPanel({ type: "add" })}
              selectMode={selectMode}
              selectedIds={selectedIds}
              onToggleSelect={handleToggleSelect}
              onEnterSelectMode={handleEnterSelectMode}
            />
          )}

          {activeTab === "table" && (
            <EventTable
              events={events}
              categories={categories}
              timeBlocks={timeBlocks}
              onUpdate={handleUpdateEvent}
              onCreateCategory={handleCreateCategory}
              onAddClick={() => setPanel({ type: "add" })}
              selectMode={selectMode}
              selectedIds={selectedIds}
              onToggleSelect={handleToggleSelect}
              onEnterSelectMode={handleEnterSelectMode}
            />
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
