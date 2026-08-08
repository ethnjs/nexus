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
import { Badge } from "@/components/ui/Badge";
import { FloatingSaveBar } from "@/components/ui/FloatingSaveBar";
import { Spinner } from "@/components/ui/Spinner";
import { DeleteTournamentModal } from "@/components/tournament/settings/DeleteTournamentModal";
import { TransferOwnershipModal } from "@/components/tournament/settings/TransferOwnershipModal";
import { LeaveTournamentModal } from "@/components/tournament/settings/LeaveTournamentModal";

interface LevelOption { value: TournamentLevel; label: string }
const LEVEL_OPTIONS: LevelOption[] = TOURNAMENT_LEVELS.map((l) => ({ value: l, label: l[0].toUpperCase() + l.slice(1) }));
const STATE_OPTIONS: TournamentState[] = [...TOURNAMENT_STATES];

interface GeneralDraft {
  name:          string;
  short_name:    string;
  location:      string;        // display text — free-text location, or the matched university's name
  university_id: number | null; // non-null when location is a matched university, not free text
  start_date:    string;
  end_date:      string;
  state:         TournamentState | "";
  level:         TournamentLevel | "";
  division:      TournamentDivision[];
  is_public:     boolean;
}

function toDraft(t: Tournament): GeneralDraft {
  return {
    name:          t.name,
    short_name:    t.short_name ?? "",
    location:      t.location ?? t.university?.name ?? "",
    university_id: t.university?.id ?? null,
    start_date:    t.start_date,
    end_date:      t.end_date,
    state:         t.state,
    level:         t.level,
    division:      t.division,
    is_public:     t.is_public,
  };
}

