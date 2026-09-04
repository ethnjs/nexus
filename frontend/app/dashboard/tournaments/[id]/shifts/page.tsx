"use client";

import { useParams } from "next/navigation";
import { useAuth } from "@/lib/useAuth";
import { useMyMembership } from "@/lib/useMyMembership";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Spinner } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { IconLock } from "@/components/ui/Icons";
import { ShiftsTab } from "@/components/tournament/events/ShiftsTab";

// Its own route rather than a tab under Events: a shift belongs to a track,
// not to an event, and it is the thing availability is collected against —
// it outranks being a sub-view of the event catalog.
export default function ShiftsPage() {
  const params = useParams();
  const tournamentId = Number(params.id);

  const { user: currentUser } = useAuth();
  const { membership, hasPermission, loading: membershipLoading } = useMyMembership();

  const isAdmin = currentUser?.role === "admin";
  const isOwner = !!membership?.is_owner;
  const canManageEvents = isAdmin || isOwner || hasPermission("manage_events");

  if (membershipLoading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
        <Spinner size="lg" />
      </div>
    );
  }

  if (!canManageEvents) {
    return (
      <div>
        <PageHeader heading="Shifts" />
        <Card radius="lg" style={{ padding: "8px" }}>
          <EmptyState
            icon={<IconLock size={28} />}
            title="No access"
            description="You need the manage events permission to view this page."
          />
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader heading="Shifts" />
      <ShiftsTab tournamentId={tournamentId} canManageEvents={canManageEvents} />
    </div>
  );
}
