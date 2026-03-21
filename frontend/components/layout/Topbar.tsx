"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/useAuth";
import { useTournament, Tournament } from "@/lib/useTournament";
import { NewTournamentModal } from "@/components/ui/NewTournamentModal";
import { IconChevronDown, IconLogout, IconPlus } from "@/components/ui/Icons";

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
            <IconChevronDown />
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
                  {t.location && (
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--color-text-tertiary)", marginTop: "2px" }}>
                      {t.location}
                    </div>
                  )}
                </button>
              ))}
              <button
                onClick={() => { setTournamentOpen(false); setShowNewModal(true); }}
                style={{
                  display: "flex", alignItems: "center", gap: "8px",
                  width: "100%", padding: "10px 16px",
                  border: "none", background: "transparent",
                  fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 500,
                  color: "var(--color-text-primary)", cursor: "pointer",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--color-bg)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                <IconPlus />
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

      {showNewModal && (
        <NewTournamentModal onClose={() => setShowNewModal(false)} onCreated={handleCreated} />
      )}
    </>
  );
}