"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/useAuth";
import { useTournament } from "@/lib/useTournament";
import { useMyMembership } from "@/lib/useMyMembership";
import {
  tournamentsApi, universitiesApi, Tournament, University,
  TournamentState, TournamentLevel, TournamentDivision,
  TOURNAMENT_STATES, TOURNAMENT_LEVELS, TOURNAMENT_DIVISIONS,
  ApiError,
} from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { SettingsSection, SettingsRow } from "@/components/settings/SettingsRow";
import { Input } from "@/components/ui/Input";
import { Combobox } from "@/components/ui/Combobox";
import { Button } from "@/components/ui/Button";
import { ButtonGroup } from "@/components/ui/ButtonGroup";
import { Badge } from "@/components/ui/Badge";
import { FloatingSaveBar } from "@/components/ui/FloatingSaveBar";
import { Spinner } from "@/components/ui/Spinner";
import { DeleteTournamentModal } from "@/components/tournament/settings/DeleteTournamentModal";
import { TransferOwnershipModal } from "@/components/tournament/settings/TransferOwnershipModal";
import { LeaveTournamentModal } from "@/components/tournament/settings/LeaveTournamentModal";
import { ArchiveTournamentModal } from "@/components/tournament/settings/ArchiveTournamentModal";
import { StaffInviteModal } from "@/components/tournament/settings/StaffInviteModal";

interface LevelOption { value: TournamentLevel; label: string }
const LEVEL_OPTIONS: LevelOption[] = TOURNAMENT_LEVELS.map((l) => ({ value: l, label: l[0].toUpperCase() + l.slice(1) }));
const STATE_OPTIONS: TournamentState[] = [...TOURNAMENT_STATES];

interface GeneralDraft {
  name: string;
  short_name: string;
  location: string;        // display text — free-text location, or the matched university's name
  university_id: number | null; // non-null when location is a matched university, not free text
  start_date: string;
  end_date: string;
  state: TournamentState | "";
  level: TournamentLevel | "";
  division: TournamentDivision[];
  is_public: boolean;
}

function toDraft(t: Tournament): GeneralDraft {
  return {
    name: t.name,
    short_name: t.short_name ?? "",
    location: t.location ?? t.university?.name ?? "",
    university_id: t.university?.id ?? null,
    start_date: t.start_date,
    end_date: t.end_date,
    state: t.state,
    level: t.level,
    division: t.division,
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
  const [universities, setUniversities] = useState<University[]>([]);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>(undefined);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);

  useEffect(() => {
    if (selectedTournament) {
      setDraft(toDraft(selectedTournament));
      setStateText(selectedTournament.state);
      setLevelText(LEVEL_OPTIONS.find((o) => o.value === selectedTournament.level)?.label ?? "");
    }
  }, [selectedTournament]);

  useEffect(() => {
    universitiesApi.list().then(setUniversities).catch(() => { });
  }, []);

  const canEdit = !!membership && (membership.is_owner || hasPermission("manage_tournament"));

  const isAdmin = currentUser?.role === "admin";
  const isOwnerOrAdmin = !!membership?.is_owner || isAdmin;
  const hasEnded = !!selectedTournament && selectedTournament.end_date < new Date().toISOString().slice(0, 10);
  const unarchiveNeedsAdmin = !!selectedTournament?.is_archived && hasEnded && !isAdmin;

  const isDirty = useMemo(() => {
    if (!selectedTournament || !draft) return false;
    return JSON.stringify(draft) !== JSON.stringify(toDraft(selectedTournament));
  }, [draft, selectedTournament]);

  function toggleDivision(d: TournamentDivision) {
    setDraft((cur) => cur && {
      ...cur,
      division: cur.division.includes(d) ? cur.division.filter((x) => x !== d) : [...cur.division, d],
    });
  }

  function handleCancel() {
    if (selectedTournament) {
      setDraft(toDraft(selectedTournament));
      setStateText(selectedTournament.state);
      setLevelText(LEVEL_OPTIONS.find((o) => o.value === selectedTournament.level)?.label ?? "");
    }
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
    if (!draft.university_id && !draft.location.trim()) fieldErrors.location = "Location is required.";
    if (!draft.start_date) fieldErrors.start_date = "Start date is required.";
    else if (draft.start_date < new Date().toISOString().slice(0, 10)) fieldErrors.start_date = "Cannot be in the past.";
    if (!draft.end_date) fieldErrors.end_date = "End date is required.";
    else if (draft.end_date < draft.start_date) fieldErrors.end_date = "Cannot be before start date.";
    if (!draft.state) fieldErrors.state = "Pick one from the list.";
    if (!draft.level) fieldErrors.level = "Pick one from the list.";
    if (draft.division.length === 0) fieldErrors.division = "Select at least one division.";

    if (Object.keys(fieldErrors).length > 0 || !draft.state || !draft.level) {
      setErrors(fieldErrors);
      setSaving(false);
      return;
    }

    // Explicit nulls clear whichever field isn't the active source — the
    // backend now applies both atomically (see models.py's before_flush check).
    const source = draft.university_id
      ? { university_id: draft.university_id, location: null }
      : { location: draft.location.trim(), university_id: null };

    try {
      const updated = await tournamentsApi.update(tournamentId, {
        name: draft.name.trim(),
        short_name: draft.short_name.trim() || null,
        start_date: draft.start_date,
        end_date: draft.end_date,
        state: draft.state,
        level: draft.level,
        division: draft.division,
        is_public: draft.is_public,
        ...source,
      });
      setSelectedTournament(updated);
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
    <div>
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
          <SettingsRow label="Location">
            <Combobox
              options={universities}
              getId={(u) => u.id}
              getLabel={(u) => u.name}
              getSearchText={(u) => `${u.name} ${u.abbreviation ?? ""}`}
              value={draft.location}
              onChange={(text, matched) => setDraft((d) => d && { ...d, location: text, university_id: matched?.id ?? null })}
              placeholder="e.g. USC"
              locked={isArchived}
              error={errors.location}
            />
          </SettingsRow>
          <SettingsRow label="Dates">
            <div style={{ display: "flex", gap: "10px" }}>
              <Input
                label="Start"
                type="date"
                fullWidth
                locked={isArchived}
                min={new Date().toISOString().slice(0, 10)}
                value={draft.start_date}
                onChange={(e) => setDraft((d) => d && { ...d, start_date: e.target.value })}
                error={errors.start_date}
              />
              <Input
                label="End"
                type="date"
                fullWidth
                locked={isArchived}
                value={draft.end_date}
                onChange={(e) => setDraft((d) => d && { ...d, end_date: e.target.value })}
                error={errors.end_date}
              />
            </div>
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
          <SettingsRow label="Level">
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
          <SettingsRow label="Division" last>
            <ButtonGroup
              options={TOURNAMENT_DIVISIONS.map((d) => ({ value: d, label: d }))}
              value={draft.division}
              onChange={(v) => toggleDivision(v as TournamentDivision)}
              locked={isArchived}
            />
            {errors.division && (
              <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)", marginTop: "6px" }}>
                {errors.division}
              </p>
            )}
          </SettingsRow>
        </SettingsSection>
      )}

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
        <FloatingSaveBar visible={isDirty} saving={saving} error={saveError} onSave={handleSave} onCancel={handleCancel} />
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
    </div>
  );
}
