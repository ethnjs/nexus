"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { tournamentsApi, eventsApi, membershipsApi, Tournament } from "@/lib/api";
import { useAuth } from "@/lib/useAuth";
import { IconPlus, IconCalendar, IconLocation, IconLogout, IconArrowDown } from "@/components/ui/Icons";

// ─── Topbar (dashboard-level, no sidebar) ────────────────────────────────────

function DashboardTopbar() {
  const { user, logout } = useAuth();
  const [userOpen, setUserOpen] = useState(false);
  const userRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (userRef.current && !userRef.current.contains(e.target as Node)) setUserOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const initials = user
    ? (`${user.first_name?.[0] ?? ""}${user.last_name?.[0] ?? ""}`).toUpperCase() || user.email[0].toUpperCase()
    : "?";

  return (
    <header style={{
      height: "52px",
      background: "var(--color-surface)",
      borderBottom: "1px solid var(--color-border)",
      display: "flex", alignItems: "center",
      paddingLeft: "24px", paddingRight: "24px",
      flexShrink: 0,
    }}>
      <span style={{
        fontFamily: "var(--font-serif)", fontSize: "15px",
        letterSpacing: "0.18em", textTransform: "uppercase",
        color: "var(--color-text-primary)", userSelect: "none",
      }}>
        NEXUS
      </span>

      <div style={{ flex: 1 }} />

      <div ref={userRef} style={{ position: "relative" }}>
        <button
          onClick={() => setUserOpen((v) => !v)}
          style={{
            width: "32px", height: "32px", borderRadius: "50%",
            background: "var(--color-accent)", color: "var(--color-text-inverse)",
            border: "none", fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 700,
            letterSpacing: "0.05em", display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer",
          }}
        >
          {initials}
        </button>

        {userOpen && (
          <div style={{
            position: "absolute", top: "calc(100% + 8px)", right: 0, width: "220px",
            background: "var(--color-surface)", border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)",
            overflow: "hidden", zIndex: 100,
          }}>
            <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--color-border)" }}>
              <div style={{ fontFamily: "var(--font-sans)", fontSize: "14px", fontWeight: 600, color: "var(--color-text-primary)" }}>
                {user?.first_name && user?.last_name ? `${user.first_name} ${user.last_name}` : user?.email}
              </div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--color-text-tertiary)", marginTop: "3px" }}>
                {user?.email}
              </div>
              <div style={{ marginTop: "8px" }}>
                <span style={{
                  fontFamily: "var(--font-sans)", fontSize: "10px", fontWeight: 600,
                  textTransform: "uppercase", letterSpacing: "0.07em",
                  color: "var(--color-text-secondary)", background: "var(--color-accent-subtle)",
                  padding: "2px 7px", borderRadius: "var(--radius-sm)",
                }}>
                  {user?.role}
                </span>
              </div>
            </div>
            <button
              onClick={() => { setUserOpen(false); logout(); }}
              style={{
                display: "flex", alignItems: "center", gap: "8px",
                width: "100%", padding: "11px 16px",
                border: "none", background: "transparent",
                fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 500,
                color: "var(--color-danger)", cursor: "pointer",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--color-danger-subtle)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              <IconLogout />
              Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

// ─── New Tournament Modal ─────────────────────────────────────────────────────

const fieldLabel: React.CSSProperties = {
  fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 600,
  textTransform: "uppercase", letterSpacing: "0.07em",
  color: "var(--color-text-tertiary)", display: "block", marginBottom: "6px",
};
const inputStyle: React.CSSProperties = {
  width: "100%", height: "44px", padding: "0 14px",
  border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)",
  fontFamily: "var(--font-sans)", fontSize: "14px",
  color: "var(--color-text-primary)", background: "var(--color-bg)",
  outline: "none", boxSizing: "border-box",
};

function NewTournamentModal({ onClose, onCreated }: { onClose: () => void; onCreated: (t: Tournament) => void }) {
  const [name, setName]           = useState("");
  const [location, setLocation]   = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate]     = useState("");
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError("Name is required"); return; }
    setLoading(true); setError("");
    try {
      const t = await tournamentsApi.create({
        name: name.trim(),
        location: location.trim() || null,
        start_date: startDate || null,
        end_date: endDate || null,
        blocks: [],
      });
      onCreated(t);
    } catch { setError("Failed to create tournament"); }
    finally { setLoading(false); }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-lg)", padding: "28px", width: "440px", maxWidth: "calc(100vw - 32px)", boxShadow: "var(--shadow-lg)" }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ fontFamily: "var(--font-serif)", fontSize: "22px", color: "var(--color-text-primary)", marginBottom: "20px" }}>New Tournament</h2>
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <div><label style={fieldLabel}>Name *</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 2026 Nationals @ USC" style={inputStyle} autoFocus /></div>
          <div><label style={fieldLabel}>Location</label><input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. USC, Los Angeles CA" style={inputStyle} /></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <div><label style={fieldLabel}>Start Date</label><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={{ ...inputStyle, padding: "0 12px" }} /></div>
            <div><label style={fieldLabel}>End Date</label><input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={{ ...inputStyle, padding: "0 12px" }} /></div>
          </div>
          {error && <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)" }}>{error}</p>}
          <div style={{ display: "flex", gap: "10px", marginTop: "4px" }}>
            <button type="button" onClick={onClose} style={{ flex: 1, height: "44px", border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)", fontFamily: "var(--font-sans)", fontSize: "14px", fontWeight: 500, color: "var(--color-text-secondary)", background: "transparent", cursor: "pointer" }}>Cancel</button>
            <button type="submit" disabled={loading} style={{ flex: 1, height: "44px", border: "none", borderRadius: "var(--radius-md)", fontFamily: "var(--font-sans)", fontSize: "14px", fontWeight: 600, color: "#fff", background: loading ? "var(--color-text-tertiary)" : "var(--color-accent)", cursor: loading ? "not-allowed" : "pointer" }}>{loading ? "Creating…" : "Create"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Tournament Card ──────────────────────────────────────────────────────────

interface CardCounts { events: number | null; volunteers: number | null; }

function TournamentCard({ tournament, counts, onClick }: { tournament: Tournament; counts: CardCounts; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);

  const fmt = (d: string) =>
    new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  const dateRange = tournament.start_date
    ? tournament.end_date && tournament.end_date !== tournament.start_date
      ? `${fmt(tournament.start_date)} – ${fmt(tournament.end_date)}`
      : fmt(tournament.start_date)
    : null;

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: "var(--color-surface)",
        border: `1px solid ${hovered ? "var(--color-border-strong)" : "var(--color-border)"}`,
        borderRadius: "var(--radius-lg)", padding: "22px 24px",
        textAlign: "left", cursor: "pointer", width: "100%",
        transition: "border-color var(--transition-fast), box-shadow var(--transition-fast), transform var(--transition-fast)",
        boxShadow: hovered ? "var(--shadow-md)" : "var(--shadow-sm)",
        transform: hovered ? "translateY(-1px)" : "none",
        display: "flex", flexDirection: "column", gap: "14px",
      }}
    >
      <h3 style={{ fontFamily: "var(--font-serif)", fontSize: "19px", fontWeight: 400, color: "var(--color-text-primary)", lineHeight: 1.25 }}>
        {tournament.name}
      </h3>
      <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
        {tournament.location && (
          <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "var(--color-text-secondary)" }}>
            <IconLocation />
            <span style={{ fontFamily: "var(--font-sans)", fontSize: "13px" }}>{tournament.location}</span>
          </div>
        )}
        {dateRange && (
          <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "var(--color-text-tertiary)" }}>
            <IconCalendar />
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px" }}>{dateRange}</span>
          </div>
        )}
      </div>
      <div style={{ paddingTop: "14px", borderTop: "1px solid var(--color-border)", display: "flex", gap: "20px" }}>
        <div>
          <div style={{ fontFamily: "var(--font-serif)", fontSize: "22px", color: "var(--color-text-primary)", lineHeight: 1 }}>
            {counts.events === null ? "—" : counts.events}
          </div>
          <div style={{ fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 500, color: "var(--color-text-tertiary)", marginTop: "3px", textTransform: "uppercase", letterSpacing: "0.06em" }}>Events</div>
        </div>
        <div style={{ width: "1px", background: "var(--color-border)" }} />
        <div>
          <div style={{ fontFamily: "var(--font-serif)", fontSize: "22px", color: "var(--color-text-primary)", lineHeight: 1 }}>
            {counts.volunteers === null ? "—" : counts.volunteers}
          </div>
          <div style={{ fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 500, color: "var(--color-text-tertiary)", marginTop: "3px", textTransform: "uppercase", letterSpacing: "0.06em" }}>Volunteers</div>
        </div>
      </div>
    </button>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const router = useRouter();
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [counts, setCounts]           = useState<Record<number, CardCounts>>({});
  const [loading, setLoading]         = useState(true);
  const [showModal, setShowModal]     = useState(false);

  useEffect(() => {
    tournamentsApi.list().then((data) => {
      setTournaments(data);
      setLoading(false);
      data.forEach((t) => {
        Promise.all([
          eventsApi.listByTournament(t.id).then((e) => e.length).catch(() => 0),
          membershipsApi.listByTournament(t.id).then((m) => m.length).catch(() => 0),
        ]).then(([events, volunteers]) => {
          setCounts((prev) => ({ ...prev, [t.id]: { events, volunteers } }));
        });
      });
    }).catch(() => setLoading(false));
  }, []);

  function handleCreated(t: Tournament) {
    setTournaments((prev) => [...prev, t]);
    setCounts((prev) => ({ ...prev, [t.id]: { events: 0, volunteers: 0 } }));
    setShowModal(false);
    router.push(`/dashboard/${t.id}/overview`);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "var(--color-bg)" }}>
      <DashboardTopbar />

      <main style={{ flex: 1, overflowY: "auto", padding: "28px" }}>
        <div style={{ maxWidth: "960px", margin: "0 auto" }}>
          {/* Page header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "24px" }}>
            <div>
              <h1 style={{ fontSize: "28px", marginBottom: "4px" }}>Tournaments</h1>
              <p style={{ fontFamily: "var(--font-sans)", fontSize: "14px", color: "var(--color-text-secondary)" }}>
                {loading ? "" : tournaments.length === 0 ? "No tournaments yet" : `${tournaments.length} tournament${tournaments.length !== 1 ? "s" : ""}`}
              </p>
            </div>
            <button
              onClick={() => setShowModal(true)}
              style={{
                height: "38px", padding: "0 16px", border: "none", borderRadius: "var(--radius-md)",
                background: "var(--color-accent)", color: "var(--color-text-inverse)",
                fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 600,
                display: "flex", alignItems: "center", gap: "7px", cursor: "pointer",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--color-accent-hover)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "var(--color-accent)"; }}
            >
              <IconPlus />
              Add Tournament
            </button>
          </div>

          {loading ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "16px" }}>
              {[1, 2, 3].map((i) => (
                <div key={i} style={{ height: "180px", background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-lg)", opacity: 0.5 }} />
              ))}
            </div>
          ) : tournaments.length === 0 ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "320px", gap: "12px", textAlign: "center" }}>
              <p style={{ fontFamily: "var(--font-serif)", fontSize: "24px", color: "var(--color-text-primary)" }}>No tournaments yet</p>
              <p style={{ fontFamily: "var(--font-sans)", fontSize: "14px", color: "var(--color-text-secondary)", maxWidth: "280px" }}>Create your first tournament to get started.</p>
              <button onClick={() => setShowModal(true)} style={{ marginTop: "8px", height: "40px", padding: "0 20px", border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)", background: "transparent", fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 500, color: "var(--color-text-primary)", cursor: "pointer", display: "flex", alignItems: "center", gap: "7px" }}>
                <IconPlus />
                Create tournament
              </button>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "16px" }}>
              {tournaments.map((t) => (
                <TournamentCard
                  key={t.id} tournament={t}
                  counts={counts[t.id] ?? { events: null, volunteers: null }}
                  onClick={() => router.push(`/dashboard/${t.id}/overview`)}
                />
              ))}
            </div>
          )}
        </div>
      </main>

      {showModal && <NewTournamentModal onClose={() => setShowModal(false)} onCreated={handleCreated} />}
    </div>
  );
}