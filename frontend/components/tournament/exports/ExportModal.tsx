"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Assignment, DisplayConfigCatalog, DuosmiumRole, ExportPreset, ExportPresetInput, MembershipFull,
  RoleWithMemberCount, TorusRole, Tournament, TournamentEvent, assignmentsApi, displayConfigApi,
  exportPresetsApi, membersApi, rolesApi, tournamentEventsApi,
} from "@/lib/api";
import { BUILTINS, BuiltinId } from "@/lib/exports/builtins";
import { availableExportColumns, exportContext, resolveExportColumn } from "@/lib/exports/columns";
import { copyText, downloadText } from "@/lib/exports/output";
import {
  ExportOutput, ExportPage, RememberedExport, presetKey, writeLastExport, writeOutput,
} from "@/lib/exports/remembered";
import {
  ExportChoice, computeExport, eventIdsFor, exportFilenameFor, fieldsForChoice, trackNamesOf,
} from "@/lib/exports/run";
import { useExitAnimation } from "@/lib/useExitAnimation";
import { useToast } from "@/lib/useToast";
import { useActionToast } from "@/lib/useActionToast";
import {
  MembersFilterModal, MembersFilterState, membersFilterFromStored, membersFilterParams,
} from "@/components/tournament/members/MembersFilterModal";
import {
  EVENT_TYPE_OPTIONS, EventsFilterModal, EventsFilterState, eventBuildingOptions, eventCategoryOptions,
  eventDivisionOptions, eventShiftOptions, eventTrackOptions, eventsFilterFromStored, isEventsFilterActive,
} from "@/components/tournament/events/EventsFilterModal";
import { isFilterActive } from "@/components/ui/FilterModal";
import { BuiltinOptions } from "@/components/tournament/exports/BuiltinOptions";
import { ExportPreview } from "@/components/tournament/exports/ExportPreview";
import { BuilderDraft, PresetBuilder } from "@/components/tournament/exports/PresetBuilder";
import { Button } from "@/components/ui/Button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { EmptyState } from "@/components/ui/EmptyState";
import { FilterButton } from "@/components/ui/FilterButton";
import { IconExport, IconPlus, IconX } from "@/components/ui/Icons";

type Selection =
  | { kind: "builtin"; id: BuiltinId }
  | { kind: "saved"; id: number }
  | { kind: "new" };

const EMPTY_DRAFT: BuilderDraft = { name: "", row_type: null, columns: [], sorts: [], include_header: true };

export const ALL_DUOSMIUM_ROLES: DuosmiumRole[] = ["tournament_director", "scoremaster", "event_supervisor"];

function draftFromPreset(preset: ExportPreset): BuilderDraft {
  return {
    name: preset.name, row_type: preset.row_type, columns: preset.columns,
    sorts: preset.sorts, include_header: preset.include_header,
  };
}

/** Everything a saved preset stores, as one string — the dirty check. Not
 *  the filters: those belong to the page, never to a preset. */
function snapshot(draft: BuilderDraft): string {
  return JSON.stringify(draft);
}

/** What the Export button reruns. An unsaved custom export can't be rerun. */
function rememberedOf(choice: ExportChoice): RememberedExport | null {
  if (choice.kind === "custom") {
    return choice.presetId === null ? null : { kind: "saved", presetId: choice.presetId, trackId: choice.trackId };
  }
  return choice;
}

interface ExportModalProps {
  tournament: Tournament;
  // Which page opened it — the Export button remembers per page.
  page: ExportPage;
  // Copies of the page's filters; nothing here writes back to the page.
  initialMemberFilters: MembersFilterState;
  initialEventFilters:  EventsFilterState;
  // The page's track tab, if it has one.
  initialTrackId: number | null;
  // Saved presets were added, edited or deleted — the button's menu refreshes.
  onPresetsChanged?: () => void;
  onClose: () => void;
}

