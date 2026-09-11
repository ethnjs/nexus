"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useTournament } from "@/lib/useTournament";
import { tournamentFactRows, tournamentYear } from "@/lib/tournamentDisplay";
import { ApiError, formsApi, MemberForm } from "@/lib/api";
import { SetupChecklistWidget } from "@/components/tournament/overview/SetupChecklistWidget";
import { MySignupCards } from "@/components/tournament/overview/MySignupCards";
import { MemberSummaryCard } from "@/components/tournament/overview/MemberSummaryCard";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { OverviewCard } from "@/components/tournament/overview/OverviewCard";
import { MasonryGrid } from "@/components/ui/MasonryGrid";
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

  const rows = selectedTournament ? tournamentFactRows(selectedTournament, "weekday") : [];

  const year = selectedTournament && tournamentYear(selectedTournament);
  const heading = selectedTournament
    ? [year, selectedTournament.name].filter(Boolean).join(" ")
    : "—";

  const metadata = selectedTournament && (
    <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
      {rows.map((row) => (
        <span key={row.key} style={{ display: "flex", alignItems: "center", gap: "6px", fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)" }}>
          {row.name && <span style={{ fontWeight: 600, color: "var(--color-text-tertiary)" }}>{row.name}</span>}
          {row.place && <><IconLocation />{row.place}</>}
          {row.dates && <><IconCalendar />{row.dates}</>}
        </span>
      ))}
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

      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {formsError && (
          <p style={{ margin: 0, fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)" }}>
            {formsError}
          </p>
        )}
        <MasonryGrid>
          <SetupChecklistWidget tournamentId={tournamentId} />
          <MemberSummaryCard tournamentId={Number(tournamentId)} />
          {forms === null ? (
            <div style={{ padding: "20px" }}><Spinner size="sm" /></div>
          ) : forms.length > 0 ? (
            <OverviewCard title="Forms">
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
            </OverviewCard>
          ) : null}
          <MySignupCards tournamentId={Number(tournamentId)} />
        </MasonryGrid>
      </div>
    </div>
  );
}
