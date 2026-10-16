"use client";

import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { IconLock } from "@/components/ui/Icons";

// The builder and Responses pages are manager-only; the backend 403s their
// data for anyone else. Same wording as the tournament forms list.
export function NoFormAccess() {
  return (
    <div style={{ maxWidth: "800px", margin: "0 auto", padding: "40px 24px" }}>
      <Card radius="lg" style={{ padding: "8px" }}>
        <EmptyState
          icon={<IconLock size={28} />}
          title="No access"
          description="You need the manage forms permission to view this page."
        />
      </Card>
    </div>
  );
}
