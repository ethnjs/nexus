"use client";

import { ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { ExportPreset, TorusRole, Tournament, exportPresetsApi } from "@/lib/api";
import { EXTERNAL_SYSTEMS } from "@/lib/exports/externalSystems";
import { copyText, downloadText } from "@/lib/exports/output";
import {
  ExportPage, RememberedExport, forgetLastExport, presetKey, readLastExport, readOutput, writeLastExport,
} from "@/lib/exports/remembered";
import { ExportChoice, exportFilenameFor, exportLabel, runExport, trackNamesOf } from "@/lib/exports/run";
import { useToast } from "@/lib/useToast";
import type { MembersFilterState } from "@/components/tournament/members/MembersFilterModal";
import type { EventsFilterState } from "@/components/tournament/events/EventsFilterModal";
import { ALL_DUOSMIUM_ROLES, ExportModal } from "@/components/tournament/exports/ExportModal";
import { Button } from "@/components/ui/Button";
import { SplitButton } from "@/components/ui/SplitButton";
import { Tooltip } from "@/components/ui/Tooltip";
import { IconChevronLeft, IconChevronRight, IconExport } from "@/components/ui/Icons";

const TORUS_OPTIONS = Object.entries(EXTERNAL_SYSTEMS.find((s) => s.field === "torus_role")!.roles)
  .map(([value, info]) => ({ value: value as TorusRole, label: info.label }));

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
  page: ExportPage;
  // The page's current filters: a one-click export exports what the page shows.
  memberFilters: MembersFilterState;
  eventFilters: EventsFilterState;
  // The page's track tab, if it has one.
  trackId: number | null;
  // Why exporting isn't allowed here, if it isn't.
  lockedReason?: string | null;
  // Toolbar sizing, matching the Filter and Sort buttons beside it.
  size?: "sm" | "md";
  iconOnly?: boolean;
}

