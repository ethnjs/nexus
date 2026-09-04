"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/useAuth";
import { useTournament } from "@/lib/useTournament";
import { useMyMembership } from "@/lib/useMyMembership";
import {
  tournamentsApi, Tournament,
  TournamentState, TournamentLevel,
  TOURNAMENT_STATES, TOURNAMENT_LEVELS,
  ApiError,
} from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { SettingsSection, SettingsRow } from "@/components/settings/SettingsRow";
import { Input } from "@/components/ui/Input";
import { Combobox } from "@/components/ui/Combobox";
import { Button } from "@/components/ui/Button";
import { ButtonGroup } from "@/components/ui/ButtonGroup";
import { Badge } from "@/components/ui/Badge";
import { Toggle } from "@/components/ui/Toggle";
import { FloatingSaveBar } from "@/components/ui/FloatingSaveBar";
import { Spinner } from "@/components/ui/Spinner";
import { DeleteTournamentModal } from "@/components/tournament/settings/DeleteTournamentModal";
import { TransferOwnershipModal } from "@/components/tournament/settings/TransferOwnershipModal";
import { LeaveTournamentModal } from "@/components/tournament/settings/LeaveTournamentModal";
import { ArchiveTournamentModal } from "@/components/tournament/settings/ArchiveTournamentModal";
import { StaffInviteModal } from "@/components/tournament/settings/StaffInviteModal";
import { AgeDisclosureToggleModal } from "@/components/tournament/settings/AgeDisclosureToggleModal";
import { TracksSection, useTrackEditor } from "@/components/tournament/settings/TracksSection";

interface LevelOption { value: TournamentLevel; label: string }
const LEVEL_OPTIONS: LevelOption[] = TOURNAMENT_LEVELS.map((l) => ({ value: l, label: l[0].toUpperCase() + l.slice(1) }));
const STATE_OPTIONS: TournamentState[] = [...TOURNAMENT_STATES];

// Dates, venue and divisions are absent by design — they belong to the
// tracks below, and the tournament derives its own from them. Sending one
// here is a 422 (TournamentUpdate is extra="forbid").
interface GeneralDraft {
  name: string;
  short_name: string;
  state: TournamentState | "";
  level: TournamentLevel | "";
  is_public: boolean;
}

function toDraft(t: Tournament): GeneralDraft {
  return {
    name: t.name,
    short_name: t.short_name ?? "",
    state: t.state,
    level: t.level,
    is_public: t.is_public,
  };
}