export default function GeneralSettingsPage() {
  const params = useParams();
  const router = useRouter();
  const tournamentId = Number(params.id);
  const { user: currentUser } = useAuth();
  const { selectedTournament, setSelectedTournament } = useTournament();
  const { membership, hasPermission, loading: membershipLoading } = useMyMembership();

  const [draft, setDraft] = useState<GeneralDraft | null>(null);
  const [universities, setUniversities] = useState<University[]>([]);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>(undefined);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showLeaveModal, setShowLeaveModal] = useState(false);

  useEffect(() => {
    if (selectedTournament) setDraft(toDraft(selectedTournament));
  }, [selectedTournament]);

  useEffect(() => {
    universitiesApi.list().then(setUniversities).catch(() => {});
  }, []);

  const canEdit = !!membership && (membership.is_owner || hasPermission("manage_tournament"));

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
    if (selectedTournament) setDraft(toDraft(selectedTournament));
    setErrors({});
    setSaveError(undefined);
  }

  async function handleSave() {
    if (!selectedTournament || !draft) return;
    setSaving(true);
    setSaveError(undefined);
    setErrors({});

    if (!draft.name.trim()) { setErrors((e) => ({ ...e, name: "Cannot be empty." })); setSaving(false); return; }
    if (/\d/.test(draft.name)) { setErrors((e) => ({ ...e, name: "Name must not contain numbers." })); setSaving(false); return; }
    if (!draft.university_id && !draft.location.trim()) { setSaveError("Location is required."); setSaving(false); return; }
    if (!draft.start_date || !draft.end_date) { setSaveError("Start and end date are required."); setSaving(false); return; }
    if (draft.end_date < draft.start_date) { setSaveError("End date cannot be before start date."); setSaving(false); return; }
    if (!draft.state) { setSaveError("State is required — pick one from the list."); setSaving(false); return; }
    if (!draft.level) { setSaveError("Level is required — pick one from the list."); setSaving(false); return; }
    if (draft.division.length === 0) { setSaveError("Select at least one division."); setSaving(false); return; }

    // Explicit nulls clear whichever field isn't the active source — the
    // backend now applies both atomically (see models.py's before_flush check).
    const source = draft.university_id
      ? { university_id: draft.university_id, location: null }
      : { location: draft.location.trim(), university_id: null };

    try {
      const updated = await tournamentsApi.update(tournamentId, {
        name:       draft.name.trim(),
        short_name: draft.short_name.trim() || null,
        start_date: draft.start_date,
        end_date:   draft.end_date,
        state:      draft.state,
        level:      draft.level,
        division:   draft.division,
        is_public:  draft.is_public,
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
      <PageHeader heading="General" subheading="Tournament Settings"/>

      {canEdit && (
        <>
          <SettingsSection title="Details">
            <SettingsRow label="Name">
              <Input
                fullWidth
                charset="alpha"
                value={draft.name}
                onChange={(e) => setDraft((d) => d && { ...d, name: e.target.value })}
                error={errors.name}
              />
            </SettingsRow>
            <SettingsRow label="Short name">
              <Input
                fullWidth
                charset="alpha"
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
              />
            </SettingsRow>
            <SettingsRow label="Dates">
              <div style={{ display: "flex", gap: "10px" }}>
                <Input
                  label="Start"
                  type="date"
                  fullWidth
                  value={draft.start_date}
                  onChange={(e) => setDraft((d) => d && { ...d, start_date: e.target.value })}
                />
                <Input
                  label="End"
                  type="date"
                  fullWidth
                  value={draft.end_date}
                  onChange={(e) => setDraft((d) => d && { ...d, end_date: e.target.value })}
                />
              </div>
            </SettingsRow>
            <SettingsRow label="State">
              <Combobox
                options={STATE_OPTIONS}
                getId={(s) => s}
                getLabel={(s) => s}
                allowFreeText={false}
                value={draft.state}
                onChange={(_, matched) => setDraft((d) => d && { ...d, state: matched ?? "" })}
              />
            </SettingsRow>
            <SettingsRow label="Level">
              <Combobox
                options={LEVEL_OPTIONS}
                getId={(o) => o.value}
                getLabel={(o) => o.label}
                allowFreeText={false}
                value={LEVEL_OPTIONS.find((o) => o.value === draft.level)?.label ?? ""}
                onChange={(_, matched) => setDraft((d) => d && { ...d, level: matched?.value ?? "" })}
              />
            </SettingsRow>
            <SettingsRow label="Division" last>
              <div style={{ display: "flex", gap: "8px" }}>
                {TOURNAMENT_DIVISIONS.map((d) => (
                  <Button
                    key={d}
                    type="button"
                    variant={draft.division.includes(d) ? "primary" : "secondary"}
                    size="sm"
                    onClick={() => toggleDivision(d)}
                  >
                    {d}
                  </Button>
                ))}
              </div>
            </SettingsRow>
          </SettingsSection>

          <SettingsSection title="Visibility">
            <SettingsRow label="Public directory" helper="Show this tournament in the public directory.">
              <Button
                type="button"
                variant={draft.is_public ? "primary" : "secondary"}
                size="sm"
                onClick={() => setDraft((d) => d && { ...d, is_public: !d.is_public })}
              >
                {draft.is_public ? "Public" : "Private"}
              </Button>
            </SettingsRow>
            <SettingsRow label="Verification" helper="Get verified by NEXUS admin." last>
              {selectedTournament.is_verified ? (
                <Badge variant="confirmed">Verified</Badge>
              ) : (
                <Button type="button" variant="secondary" size="sm" disabled>
                  Request
                </Button>
              )}
            </SettingsRow>
          </SettingsSection>
        </>
      )}

      <SettingsSection title="Danger Zone" variant="danger">
        {membership?.is_owner ? (
          <>
            <SettingsRow label="Transfer ownership" helper="Give another member full ownership of this tournament.">
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <Button type="button" variant="danger" size="md" onClick={() => setShowTransferModal(true)}>
                  Transfer
                </Button>
              </div>
            </SettingsRow>
            <SettingsRow label="Delete tournament" helper="Permanently delete this tournament and everything in it." last>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <Button type="button" variant="danger" size="md" onClick={() => setShowDeleteModal(true)}>
                  Delete
                </Button>
              </div>
            </SettingsRow>
          </>
        ) : (
          <SettingsRow label="Leave tournament" helper="Remove yourself from this tournament." last>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <Button type="button" variant="danger" size="md" onClick={() => setShowLeaveModal(true)}>
                Leave
              </Button>
            </div>
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
    </div>
  );
}
