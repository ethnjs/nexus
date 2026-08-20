"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { formsApi, Form, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/useAuth";
import { useMyMembership } from "@/lib/useMyMembership";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Spinner } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { IconForms, IconLock } from "@/components/ui/Icons";

export default function FormsPage() {
  const params = useParams();
  const tournamentId = Number(params.id);

  const { user: currentUser } = useAuth();
  const { membership, hasPermission, loading: membershipLoading } = useMyMembership();
  const canManageForms = currentUser?.role === "admin" || !!membership?.is_owner || hasPermission("manage_forms");

  const [forms, setForms] = useState<Form[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!canManageForms) return;
    formsApi.listForTournament(tournamentId)
      .then(setForms)
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : "Failed to load forms."));
  }, [tournamentId, canManageForms]);

  if (membershipLoading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
        <Spinner size="lg" />
      </div>
    );
  }

  if (!canManageForms) {
    return (
      <div>
        <PageHeader heading="Forms" />
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

  if (forms === null) {
    return (
      <div>
        <PageHeader heading="Forms" />
        <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
          <Spinner size="lg" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader heading="Forms" />

      {loadError && (
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)", marginBottom: "10px" }}>
          {loadError}
        </p>
      )}

      {forms.length === 0 ? (
        <Card radius="lg" style={{ padding: "8px" }}>
          <EmptyState
            icon={<IconForms size={28} />}
            title="No forms yet"
            description="Create a form to start collecting responses from members."
          />
        </Card>
      ) : (
        <Card radius="lg" style={{ padding: "8px 12px" }}>
          {forms.map((form) => (
            <p key={form.id} style={{ fontFamily: "var(--font-sans)", fontSize: "13px", padding: "8px 4px" }}>
              {form.name}
            </p>
          ))}
        </Card>
      )}
    </div>
  );
}
