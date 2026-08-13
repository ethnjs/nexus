"use client";

import { useEffect, useState } from "react";
import { usersApi, UserSession, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Banner } from "@/components/ui/Banner";
import { Spinner } from "@/components/ui/Spinner";
import { parseUserAgent, formatRelativeTime } from "@/lib/timeFormat";

export function SessionList() {
  const [sessions, setSessions] = useState<UserSession[] | null>(null);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | undefined>(undefined);
  const [logoutSuccess, setLogoutSuccess] = useState(false);

  function load() {
    usersApi.listSessions().then(setSessions).catch(() => setLoadError("Failed to load sessions."));
  }

  useEffect(() => { load(); }, []);

  async function handleLogoutOthers() {
    setLoggingOut(true);
    setLogoutError(undefined);
    setLogoutSuccess(false);
    try {
      await usersApi.logoutOtherSessions();
      setLogoutSuccess(true);
      load();
    } catch (error: unknown) {
      setLogoutError(error instanceof ApiError ? error.message : "Something went wrong.");
    } finally {
      setLoggingOut(false);
    }
  }

  if (loadError) {
    return (
      <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-tertiary)" }}>
        {loadError}
      </p>
    );
  }

  if (!sessions) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "20px 0" }}>
        <Spinner />
      </div>
    );
  }

  const otherCount = sessions.filter((s) => !s.is_current).length;

  return (
    <div>
      {sessions.map((s, i) => (
        <div key={s.id} style={{
          padding: "16px 0",
          borderBottom: i === sessions.length - 1 ? "none" : "1px solid var(--color-border)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontFamily: "var(--font-sans)", fontSize: "14px", fontWeight: 500, color: "var(--color-text-primary)" }}>
              {parseUserAgent(s.user_agent)}
            </span>
            {s.is_current && (
              <span style={{
                fontFamily: "var(--font-sans)", fontSize: "10px", fontWeight: 600,
                textTransform: "uppercase", letterSpacing: "0.05em",
                color: "var(--color-text-secondary)", background: "var(--color-accent-subtle)",
                padding: "2px 7px", borderRadius: "var(--radius-sm)",
              }}>
                This device
              </span>
            )}
          </div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--color-text-tertiary)", marginTop: "3px" }}>
            {s.ip_address ?? "Unknown IP"} · Active {formatRelativeTime(s.last_active_at)}
          </div>
        </div>
      ))}

      {otherCount > 0 && (
        <div style={{ marginTop: "20px" }}>
          <Button type="button" variant="secondary" onClick={handleLogoutOthers} loading={loggingOut}>
            Log out everywhere else
          </Button>
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)", marginTop: "8px" }}>
            Signs out every other session — this device stays logged in.
          </p>
        </div>
      )}

      {logoutSuccess && (
        <div style={{ marginTop: "12px" }}>
          <Banner variant="success" message="Logged out of all other sessions." />
        </div>
      )}
      {logoutError && (
        <div style={{ marginTop: "12px" }}>
          <Banner variant="error" message={logoutError} />
        </div>
      )}
    </div>
  );
}
