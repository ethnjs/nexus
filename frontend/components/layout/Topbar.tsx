"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTournament, Tournament } from "@/lib/useTournament";
import { NewTournamentModal } from "@/components/ui/NewTournamentModal";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { IconChevronDown, IconPlus } from "@/components/ui/Icons";

interface TopbarProps {
  showWordmark?: boolean;
  showDropdown?: boolean;
  showAvatar?: boolean;
  tournamentId?: string | number;
}

// ─── Tournament Dropdown ──────────────────────────────────────────────────────
// Isolated into its own component so useTournament() is only called when
// showDropdown=true and a TournamentProvider is present in the tree.

function TournamentDropdown({ tournamentId }: { tournamentId?: string | number }) {
  const router = useRouter();
  const { tournaments, selectedTournament, setSelectedTournament, refresh } = useTournament();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [showNewModal, setShowNewModal] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  async function handleCreated(t: Tournament) {
    await refresh();
    setSelectedTournament(t);
    setShowNewModal(false);
    router.push(`/dashboard/${t.id}/overview`);
  }

  function handleSelect(t: Tournament) {
    setSelectedTournament(t);
    setDropdownOpen(false);
    const segment = window.location.pathname.split("/").pop() ?? "overview";
    router.push(`/dashboard/${t.id}/${segment}`);
  }

  return (
    <>
      <div ref={dropdownRef} style={{ position: "relative" }}>
        <button
          onClick={() => setDropdownOpen((v) => !v)}
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

        {dropdownOpen && (
          <div style={{
            position: "absolute", top: "calc(100% + 6px)", left: 0, width: "280px",
            background: "var(--color-surface)", border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)",
            overflow: "hidden", zIndex: 100,
          }}>
            {tournaments.length === 0 && (
              <p style={{ padding: "12px 16px", fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-tertiary)" }}>
                No tournaments yet
              </p>
            )}
            {tournaments.map((t) => (
              <button
                key={t.id}
                onClick={() => handleSelect(t)}
                style={{
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
              onClick={() => { setDropdownOpen(false); setShowNewModal(true); }}
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

      {showNewModal && (
        <NewTournamentModal onClose={() => setShowNewModal(false)} onCreated={handleCreated} />
      )}
    </>
  );
}

// ─── Topbar ───────────────────────────────────────────────────────────────────

export function Topbar({
  showWordmark = false,
  showDropdown = false,
  showAvatar = true,
  tournamentId,
}: TopbarProps) {
  return (
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
      {showWordmark && (
        <span style={{
          fontFamily: "Georgia, serif", fontSize: "15px",
          letterSpacing: "0.18em", textTransform: "uppercase",
          color: "var(--color-text-primary)", userSelect: "none",
          paddingLeft: "8px",
        }}>
          NEXUS
        </span>
      )}

      {showDropdown && <TournamentDropdown tournamentId={tournamentId} />}

      <div style={{ flex: 1 }} />

      {showAvatar && <UserAvatar />}
    </header>
  );
}