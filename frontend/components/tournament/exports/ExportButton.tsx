"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { eventsFilterFromStored } from "@/components/tournament/events/EventsFilterModal";
import { ALL_DUOSMIUM_ROLES, ExportModal } from "@/components/tournament/exports/ExportModal";
import { membersFilterFromStored } from "@/components/tournament/members/MembersFilterModal";
import { Button } from "@/components/ui/Button";
import { DrillMenu, MenuHeading, MenuItem, MenuNote } from "@/components/ui/DrillMenu";
import { IconExport } from "@/components/ui/Icons";
import { SplitButton } from "@/components/ui/SplitButton";
import { Tooltip } from "@/components/ui/Tooltip";
import {
  type ExportOutput,
  type ExportPreset,
  exportPresetsApi,
  type TorusRole,
  type Tournament,
} from "@/lib/api";
import { EXTERNAL_SYSTEMS } from "@/lib/exports/externalSystems";
import { copyText, downloadText } from "@/lib/exports/output";
import {
  type ExportChoice,
  exportFilenameFor,
  logExport,
  runExport,
  trackNamesOf,
} from "@/lib/exports/run";
import { useToast } from "@/lib/useToast";

const TORUS_OPTIONS = Object.entries(
  EXTERNAL_SYSTEMS.find((s) => s.field === "torus_role")!.roles,
).map(([value, info]) => ({ value: value as TorusRole, label: info.label }));

const MENU_WIDTH = 260;

// The steps a built-in walks through before it can export. Steps with only
// one possible answer are skipped, so a one-track tournament never sees a
// track step.
type Panel =
  | { id: "root" }
  | { id: "torus_track" }
  | { id: "torus_role"; trackId: number }
  | { id: "duosmium_track" }
  | { id: "duosmium_division"; trackId: number };

interface ExportButtonProps {
  tournament: Tournament;
  // The page's track tab, if it has one.
  trackId: number | null;
  // Why exporting isn't allowed here, if it isn't.
  lockedReason?: string | null;
  // Toolbar sizing, matching the Filter and Sort buttons beside it.
  size?: "sm" | "md";
  iconOnly?: boolean;
}

