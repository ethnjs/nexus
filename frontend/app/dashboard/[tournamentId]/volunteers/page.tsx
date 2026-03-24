"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { membershipsApi, usersApi, Membership, User } from "@/lib/api";
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

        // Fetch users in parallel for display names / emails
        const withUsers = await Promise.all(
          ms.map(async (m) => {
            try {
              const user = await usersApi.getForTournament(tournamentId, m.user_id);
              return { ...m, user };
            } catch {
              return { ...m };
            }
          })
        );
        setMemberships(withUsers);
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
    if (sortKey === "name")            { av = displayName(a.user); bv = displayName(b.user); }
    else if (sortKey === "email")      { av = a.user?.email ?? ""; bv = b.user?.email ?? ""; }
    else if (sortKey === "status")     { av = a.status; bv = b.status; }
    else if (sortKey === "role_preference") {
      av = (a.role_preference ?? []).join(",");
      bv = (b.role_preference ?? []).join(",");
    }
    return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
  });

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc((v) => !v);
    else { setSortKey(key); setSortAsc(true); }
  }

  // ── Derive extra_data keys present across all memberships ─────────────────

  const extraKeys = Array.from(
    new Set(memberships.flatMap((m) => Object.keys(m.extra_data ?? {})))
  ).slice(0, 4); // cap at 4 columns to avoid blowing out the table

  // ── Render ────────────────────────────────────────────────────────────────

  const thStyle: React.CSSProperties = {
    fontFamily: "var(--font-sans)", fontSize: "10px", fontWeight: 600,
    textTransform: "uppercase", letterSpacing: "0.07em",
    color: "var(--color-text-tertiary)", padding: "8px 14px",
    textAlign: "left", whiteSpace: "nowrap", cursor: "pointer",
    userSelect: "none",
  };

  const tdStyle: React.CSSProperties = {
    fontFamily: "var(--font-mono)", fontSize: "12px",
    color: "var(--color-text-primary)", padding: "10px 14px",
    borderTop: "1px solid var(--color-border)", verticalAlign: "top",
  };

  const arrow = (key: SortKey) =>
    sortKey === key ? (sortAsc ? " ↑" : " ↓") : "";

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
        <div style={{
          border: "1px dashed var(--color-border)", borderRadius: "var(--radius-lg)",
          background: "var(--color-surface)", padding: "60px 0",
          textAlign: "center",
        }}>
          <p style={{ fontFamily: "Georgia, serif", fontSize: "20px", color: "var(--color-text-primary)", marginBottom: "6px" }}>
            No volunteers yet
          </p>
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)" }}>
            Sync a Google Sheet to start importing volunteer responses.
          </p>
        </div>
      )}

      {/* ── Table ── */}
      {!loading && !error && sorted.length > 0 && (
        <div style={{
          border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)",
          overflow: "auto", background: "var(--color-surface)",
        }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "700px" }}>
            <thead>
              <tr style={{ background: "var(--color-bg)" }}>
                <th style={thStyle} onClick={() => toggleSort("name")}>Name{arrow("name")}</th>
                <th style={thStyle} onClick={() => toggleSort("email")}>Email{arrow("email")}</th>
                <th style={thStyle} onClick={() => toggleSort("status")}>Status{arrow("status")}</th>
                <th style={thStyle} onClick={() => toggleSort("role_preference")}>Role Pref{arrow("role_preference")}</th>
                <th style={thStyle}>Event Pref</th>
                <th style={thStyle}>Availability</th>
                {extraKeys.map((k) => (
                  <th key={k} style={thStyle}>{k.replace(/_/g, " ")}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((m) => (
                <tr key={m.id} style={{ background: "var(--color-surface)" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--color-bg)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--color-surface)"; }}
                >
                  <td style={{ ...tdStyle, fontFamily: "var(--font-sans)", fontWeight: 500 }}>
                    {displayName(m.user)}
                  </td>
                  <td style={{ ...tdStyle, color: "var(--color-text-secondary)" }}>
                    {m.user?.email ?? "—"}
                  </td>
                  <td style={tdStyle}>
                    <Badge variant={STATUS_VARIANT[m.status] ?? "default"}>
                      {m.status}
                    </Badge>
                  </td>
                  <td style={{ ...tdStyle, color: "var(--color-text-secondary)" }}>
                    {fmtList(m.role_preference)}
                  </td>
                  <td style={{ ...tdStyle, color: "var(--color-text-secondary)" }}>
                    {fmtList(m.event_preference)}
                  </td>
                  <td style={{ ...tdStyle, color: "var(--color-text-secondary)" }}>
                    {m.availability && m.availability.length > 0
                      ? `${m.availability.length} slot${m.availability.length !== 1 ? "s" : ""}`
                      : "—"}
                  </td>
                  {extraKeys.map((k) => (
                    <td key={k} style={{ ...tdStyle, color: "var(--color-text-secondary)" }}>
                      {m.extra_data?.[k] != null
                        ? String(m.extra_data[k])
                        : "—"}
                    </td>
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