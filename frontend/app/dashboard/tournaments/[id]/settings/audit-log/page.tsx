"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { auditLogApi, AuditLogActor, AuditLogEntry, ApiError } from "@/lib/api";
import { describeAuditLogEntry, ACTION_LABELS, ALL_AUDIT_ACTIONS } from "@/lib/auditLog";
import { personName } from "@/lib/personDisplay";
import { formatRelativeTime } from "@/lib/timeFormat";
import { useAuth } from "@/lib/useAuth";
import { useMyMembership } from "@/lib/useMyMembership";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Dropdown } from "@/components/ui/Dropdown";
import { Spinner } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { AvatarCircle } from "@/components/ui/AvatarCircle";
import { IconChevronRight, IconLock } from "@/components/ui/Icons";

const PAGE_SIZE = 50;

function AuditLogRow({ entry, isLast }: { entry: AuditLogEntry; isLast: boolean }) {
  const [hovered, setHovered] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const { summary, details, hideActor } = describeAuditLogEntry(entry);
  const hasDetails = !!details && details.length > 0;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => hasDetails && setExpanded((v) => !v)}
      style={{
        display: "flex", alignItems: "flex-start", gap: "10px", padding: "10px 12px",
        borderBottom: isLast ? "none" : "1px solid var(--color-border)",
        background: hovered ? "var(--color-bg)" : "transparent",
        transition: "background 100ms ease",
        cursor: hasDetails ? "pointer" : "default",
      }}
    >
      <div
        style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          width: "16px", height: "22px", flexShrink: 0,
          color: "var(--color-text-tertiary)",
        }}
      >
        {hasDetails && (
          <IconChevronRight
            size={12}
            style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}
          />
        )}
      </div>
      {hideActor ? (
        <div style={{ width: "28px", flexShrink: 0 }} />
      ) : (
        <AvatarCircle user={entry.actor} size="sm" />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{
          fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-primary)",
          overflow: "hidden", textOverflow: "ellipsis",
        }}>
          {hideActor ? summary : <><strong>{personName(entry.actor)}</strong> — {summary}</>}
        </p>
        <span style={{
          fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 600,
          textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-text-tertiary)",
        }}>
          {ACTION_LABELS[entry.action] ?? entry.action}
        </span>

        {expanded && hasDetails && (
          <ol style={{ margin: "8px 0 0", paddingLeft: "18px", display: "flex", flexDirection: "column", gap: "4px" }}>
            {details.map((d, i) => (
              <li key={i} style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-secondary)" }}>
                {d}
              </li>
            ))}
          </ol>
        )}
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
  const [nextBeforeId, setNextBeforeId] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [actors, setActors] = useState<AuditLogActor[] | null>(null);
  const [actionFilter, setActionFilter] = useState("");
  const [userFilter, setUserFilter] = useState("");

  useEffect(() => {
    if (!canViewAuditLog) return;
    auditLogApi.actors(tournamentId).then(setActors).catch(() => setActors([]));
  }, [tournamentId, canViewAuditLog]);

  useEffect(() => {
    if (!canViewAuditLog) return;
    setEntries(null);
    setLoadError(null);
    auditLogApi.list(tournamentId, {
      limit: PAGE_SIZE,
      action: actionFilter || undefined,
      actor_id: userFilter ? Number(userFilter) : undefined,
    })
      .then((page) => {
        setEntries(page.items);
        setNextBeforeId(page.next_before_id);
      })
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : "Failed to load the audit log."));
  }, [tournamentId, canViewAuditLog, actionFilter, userFilter]);

  async function handleLoadMore() {
    if (nextBeforeId === null) return;
    setLoadingMore(true);
    try {
      const page = await auditLogApi.list(tournamentId, {
        limit: PAGE_SIZE,
        before_id: nextBeforeId,
        action: actionFilter || undefined,
        actor_id: userFilter ? Number(userFilter) : undefined,
      });
      setEntries((prev) => (prev ? [...prev, ...page.items] : page.items));
      setNextBeforeId(page.next_before_id);
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : "Failed to load more entries.");
    } finally {
      setLoadingMore(false);
    }
  }

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

  const actionOptions = [
    { value: "", label: "All actions" },
    ...ALL_AUDIT_ACTIONS.map((a) => ({ value: a, label: ACTION_LABELS[a] ?? a })),
  ];
  const userOptions = [
    { value: "", label: "All users" },
    ...(actors ?? []).map((a) => ({
      value: String(a.actor.user_id),
      label: personName(a.actor),
    })),
  ];

  return (
    <div>
      <PageHeader heading="Audit Log" subheading="Tournament Settings" />

      <div style={{ display: "flex", gap: "10px", marginBottom: "14px" }}>
        <Dropdown
          value={actionFilter}
          onChange={setActionFilter}
          options={actionOptions}
          placeholder="Filter by action"
          size="md"
          variant="secondary"
        />
        <Dropdown
          value={userFilter}
          onChange={setUserFilter}
          options={userOptions}
          placeholder="Filter by user"
          size="md"
          variant="secondary"
        />
      </div>

      {loadError && (
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)", marginBottom: "10px" }}>
          {loadError}
        </p>
      )}

      {entries === null ? (
        <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
          <Spinner size="lg" />
        </div>
      ) : entries.length === 0 ? (
        <Card radius="lg" style={{ padding: "8px" }}>
          <EmptyState
            title="No activity yet"
            description={
              actionFilter || userFilter
                ? "No entries match the current filters."
                : "Actions taken in this tournament will show up here."
            }
          />
        </Card>
      ) : (
        <>
          <Card radius="lg" style={{ padding: "8px 12px" }}>
            {entries.map((entry, i) => (
              <AuditLogRow key={entry.id} entry={entry} isLast={i === entries.length - 1} />
            ))}
          </Card>

          {nextBeforeId !== null && (
            <div style={{ display: "flex", justifyContent: "center", marginTop: "14px" }}>
              <Button type="button" variant="secondary" size="sm" loading={loadingMore} onClick={handleLoadMore}>
                Load more
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