export function ExportButton({
  tournament,
  trackId,
  lockedReason,
  size = "md",
  iconOnly = false,
}: ExportButtonProps) {
  const { show } = useToast();
  const tracks = tournament.tracks;
  const trackNames = useMemo(() => trackNamesOf(tournament), [tournament]);

  const [presets, setPresets] = useState<ExportPreset[] | null>(null);
  const [running, setRunning] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [panels, setPanels] = useState<Panel[]>([{ id: "root" }]);

  const refreshPresets = useCallback(() => {
    exportPresetsApi
      .list(tournament.id)
      .then(setPresets)
      .catch(() => setPresets([]));
  }, [tournament.id]);

  useEffect(() => {
    if (lockedReason) return;
    refreshPresets();
  }, [refreshPresets, lockedReason]);

  /** Runs one menu pick. A saved preset goes where it says; a built-in is
   *  copied, since TORUS, Duosmium and email lists all get pasted. */
  async function run(choice: ExportChoice, output: ExportOutput) {
    setRunning(true);
    try {
      // A saved preset brings its own filters; a built-in covers everyone.
      // Never the page's — what's exported shouldn't depend on where you are.
      const custom = choice.kind === "custom" ? choice.shape : null;
      const result = await runExport(
        tournament,
        choice,
        membersFilterFromStored(custom?.member_filters),
        eventsFilterFromStored(custom?.event_filters),
      );
      if (result.rows.length === 0) {
        show("Nothing to export.", "error");
        return;
      }
      if (output === "copy") {
        await copyText(result.text);
        show(`Copied ${result.rows.length} row${result.rows.length === 1 ? "" : "s"}`, "success");
      } else {
        downloadText(exportFilenameFor(choice, tournament, trackNames), result.text, output);
      }
      logExport(tournament, choice, result, output).catch(() =>
        show("Exported, but it couldn't be recorded in the audit log.", "error"),
      );
      for (const warning of result.warnings) show(warning, "error");
    } catch {
      show("Couldn't export. Try again.", "error");
    } finally {
      setRunning(false);
    }
  }

  // ---- The menu ----------------------------------------------------------
  const push = (panel: Panel) => setPanels((stack) => [...stack, panel]);
  const back = () => setPanels((stack) => stack.slice(0, -1));

  function pickTorusTrack(nextTrackId: number) {
    push({ id: "torus_role", trackId: nextTrackId });
  }

  function pickDuosmiumTrack(nextTrackId: number, close: () => void) {
    if (tournament.division.length > 1) push({ id: "duosmium_division", trackId: nextTrackId });
    else
      finish(
        {
          kind: "duosmium",
          trackId: nextTrackId,
          division: tournament.division[0] ?? "",
          roles: ALL_DUOSMIUM_ROLES,
        },
        close,
      );
  }

  function finish(choice: ExportChoice, close: () => void) {
    close();
    run(choice, choice.kind === "custom" ? choice.shape.output_type : "copy");
  }

  // The track a built-in should start from: the page's tab, else the only one.
  const soleTrackId = tracks.length === 1 ? tracks[0].id : null;

  function renderPanel(panel: Panel, close: () => void): ReactNode {
    switch (panel.id) {
      case "root":
        return (
          <>
            <MenuHeading>Built-in</MenuHeading>
            <MenuItem
              chevron
              onClick={() =>
                soleTrackId === null
                  ? push({ id: "torus_track" })
                  : push({ id: "torus_role", trackId: soleTrackId })
              }
            >
              TORUS
            </MenuItem>
            <MenuItem
              chevron={soleTrackId === null || tournament.division.length > 1}
              onClick={() =>
                soleTrackId === null
                  ? push({ id: "duosmium_track" })
                  : pickDuosmiumTrack(soleTrackId, close)
              }
            >
              Duosmium
            </MenuItem>
            <MenuItem onClick={() => finish({ kind: "email_list" }, close)}>Email list</MenuItem>
            <MenuHeading>Saved</MenuHeading>
            {presets === null ? (
              <MenuNote>Loading…</MenuNote>
            ) : presets.length === 0 ? (
              <MenuNote>None yet</MenuNote>
            ) : (
              presets.map((preset) => (
                <MenuItem
                  key={preset.id}
                  onClick={() =>
                    finish({ kind: "custom", presetId: preset.id, shape: preset, trackId }, close)
                  }
                >
                  {preset.name}
                </MenuItem>
              ))
            )}
          </>
        );
      case "torus_track":
      case "duosmium_track":
        return tracks.map((track) => (
          <MenuItem
            key={track.id}
            chevron={panel.id === "torus_track" || tournament.division.length > 1}
            onClick={() =>
              panel.id === "torus_track"
                ? pickTorusTrack(track.id)
                : pickDuosmiumTrack(track.id, close)
            }
          >
            {track.name}
          </MenuItem>
        ));
      case "torus_role":
        return TORUS_OPTIONS.map((option) => (
          <MenuItem
            key={option.value}
            onClick={() =>
              finish({ kind: "torus", trackId: panel.trackId, role: option.value }, close)
            }
          >
            {option.label}
          </MenuItem>
        ));
      case "duosmium_division":
        return tournament.division.map((division) => (
          <MenuItem
            key={division}
            onClick={() =>
              finish(
                { kind: "duosmium", trackId: panel.trackId, division, roles: ALL_DUOSMIUM_ROLES },
                close,
              )
            }
          >
            Division {division}
          </MenuItem>
        ));
    }
  }

  const PANEL_TITLES: Record<Exclude<Panel["id"], "root">, string> = {
    torus_track: "TORUS: pick a track",
    torus_role: "TORUS: pick a role",
    duosmium_track: "Duosmium: pick a track",
    duosmium_division: "Duosmium: pick a division",
  };

  function renderMenu(close: () => void) {
    return (
      <DrillMenu
        stack={panels}
        titleOf={(panel) => (panel.id === "root" ? "" : PANEL_TITLES[panel.id])}
        renderLevel={(panel) => renderPanel(panel, close)}
        onBack={back}
        footer={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            fullWidth
            onClick={() => {
              close();
              setModalOpen(true);
            }}
          >
            Edit presets
          </Button>
        }
      />
    );
  }

  const button = (
    <SplitButton
      label="Export"
      icon={<IconExport size={size === "sm" ? 14 : 16} />}
      iconOnly={iconOnly}
      variant="secondary"
      size={size}
      loading={running}
      disabled={Boolean(lockedReason)}
      onClick={() => setModalOpen(true)}
      menu={{
        width: MENU_WIDTH,
        render: renderMenu,
        // However it closes (a pick or an outside click), it reopens at the top.
        onOpenChange: (open) => {
          if (!open) setPanels([{ id: "root" }]);
        },
      }}
    />
  );

  return (
    <>
      {lockedReason ? (
        <Tooltip variant="info" message={lockedReason} showIcon={false}>
          {button}
        </Tooltip>
      ) : (
        button
      )}
      {modalOpen && (
        <ExportModal
          tournament={tournament}
          initialTrackId={trackId}
          onPresetsChanged={refreshPresets}
          onClose={() => setModalOpen(false)}
        />
      )}
    </>
  );
}