export default function GeneralSettingsPage() {
  const params = useParams();
  const router = useRouter();
  const tournamentId = Number(params.id);
  const { user: currentUser } = useAuth();
  const { selectedTournament, setSelectedTournament, isArchived } = useTournament();
  const { membership, hasPermission, loading: membershipLoading } = useMyMembership();

  const [draft, setDraft] = useState<GeneralDraft | null>(null);
  const [stateText, setStateText] = useState("");
  const [levelText, setLevelText] = useState("");
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>(undefined);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [pendingAgeToggle, setPendingAgeToggle] = useState<"collect_is_over_18" | "collect_is_over_21" | null>(null);
  const [ageToggleError, setAgeToggleError] = useState<string | undefined>(undefined);
  // Reserved as bottom padding so the fixed save bar never covers the last
  // row — a track row scrolling itself into view has to land above it.
  const [saveBarHeight, setSaveBarHeight] = useState(0);

  useEffect(() => {
    if (selectedTournament) {
      setDraft(toDraft(selectedTournament));
      setStateText(selectedTournament.state);
      setLevelText(LEVEL_OPTIONS.find((o) => o.value === selectedTournament.level)?.label ?? "");
    }
  }, [selectedTournament]);

  const canEdit = !!membership && (membership.is_owner || hasPermission("manage_tournament"));

  const isAdmin = currentUser?.role === "admin";
  const isOwnerOrAdmin = !!membership?.is_owner || isAdmin;
  // The last day it runs — `dates` is already sorted, and its final entry is
  // the real end even when the days aren't contiguous.
  const lastDay = selectedTournament?.dates.at(-1);
  const hasEnded = !!lastDay && lastDay < new Date().toISOString().slice(0, 10);
  const unarchiveNeedsAdmin = !!selectedTournament?.is_archived && hasEnded && !isAdmin;

  // The tournament's own dates, location and division are derived from its
  // tracks, so any track write changes the header — refetch it.
  const refetch = useCallback(() => {
    tournamentsApi.get(tournamentId).then(setSelectedTournament).catch(() => {});
  }, [tournamentId, setSelectedTournament]);
  const trackEditor = useTrackEditor(tournamentId, refetch);

  const detailsDirty = useMemo(() => {
    if (!selectedTournament || !draft) return false;
    return JSON.stringify(draft) !== JSON.stringify(toDraft(selectedTournament));
  }, [draft, selectedTournament]);
  // One bar for the page: the details fields and every track row are the
  // same set of unsaved changes as far as the TD is concerned.
  const isDirty = detailsDirty || trackEditor.isDirty;

  // Turning collection ON needs the type-to-confirm modal (real
  // consequences for existing members); turning it OFF applies immediately —
  // nothing is destroyed and no one loses access.
  async function handleAgeToggleChange(flag: "collect_is_over_18" | "collect_is_over_21", checked: boolean) {
    if (checked) {
      setPendingAgeToggle(flag);
      return;
    }
    setAgeToggleError(undefined);
    try {
      const updated = await tournamentsApi.update(tournamentId, { [flag]: false });
      setSelectedTournament(updated);
    } catch (err: unknown) {
      setAgeToggleError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    }
  }

  function handleCancel() {
    if (selectedTournament) {
      setDraft(toDraft(selectedTournament));
      setStateText(selectedTournament.state);
      setLevelText(LEVEL_OPTIONS.find((o) => o.value === selectedTournament.level)?.label ?? "");
    }
    trackEditor.reset();
    setErrors({});
    setSaveError(undefined);
  }

  async function handleSave() {
    if (!selectedTournament || !draft) return;
    setSaving(true);
    setSaveError(undefined);
    setErrors({});

    const fieldErrors: Record<string, string> = {};
    if (!draft.name.trim()) fieldErrors.name = "Cannot be empty.";
    else if (/\d/.test(draft.name)) fieldErrors.name = "Name must not contain numbers.";
    if (!draft.state) fieldErrors.state = "Pick one from the list.";
    if (!draft.level) fieldErrors.level = "Pick one from the list.";

    if (Object.keys(fieldErrors).length > 0 || !draft.state || !draft.level) {
      setErrors(fieldErrors);
      setSaving(false);
      return;
    }

    try {
      if (detailsDirty) {
        setSelectedTournament(await tournamentsApi.update(tournamentId, {
          name: draft.name.trim(),
          short_name: draft.short_name.trim() || null,
          state: draft.state,
          level: draft.level,
          is_public: draft.is_public,
        }));
      }
      // Tracks are separate resources with their own writes — the bar is
      // shared, the requests aren't. A track failure leaves the details
      // saved, which is why the error names the tracks specifically.
      const trackError = await trackEditor.save();
      if (trackError) setSaveError(trackError);
    } catch (error: unknown) {
      setSaveError(error instanceof ApiError ? error.message : "Something went wrong. Try again.");
    } finally {
      setSaving(false);
    }
  }

  if (membershipLoading || !selectedTournament || !draft) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div style={{ paddingBottom: `${saveBarHeight}px` }}>
      <PageHeader heading="General" subheading="Tournament Settings" />

      {canEdit && (
        <SettingsSection title="Details">
          <SettingsRow label="Name">
            <Input
              fullWidth
              charset="alpha"
              locked={isArchived}
              value={draft.name}
              onChange={(e) => setDraft((d) => d && { ...d, name: e.target.value })}
              error={errors.name}
            />
          </SettingsRow>
          <SettingsRow label="Short name">
            <Input
              fullWidth
              charset="alpha"
              locked={isArchived}
              value={draft.short_name}
              onChange={(e) => setDraft((d) => d && { ...d, short_name: e.target.value })}
            />
          </SettingsRow>
          <SettingsRow label="State">
            <Combobox
              options={STATE_OPTIONS}
              getId={(s) => s}
              getLabel={(s) => s}
              allowFreeText={false}
              value={stateText}
              onChange={(text, matched) => { setStateText(text); setDraft((d) => d && { ...d, state: matched ?? "" }); }}
              locked={isArchived}
              error={errors.state}
            />
          </SettingsRow>
          <SettingsRow label="Level" last>
            <Combobox
              options={LEVEL_OPTIONS}
              getId={(o) => o.value}
              getLabel={(o) => o.label}
              allowFreeText={false}
              value={levelText}
              onChange={(text, matched) => { setLevelText(text); setDraft((d) => d && { ...d, level: matched?.value ?? "" }); }}
              locked={isArchived}
              error={errors.level}
            />
          </SettingsRow>
        </SettingsSection>
      )}

      {canEdit && <TracksSection editor={trackEditor} locked={isArchived} />}

      {isOwnerOrAdmin && (
        <SettingsSection title="Invites">
          <SettingsRow
            label="Invite staff"
            helper={isArchived ? "Unarchive first to invite staff." : "Send a join link by email."}
            contentStyle={{ display: "flex", justifyContent: "flex-end" }}
            last
          >
            <Button type="button" variant="secondary" size="md" disabled={isArchived} onClick={() => setShowInviteModal(true)}>
              Invite staff
            </Button>
          </SettingsRow>
        </SettingsSection>
      )}

      {canEdit && (
        <SettingsSection title="Visibility">
          <SettingsRow label="Visibility" helper="Public tournaments are discoverable and joinable without an invite.">
            <ButtonGroup
              options={[{ value: "public", label: "Public" }, { value: "private", label: "Private" }]}
              value={draft.is_public ? "public" : "private"}
              onChange={(v) => setDraft((d) => d && { ...d, is_public: v === "public" })}
              locked={isArchived}
            />
          </SettingsRow>
          <SettingsRow
            label="Verification"
            helper="Get verified by NEXUS admin."
            contentStyle={{ display: "flex", justifyContent: "flex-end" }}
            last
          >
            {selectedTournament.is_verified ? (
              <Badge variant="confirmed">Verified</Badge>
            ) : (
              <Button type="button" variant="secondary" size="md" disabled>
                Request
              </Button>
            )}
          </SettingsRow>
        </SettingsSection>
      )}

      {canEdit && (
        <SettingsSection title="Age Disclosure">
          <SettingsRow
            label="Collect 18+ status"
            helper="Members consent before this is shared — their date of birth is never sent."
          >
            <Toggle
              checked={selectedTournament.collect_is_over_18}
              onChange={(v) => handleAgeToggleChange("collect_is_over_18", v)}
              locked={isArchived}
            />
          </SettingsRow>
          <SettingsRow
            label="Collect 21+ status"
            helper="Members consent before this is shared — their date of birth is never sent."
            last
          >
            <Toggle
              checked={selectedTournament.collect_is_over_21}
              onChange={(v) => handleAgeToggleChange("collect_is_over_21", v)}
              locked={isArchived}
            />
          </SettingsRow>
          {ageToggleError && (
            <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)", marginTop: "6px" }}>
              {ageToggleError}
            </p>
          )}
        </SettingsSection>
      )}

      <SettingsSection title="Danger Zone" variant="danger">
        {isOwnerOrAdmin && (
          <SettingsRow
            label={selectedTournament.is_archived ? "Unarchive tournament" : "Archive tournament"}
            helper={
              selectedTournament.is_archived
                ? unarchiveNeedsAdmin
                  ? "This tournament has ended — only an admin can unarchive it."
                  : "Restore full editing access."
                : "Lock this tournament as read-only history."
            }
            contentStyle={{ display: "flex", justifyContent: "flex-end" }}
          >
            <Button
              type="button"
              variant="danger"
              size="md"
              disabled={unarchiveNeedsAdmin}
              onClick={() => setShowArchiveModal(true)}
            >
              {selectedTournament.is_archived ? "Unarchive" : "Archive"}
            </Button>
          </SettingsRow>
        )}

        {membership?.is_owner && (
          <SettingsRow
            label="Transfer ownership"
            helper="Give another member full ownership of this tournament."
            contentStyle={{ display: "flex", justifyContent: "flex-end" }}
          >
            <Button type="button" variant="danger" size="md" disabled={isArchived} onClick={() => setShowTransferModal(true)}>
              Transfer
            </Button>
          </SettingsRow>
        )}

        {isOwnerOrAdmin && (
          <SettingsRow
            label="Delete tournament"
            helper={isArchived ? "Unarchive first to delete this tournament." : "Permanently delete this tournament and everything in it."}
            contentStyle={{ display: "flex", justifyContent: "flex-end" }}
            last={!membership || membership.is_owner}
          >
            <Button type="button" variant="danger" size="md" disabled={isArchived} onClick={() => setShowDeleteModal(true)}>
              Delete
            </Button>
          </SettingsRow>
        )}

        {membership && !membership.is_owner && (
          <SettingsRow
            label="Leave tournament"
            contentStyle={{ display: "flex", justifyContent: "flex-end" }}
            last
          >
            <Button type="button" variant="danger" size="md" onClick={() => setShowLeaveModal(true)}>
              Leave
            </Button>
          </SettingsRow>
        )}
      </SettingsSection>

      {canEdit && (
        <FloatingSaveBar
          visible={isDirty} saving={saving} error={saveError}
          onSave={handleSave} onCancel={handleCancel}
          onHeightChange={setSaveBarHeight}
        />
      )}

      {showDeleteModal && selectedTournament && (
        <DeleteTournamentModal
          tournamentId={tournamentId}
          tournamentName={selectedTournament.name}
          onClose={() => setShowDeleteModal(false)}
          onDeleted={() => router.push("/dashboard")}
        />
      )}

      {showTransferModal && currentUser && (
        <TransferOwnershipModal
          tournamentId={tournamentId}
          currentUserId={currentUser.id}
          onClose={() => setShowTransferModal(false)}
          onTransferred={() => { window.location.href = window.location.pathname; }}
        />
      )}

      {showLeaveModal && selectedTournament && (
        <LeaveTournamentModal
          tournamentId={tournamentId}
          tournamentName={selectedTournament.name}
          onClose={() => setShowLeaveModal(false)}
          onLeft={() => router.push("/dashboard")}
        />
      )}

      {showArchiveModal && selectedTournament && (
        <ArchiveTournamentModal
          tournamentId={tournamentId}
          tournamentName={selectedTournament.name}
          mode={selectedTournament.is_archived ? "unarchive" : "archive"}
          onClose={() => setShowArchiveModal(false)}
          onDone={(updated) => { setSelectedTournament(updated); setShowArchiveModal(false); }}
        />
      )}

      {showInviteModal && (
        <StaffInviteModal
          tournamentId={tournamentId}
          onClose={() => setShowInviteModal(false)}
        />
      )}

      {pendingAgeToggle && (
        <AgeDisclosureToggleModal
          tournamentId={tournamentId}
          flag={pendingAgeToggle}
          thresholdLabel={pendingAgeToggle === "collect_is_over_18" ? "18+" : "21+"}
          onClose={() => setPendingAgeToggle(null)}
          onDone={(updated) => { setSelectedTournament(updated); setPendingAgeToggle(null); }}
        />
      )}
    </div>
  );
}
