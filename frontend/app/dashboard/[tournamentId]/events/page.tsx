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
import { IconUpload, IconSheets } from "@/components/ui/Icons";
import { TimeBlocksTable } from "@/components/events/TimeBlocksTable";
import { DeleteBlockModal, AffectedEvent } from "@/components/events/DeleteBlockModal";
import { EventSidePanel } from "@/components/events/EventSidePanel";
import { EventCardGrid } from "@/components/events/EventCardGrid";

// ─── Tab type ─────────────────────────────────────────────────────────────────

type Tab = "timeline" | "cards" | "blocks";

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

// ─── Import bar ───────────────────────────────────────────────────────────────

function ImportBar() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "10px 14px",
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-md)",
        marginBottom: "20px",
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: "12px",
          fontWeight: 500,
          color: "var(--color-text-secondary)",
          marginRight: "4px",
        }}
      >
        Import
      </span>

      {/* CSV upload */}
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: "5px",
          fontFamily: "var(--font-sans)",
          fontSize: "12px",
          fontWeight: 500,
          color: "var(--color-text-primary)",
          background: "var(--color-accent-subtle)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-sm)",
          padding: "4px 10px",
          cursor: "pointer",
          transition: "background var(--transition-fast)",
          userSelect: "none",
        }}
      >
        <IconUpload size={12} />
        Upload CSV
        <input
          type="file"
          accept=".csv"
          style={{ display: "none" }}
          onChange={() => {
            // TODO: wire up CsvImportBar in step 14
          }}
        />
      </label>

      {/* Help icon */}
      <button
        title="CSV import help"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "22px",
          height: "22px",
          borderRadius: "50%",
          border: "1px solid var(--color-border)",
          background: "none",
          cursor: "pointer",
          color: "var(--color-text-tertiary)",
          fontFamily: "var(--font-sans)",
          fontSize: "11px",
          fontWeight: 600,
          flexShrink: 0,
        }}
      >
        ?
      </button>

      <div
        style={{
          width: "1px",
          height: "18px",
          background: "var(--color-border)",
          margin: "0 4px",
        }}
      />

      {/* Google Sheets — disabled until Sheets feature lands */}
      <button
        disabled
        title="Connect Google Sheets (coming soon)"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "5px",
          fontFamily: "var(--font-sans)",
          fontSize: "12px",
          fontWeight: 500,
          color: "var(--color-text-tertiary)",
          background: "none",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-sm)",
          padding: "4px 10px",
          cursor: "not-allowed",
          opacity: 0.6,
        }}
      >
        <IconSheets size={12} />
        Google Sheets
      </button>
    </div>
  );
}

// ─── Placeholder panels (replaced in subsequent steps) ────────────────────────

function TimelinePlaceholder() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "320px",
        border: "1px dashed var(--color-border)",
        borderRadius: "var(--radius-md)",
        color: "var(--color-text-tertiary)",
        fontFamily: "var(--font-sans)",
        fontSize: "13px",
      }}
    >
      Timeline view — coming soon
    </div>
  );
}


// ─── Inline icons ─────────────────────────────────────────────────────────────

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

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [evts, blocks, cats] = await Promise.all([
        eventsApi.listByTournament(tournamentId),
        timeBlocksApi.listByTournament(tournamentId),
        categoriesApi.listByTournament(tournamentId),
      ]);
      setEvents(evts);
      setTimeBlocks(blocks);
      setCategories(cats);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load events");
    } finally {
      setLoading(false);
    }
  }, [tournamentId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // ── Time block handlers ───────────────────────────────────────────────────

  const handleAddBlock = async (data: TimeBlockCreate) => {
    await timeBlocksApi.create(tournamentId, data);
    await loadAll();
  };

  const handleEditBlock = async (id: number, data: Partial<TimeBlockCreate>) => {
    await timeBlocksApi.update(tournamentId, id, data);
    await loadAll();
  };

  // ── Delete block (with 409 modal guard) ──────────────────────────────────

  // ── Event side panel ─────────────────────────────────────────────────────

  type PanelMode = { type: "add" } | { type: "edit"; event: Event } | null;
  const [panel, setPanel] = useState<PanelMode>(null);

  const handleSaveEvent = async (data: EventCreate) => {
    if (panel?.type === "edit") {
      await eventsApi.update(tournamentId, panel.event.id, data);
    } else {
      await eventsApi.create(tournamentId, data);
    }
    await loadAll();
  };

  const handleCreateCategory = async (name: string) => {
    const cat = await categoriesApi.create(tournamentId, name);
    await loadAll();
    return cat;
  };

  // ── Delete block ──────────────────────────────────────────────────────────

  const [deleteTarget,    setDeleteTarget]    = useState<TimeBlock | null>(null);
  const [affectedEvents,  setAffectedEvents]  = useState<AffectedEvent[]>([]);

  const handleDeleteClick = async (block: TimeBlock) => {
    try {
      await timeBlocksApi.delete(tournamentId, block.id);
      await loadAll();
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
    await loadAll();
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ position: "relative" }}>
      <PageHeader
        title="Events"
        subtitle="Manage tournament events, schedule time blocks, and track locations."
      />

      <ImportBar />

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
            <TimelinePlaceholder />
          )}

          {activeTab === "cards" && (
            <EventCardGrid
              events={events}
              categories={categories}
              onCardClick={(event) => setPanel({ type: "edit", event })}
              onAddClick={() => setPanel({ type: "add" })}
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

      {/* ── Event side panel ── */}
      {panel && (
        <EventSidePanel
          mode={panel.type}
          event={panel.type === "edit" ? panel.event : undefined}
          timeBlocks={timeBlocks}
          categories={categories}
          onSave={handleSaveEvent}
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
