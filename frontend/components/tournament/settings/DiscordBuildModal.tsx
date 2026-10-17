"use client";

import { useEffect, useState } from "react";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { ApiError, type DiscordBuildPreview, type DiscordTrackStatus, discordApi } from "@/lib/api";

const sectionTitle: React.CSSProperties = {
  fontFamily: "var(--font-sans)",
  fontSize: "13px",
  fontWeight: 600,
  color: "var(--color-text-secondary)",
  margin: "16px 0 6px",
};

const listStyle: React.CSSProperties = {
  margin: 0,
  paddingLeft: "18px",
  fontFamily: "var(--font-sans)",
  fontSize: "13px",
  color: "var(--color-text-primary)",
  lineHeight: 1.6,
};

/**
 * The preview of a build or reset, with Confirm. The preview is a dry run of the same build,
 * so it lists exactly what Confirm will do. Confirm must come within 10 minutes.
 */
export function DiscordBuildModal({
  tournamentId,
  trackId,
  reset,
  onClose,
  onStarted,
}: {
  tournamentId: number;
  trackId: number;
  reset: boolean;
  onClose: () => void;
  onStarted: (status: DiscordTrackStatus) => void;
}) {
  const [preview, setPreview] = useState<DiscordBuildPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    discordApi
      .previewBuild(tournamentId, trackId, reset)
      .then(setPreview)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't preview the build."));
  }, [tournamentId, trackId, reset]);

  async function confirm() {
    if (!preview?.preview_token) return;
    setConfirming(true);
    setError(null);
    try {
      onStarted(await discordApi.startBuild(tournamentId, trackId, reset, preview.preview_token));
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't start the build.");
      setConfirming(false);
    }
  }

  const nothingToDo =
    preview !== null && preview.groups.length === 0 && preview.blockers.length === 0;

  return (
    <Modal
      title={reset ? "Reset to defaults" : "Build server"}
      onClose={onClose}
      width={560}
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={reset ? "danger" : "primary"}
            loading={confirming}
            disabled={!preview?.preview_token}
            onClick={confirm}
          >
            Confirm
          </Button>
        </div>
      }
    >
      {error && (
        <div style={{ marginBottom: "12px" }}>
          <Banner variant="error" message={error} />
        </div>
      )}
      {preview === null && !error && (
        <div style={{ display: "flex", justifyContent: "center", padding: "40px 0" }}>
          <Spinner size="lg" />
        </div>
      )}
      {nothingToDo && (
        <p style={{ ...listStyle, paddingLeft: 0 }}>
          Nothing to change. This server already matches NEXUS.
        </p>
      )}
      {preview?.blockers.map((blocker) => (
        <div key={blocker} style={{ marginBottom: "8px" }}>
          <Banner variant="error" message={blocker} />
        </div>
      ))}
      {preview?.warnings.map((warning) => (
        <div key={warning} style={{ marginBottom: "8px" }}>
          <Banner variant="warning" message={warning} />
        </div>
      ))}
      {preview?.groups.map((group) => (
        <div key={group.title}>
          <h3 style={sectionTitle}>
            {group.title} ({group.items.length})
          </h3>
          <ul style={listStyle}>
            {group.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ))}
    </Modal>
  );
}
