"use client";

import { useAuth } from "@/lib/useAuth";
import { useMyMembership } from "@/lib/useMyMembership";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Spinner } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { IconLock } from "@/components/ui/Icons";

export default function InvitesSettingsPage() {
  const { user: currentUser } = useAuth();
  const { membership, hasPermission, loading: membershipLoading } = useMyMembership();
  const canManageInvites = currentUser?.role === "admin" || !!membership?.is_owner || hasPermission("manage_invites");

  if (membershipLoading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
        <Spinner size="lg" />
      </div>
    );
  }

  if (!canManageInvites) {
    return (
      <div>
        <PageHeader heading="Invites" subheading="Tournament Settings" />
        <Card radius="lg" style={{ padding: "8px" }}>
          <EmptyState
            icon={<IconLock size={28} />}
            title="No access"
            description="You need the manage invites permission to view this page."
          />
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader heading="Invites" subheading="Tournament Settings" />
      <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)" }}>
        Coming soon.
      </p>
    </div>
  );
}
