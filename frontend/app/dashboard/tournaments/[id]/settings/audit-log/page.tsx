"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { auditLogApi, AuditLogEntry, ApiError } from "@/lib/api";
import { describeAuditLogEntry, ACTION_LABELS } from "@/lib/auditLog";
import { personUser, personName } from "@/lib/personDisplay";
import { formatRelativeTime } from "@/lib/sessionFormat";
import { useAuth } from "@/lib/useAuth";
import { useMyMembership } from "@/lib/useMyMembership";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Spinner } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { AvatarCircle } from "@/components/ui/AvatarCircle";
import { IconLock } from "@/components/ui/Icons";

function AuditLogRow({ entry, isLast }: { entry: AuditLogEntry; isLast: boolean }) {
  const [hovered, setHovered] = useState(false);
  const user = personUser(entry.actor);
  const { summary } = describeAuditLogEntry(entry);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex", alignItems: "flex-start", gap: "10px", padding: "10px 12px",
        borderBottom: isLast ? "none" : "1px solid var(--color-border)",
        background: hovered ? "var(--color-bg)" : "transparent",
        transition: "background 100ms ease",
      }}
    >
      <AvatarCircle user={user} size="sm" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{
          fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-primary)",
          overflow: "hidden", textOverflow: "ellipsis",
        }}>
          <strong>{personName(entry.actor)}</strong> — {summary}
        </p>
        <span style={{
          fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 600,
          textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-text-tertiary)",
        }}>
          {ACTION_LABELS[entry.action] ?? entry.action}
        </span>
      </div>
      <span style={{
        fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)",
        whiteSpace: "nowrap", flexShrink: 0,
      }}>
        {formatRelativeTime(entry.created_at)}
      </span>
    </div>
  );
}

export default function AuditLogSettingsPage() {
  const params = useParams();
  const tournamentId = Number(params.id);

  const { user: currentUser } = useAuth();
  const { membership, hasPermission, loading: membershipLoading } = useMyMembership();
  const canViewAuditLog = currentUser?.role === "admin" || !!membership?.is_owner || hasPermission("manage_tournament");

  const [entries, setEntries] = useState<AuditLogEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!canViewAuditLog) return;
    auditLogApi.list(tournamentId, { limit: 50 })
      .then((page) => setEntries(page.items))
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : "Failed to load the audit log."));
  }, [tournamentId, canViewAuditLog]);

  if (membershipLoading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
        <Spinner size="lg" />
      </div>
    );
  }

  if (!canViewAuditLog) {
    return (
      <div>
        <PageHeader heading="Audit Log" subheading="Tournament Settings" />
        <Card radius="lg" style={{ padding: "8px" }}>
          <EmptyState
            icon={<IconLock size={28} />}
            title="No access"
            description="You need the manage tournament permission to view this page."
          />
        </Card>
      </div>
    );
  }

  if (entries === null) {
    return (
      <div>
        <PageHeader heading="Audit Log" subheading="Tournament Settings" />
        <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
          <Spinner size="lg" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader heading="Audit Log" subheading="Tournament Settings" />

      {loadError && (
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)", marginBottom: "10px" }}>
          {loadError}
        </p>
      )}

      {entries.length === 0 ? (
        <Card radius="lg" style={{ padding: "8px" }}>
          <EmptyState title="No activity yet" description="Actions taken in this tournament will show up here." />
        </Card>
      ) : (
        <Card radius="lg" style={{ padding: "8px 12px" }}>
          {entries.map((entry, i) => (
            <AuditLogRow key={entry.id} entry={entry} isLast={i === entries.length - 1} />
          ))}
        </Card>
      )}
    </div>
  );
}
