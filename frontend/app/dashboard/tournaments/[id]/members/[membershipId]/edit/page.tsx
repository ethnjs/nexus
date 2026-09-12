"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ApiError, MyTrackOptions, formsApi, membersApi } from "@/lib/api";
import { useMyMembership } from "@/lib/useMyMembership";
import { ARCHIVED_REASON, useArchiveLock } from "@/lib/useArchiveLock";
import { Banner } from "@/components/ui/Banner";
import { MemberEditDraft, TrackDraft, editableTracks, saveDraft, toDraft } from "@/lib/memberEdit";
import { TrackEditSection } from "@/components/tournament/edit/TrackEditSection";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { FloatingSaveBar } from "@/components/ui/FloatingSaveBar";
import { PageHeader } from "@/components/ui/PageHeader";
import { Spinner } from "@/components/ui/Spinner";
import { IconArrowLeft, IconLock } from "@/components/ui/Icons";

/**
 * A member editing their own answers, one section per track.
 *
 * Self-only, and not a coordinator tool: every route it writes to is a
 * `/members/me/` one, and the read-only member page stays the way a
 * coordinator sees somebody. That split is deliberate — a coordinator's own
 * update schema is notes-only, so there is no version of this page for them.
 */
export default function MemberEditPage() {
  const params = useParams();
  const router = useRouter();
  const tournamentId = Number(params.id);
  const membershipId = Number(params.membershipId);

  const { membership: me, loading: membershipLoading } = useMyMembership();
  const isSelf = me?.id === membershipId;
  const { isArchived } = useArchiveLock();

  const [tracks, setTracks] = useState<MyTrackOptions[] | null>(null);
  const [baseline, setBaseline] = useState<MemberEditDraft>({});
  const [draft, setDraft] = useState<MemberEditDraft>({});
  const [loadError, setLoadError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>();
  const [saveBarHeight, setSaveBarHeight] = useState(0);

  useEffect(() => {
    // Waits for the provider: guessing before it lands would refuse a member
    // their own page for a frame, or fetch one they can't have.
    if (membershipLoading || !isSelf || !Number.isFinite(tournamentId)) return;
    Promise.all([membersApi.getMyOptions(tournamentId), formsApi.listMineForTournament(tournamentId)])
      .then(([response, forms]) => {
        const completed = new Set(forms.filter((form) => form.completed).map((form) => form.id));
        const editable = editableTracks(response.tracks, completed);
        setTracks(editable);
        const initial = toDraft(editable);
        setBaseline(initial);
        setDraft(initial);
      })
      .catch((err) => {
        setLoadError(err instanceof ApiError ? err.message : "Failed to load your answers.");
        setTracks([]);
      });
  }, [tournamentId, isSelf, membershipLoading]);

  const isDirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(baseline),
    [draft, baseline],
  );

  function patchTrack(trackId: number, updates: Partial<TrackDraft>) {
    setDraft((current) => ({ ...current, [trackId]: { ...current[trackId], ...updates } }));
  }

  async function handleSave() {
    if (!tracks) return;
    setSaving(true);
    setSaveError(undefined);
    try {
      await saveDraft(tournamentId, tracks, draft, baseline);
      // The draft becomes the new baseline rather than refetching: the writes
      // that succeeded are exactly what it holds, and a refetch would also
      // re-derive answers whose options the TD changed mid-edit.
      setBaseline(draft);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    } finally {
      setSaving(false);
    }
  }

  if (membershipLoading || (isSelf && tracks === null)) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
        <Spinner size="lg" />
      </div>
    );
  }

  if (!isSelf) {
    return (
      <div style={{ maxWidth: "900px", margin: "0 auto" }}>
        <PageHeader heading="Edit your member profile" />
        <Card radius="lg" style={{ padding: "8px" }}>
          <EmptyState
            icon={<IconLock size={28} />}
            title="No access"
            description="You can only edit your own member profile."
          />
        </Card>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: "900px", margin: "0 auto", paddingBottom: `${saveBarHeight}px` }}>
      <div style={{ marginBottom: "16px" }}>
        <Button
          type="button" variant="ghost" size="sm"
          onClick={() => router.push(`/dashboard/tournaments/${tournamentId}/members/${membershipId}`)}
        >
          <IconArrowLeft size={14} /> Back
        </Button>
      </div>

      <PageHeader
        heading="Edit your member profile"
        subheading="Change your availability, lunch, and event preference."
      />

      {loadError && (
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)", marginBottom: "12px" }}>
          {loadError}
        </p>
      )}

      {/* Inputs can't carry a tooltip the way a button does, so the reason
          sits above them once. */}
      {isArchived && (
        <div style={{ marginBottom: "16px" }}>
          <Banner variant="warning" message={ARCHIVED_REASON} />
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {tracks?.length === 0 && !loadError && (
          <Card radius="lg" style={{ padding: "8px" }}>
            <EmptyState title="Nothing to edit yet" description="This tournament hasn't set up any tracks." />
          </Card>
        )}
        {tracks?.map((track) => (
          <TrackEditSection
            key={track.track_id}
            track={track}
            draft={draft[track.track_id]}
            onChange={(updates) => patchTrack(track.track_id, updates)}
            locked={isArchived}
          />
        ))}
      </div>

      <FloatingSaveBar
        visible={isDirty}
        saving={saving}
        error={saveError}
        onSave={handleSave}
        onCancel={() => { setDraft(baseline); setSaveError(undefined); }}
        onHeightChange={setSaveBarHeight}
      />
    </div>
  );
}
