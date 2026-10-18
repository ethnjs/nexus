"use client";

import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { SettingsRow, SettingsSection } from "@/components/settings/SettingsRow";
import { DiscordBuildModal } from "@/components/tournament/settings/DiscordBuildModal";
import { SettingsPageHeader } from "@/components/tournament/settings/SettingsPageHeader";
import { Badge } from "@/components/ui/Badge";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { ButtonGroup } from "@/components/ui/ButtonGroup";
import { Card } from "@/components/ui/Card";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { EmptyState } from "@/components/ui/EmptyState";
import { IconDiscord, IconLock } from "@/components/ui/Icons";
import { Spinner } from "@/components/ui/Spinner";
import { Switch } from "@/components/ui/Switch";
import {
  ApiError,
  type DiscordCategoryGrouping,
  type DiscordLinkSettings,
  type DiscordTrackStatus,
  discordApi,
  type TournamentTrack,
} from "@/lib/api";
import { useAuth } from "@/lib/useAuth";
import { useMyMembership } from "@/lib/useMyMembership";
import { useTournament } from "@/lib/useTournament";

const LEFT = "lobot left the server.";

const INSTALL_ERRORS: Record<string, string> = {
  owner_not_linked: `The server owner hasn't linked their Discord account to NEXUS. ${LEFT}`,
  no_permission: `You no longer have permission to add Discord servers. ${LEFT}`,
  tournament_archived: `This tournament is archived. ${LEFT}`,
  track_unavailable: `This track is being deleted or no longer exists. ${LEFT}`,
  guild_linked_elsewhere: "That Discord server is already linked to another track.",
  track_linked_elsewhere: `This track is linked to a different Discord server. Unlink it first. ${LEFT}`,
  discord_cancelled: "Adding lobot was cancelled in Discord.",
  discord_no_guild:
    "Discord didn't say which server lobot joined. If lobot was just removed from that server, wait a few seconds and try again.",
};

function installErrorMessage(code: string, owner: string | null): string {
  if (code === "owner_lacks_permission") {
    return `The server owner (${owner ?? "unknown"}) doesn't have Manage Tournament in this tournament. ${LEFT}`;
  }
  return INSTALL_ERRORS[code] ?? "Something went wrong adding lobot. Try again.";
}

const GROUPING_OPTIONS = [
  { value: "building", label: "Building" },
  { value: "zone", label: "Zone" },
];

const MERGE_HELPER =
  "Events that are the same catalog event in the same building or zone share one channel, like #circuit-lab-bc.";
const BUILD_POLL_MS = 3000;
// A running build refreshes last_build_at every 30 s; one this quiet was interrupted.
// Matches STALE_BUILD_MINUTES in backend/app/core/discord/build.py.
const BUILD_STALE_MS = 2 * 60_000;
const GROUPING_HELPER = "Channel categories are named after each event's building or zone.";

export default function DiscordSettingsPage() {
  return (
    <Suspense>
      <DiscordSettingsContent />
    </Suspense>
  );
}

