"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/useAuth";
import { useTournament, Tournament } from "@/lib/useTournament";
import { tournamentsApi } from "@/lib/api";

function ChevronDown() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M5 2H3a1 1 0 00-1 1v8a1 1 0 001 1h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M9 10l3-3-3-3M12 7H5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

const fieldLabel: React.CSSProperties = {
  fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 600,
  textTransform: "uppercase", letterSpacing: "0.07em",
  color: "var(--color-text-tertiary)", display: "block", marginBottom: "6px",
};

const textInput: React.CSSProperties = {
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
      const t = await tournamentsApi.create({ name: name.trim(), location: location.trim() || null, start_date: startDate || null, end_date: endDate || null, blocks: [] });
      onCreated(t);
    } catch { setError("Failed to create tournament"); }
    finally { setLoading(false); }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-lg)", padding: "28px", width: "440px", maxWidth: "calc(100vw - 32px)", boxShadow: "var(--shadow-lg)" }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ fontFamily: "var(--font-serif)", fontSize: "22px", color: "var(--color-text-primary)", marginBottom: "20px" }}>New Tournament</h2>
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <div><label style={fieldLabel}>Name *</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 2026 Nationals @ USC" style={textInput} autoFocus /></div>
          <div><label style={fieldLabel}>Location</label><input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. USC, Los Angeles CA" style={textInput} /></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <div><label style={fieldLabel}>Start Date</label><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={{ ...textInput, padding: "0 12px" }} /></div>
            <div><label style={fieldLabel}>End Date</label><input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={{ ...textInput, padding: "0 12px" }} /></div>
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

interface TopbarProps {
  tournamentId: string | number;
}