export function ExportButton({
  tournament, page, memberFilters, eventFilters, trackId, lockedReason, size = "md", iconOnly = false,
}: ExportButtonProps) {
  const { show } = useToast();
  const tracks = tournament.tracks;
  const trackNames = useMemo(() => trackNamesOf(tournament), [tournament]);

  const [presets, setPresets] = useState<ExportPreset[] | null>(null);
  const [last, setLast] = useState<RememberedExport | null>(null);
  const [running, setRunning] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [panels, setPanels] = useState<Panel[]>([{ id: "root" }]);

  const refreshPresets = useCallback(() => {
    exportPresetsApi.list(tournament.id).then(setPresets).catch(() => setPresets([]));
  }, [tournament.id]);

  useEffect(() => {
    if (lockedReason) return;
    refreshPresets();
  }, [refreshPresets, lockedReason]);

  // Re-read after the screen closes: exporting from it updates the memory.
  useEffect(() => {
    if (!modalOpen) setLast(readLastExport(tournament.id, page));
  }, [tournament.id, page, modalOpen]);

  /** The remembered export as a runnable choice, or null when it no longer
   *  resolves (a deleted track or preset). */
  const toChoice = useCallback((remembered: RememberedExport): ExportChoice | null => {
    if (remembered.kind === "saved") {
      const preset = presets?.find((p) => p.id === remembered.presetId);
      if (!preset) return null;
      return { kind: "custom", presetId: preset.id, shape: preset, trackId: remembered.trackId };
    }
    if (remembered.kind !== "email_list" && !trackNames.has(remembered.trackId)) return null;
    return remembered;
  }, [presets, trackNames]);

  const lastChoice = last && presets ? toChoice(last) : null;

  // A remembered export that stopped resolving is forgotten, not kept broken.
  useEffect(() => {
    if (last && presets && !lastChoice) {
      forgetLastExport(tournament.id, page);
      setLast(null);
    }
  }, [last, presets, lastChoice, tournament.id, page]);

  async function run(remembered: RememberedExport) {
    const choice = toChoice(remembered);
    if (!choice) return;
    writeLastExport(tournament.id, page, remembered);
    setLast(remembered);
    setRunning(true);
    try {
      const result = await runExport(tournament, choice, memberFilters, eventFilters);
      if (result.rows.length === 0) {
        show("Nothing to export with the current filters.", "error");
        return;
      }
      const output = readOutput(tournament.id, presetKey(remembered));
      if (output === "copy") {
        await copyText(result.text);
        show(`Copied ${result.rows.length} row${result.rows.length === 1 ? "" : "s"}`, "success");
      } else {
        downloadText(exportFilenameFor(choice, tournament, trackNames), result.text, output);
      }
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
    else finish({ kind: "duosmium", trackId: nextTrackId, division: tournament.division[0] ?? "", roles: ALL_DUOSMIUM_ROLES }, close);
  }

  function finish(remembered: RememberedExport, close: () => void) {
    close();
    run(remembered);
  }

  // The track a built-in should start from: the page's tab, else the only one.
  const soleTrackId = tracks.length === 1 ? tracks[0].id : null;

  function renderPanel(panel: Panel, close: () => void): ReactNode {
    switch (panel.id) {
      case "root":
        return (
          <>
            <MenuHeading>Built-in</MenuHeading>
            <MenuItem chevron onClick={() => (soleTrackId === null ? push({ id: "torus_track" }) : push({ id: "torus_role", trackId: soleTrackId }))}>
              TORUS
            </MenuItem>
            <MenuItem chevron={soleTrackId === null || tournament.division.length > 1} onClick={() => (
              soleTrackId === null ? push({ id: "duosmium_track" }) : pickDuosmiumTrack(soleTrackId, close)
            )}>
              Duosmium
            </MenuItem>
            <MenuItem onClick={() => finish({ kind: "email_list" }, close)}>Email list</MenuItem>
            <MenuHeading>Saved</MenuHeading>
            {presets === null ? (
              <MenuNote>Loading…</MenuNote>
            ) : presets.length === 0 ? (
              <MenuNote>None yet</MenuNote>
            ) : presets.map((preset) => (
              <MenuItem key={preset.id} onClick={() => finish({ kind: "saved", presetId: preset.id, trackId }, close)}>
                {preset.name}
              </MenuItem>
            ))}
          </>
        );
      case "torus_track":
      case "duosmium_track":
        return tracks.map((track) => (
          <MenuItem
            key={track.id}
            chevron={panel.id === "torus_track" || tournament.division.length > 1}
            onClick={() => (panel.id === "torus_track" ? pickTorusTrack(track.id) : pickDuosmiumTrack(track.id, close))}
          >
            {track.name}
          </MenuItem>
        ));
      case "torus_role":
        return TORUS_OPTIONS.map((option) => (
          <MenuItem key={option.value} onClick={() => finish({ kind: "torus", trackId: panel.trackId, role: option.value }, close)}>
            {option.label}
          </MenuItem>
        ));
      case "duosmium_division":
        return tournament.division.map((division) => (
          <MenuItem
            key={division}
            onClick={() => finish({ kind: "duosmium", trackId: panel.trackId, division, roles: ALL_DUOSMIUM_ROLES }, close)}
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
    const depth = panels.length - 1;
    return (
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ overflow: "hidden" }}>
          {/* Every open step side by side; the strip slides one panel left per step. */}
          <div style={{
            display: "flex", width: `${panels.length * 100}%`,
            transform: `translateX(-${(depth * 100) / panels.length}%)`,
            transition: "transform 200ms ease",
          }}>
            {panels.map((panel, i) => (
              <div key={`${panel.id}-${i}`} style={{ width: `${100 / panels.length}%`, flexShrink: 0 }}>
                {panel.id !== "root" && (
                  <div style={{ display: "flex", alignItems: "center", gap: "4px", padding: "6px 6px 2px" }}>
                    <Button type="button" variant="ghost" size="xs" iconOnly title="Back" onClick={back}>
                      <IconChevronLeft size={12} />
                    </Button>
                    <span style={{ fontFamily: "var(--font-sans)", fontSize: "12px", fontWeight: 600, color: "var(--color-text-secondary)" }}>
                      {PANEL_TITLES[panel.id]}
                    </span>
                  </div>
                )}
                <div style={{ maxHeight: "320px", overflowY: "auto", padding: "6px" }}>
                  {renderPanel(panel, close)}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ borderTop: "1px solid var(--color-border)", padding: "6px" }}>
          <Button type="button" variant="ghost" size="sm" fullWidth onClick={() => { close(); setModalOpen(true); }}>
            Edit presets
          </Button>
        </div>
      </div>
    );
  }

  const label = lastChoice ? `Export ${exportLabel(lastChoice, trackNames)}` : "Export";

  const button = (
    <SplitButton
      label={label}
      icon={<IconExport size={size === "sm" ? 14 : 16} />}
      iconOnly={iconOnly}
      title={lastChoice ? undefined : "Pick or build an export"}
      variant="secondary"
      size={size}
      loading={running}
      disabled={Boolean(lockedReason)}
      onClick={() => (last && lastChoice ? run(last) : setModalOpen(true))}
      menu={{
        width: MENU_WIDTH,
        render: renderMenu,
        // However it closes (a pick or an outside click), it reopens at the top.
        onOpenChange: (open) => { if (!open) setPanels([{ id: "root" }]); },
      }}
    />
  );

  return (
    <>
      {lockedReason ? (
        <Tooltip variant="info" message={lockedReason} showIcon={false}>{button}</Tooltip>
      ) : button}
      {modalOpen && (
        <ExportModal
          tournament={tournament}
          page={page}
          initialMemberFilters={memberFilters}
          initialEventFilters={eventFilters}
          initialTrackId={trackId}
          onPresetsChanged={refreshPresets}
          onClose={() => setModalOpen(false)}
        />
      )}
    </>
  );
}

function MenuHeading({ children }: { children: ReactNode }) {
  return (
    <div style={{
      padding: "8px 10px 4px", fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 700,
      letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--color-text-tertiary)",
    }}>
      {children}
    </div>
  );
}

function MenuNote({ children }: { children: ReactNode }) {
  return (
    <div style={{ padding: "4px 10px", fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)" }}>
      {children}
    </div>
  );
}

function MenuItem({ children, chevron = false, onClick }: { children: ReactNode; chevron?: boolean; onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      fullWidth
      onClick={onClick}
      style={{ justifyContent: "space-between", fontWeight: 500 }}
    >
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{children}</span>
      {chevron && <IconChevronRight size={12} />}
    </Button>
  );
}
