"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ApiError, formsApi, MemberForm } from "@/lib/api";
import { SetupChecklistWidget } from "@/components/tournament/overview/SetupChecklistWidget";
import { MySignupCards } from "@/components/tournament/overview/MySignupCards";
import { MemberSummaryCard } from "@/components/tournament/overview/MemberSummaryCard";
import { TournamentHeaderCard } from "@/components/tournament/overview/TournamentHeaderCard";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { OverviewCard } from "@/components/tournament/overview/OverviewCard";
import { MasonryGrid } from "@/components/ui/MasonryGrid";
import { Spinner } from "@/components/ui/Spinner";
import { Tooltip } from "@/components/ui/Tooltip";
import { IconLock } from "@/components/ui/Icons";
import { useArchiveLock } from "@/lib/useArchiveLock";
import { responseEditLockedReason } from "@/lib/forms/responseEditLock";
import styles from "@/components/tournament/overview/Overview.module.css";

function openInNewTab(path: string) {
  window.open(path, "_blank", "noopener,noreferrer");
}

export default function OverviewPage() {
  const params = useParams();
  const tournamentId = params.id as string;
  const [forms, setForms] = useState<MemberForm[] | null>(null);
  const [formsError, setFormsError] = useState<string | null>(null);
  const [hoveredFormId, setHoveredFormId] = useState<string | null>(null);
  const { isArchived } = useArchiveLock();

  useEffect(() => {
    formsApi.listMineForTournament(Number(tournamentId))
      .then(setForms)
      .catch((error) => setFormsError(error instanceof ApiError ? error.message : "Failed to load forms."));
  }, [tournamentId]);

  return (
    <div>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {formsError && (
          <p style={{ margin: 0, fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)" }}>
            {formsError}
          </p>
        )}
        <MasonryGrid>
          <TournamentHeaderCard />
          <SetupChecklistWidget tournamentId={tournamentId} />
          <MemberSummaryCard tournamentId={Number(tournamentId)} />
          {forms === null ? (
            <div style={{ padding: "20px" }}><Spinner size="sm" /></div>
          ) : forms.length > 0 ? (
            // Two columns wide, so form names fit beside the status badge, Locked and Edit.
            <OverviewCard title="Forms" data-min-width={560}>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {forms.map((form, index) => {
                  const lockedReason = form.completed
                    ? responseEditLockedReason({ ...form, tournamentArchived: isArchived })
                    : undefined;
                  return (
                  <div
                    key={form.id}
                    onMouseEnter={() => setHoveredFormId(form.id)}
                    onMouseLeave={() => setHoveredFormId(null)}
                    // A completed row opens the member's read-only response.
                    onClick={form.completed ? () => openInNewTab(`/forms/${form.id}/view`) : undefined}
                    className={styles.formRow}
                    style={{
                      borderBottom: index === forms.length - 1 ? "none" : "1px solid var(--color-border)",
                      background: hoveredFormId === form.id ? "var(--color-bg)" : "transparent",
                      cursor: form.completed ? "pointer" : "default",
                    }}
                  >
                    <div className={styles.formName}>
                      {form.name}
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
                          openInNewTab(form.is_onboarding
                            ? `/tournaments/${tournamentId}/onboarding`
                            : `/forms/${form.id}/view`);
                        }}
                      >
                        Open
                      </Button>
                    )}
                    {form.completed && lockedReason && (
                      <Tooltip variant="info" message={lockedReason} showIcon={false}>
                        <Badge variant="removed"><IconLock size={11} /> Locked</Badge>
                      </Tooltip>
                    )}
                    {form.completed && (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={!!lockedReason}
                        title={lockedReason}
                        onClick={(e) => {
                          e.stopPropagation();
                          // Onboarding too: editing goes straight to the form, not the onboarding route.
                          openInNewTab(`/forms/${form.id}/view?edit=true`);
                        }}
                      >
                        Edit
                      </Button>
                    )}
                  </div>
                  );
                })}
              </div>
            </OverviewCard>
          ) : null}
          <MySignupCards tournamentId={Number(tournamentId)} />
        </MasonryGrid>
      </div>
    </div>
  );
}
