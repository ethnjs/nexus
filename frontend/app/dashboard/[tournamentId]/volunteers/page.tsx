"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { membershipsApi, Membership, User } from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/Badge";

// ─── Types ────────────────────────────────────────────────────────────────────

type MembershipWithUser = Membership & { user?: User };

type SortKey = "name" | "email" | "status" | "role_preference";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function displayName(user?: User) {
  if (!user) return "—";
  const full = [user.first_name, user.last_name].filter(Boolean).join(" ");
  return full || user.email;
}

function fmtList(items: string[] | null | undefined) {
  if (!items || items.length === 0) return "—";
  return items.join(", ");
}

function fmtVal(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) return v.length > 0 ? v.join(", ") : "—";
  return String(v);
}

const STATUS_VARIANT: Record<string, "interested" | "confirmed" | "declined" | "assigned" | "removed"> = {
  interested: "interested",
  confirmed:  "confirmed",
  declined:   "declined",
  assigned:   "assigned",
  removed:    "removed",
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function VolunteersPage() {
  const params = useParams();
  const tournamentId = Number(params.tournamentId);

  const [memberships, setMemberships] = useState<MembershipWithUser[]>([]);
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
        // User data is embedded by the list endpoint — no per-membership fetches needed.
        setMemberships(ms as MembershipWithUser[]);
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
    const name  = displayName(m.user).toLowerCase();
    const email = (m.user?.email ?? "").toLowerCase();
    return name.includes(q) || email.includes(q);
  });

  const sorted = [...filtered].sort((a, b) => {
    let av = "", bv = "";
    if (sortKey === "name")                 { av = displayName(a.user);              bv = displayName(b.user); }
    else if (sortKey === "email")           { av = a.user?.email ?? "";              bv = b.user?.email ?? ""; }
    else if (sortKey === "status")          { av = a.status;                         bv = b.status; }
    else if (sortKey === "role_preference") { av = (a.role_preference ?? []).join(); bv = (b.role_preference ?? []).join(); }
    return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
  });

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc((v) => !v);
    else { setSortKey(key); setSortAsc(true); }
  }

  // All extra_data keys across all memberships — no cap
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
                {/* ── Sortable ── */}
                <th style={thStyle} onClick={() => toggleSort("name")}>Name{arrow("name")}</th>
                <th style={thStyle} onClick={() => toggleSort("email")}>Email{arrow("email")}</th>
                <th style={thStyle} onClick={() => toggleSort("status")}>Status{arrow("status")}</th>
                <th style={thStyle} onClick={() => toggleSort("role_preference")}>Role Pref{arrow("role_preference")}</th>

                {/* ── User fields ── */}
                <th style={thPlain}>Phone</th>
                <th style={thPlain}>University</th>
                <th style={thPlain}>Major</th>
                <th style={thPlain}>Employer</th>
                <th style={thPlain}>Shirt Size</th>
                <th style={thPlain}>Dietary</th>

                {/* ── Membership fields ── */}
                <th style={thPlain}>Event Pref</th>
                <th style={thPlain}>Availability</th>
                <th style={thPlain}>Lunch</th>
                <th style={thPlain}>Positions</th>
                <th style={thPlain}>Assigned Event</th>
                <th style={thPlain}>Notes</th>

                {/* ── Extra data ── */}
                {extraKeys.map((k) => (
                  <th key={k} style={thPlain}>{k.replace(/_/g, " ")}</th>
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
                    {displayName(m.user)}
                  </td>

                  {/* Email */}
                  <td style={tdSec}>{m.user?.email ?? "—"}</td>

                  {/* Status */}
                  <td style={tdStyle}>
                    <Badge variant={STATUS_VARIANT[m.status] ?? "default"}>{m.status}</Badge>
                  </td>

                  {/* Role pref */}
                  <td style={tdSec}>{fmtList(m.role_preference)}</td>

                  {/* User fields */}
                  <td style={tdSec}>{m.user?.phone               ?? "—"}</td>
                  <td style={tdSec}>{m.user?.university           ?? "—"}</td>
                  <td style={tdSec}>{m.user?.major                ?? "—"}</td>
                  <td style={tdSec}>{m.user?.employer             ?? "—"}</td>
                  <td style={tdSec}>{m.user?.shirt_size           ?? "—"}</td>
                  <td style={tdSec}>{m.user?.dietary_restriction  ?? "—"}</td>

                  {/* Membership fields */}
                  <td style={tdSec}>{fmtList(m.event_preference)}</td>
                  <td style={tdSec}>
                    {m.availability && m.availability.length > 0
                      ? `${m.availability.length} slot${m.availability.length !== 1 ? "s" : ""}`
                      : "—"}
                  </td>
                  <td style={tdSec}>{m.lunch_order               ?? "—"}</td>
                  <td style={tdSec}>{fmtList(m.positions)}</td>
                  <td style={tdSec}>{m.assigned_event_id != null ? String(m.assigned_event_id) : "—"}</td>
                  <td style={{ ...tdSec, whiteSpace: "normal", maxWidth: "260px" }}>{m.notes ?? "—"}</td>

                  {/* Extra data — all keys */}
                  {extraKeys.map((k) => (
                    <td key={k} style={{ ...tdSec, whiteSpace: "normal", maxWidth: "200px" }}>{fmtVal(m.extra_data?.[k])}</td>
                  ))}
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