export function ExportModal({
  tournament, page, initialMemberFilters, initialEventFilters, initialTrackId, onPresetsChanged, onClose,
}: ExportModalProps) {
  const tournamentId = tournament.id;
  const { show } = useToast();
  const runAction = useActionToast();
  const tracks = useMemo(() => tournament.tracks.map((t) => ({ id: t.id, name: t.name })), [tournament.tracks]);
  const trackNames = useMemo(() => trackNamesOf(tournament), [tournament]);

  // ---- Data the screen needs once ----------------------------------------
  const [catalog, setCatalog] = useState<DisplayConfigCatalog | null>(null);
  const [presets, setPresets] = useState<ExportPreset[]>([]);
  const [roles, setRoles] = useState<RoleWithMemberCount[]>([]);
  const [events, setEvents] = useState<TournamentEvent[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    Promise.all([
      displayConfigApi.getCatalog(tournamentId),
      exportPresetsApi.list(tournamentId),
      rolesApi.list(tournamentId),
      // Event filters judge events, and staffing needs every assignment.
      tournamentEventsApi.list(tournamentId),
      assignmentsApi.list(tournamentId),
    ]).then(([nextCatalog, nextPresets, nextRoles, nextEvents, nextAssignments]) => {
      if (!current) return;
      setCatalog(nextCatalog);
      setPresets(nextPresets);
      setRoles(nextRoles);
      setEvents(nextEvents);
      setAssignments(nextAssignments);
    }).catch(() => { if (current) setLoadError("Couldn't load export data. Close and try again."); });
    return () => { current = false; };
  }, [tournamentId]);

  // ---- What's being exported ---------------------------------------------
  const [selection, setSelection] = useState<Selection | null>(null);
  const [memberFilters, setMemberFilters] = useState(initialMemberFilters);
  const [eventFilters, setEventFilters] = useState(initialEventFilters);
  const [trackId, setTrackId] = useState<number | null>(initialTrackId);
  const [torusRole, setTorusRole] = useState<TorusRole>("writer");
  const [duosmiumRoles, setDuosmiumRoles] = useState<DuosmiumRole[]>(ALL_DUOSMIUM_ROLES);
  const [division, setDivision] = useState<string>(tournament.division[0] ?? "");
  const [draft, setDraft] = useState<BuilderDraft>(EMPTY_DRAFT);
  const [baseline, setBaseline] = useState("");

  const builtin = selection?.kind === "builtin" ? BUILTINS.find((b) => b.id === selection.id)! : null;
  const isCustom = selection?.kind === "saved" || selection?.kind === "new";
  const savedPreset = selection?.kind === "saved" ? presets.find((p) => p.id === selection.id) ?? null : null;
  const usesEventFilters = builtin ? builtin.usesEventFilters : isCustom;

  // TORUS and Duosmium always need one track; "All tracks" is custom-only.
  const effectiveTrackId = builtin?.usesTrack ? trackId ?? tracks[0]?.id ?? null : trackId;

  const current = snapshot(draft);
  const dirty = isCustom && current !== baseline;

  // ---- Child modals, confirms and Escape ---------------------------------
  const [showMemberFilters, setShowMemberFilters] = useState(false);
  const [showEventFilters, setShowEventFilters] = useState(false);
  const [builderModalOpen, setBuilderModalOpen] = useState(false);
  const [pendingDiscard, setPendingDiscard] = useState<(() => void) | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const childModalOpen = showMemberFilters || showEventFilters || builderModalOpen
    || pendingDiscard !== null || confirmDelete;

  /** Runs `action`, first confirming when it would throw away unsaved edits. */
  const guard = useCallback((action: () => void) => {
    if (dirty) setPendingDiscard(() => action);
    else action();
  }, [dirty]);

  const requestClose = useCallback(() => guard(onClose), [guard, onClose]);

  useEffect(() => {
    // A child modal or an open dropdown handles its own Escape (dropdowns
    // preventDefault); closing the whole screen with it would lose work.
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !childModalOpen && !e.defaultPrevented) requestClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [childModalOpen, requestClose]);

  // ---- Switching what's selected -----------------------------------------
  function selectBuiltin(id: BuiltinId) {
    guard(() => setSelection({ kind: "builtin", id }));
  }

  function selectPreset(preset: ExportPreset) {
    guard(() => {
      const nextDraft = draftFromPreset(preset);
      setDraft(nextDraft);
      setBaseline(snapshot(nextDraft));
      setSelection({ kind: "saved", id: preset.id });
    });
  }

  function startNew() {
    guard(() => {
      setDraft(EMPTY_DRAFT);
      setBaseline(snapshot(EMPTY_DRAFT));
      setSelection({ kind: "new" });
    });
  }

  // ---- The export, fully decided -----------------------------------------
  const ctx = useMemo(() => (catalog ? exportContext(catalog, tournament.timezone) : null), [catalog, tournament.timezone]);

  const blocked = useMemo((): string | null => {
    if (builtin?.usesTrack && effectiveTrackId === null) return "This tournament has no tracks yet";
    if (builtin?.id === "duosmium" && duosmiumRoles.length === 0) return "Pick at least one Duosmium role";
    if (builtin?.usesDivision && !division) return "This tournament has no divisions yet";
    if (isCustom && !draft.row_type) return "Pick what one row is to start";
    if (isCustom && draft.columns.length === 0) return "Add a column to start";
    return null;
  }, [builtin, effectiveTrackId, duosmiumRoles, division, isCustom, draft.row_type, draft.columns.length]);

  const choice = useMemo((): ExportChoice | null => {
    if (blocked || !selection) return null;
    if (builtin?.id === "torus") return { kind: "torus", trackId: effectiveTrackId!, role: torusRole };
    if (builtin?.id === "duosmium") return { kind: "duosmium", trackId: effectiveTrackId!, division, roles: duosmiumRoles };
    if (builtin?.id === "email_list") return { kind: "email_list" };
    if (!draft.row_type) return null;
    return {
      kind: "custom",
      presetId: savedPreset?.id ?? null,
      shape: { ...draft, row_type: draft.row_type },
      trackId,
    };
  }, [blocked, selection, builtin, effectiveTrackId, torusRole, division, duosmiumRoles, draft, savedPreset, trackId]);

  // ---- The roster fetch --------------------------------------------------
  // A custom export can't name its field groups until the catalog resolves its columns.
  const fields = useMemo(
    () => (choice && (choice.kind !== "custom" || ctx) ? fieldsForChoice(choice, ctx) : null),
    [choice, ctx],
  );
  const memberParams = useMemo(() => membersFilterParams(memberFilters), [memberFilters]);
  const fetchKey = fields ? JSON.stringify([fields, memberParams]) : null;
  const [members, setMembers] = useState<MembershipFull[] | null>(null);
  const [membersKey, setMembersKey] = useState<string | null>(null);

  useEffect(() => {
    if (!fetchKey || !fields) return;
    let current = true;
    membersApi.list(tournamentId, { fields, filters: memberParams })
      .then((rows) => { if (current) { setMembers(rows); setMembersKey(fetchKey); } })
      .catch(() => { if (current) setLoadError("Couldn't load members. Close and try again."); });
    return () => { current = false; };
    // fetchKey already encodes fields and memberParams.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchKey, tournamentId]);

  const loadingMembers = fetchKey !== null && membersKey !== fetchKey;

  const result = useMemo(() => {
    if (!choice || !members || loadingMembers) return null;
    if (choice.kind === "custom" && !ctx) return null;
    return computeExport(choice, members, events, eventIdsFor(choice, eventFilters, events, assignments), ctx);
  }, [choice, members, loadingMembers, ctx, eventFilters, events, assignments]);

  // ---- Output ------------------------------------------------------------
  /** Remembers this export for the button, and this output for the preset. */
  function remember(output: ExportOutput) {
    if (!choice) return;
    const remembered = rememberedOf(choice);
    if (!remembered) return;
    writeLastExport(tournamentId, page, remembered);
    writeOutput(tournamentId, presetKey(remembered), output);
  }

  function copy() {
    if (!result) return;
    copyText(result.text)
      .then(() => {
        remember("copy");
        show(`Copied ${result.rows.length} row${result.rows.length === 1 ? "" : "s"}`, "success");
      })
      .catch(() => show("Couldn't copy to the clipboard.", "error"));
  }

  function download(kind: "csv" | "txt") {
    if (!result || !choice) return;
    downloadText(exportFilenameFor(choice, tournament, trackNames), result.text, kind);
    remember(kind);
  }

  // ---- Saving ------------------------------------------------------------
  const [saving, setSaving] = useState(false);
  const canSave = isCustom && draft.name.trim() !== "" && draft.row_type !== null && !saving;

  async function save(asNew: boolean) {
    if (!draft.row_type) return;
    const body: ExportPresetInput = {
      name: draft.name.trim(), row_type: draft.row_type, columns: draft.columns, sorts: draft.sorts,
      include_header: draft.include_header,
    };
    setSaving(true);
    try {
      const saved = await runAction("Export saved", () => (
        savedPreset && !asNew
          ? exportPresetsApi.update(tournamentId, savedPreset.id, body)
          : exportPresetsApi.create(tournamentId, body)
      ));
      setPresets((list) => [...list.filter((p) => p.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name)));
      const nextDraft = draftFromPreset(saved);
      setDraft(nextDraft);
      setBaseline(snapshot(nextDraft));
      setSelection({ kind: "saved", id: saved.id });
      onPresetsChanged?.();
    } catch {
      // runAction already showed the error; the draft stays for a retry.
    } finally {
      setSaving(false);
    }
  }

  // ---- Render ------------------------------------------------------------
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const mouseDownOnOverlay = useRef(false);
  const exitRef = useExitAnimation<HTMLDivElement>();
  if (!mounted) return null;

  const memberFilterActive = isFilterActive(memberFilters);
  const columnGroups = isCustom && draft.row_type && catalog && ctx
    ? availableExportColumns(catalog, draft.row_type, trackId, ctx)
    : [];

  return createPortal(
    <div
      ref={exitRef}
      className="modal-overlay"
      style={{
        position: "fixed", inset: 0, zIndex: 200, padding: "10px",
        background: "rgba(0,0,0,0.35)", display: "flex",
      }}
      // Both press and release on the overlay, like Modal: a text selection
      // dragged out of an input must not close the screen.
      onMouseDown={(e) => { mouseDownOnOverlay.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (mouseDownOnOverlay.current && e.target === e.currentTarget) requestClose(); }}
    >
    <div role="dialog" aria-modal="true" aria-label="Export" className="modal-panel" style={{
      flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden",
      background: "var(--color-bg)", border: "1px solid var(--color-border)",
      borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)",
    }}>
      <header style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px",
        padding: "12px 16px", borderBottom: "1px solid var(--color-border)", background: "var(--color-surface)",
      }}>
        <h2 style={{ margin: 0, fontFamily: "var(--font-serif)", fontSize: "20px", fontWeight: 400, color: "var(--color-text-primary)" }}>
          Export
        </h2>
        <Button type="button" variant="ghost" size="sm" iconOnly title="Close" onClick={requestClose}>
          <IconX size={14} />
        </Button>
      </header>

      {/* No wrap: a wrapped line can outgrow the panel, which left main with
          no height bound for its own scroll to work against. */}
      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <nav style={{
          width: "240px", maxWidth: "100%", flexShrink: 0, overflowY: "auto",
          padding: "12px 8px", borderRight: "1px solid var(--color-border)", background: "var(--color-surface)",
          display: "flex", flexDirection: "column", gap: "2px",
        }}>
          <NavHeading>Built-in</NavHeading>
          {BUILTINS.map((b) => (
            <NavItem key={b.id} active={builtin?.id === b.id} onClick={() => selectBuiltin(b.id)}>{b.label}</NavItem>
          ))}
          <NavHeading>Saved</NavHeading>
          {presets.length === 0 && (
            <span style={{ padding: "4px 10px", fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)" }}>
              None yet
            </span>
          )}
          {presets.map((p) => (
            <NavItem key={p.id} active={selection?.kind === "saved" && selection.id === p.id} onClick={() => selectPreset(p)}>
              {p.name}
            </NavItem>
          ))}
          <div style={{ padding: "8px 2px 0" }}>
            <Button type="button" variant="secondary" size="sm" fullWidth onClick={startNew}>
              <IconPlus size={12} /> New export
            </Button>
          </div>
        </nav>

        <main style={{ flex: 1, minWidth: 0, minHeight: 0, overflowY: "auto", padding: "16px" }}>
          {loadError ? (
            <EmptyState title="Something went wrong" description={loadError} />
          ) : !selection ? (
            <EmptyState
              icon={<IconExport size={20} />}
              title="Pick an export"
              description="Choose a built-in export or a saved one, or start a new one."
            />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px", maxWidth: "1100px" }}>
              {builtin && (
                <BuiltinOptions
                  builtin={builtin}
                  tracks={tracks}
                  trackId={effectiveTrackId}
                  onTrackChange={setTrackId}
                  divisions={tournament.division}
                  division={division}
                  onDivisionChange={setDivision}
                  torusRole={torusRole}
                  onTorusRoleChange={setTorusRole}
                  duosmiumRoles={duosmiumRoles}
                  onDuosmiumRolesChange={setDuosmiumRoles}
                />
              )}
              {isCustom && (
                <PresetBuilder
                  draft={draft}
                  onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
                  available={columnGroups}
                  resolve={(key) => (ctx ? resolveExportColumn(key, ctx) : null)}
                  tracks={tracks}
                  trackId={trackId}
                  onTrackChange={setTrackId}
                  onChildModal={setBuilderModalOpen}
                />
              )}

              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
                <FilterButton
                  label="Filter members"
                  active={memberFilterActive}
                  onOpen={() => setShowMemberFilters(true)}
                  onClear={() => setMemberFilters(membersFilterFromStored({}))}
                />
                {/* Hidden, not just inert, where they don't apply — so a TD
                    never thinks they narrowed something they didn't. */}
                {usesEventFilters && (
                  <FilterButton
                    label="Filter events"
                    active={isEventsFilterActive(eventFilters)}
                    onOpen={() => setShowEventFilters(true)}
                    onClear={() => setEventFilters(eventsFilterFromStored({}))}
                  />
                )}
                {isCustom && (
                  <div style={{ marginLeft: "auto", display: "flex", gap: "8px" }}>
                    {savedPreset && (
                      <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmDelete(true)} style={{ color: "var(--color-danger)" }}>
                        Delete
                      </Button>
                    )}
                    {savedPreset && (
                      <Button type="button" variant="secondary" size="sm" disabled={!canSave} onClick={() => save(true)}>
                        Save as new
                      </Button>
                    )}
                    <Button type="button" variant="primary" size="sm" disabled={!canSave || (savedPreset !== null && !dirty)} onClick={() => save(false)}>
                      {saving ? "Saving…" : "Save"}
                    </Button>
                  </div>
                )}
              </div>

              <ExportPreview
                header={result?.header ?? null}
                rows={result?.rows ?? []}
                warnings={result?.warnings ?? []}
                loading={!blocked && (loadingMembers || (isCustom && !ctx))}
                blocked={blocked}
                onCopy={copy}
                onDownload={download}
              />
            </div>
          )}
        </main>
      </div>

      {showMemberFilters && (
        <MembersFilterModal
          tournamentId={tournamentId}
          roleOptions={roles.map((r) => ({ value: String(r.id), label: r.label }))}
          filters={memberFilters}
          onApply={setMemberFilters}
          onClose={() => setShowMemberFilters(false)}
        />
      )}
      {showEventFilters && (
        <EventsFilterModal
          divisionOptions={eventDivisionOptions(events)}
          typeOptions={EVENT_TYPE_OPTIONS}
          categoryOptions={eventCategoryOptions(events)}
          trackOptions={tracks.length > 1 ? eventTrackOptions(events) : undefined}
          buildingOptions={eventBuildingOptions(events)}
          shiftOptions={eventShiftOptions(events)}
          filters={eventFilters}
          onApply={setEventFilters}
          onClose={() => setShowEventFilters(false)}
        />
      )}
      {pendingDiscard && (
        <ConfirmModal
          title="Discard changes"
          description={`Discard unsaved changes to ${draft.name.trim() || "this export"}?`}
          confirmLabel="Discard"
          onConfirm={async () => {
            const action = pendingDiscard;
            // Clear the baseline first so the action itself isn't guarded again.
            setBaseline(current);
            action();
          }}
          onClose={() => setPendingDiscard(null)}
        />
      )}
      {confirmDelete && savedPreset && (
        <ConfirmModal
          title="Delete export"
          description={`Delete ${savedPreset.name} for everyone in this tournament? This can't be undone.`}
          confirmLabel="Delete"
          // The modal shows a failure inline and stays open for a retry.
          onConfirm={() => exportPresetsApi.delete(tournamentId, savedPreset.id)}
          onConfirmed={() => {
            show("Export deleted", "success");
            setPresets((list) => list.filter((p) => p.id !== savedPreset.id));
            setSelection(null);
            setDraft(EMPTY_DRAFT);
            onPresetsChanged?.();
          }}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </div>
    </div>,
    document.body,
  );
}

function NavHeading({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      padding: "10px 10px 4px", fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 700,
      letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--color-text-tertiary)",
    }}>
      {children}
    </span>
  );
}

function NavItem({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      fullWidth
      onClick={onClick}
      style={{
        justifyContent: "flex-start", fontWeight: active ? 600 : 500,
        background: active ? "var(--color-accent-subtle)" : undefined,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}
    >
      {children}
    </Button>
  );
}
