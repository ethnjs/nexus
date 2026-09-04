"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useTournament } from "@/lib/useTournament";
import { parseLocalDate } from "@/lib/date";
import { ApiError, formsApi, MemberForm } from "@/lib/api";
import { SetupChecklistWidget } from "@/components/tournament/setup/SetupChecklistWidget";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Spinner } from "@/components/ui/Spinner";
import { IconCalendar, IconLocation } from "@/components/ui/Icons";

export default function OverviewPage() {
  const params = useParams();
  const tournamentId = params.id as string;
  const { selectedTournament } = useTournament();
  const [forms, setForms] = useState<MemberForm[] | null>(null);
  const [formsError, setFormsError] = useState<string | null>(null);
  const [hoveredFormId, setHoveredFormId] = useState<string | null>(null);

  useEffect(() => {
    formsApi.listMineForTournament(Number(tournamentId))
      .then(setForms)
      .catch((error) => setFormsError(error instanceof ApiError ? error.message : "Failed to load forms."));
  }, [tournamentId]);

  const fmt = (d: string) =>
    parseLocalDate(d).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

  const dateRange = selectedTournament?.start_date
    ? selectedTournament.end_date && selectedTournament.end_date !== selectedTournament.start_date
      ? `${fmt(selectedTournament.start_date)} – ${fmt(selectedTournament.end_date)}`
      : fmt(selectedTournament.start_date)
    : null;

  const place = selectedTournament?.location || selectedTournament?.university?.name;

  const heading = selectedTournament
    ? `${parseLocalDate(selectedTournament.start_date).getFullYear()} ${selectedTournament.name}`
    : "—";

  const metadata = selectedTournament && (
    <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
      {place && (
        <span style={{ display: "flex", alignItems: "center", gap: "6px", fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)" }}>
          <IconLocation />
          {place}
        </span>
      )}
      {dateRange && (
        <span style={{ display: "flex", alignItems: "center", gap: "6px", fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)" }}>
          <IconCalendar />
          {dateRange}
        </span>
      )}
      {selectedTournament.state && <Badge>{selectedTournament.state}</Badge>}
      {selectedTournament.level && (
        <Badge>{selectedTournament.level[0].toUpperCase() + selectedTournament.level.slice(1)}</Badge>
      )}
      {selectedTournament.division?.map((d) => <Badge key={d}>{d}</Badge>)}
    </div>
  );

  return (
    <div>
      <PageHeader heading={heading} metadata={metadata} />

      <div style={{ display: "flex", flexWrap: "wrap", gap: "16px" }}>
        <SetupChecklistWidget tournamentId={tournamentId} />
        {formsError && (
          <p style={{ width: "100%", margin: 0, fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)" }}>
            {formsError}
          </p>
        )}
        {forms === null ? (
          <div style={{ padding: "20px" }}><Spinner size="sm" /></div>
        ) : forms.length > 0 ? (
          <Card radius="lg" style={{ width: "min(100%, 480px)", padding: "12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "4px 4px 10px" }}>
              <span style={{ fontFamily: "var(--font-sans)", fontSize: "14px", fontWeight: 600 }}>Forms</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {forms.map((form, index) => (
                <div
                  key={form.id}
                  onMouseEnter={() => setHoveredFormId(form.id)}
                  onMouseLeave={() => setHoveredFormId(null)}
                  style={{
                    display: "flex", alignItems: "center", gap: "10px", padding: "8px 4px",
                    borderBottom: index === forms.length - 1 ? "none" : "1px solid var(--color-border)",
                    background: hoveredFormId === form.id ? "var(--color-bg)" : "transparent",
                    transition: "background 100ms ease",
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 500 }}>
                      {form.name}
                    </div>
                  </div>
                  <Badge variant={form.completed ? "confirmed" : "default"}>
                    {form.completed ? "Completed" : "To do"}
                  </Badge>
                  {form.eligible && !form.completed && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        window.open(form.is_onboarding
                          ? `/tournaments/${tournamentId}/onboarding`
                          : `/forms/${form.id}/view`, "_blank", "noopener,noreferrer");
                      }}
                    >
                      Open
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
