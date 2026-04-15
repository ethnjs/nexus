"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import {
  eventsApi,
  timeBlocksApi,
  categoriesApi,
  Event,
  TimeBlock,
  TournamentCategory,
} from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function fmtTime(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(":");
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12} ${period}` : `${h12}:${mStr} ${period}`;
}

export function fmtDate(yyyymmdd: string): string {
  const [, mo, d] = yyyymmdd.split("-").map(Number);
  return new Date(0, mo - 1, d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function fmtDateShort(yyyymmdd: string): string {
  const [, mo, d] = yyyymmdd.split("-").map(Number);
  return new Date(0, mo - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/** Returns the CSS var index (1–5) for a category by its position in the list. */
export function catColorIndex(idx: number): number {
  return (idx % 5) + 1;
}

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
        <UploadIcon />
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
        <SheetsIcon />
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

function CardsPlaceholder() {
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
      Cards view — coming soon
    </div>
  );
}

// ─── Inline icons ─────────────────────────────────────────────────────────────

function UploadIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 10V2M4 6l4-4 4 4" />
      <path d="M2 13h12" />
    </svg>
  );
}

function SheetsIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="12" height="12" rx="1.5" />
      <path d="M2 6h12M6 6v8" />
    </svg>
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
            <CardsPlaceholder />
          )}

          {activeTab === "blocks" && (
            // TimeBlocksTable wired in step 4
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
              Time Blocks table — coming soon
            </div>
          )}
        </>
      )}
    </div>
  );
}
