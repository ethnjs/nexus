"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { membershipsApi, MembershipSlim, ApiError } from "@/lib/api";
import { personName } from "@/lib/personDisplay";
import { formatRelativeTime } from "@/lib/sessionFormat";
import { useAuth } from "@/lib/useAuth";
import { useMyMembership } from "@/lib/useMyMembership";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Spinner } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { AvatarCircle } from "@/components/ui/AvatarCircle";
import { HoverCard } from "@/components/ui/HoverCard";
import { IconLock } from "@/components/ui/Icons";

// Name / Email / Phone / Account Age / Join Date / Join Method / Status / Roles
const MEMBER_ROW_COLUMNS = "1.4fr 1.6fr 1fr 100px 110px 130px 100px 1.6fr";

const SOURCE_LABELS: Record<string, string> = {
  join_code: "Invite",
  public: "Public",
  manual: "Manual",
};

const STATUS_VARIANT: Record<string, "interested" | "confirmed"> = {
  interested: "interested",
  confirmed: "confirmed",
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function JoinMethodCell({ membership }: { membership: MembershipSlim }) {
  if (membership.source !== "join_code" || !membership.join_code) {
    return (
      <Badge variant="default">{SOURCE_LABELS[membership.source] ?? membership.source}</Badge>
    );
  }

  const jc = membership.join_code;
  return (
    <HoverCard
      content={
        <>
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 600, color: "var(--color-text-primary)" }}>
            {jc.label ?? "Invite"}
          </p>
          <p style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--color-text-secondary)", marginTop: "2px" }}>
            {jc.code}
          </p>
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)", marginTop: "8px" }}>
            Invited by {personName(jc.creator)}
          </p>
        </>
      }
    >
      <Badge variant="default">Invite</Badge>
    </HoverCard>
  );
}

function MemberRow({ membership, isLast }: { membership: MembershipSlim; isLast: boolean }) {
  const [hovered, setHovered] = useState(false);
  const { user } = membership;
  const name = `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim() || "—";

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "grid", gridTemplateColumns: MEMBER_ROW_COLUMNS, alignItems: "center",
        gap: "10px", padding: "10px 12px",
        borderBottom: isLast ? "none" : "1px solid var(--color-border)",
        background: hovered ? "var(--color-bg)" : "transparent",
        transition: "background 100ms ease",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
        <AvatarCircle user={user} size="sm" />
        <span style={{
          fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 500,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {name}
        </span>
      </div>
      <span style={{
        fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--color-text-secondary)",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {user.email}
      </span>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--color-text-secondary)" }}>
        {user.phone ?? "—"}
      </span>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--color-text-secondary)" }}>
        {formatRelativeTime(user.created_at)}
      </span>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--color-text-secondary)" }}>
        {fmtDate(membership.created_at)}
      </span>
      <JoinMethodCell membership={membership} />
      <Badge variant={STATUS_VARIANT[membership.status] ?? "default"}>{membership.status}</Badge>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
        {membership.roles.length === 0 ? (
          <span style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)" }}>—</span>
        ) : (
          membership.roles.map((role) => <Badge key={role.id} variant="default">{role.label}</Badge>)
        )}
      </div>
    </div>
  );
}

export default function MembersPage() {
  const params = useParams();
  const tournamentId = Number(params.id);

  const { user: currentUser } = useAuth();
  const { membership, hasPermission, loading: membershipLoading } = useMyMembership();
  const canManageMembers = currentUser?.role === "admin" || !!membership?.is_owner || hasPermission("manage_members");

  const [members, setMembers] = useState<MembershipSlim[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!canManageMembers) return;
    membershipsApi.list(tournamentId)
      .then(setMembers)
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : "Failed to load members."));
  }, [tournamentId, canManageMembers]);

  if (membershipLoading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
        <Spinner size="lg" />
      </div>
    );
  }

  if (!canManageMembers) {
    return (
      <div>
        <PageHeader heading="Members" />
        <Card radius="lg" style={{ padding: "8px" }}>
          <EmptyState
            icon={<IconLock size={28} />}
            title="No access"
            description="You need the manage members permission to view this page."
          />
        </Card>
      </div>
    );
  }

  if (members === null) {
    return (
      <div>
        <PageHeader heading="Members" />
        <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
          <Spinner size="lg" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader heading="Members" />

      {loadError && (
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)", marginBottom: "10px" }}>
          {loadError}
        </p>
      )}

      {members.length === 0 ? (
        <Card radius="lg" style={{ padding: "8px" }}>
          <EmptyState title="No members yet" description="Members who join this tournament will show up here." />
        </Card>
      ) : (
        <Card radius="lg" style={{ padding: "8px 12px" }}>
          <div style={{
            display: "grid", gridTemplateColumns: MEMBER_ROW_COLUMNS, gap: "10px",
            padding: "12px 12px", fontFamily: "var(--font-sans)", fontSize: "11px",
            fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase",
            color: "var(--color-text-tertiary)",
          }}>
            <span>Members — {members.length}</span>
            <span>Email</span>
            <span>Phone</span>
            <span>Account Age</span>
            <span>Joined</span>
            <span>Method</span>
            <span>Status</span>
            <span>Roles</span>
          </div>

          {members.map((m, i) => (
            <MemberRow key={m.id} membership={m} isLast={i === members.length - 1} />
          ))}
        </Card>
      )}
    </div>
  );
}
