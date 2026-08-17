"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useAuth } from "@/lib/useAuth";
import { useMyMembership } from "@/lib/useMyMembership";
import { useUnsavedChanges } from "@/lib/useUnsavedChanges";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Spinner } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { TabStrip } from "@/components/ui/TabStrip";
import { IconLock } from "@/components/ui/Icons";
import { EventsTab } from "@/components/tournament/events/EventsTab";
import { ShiftsTab } from "@/components/tournament/events/ShiftsTab";

type EventsPageTab = "events" | "shifts";

export default function EventsPage() {
  const params = useParams();
  const tournamentId = Number(params.id);

  const { user: currentUser } = useAuth();
  const { membership, hasPermission, loading: membershipLoading } = useMyMembership();
  const { guard } = useUnsavedChanges();

  const [activeTab, setActiveTab] = useState<EventsPageTab>("events");

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
        <PageHeader heading="Events" />
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
      <PageHeader heading="Events" />

      <TabStrip
        tabs={[
          { key: "events", label: "Events" },
          { key: "shifts", label: "Shifts" },
        ]}
        activeKey={activeTab}
        onChange={(tab) => guard(() => setActiveTab(tab))}
      />

      {activeTab === "events" ? (
        <EventsTab tournamentId={tournamentId} canManageEvents={canManageEvents} />
      ) : (
        <ShiftsTab tournamentId={tournamentId} canManageEvents={canManageEvents} />
      )}
    </div>
  );
}