export function Topbar({ tournamentId }: TopbarProps) {
  const router = useRouter();
  const { user, logout } = useAuth();
  const { tournaments, selectedTournament, setSelectedTournament, refresh } = useTournament();
  const [tournamentOpen, setTournamentOpen] = useState(false);
  const [userOpen, setUserOpen]             = useState(false);
  const [showNewModal, setShowNewModal]     = useState(false);
  const tournamentRef = useRef<HTMLDivElement>(null);
  const userRef       = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (tournamentRef.current && !tournamentRef.current.contains(e.target as Node)) setTournamentOpen(false);
      if (userRef.current       && !userRef.current.contains(e.target as Node))       setUserOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const initials = user
    ? (`${user.first_name?.[0] ?? ""}${user.last_name?.[0] ?? ""}`).toUpperCase() || user.email[0].toUpperCase()
    : "?";

  async function handleCreated(t: Tournament) {
    await refresh();
    setSelectedTournament(t);
    setShowNewModal(false);
    router.push(`/dashboard/${t.id}/overview`);
  }

  function handleSelect(t: Tournament) {
    setSelectedTournament(t);
    setTournamentOpen(false);
    const segment = window.location.pathname.split("/").pop() ?? "overview";
    router.push(`/dashboard/${t.id}/${segment}`);
  }

  return (
    <>
      {/* Sticky topbar — stays in normal flow, scrolls with the column but sticks to top */}
      <header style={{
        height: "52px",
        background: "var(--color-surface)",
        borderBottom: "1px solid var(--color-border)",
        display: "flex", alignItems: "center",
        paddingLeft: "16px", paddingRight: "20px",
        gap: "12px",
        position: "sticky",
        top: 0,
        zIndex: 40,
        flexShrink: 0,
      }}>
        {/* Tournament selector */}
        <div ref={tournamentRef} style={{ position: "relative" }}>
          <button
            onClick={() => setTournamentOpen((v) => !v)}
            style={{
              height: "34px", width: "280px", padding: "0 10px",
              border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)",
              background: "var(--color-bg)",
              display: "flex", alignItems: "center", gap: "8px",
              fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 500,
              color: "var(--color-text-primary)", cursor: "pointer",
            }}
          >
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left" }}>
              {selectedTournament ? selectedTournament.name : "Select tournament…"}
            </span>
            <ChevronDown />
          </button>

          {tournamentOpen && (
            <div style={{
              position: "absolute", top: "calc(100% + 6px)", left: 0, width: "280px",
              background: "var(--color-surface)", border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)",
              overflow: "hidden", zIndex: 100,
            }}>
              {tournaments.length === 0 && (
                <p style={{ padding: "12px 16px", fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-tertiary)" }}>No tournaments yet</p>
              )}
              {tournaments.map((t) => (
                <button key={t.id} onClick={() => handleSelect(t)} style={{
                  display: "block", width: "100%", padding: "10px 16px",
                  border: "none", borderBottom: "1px solid var(--color-border)",
                  background: String(tournamentId) === String(t.id) ? "var(--color-accent-subtle)" : "transparent",
                  fontFamily: "var(--font-sans)", fontSize: "13px",
                  fontWeight: String(tournamentId) === String(t.id) ? 600 : 400,
                  color: "var(--color-text-primary)", textAlign: "left", cursor: "pointer",
                }}
                  onMouseEnter={(e) => { if (String(tournamentId) !== String(t.id)) e.currentTarget.style.background = "var(--color-bg)"; }}
                  onMouseLeave={(e) => { if (String(tournamentId) !== String(t.id)) e.currentTarget.style.background = "transparent"; }}
                >
                  <div>{t.name}</div>
                  {t.location && <div style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--color-text-tertiary)", marginTop: "2px" }}>{t.location}</div>}
                </button>
              ))}
              <button onClick={() => { setTournamentOpen(false); setShowNewModal(true); }} style={{
                display: "flex", alignItems: "center", gap: "8px",
                width: "100%", padding: "10px 16px",
                border: "none", background: "transparent",
                fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 500,
                color: "var(--color-text-primary)", cursor: "pointer",
              }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--color-bg)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                <PlusIcon />
                New tournament
              </button>
            </div>
          )}
        </div>

        <div style={{ flex: 1 }} />

        {/* User avatar */}
        <div ref={userRef} style={{ position: "relative" }}>
          <button onClick={() => setUserOpen((v) => !v)} style={{
            width: "32px", height: "32px", borderRadius: "50%",
            background: "var(--color-accent)", color: "var(--color-text-inverse)",
            border: "none", fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 700,
            letterSpacing: "0.05em", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
          }}>
            {initials}
          </button>

          {userOpen && (
            <div style={{
              position: "absolute", top: "calc(100% + 8px)", right: 0, width: "220px",
              background: "var(--color-surface)", border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)", overflow: "hidden", zIndex: 100,
            }}>
              <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--color-border)" }}>
                <div style={{ fontFamily: "var(--font-sans)", fontSize: "14px", fontWeight: 600, color: "var(--color-text-primary)" }}>
                  {user?.first_name && user?.last_name ? `${user.first_name} ${user.last_name}` : user?.email}
                </div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--color-text-tertiary)", marginTop: "3px" }}>{user?.email}</div>
                <div style={{ marginTop: "8px" }}>
                  <span style={{ fontFamily: "var(--font-sans)", fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--color-text-secondary)", background: "var(--color-accent-subtle)", padding: "2px 7px", borderRadius: "var(--radius-sm)" }}>
                    {user?.role}
                  </span>
                </div>
              </div>
              <button onClick={() => { setUserOpen(false); logout(); }} style={{
                display: "flex", alignItems: "center", gap: "8px",
                width: "100%", padding: "11px 16px",
                border: "none", background: "transparent",
                fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 500,
                color: "var(--color-danger)", cursor: "pointer",
              }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--color-danger-subtle)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                <LogoutIcon />
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>

      {showNewModal && <NewTournamentModal onClose={() => setShowNewModal(false)} onCreated={handleCreated} />}
    </>
  );
}