function DiscordSettingsContent() {
  const params = useParams();
  const tournamentId = Number(params.id);
  const searchParams = useSearchParams();
  const { user: currentUser } = useAuth();
  const { tracks, isSimple, isArchived } = useTournament();
  const { membership, hasPermission, loading: membershipLoading } = useMyMembership();
  const canManageDiscord =
    currentUser?.role === "admin" || !!membership?.is_owner || hasPermission("manage_discord");

  const [statuses, setStatuses] = useState<Record<number, DiscordTrackStatus> | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const linkedTrackId = Number(searchParams.get("linked")) || null;
  const errorCode = searchParams.get("error");
  const [notice] = useState<{ variant: "success" | "error"; message: string } | null>(() => {
    if (errorCode) {
      return {
        variant: "error",
        message: installErrorMessage(errorCode, searchParams.get("owner")),
      };
    }
    if (linkedTrackId) return { variant: "success", message: "The Discord server is linked." };
    return null;
  });

  const trackIds = tracks.map((t) => t.id).join(",");
  useEffect(() => {
    if (!canManageDiscord || !trackIds) return;
    const ids = trackIds.split(",").map(Number);
    Promise.all(ids.map((id) => discordApi.status(tournamentId, id)))
      .then((rows) => setStatuses(Object.fromEntries(rows.map((row) => [row.track_id, row]))))
      .catch((e) => {
        if (e instanceof ApiError && e.status === 404) setUnavailable(true);
        else setLoadError(e instanceof ApiError ? e.message : "Couldn't load Discord settings.");
      });
  }, [tournamentId, trackIds, canManageDiscord]);

  if (membershipLoading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
        <Spinner size="lg" />
      </div>
    );
  }

  if (!canManageDiscord) {
    return (
      <div>
        <SettingsPageHeader page="discord" heading="Discord" />
        <Card radius="lg" style={{ padding: "8px" }}>
          <EmptyState
            icon={<IconLock size={28} />}
            title="No access"
            description="You need the manage Discord permission to view this page."
          />
        </Card>
      </div>
    );
  }

  return (
    <div>
      <SettingsPageHeader page="discord" heading="Discord" />

      {notice && (
        <div style={{ marginBottom: "16px" }}>
          <Banner variant={notice.variant} message={notice.message} />
        </div>
      )}
      {loadError && (
        <div style={{ marginBottom: "16px" }}>
          <Banner variant="error" message={loadError} />
        </div>
      )}

      {unavailable ? (
        <Card radius="lg" style={{ padding: "8px" }}>
          <EmptyState
            icon={<IconDiscord size={28} />}
            title="Discord isn't available"
            description="Discord isn't turned on for this NEXUS deployment."
          />
        </Card>
      ) : statuses === null ? (
        !loadError && (
          <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
            <Spinner size="lg" />
          </div>
        )
      ) : (
        tracks.map((track) => (
          <TrackDiscord
            key={track.id}
            tournamentId={tournamentId}
            track={track}
            title={isSimple ? "Tournament server" : track.name}
            status={statuses[track.id]}
            locked={isArchived}
            onChange={(status) => setStatuses((prev) => ({ ...prev, [status.track_id]: status }))}
          />
        ))
      )}
    </div>
  );
}

