"use client";

import { useEffect, useState } from "react";
import { FlowSection, FlowTitle } from "@/components/tournament/forms/flow/FlowPane";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { IconCheck, IconChevronLeft, IconMembers, IconSearch } from "@/components/ui/Icons";
import { Input } from "@/components/ui/Input";
import { NavItem } from "@/components/ui/ModalNav";
import { Spinner } from "@/components/ui/Spinner";
import { ApiError, type FlowStep, formsApi, type MemberFormFlow, type PersonRef } from "@/lib/api";
import { personName } from "@/lib/personDisplay";

const MUTED = {
  fontFamily: "var(--font-sans)",
  fontSize: "12px",
  color: "var(--color-text-tertiary)",
} as const;

/** The left column while previewing: every member, searchable, with a way back. */
export function PreviewMemberList({
  tournamentId,
  selectedId,
  onSelect,
  onBack,
}: {
  tournamentId: number;
  selectedId: number | null;
  onSelect: (member: PersonRef) => void;
  onBack: () => void;
}) {
  const [members, setMembers] = useState<PersonRef[] | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    // No conditions matches everyone, with their roles — and needs only manage_forms.
    formsApi
      .previewPrerequisites(tournamentId, { roles: [] })
      .then((refs) => setMembers(refs.filter((r) => r.membership_id != null)))
      .catch(() => setMembers([]));
  }, [tournamentId]);

  const q = query.trim().toLowerCase();
  const shown = (members ?? []).filter((m) => personName(m).toLowerCase().includes(q));

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: "4px", padding: "8px 8px 0" }}>
        <Button type="button" variant="ghost" size="sm" iconOnly title="Back" onClick={onBack}>
          <IconChevronLeft size={14} />
        </Button>
        <span
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: "14px",
            fontWeight: 600,
            color: "var(--color-text-primary)",
          }}
        >
          Preview
        </span>
      </div>
      <div style={{ padding: "8px" }}>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search members"
          font="sans"
          icon={<IconSearch size={13} />}
          size="sm"
          fullWidth
        />
      </div>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: "0 8px 8px",
          display: "flex",
          flexDirection: "column",
          gap: "2px",
        }}
      >
        {members === null ? (
          <div style={{ display: "flex", justifyContent: "center", padding: "24px 0" }}>
            <Spinner />
          </div>
        ) : shown.length === 0 ? (
          <span style={{ ...MUTED, padding: "8px 10px" }}>No members match.</span>
        ) : (
          shown.map((member) => (
            <NavItem
              key={member.membership_id}
              active={selectedId === member.membership_id}
              onClick={() => onSelect(member)}
            >
              {personName(member)}
            </NavItem>
          ))
        )}
      </div>
    </>
  );
}

/** The main area while previewing: the picked member's forms as they'd find them.
 *  Key it by the member, so picking another starts from a blank load. */
export function MemberFlowView({
  tournamentId,
  member,
}: {
  tournamentId: number;
  member: PersonRef | null;
}) {
  const [flow, setFlow] = useState<MemberFormFlow | null>(null);
  const [error, setError] = useState<string>();
  const membershipId = member?.membership_id ?? null;

  useEffect(() => {
    if (membershipId == null) return;
    let cancelled = false;
    formsApi
      .memberFlow(tournamentId, membershipId)
      .then((next) => {
        if (!cancelled) setFlow(next);
      })
      .catch((e) => {
        if (!cancelled)
          setError(e instanceof ApiError ? e.message : "Couldn't load this member's forms.");
      });
    return () => {
      cancelled = true;
    };
  }, [tournamentId, membershipId]);

  return (
    <div style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: "20px 24px" }}>
      {!member ? (
        <EmptyState
          icon={<IconMembers size={28} />}
          title="Preview a member's forms"
          description="Pick a member to see their onboarding steps and every other form, as they'd find them."
        />
      ) : (
        <>
          <div style={{ marginBottom: "16px" }}>
            <FlowTitle>{personName(member)}</FlowTitle>
            <span style={MUTED}>
              {(member.roles ?? []).map((r) => r.label).join(", ") || "No roles"}
            </span>
          </div>
          {error && (
            <p
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: "13px",
                color: "var(--color-danger)",
              }}
            >
              {error}
            </p>
          )}
          {!flow && !error && <Spinner />}
          {flow && <FlowDetail flow={flow} />}
        </>
      )}
    </div>
  );
}

function FlowDetail({ flow }: { flow: MemberFormFlow }) {
  return (
    <>
      <FlowSection label="Onboarding">
        {flow.exempt_from_onboarding && (
          <span style={MUTED}>
            They hold a staff permission, so onboarding doesn&rsquo;t hold them back.
          </span>
        )}
        {flow.onboarding.length === 0 && <span style={MUTED}>No onboarding steps.</span>}
        {flow.onboarding.map((step, i) => (
          <FlowRow key={step.form_id} step={step} number={i + 1} label={onboardingLabel(step)} />
        ))}
      </FlowSection>
      <FlowSection label="Other forms">
        {flow.forms.length === 0 && <span style={MUTED}>No other forms.</span>}
        {flow.forms.map((step) => (
          <FlowRow
            key={step.form_id}
            step={step}
            label={formLabel(step, flow.held_to_onboarding)}
          />
        ))}
      </FlowSection>
    </>
  );
}

type RowLabel = {
  text: string;
  variant: "confirmed" | "interested" | "pending" | "warning" | "default";
  /** The member won't fill it out — dimmed. */
  skipped?: boolean;
};

function onboardingLabel(step: FlowStep): RowLabel {
  if (!step.applies) return { text: "Not eligible", variant: "default", skipped: true };
  if (step.completed) return { text: "Done", variant: "confirmed" };
  if (step.status === "draft") return { text: "Draft", variant: "warning", skipped: true };
  return { text: "To do", variant: "interested" };
}

function formLabel(step: FlowStep, heldToOnboarding: boolean): RowLabel {
  if (step.completed) return { text: "Done", variant: "confirmed" };
  if (step.status === "draft") return { text: "Draft", variant: "warning", skipped: true };
  if (step.status === "archived") return { text: "Archived", variant: "default", skipped: true };
  if (!step.applies) return { text: "Not eligible", variant: "default", skipped: true };
  if (heldToOnboarding) return { text: "After onboarding", variant: "pending" };
  return { text: "Can fill out now", variant: "interested" };
}

function FlowRow({ step, number, label }: { step: FlowStep; number?: number; label: RowLabel }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        opacity: label.skipped ? 0.55 : 1,
      }}
    >
      {number !== undefined && (
        <span
          style={{
            minWidth: "20px",
            textAlign: "right",
            fontFamily: "var(--font-mono)",
            fontSize: "13px",
            color: "var(--color-text-tertiary)",
          }}
        >
          {number}.
        </span>
      )}
      <span style={{ width: "14px", display: "flex", justifyContent: "center" }}>
        {step.completed && <IconCheck size={12} style={{ color: "var(--color-success)" }} />}
      </span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontFamily: "var(--font-sans)",
          fontSize: "13px",
          fontWeight: 500,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {step.name}
      </span>
      <Badge variant={label.variant}>{label.text}</Badge>
    </div>
  );
}
