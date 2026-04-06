"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { membershipsApi, Membership } from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/Badge";

// ─── Types ────────────────────────────────────────────────────────────────────

type SortKey = "name" | "email" | "status" | "role_preference";

interface AvailabilitySlot {
  date:  string; // "YYYY-MM-DD"
  start: string; // "HH:MM"
  end:   string; // "HH:MM"
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function displayName(m: Pick<Membership, "first_name" | "last_name" | "email">) {
  const full = [m.first_name, m.last_name].filter(Boolean).join(" ");
  return full || m.email || "—";
}

function fmtVal(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) return v.length > 0 ? v.join(", ") : "—";
  return String(v);
}

function fmtTime(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(":");
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  const period = h >= 12 ? "PM" : "AM";
  const h12    = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12} ${period}` : `${h12}:${mStr} ${period}`;
}

function fmtDate(yyyymmdd: string): string {
  // Parse without timezone shift
  const [, m, d] = yyyymmdd.split("-").map(Number);
  return new Date(0, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const STATUS_VARIANT: Record<string, "interested" | "confirmed" | "declined" | "assigned" | "removed"> = {
  interested: "interested",
  confirmed:  "confirmed",
  declined:   "declined",
  assigned:   "assigned",
  removed:    "removed",
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function TagList({ items }: { items: string[] }) {
  if (!items || items.length === 0) return <span style={{ color: "var(--color-text-tertiary)", fontFamily: "var(--font-mono)", fontSize: "12px" }}>—</span>;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
      {items.map((item) => (
        <span
          key={item}
          style={{
            fontFamily:   "var(--font-sans)",
            fontSize:     "11px",
            color:        "var(--color-text-secondary)",
            background:   "var(--color-bg)",
            border:       "1px solid var(--color-border)",
            borderRadius: "var(--radius-sm)",
            padding:      "1px 7px",
            whiteSpace:   "nowrap",
          }}
        >
          {item}
        </span>
      ))}
    </div>
  );
}

function AvailabilityCell({ slots }: { slots: AvailabilitySlot[] | null | undefined }) {
  if (!slots || slots.length === 0) {
    return <span style={{ color: "var(--color-text-tertiary)", fontFamily: "var(--font-mono)", fontSize: "12px" }}>—</span>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
      {slots.map((slot, i) => (
        <div key={i} style={{ display: "flex", gap: "8px", alignItems: "baseline" }}>
          <span style={{
            fontFamily:  "var(--font-sans)",
            fontSize:    "12px",
            fontWeight:  500,
            color:       "var(--color-text-primary)",
            flexShrink:  0,
            minWidth:    "52px",
          }}>
            {fmtDate(slot.date)}
          </span>
          <span style={{
            fontFamily: "var(--font-mono)",
            fontSize:   "11px",
            color:      "var(--color-text-secondary)",
            whiteSpace: "nowrap",
          }}>
            {fmtTime(slot.start)}–{fmtTime(slot.end)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function VolunteersPage() {
  const params = useParams();
  const tournamentId = Number(params.tournamentId);

  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState("");
  const [search, setSearch]           = useState("");
  const [sortKey, setSortKey]         = useState<SortKey>("name");
  const [sortAsc, setSortAsc]         = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError("");
      try {
        const ms = await membershipsApi.listByTournament(tournamentId);
        setMemberships(ms);
      } catch {
        setError("Failed to load volunteers.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [tournamentId]);

  // ── Filter + sort ─────────────────────────────────────────────────────────

  const q = search.toLowerCase();

  const filtered = memberships.filter((m) => {
    if (statusFilter !== "all" && m.status !== statusFilter) return false;
    if (!q) return true;
    const name  = displayName(m).toLowerCase();
    const email = (m.email ?? "").toLowerCase();
    return name.includes(q) || email.includes(q);
  });

  const sorted = [...filtered].sort((a, b) => {
    let av = "", bv = "";
    if (sortKey === "name")                 { av = displayName(a);              bv = displayName(b); }
    else if (sortKey === "email")           { av = a.email ?? "";              bv = b.email ?? ""; }
    else if (sortKey === "status")          { av = a.status;                         bv = b.status; }
    else if (sortKey === "role_preference") { av = (a.role_preference ?? []).join(); bv = (b.role_preference ?? []).join(); }
    return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
  });

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc((v) => !v);
    else { setSortKey(key); setSortAsc(true); }
  }

  const extraKeys = Array.from(
    new Set(memberships.flatMap((m) => Object.keys(m.extra_data ?? {})))
  ).sort();

  // ── Styles ────────────────────────────────────────────────────────────────

  const thStyle: React.CSSProperties = {
    fontFamily: "var(--font-sans)", fontSize: "10px", fontWeight: 600,
    textTransform: "uppercase", letterSpacing: "0.07em",
    color: "var(--color-text-tertiary)", padding: "8px 14px",
    textAlign: "left", whiteSpace: "nowrap", cursor: "pointer",
    userSelect: "none", background: "var(--color-bg)",
  };

  const thPlain: React.CSSProperties = { ...thStyle, cursor: "default" };

  const tdStyle: React.CSSProperties = {
    fontFamily: "var(--font-mono)", fontSize: "12px",
    color: "var(--color-text-primary)", padding: "10px 14px",
    borderTop: "1px solid var(--color-border)", verticalAlign: "top",
    whiteSpace: "nowrap",
  };

  const tdSec: React.CSSProperties = { ...tdStyle, color: "var(--color-text-secondary)" };

  const arrow = (key: SortKey) => sortKey === key ? (sortAsc ? " ↑" : " ↓") : "";

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ width: "100%" }}>
      <PageHeader
        title="Volunteers"
        subtitle={loading ? "" : `${filtered.length} of ${memberships.length} volunteer${memberships.length !== 1 ? "s" : ""}`}
      />

      {/* ── Toolbar ── */}
      <div style={{ display: "flex", gap: "10px", marginBottom: "16px", flexWrap: "wrap" }}>
        <input
          type="search"
          placeholder="Search name or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            height: "34px", padding: "0 12px",
            border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)",
            fontFamily: "var(--font-sans)", fontSize: "13px",
            color: "var(--color-text-primary)", background: "var(--color-surface)",
            outline: "none", width: "240px",
          }}
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{
            height: "34px", padding: "0 10px",
            border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)",
            fontFamily: "var(--font-sans)", fontSize: "13px",
            color: "var(--color-text-primary)", background: "var(--color-surface)",
            outline: "none", cursor: "pointer",
          }}
        >
          <option value="all">All statuses</option>
          <option value="interested">Interested</option>
          <option value="confirmed">Confirmed</option>
          <option value="assigned">Assigned</option>
          <option value="declined">Declined</option>
          <option value="removed">Removed</option>
        </select>
      </div>

      {/* ── States ── */}
      {loading && (
        <div style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-tertiary)", padding: "40px 0", textAlign: "center" }}>
          Loading volunteers…
        </div>
      )}
      {error && (
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)" }}>{error}</p>
      )}
      {!loading && !error && memberships.length === 0 && (
        <div style={{ border: "1px dashed var(--color-border)", borderRadius: "var(--radius-lg)", background: "var(--color-surface)", padding: "60px 0", textAlign: "center" }}>
          <p style={{ fontFamily: "Georgia, serif", fontSize: "20px", color: "var(--color-text-primary)", marginBottom: "6px" }}>No volunteers yet</p>
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)" }}>
            Sync a Google Sheet to start importing volunteer responses.
          </p>
        </div>
      )}

      {/* ── Table ── */}
      {!loading && !error && sorted.length > 0 && (
        <div style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)", overflowX: "auto", background: "var(--color-surface)" }}>
          <table style={{ borderCollapse: "collapse", minWidth: "100%" }}>
            <thead>
              <tr>
                {/* Sortable */}
                <th style={thStyle} onClick={() => toggleSort("name")}>Name{arrow("name")}</th>
                <th style={thStyle} onClick={() => toggleSort("email")}>Email{arrow("email")}</th>
                <th style={thStyle} onClick={() => toggleSort("status")}>Status{arrow("status")}</th>
                <th style={thStyle} onClick={() => toggleSort("role_preference")}>Role Pref{arrow("role_preference")}</th>

                {/* User fields */}
                <th style={thPlain}>Phone</th>
                <th style={thPlain}>University</th>
                <th style={thPlain}>Student Status</th>
                <th style={thPlain}>Major</th>
                <th style={thPlain}>Employer</th>
                <th style={thPlain}>Student Status</th>
                <th style={thPlain}>Shirt Size</th>
                <th style={thPlain}>Dietary</th>

                {/* Membership fields */}
                <th style={thPlain}>Event Pref</th>
                <th style={{ ...thPlain, minWidth: "160px" }}>Availability</th>
                <th style={thPlain}>Lunch</th>
                <th style={thPlain}>Positions</th>
                <th style={thPlain}>Assigned Event</th>
                <th style={thPlain}>Notes</th>

                {/* Extra data — wider columns */}
                {extraKeys.map((k) => (
                  <th key={k} style={{ ...thPlain, minWidth: "240px" }}>{k.replace(/_/g, " ")}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((m) => (
                <tr
                  key={m.id}
                  style={{ background: "var(--color-surface)" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--color-bg)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--color-surface)"; }}
                >
                  {/* Name */}
                  <td style={{ ...tdStyle, fontFamily: "var(--font-sans)", fontWeight: 500 }}>
                    {displayName(m)}
                  </td>

                  {/* Email */}
                  <td style={tdSec}>{m.email ?? "—"}</td>

                  {/* Status */}
                  <td style={tdStyle}>
                    <Badge variant={STATUS_VARIANT[m.status] ?? "default"}>{m.status}</Badge>
                  </td>

                  {/* Role pref — tags */}
                  <td style={{ ...tdStyle, whiteSpace: "normal", minWidth: "160px" }}>
                    <TagList items={m.role_preference ?? []} />
                  </td>

                  {/* User fields */}
                  <td style={tdSec}>{m.phone           ?? "—"}</td>
                  <td style={tdSec}>{m.university            ?? "—"}</td>
                  <td style={tdSec}>{m.student_status        ?? "—"}</td>
                  <td style={tdSec}>{m.major                 ?? "—"}</td>
                  <td style={tdSec}>{m.employer              ?? "—"}</td>
                  <td style={tdSec}>{m.shirt_size            ?? "—"}</td>
                  <td style={tdSec}>{m.dietary_restriction   ?? "—"}</td>

                  {/* Event pref — tags */}
                  <td style={{ ...tdStyle, whiteSpace: "normal", minWidth: "200px" }}>
                    <TagList items={m.event_preference ?? []} />
                  </td>

                  {/* Availability — stacked date + time rows */}
                  <td style={{ ...tdStyle, whiteSpace: "normal", minWidth: "160px" }}>
                    <AvailabilityCell slots={m.availability as AvailabilitySlot[] | null} />
                  </td>

                  {/* Lunch */}
                  <td style={tdSec}>
                    {m.lunch_order == null
                      ? "—"
                      : typeof m.lunch_order === "object"
                        ? Object.entries(m.lunch_order).map(([k, v]) => `${k}: ${v}`).join(", ")
                        : m.lunch_order}
                  </td>

                  {/* Positions — tags */}
                  <td style={{ ...tdStyle, whiteSpace: "normal", minWidth: "160px" }}>
                    <TagList items={m.positions ?? []} />
                  </td>

                  <td style={tdSec}>{m.assigned_event_id != null ? String(m.assigned_event_id) : "—"}</td>
                  <td style={{ ...tdSec, whiteSpace: "normal", maxWidth: "260px" }}>{m.notes ?? "—"}</td>

                  {/* Extra data — wider, wrapping */}
                  {extraKeys.map((k) => {
                    const v = m.extra_data?.[k];
                    const isArr = Array.isArray(v);
                    return (
                      <td key={k} style={{ ...tdStyle, whiteSpace: "normal", minWidth: "240px", maxWidth: "360px", verticalAlign: "top" }}>
                        {isArr
                          ? <TagList items={v as string[]} />
                          : <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--color-text-secondary)" }}>{fmtVal(v)}</span>
                        }
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* No results after filter */}
      {!loading && !error && memberships.length > 0 && sorted.length === 0 && (
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-tertiary)", padding: "24px 0" }}>
          No volunteers match your search.
        </p>
      )}
    </div>
  );
}