"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { useTournament } from "@/lib/useTournament";
import { useMyMembership } from "@/lib/useMyMembership";
import { setupChecklistApi, SetupChecklistItem, SetupChecklistResponse } from "@/lib/api";
import { IconCheckCircle } from "@/components/ui/Icons";

// ─── Checklist config ───────────────────────────────────────────────────────
// Steps H (settings shell), J (roles editor), K (staff invite modal) build the
// targets below — dates/location/roles routes 404 until Step H/J land.

interface ChecklistConfigEntry {
  buildable: boolean;
  onClick: ((router: ReturnType<typeof useRouter>, tournamentId: string) => void) | null;
}

const CHECKLIST_CONFIG: Record<string, ChecklistConfigEntry> = {
  dates:        { buildable: true,  onClick: (r, id) => r.push(`/dashboard/tournaments/${id}/settings/general`) },
  location:     { buildable: true,  onClick: (r, id) => r.push(`/dashboard/tournaments/${id}/settings/visibility`) },
  roles:        { buildable: true,  onClick: (r, id) => r.push(`/dashboard/tournaments/${id}/settings/roles`) },
  // Step K builds the staff-invite modal — no target to wire yet.
  invite_staff: { buildable: false, onClick: null },
  onboarding:   { buildable: false, onClick: null },
  events:       { buildable: false, onClick: null },
  shifts:       { buildable: false, onClick: null },
  buildings:    { buildable: false, onClick: null },
};

// ─── Meter ──────────────────────────────────────────────────────────────────

function ChecklistMeter({ completed, total }: { completed: number; total: number }) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div style={{ marginBottom: "24px" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: "8px" }}>
        <span style={{ fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 600, color: "var(--color-text-primary)" }}>
          Setup progress
        </span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--color-text-secondary)" }}>
          {completed} / {total} complete
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={completed}
        aria-valuemin={0}
        aria-valuemax={total}
        style={{
          height: "8px",
          borderRadius: "var(--radius-sm)",
          background: "var(--color-accent-subtle)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            background: "var(--color-accent)",
            borderRadius: "var(--radius-sm)",
            transition: "width 200ms ease",
          }}
        />
      </div>
    </div>
  );
}

// ─── Checklist card ─────────────────────────────────────────────────────────

function ChecklistCard({
  item,
  onClick,
}: {
  item: SetupChecklistItem;
  onClick: (() => void) | null;
}) {
  const [hovered, setHovered] = useState(false);
  const clickable = onClick !== null;
  const complete = item.status === "complete";

  return (
    <div
      onClick={clickable ? onClick : undefined}
      onMouseEnter={() => clickable && setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: "var(--color-surface)",
        border: `1px solid ${hovered ? "var(--color-border-strong)" : "var(--color-border)"}`,
        borderRadius: "var(--radius-md)",
        padding: "16px 18px",
        cursor: clickable ? "pointer" : "default",
        opacity: clickable ? 1 : 0.55,
        boxShadow: hovered ? "var(--shadow-md)" : "var(--shadow-sm)",
        transition: "border-color 120ms ease, box-shadow 120ms ease",
        display: "flex", alignItems: "center", gap: "10px",
      }}
    >
      {complete ? (
        <IconCheckCircle size={18} style={{ color: "var(--color-success)", flexShrink: 0 }} />
      ) : (
        <div style={{
          width: "18px", height: "18px", borderRadius: "50%",
          border: "1.5px solid var(--color-border-strong)", flexShrink: 0,
        }} />
      )}
      <div>
        <div style={{ fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 500, color: "var(--color-text-primary)" }}>
          {item.label}
        </div>
        {!clickable && (
          <div style={{ fontFamily: "var(--font-sans)", fontSize: "11px", color: "var(--color-text-tertiary)", marginTop: "2px" }}>
            Coming soon
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function OverviewPage() {
  const router = useRouter();
  const params = useParams();
  const tournamentId = params.id as string;
  const { selectedTournament } = useTournament();
  const { membership, hasPermission, loading: membershipLoading } = useMyMembership();

  const [checklist, setChecklist] = useState<SetupChecklistResponse | null>(null);

  const canSeeChecklist = !!membership && (membership.is_owner || hasPermission("manage_tournament"));

  useEffect(() => {
    if (!canSeeChecklist) return;
    setupChecklistApi.get(Number(tournamentId)).then(setChecklist).catch(() => setChecklist(null));
  }, [canSeeChecklist, tournamentId]);

  const fmt = (d: string) =>
    new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  const dateRange = selectedTournament?.start_date
    ? selectedTournament.end_date && selectedTournament.end_date !== selectedTournament.start_date
      ? `${fmt(selectedTournament.start_date)} – ${fmt(selectedTournament.end_date)}`
      : fmt(selectedTournament.start_date)
    : null;

  return (
    <div>
      <h1 style={{ fontSize: "28px", lineHeight: 1.2, marginBottom: "4px" }}>
        {selectedTournament?.name ?? "—"}
      </h1>
      <div style={{ display: "flex", gap: "12px", alignItems: "center", marginBottom: "28px" }}>
        {selectedTournament?.location && (
          <span style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)" }}>
            {selectedTournament.location}
          </span>
        )}
        {dateRange && (
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--color-text-tertiary)" }}>
            {dateRange}
          </span>
        )}
      </div>

      {!membershipLoading && canSeeChecklist && checklist && (
        <>
          <ChecklistMeter completed={checklist.completed_count} total={checklist.total_count} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "10px" }}>
            {checklist.items.map((item) => {
              const config = CHECKLIST_CONFIG[item.item_key];
              const onClick = config?.buildable && config.onClick
                ? () => config.onClick!(router, tournamentId)
                : null;
              return <ChecklistCard key={item.item_key} item={item} onClick={onClick} />;
            })}
          </div>
        </>
      )}
    </div>
  );
}