function TrackDiscord({
  tournamentId,
  track,
  title,
  status,
  locked,
  onChange,
}: {
  tournamentId: number;
  track: TournamentTrack;
  title: string;
  status: DiscordTrackStatus | undefined;
  locked: boolean;
  onChange: (status: DiscordTrackStatus) => void;
}) {
  const link = status?.link ?? null;
  const [draft, setDraft] = useState<DiscordLinkSettings>({
    merge_divisions: link?.merge_divisions ?? false,
    category_grouping: link?.category_grouping ?? "building",
  });
  const [saveError, setSaveError] = useState<string | null>(null);
  const [unlinking, setUnlinking] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const building =
    link?.last_build_status === "running" &&
    link.last_build_at !== null &&
    now - new Date(link.last_build_at).getTime() < BUILD_STALE_MS;

  // A build runs in the background; poll until it finishes.
  useEffect(() => {
    if (!building) return;
    const interval = setInterval(() => {
      setNow(Date.now());
      discordApi
        .status(tournamentId, track.id)
        .then(onChange)
        .catch(() => {});
    }, BUILD_POLL_MS);
    return () => clearInterval(interval);
  }, [building, tournamentId, track.id, onChange]);

  function install() {
    window.location.assign(discordApi.installUrl(tournamentId, track.id, draft));
  }

  async function save(change: Partial<DiscordLinkSettings>) {
    const previous = draft;
    setDraft({ ...draft, ...change });
    setSaveError(null);
    if (!link) return;
    try {
      onChange(await discordApi.update(tournamentId, track.id, change));
    } catch (e) {
      setDraft(previous);
      setSaveError(e instanceof ApiError ? e.message : "Couldn't save. Try again.");
    }
  }

  const settingsRows = (
    <>
      <SettingsRow
        label="Division merge"
        helper={MERGE_HELPER}
        contentStyle={{ display: "flex", justifyContent: "flex-end" }}
      >
        <Switch
          checked={draft.merge_divisions}
          onChange={(merge_divisions) => save({ merge_divisions })}
          locked={locked}
        />
      </SettingsRow>
      <SettingsRow
        label="Categories by"
        helper={GROUPING_HELPER}
        contentStyle={{ display: "flex", justifyContent: "flex-end" }}
      >
        <ButtonGroup
          options={GROUPING_OPTIONS}
          value={draft.category_grouping}
          onChange={(value) => save({ category_grouping: value as DiscordCategoryGrouping })}
          size="sm"
          locked={locked}
        />
      </SettingsRow>
    </>
  );

  if (!link) {
    return (
      <SettingsSection title={title}>
        {settingsRows}
        <SettingsRow
          label="Add to Discord"
          helper="Pick a server in Discord. Its owner must have linked their Discord account to NEXUS and have Manage Tournament in this tournament; otherwise lobot leaves right away. Adding lobot changes nothing in the server until you build it."
          last
          contentStyle={{ display: "flex", justifyContent: "flex-end" }}
        >
          <Button variant="primary" onClick={install} disabled={locked}>
            <IconDiscord variant="white" /> Add to Discord
          </Button>
        </SettingsRow>
      </SettingsSection>
    );
  }

  const removed = link.bot_removed_at !== null;
  return (
    <SettingsSection title={title}>
      <SettingsRow
        label="Server"
        helper={link.installed_by_name ? `Added by ${link.installed_by_name}` : undefined}
        contentStyle={{
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          gap: "8px",
        }}
      >
        <span style={{ fontFamily: "var(--font-sans)", fontSize: "14px", fontWeight: 600 }}>
          {link.guild_name ?? link.guild_id}
        </span>
        {removed ? (
          <Badge variant="removed">lobot removed</Badge>
        ) : building ? (
          <Badge variant="pending">Building…</Badge>
        ) : link.built_at ? (
          <Badge variant="confirmed">Built</Badge>
        ) : (
          <Badge variant="pending">Not built yet</Badge>
        )}
      </SettingsRow>
      {removed && (
        <div style={{ margin: "12px 0" }}>
          <Banner
            variant="warning"
            message="lobot was removed from this server, so syncing has stopped. Add it back to resume."
            action={
              <Button size="sm" variant="secondary" onClick={install} disabled={locked}>
                Add lobot back
              </Button>
            }
          />
        </div>
      )}
      {link.last_build_error && !building && (
        <div style={{ margin: "12px 0" }}>
          <Banner variant="error" message={`Last build failed: ${link.last_build_error}`} />
        </div>
      )}
      {link.last_sync_error ? (
        <div style={{ margin: "12px 0" }}>
          <Banner variant="error" message={`Last sync failed: ${link.last_sync_error}`} />
        </div>
      ) : (
        link.last_sync_warning && (
          <div style={{ margin: "12px 0" }}>
            <Banner variant="warning" message={link.last_sync_warning} />
          </div>
        )
      )}
      {settingsRows}
      {saveError && (
        <div style={{ margin: "12px 0" }}>
          <Banner variant="error" message={saveError} />
        </div>
      )}
      <SettingsRow
        label={link.built_at ? "Reset to defaults" : "Build server"}
        helper={
          link.built_at
            ? "Puts NEXUS's roles, channels and permissions back the way NEXUS sets them up, undoing hand edits. Shows exactly what changes first."
            : "Creates the server's roles, categories and channels, and the #verify gate. Shows exactly what changes first."
        }
        contentStyle={{ display: "flex", justifyContent: "flex-end" }}
      >
        <Button
          variant={link.built_at ? "secondary" : "primary"}
          onClick={() => setPreviewing(true)}
          disabled={locked || removed || building}
        >
          {link.built_at ? "Reset to defaults" : "Build server"}
        </Button>
      </SettingsRow>
      <SettingsRow
        label="Unlink"
        helper="lobot leaves the server. The server's roles and channels stay as they are."
        last
        contentStyle={{ display: "flex", justifyContent: "flex-end" }}
      >
        <Button variant="secondary" onClick={() => setUnlinking(true)} disabled={locked}>
          Unlink
        </Button>
      </SettingsRow>
      {link.built_at && (
        <p
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: "12px",
            color: "var(--color-text-secondary)",
            margin: "0 0 12px",
          }}
        >
          Changes to division merge and categories take effect the next time the server is reset.
        </p>
      )}
      {previewing && (
        <DiscordBuildModal
          tournamentId={tournamentId}
          trackId={track.id}
          reset={link.built_at !== null}
          onClose={() => setPreviewing(false)}
          onStarted={onChange}
        />
      )}
      {unlinking && (
        <ConfirmModal
          title="Unlink this Discord server?"
          description={`lobot leaves ${link.guild_name ?? "the server"}. Roles and channels stay as they are, and syncing stops. You can add it back later.`}
          confirmLabel="Unlink"
          onConfirm={() => discordApi.unlink(tournamentId, track.id)}
          onClose={() => setUnlinking(false)}
          onConfirmed={() => {
            setDraft({ merge_divisions: false, category_grouping: "building" });
            onChange({ track_id: track.id, link: null });
          }}
        />
      )}
    </SettingsSection>
  );
}
