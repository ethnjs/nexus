"use client";

import type { TournamentTrack } from "@/lib/api";
import { Pill, PillTrigger, type PillSize } from "@/components/ui/PillMenu";
import { ChecklistPopover } from "@/components/ui/ChecklistPopover";
import { WIDE_SCOPE, type RoleScope } from "@/lib/roles/roleScope";

/** "All", a track's name, or a count once names would crowd the chip. */
export function scopeLabel(scope: RoleScope, tracks: TournamentTrack[]): string {
  if (scope.wide) return "All";
  const names = scope.trackIds.map((id) => tracks.find((t) => t.id === id)?.name ?? "?");
  return names.length <= 2 ? names.join(", ") : `${names.length} tracks`;
}

type ScopeOption = { kind: "wide" } | { kind: "track"; track: TournamentTrack };
const WIDE_OPTION: ScopeOption = { kind: "wide" };

/** Clicking "Whole tournament" replaces any tracks with it; clicking a track
 *  while tournament-wide narrows to just that track (the two can't coexist —
 *  a ticked track beside "whole tournament" reads as the narrower claim). */
function nextScope(scope: RoleScope, option: ScopeOption): RoleScope {
  if (option.kind === "wide") return WIDE_SCOPE;
  const id = option.track.id;
  if (scope.wide) return { wide: false, trackIds: [id] };
  return {
    wide: false,
    trackIds: scope.trackIds.includes(id)
      ? scope.trackIds.filter((x) => x !== id)
      : [...scope.trackIds, id].sort((a, b) => a - b),
  };
}

/**
 * Where a role applies, as a pill with a checklist behind it: "Whole
 * tournament" or any tracks. Plain text when the viewer can't change it.
 *
 * Shared by the roster's role chips (where a pick saves at once) and the mass
 * editor's pending rows (where it edits a draft until Save).
 */
export function RoleScopePill({ scope, tracks, editable = true, size = "sm", title, onChange }: {
  scope: RoleScope;
  tracks: TournamentTrack[];
  editable?: boolean;
  /** "sm" inside a chip or badge, "md" on its own in a list row. */
  size?: PillSize;
  title?: string;
  onChange: (scope: RoleScope) => void | Promise<void>;
}) {
  const label = scopeLabel(scope, tracks);
  if (!editable) return <Pill label={label} size={size} title={title} />;

  const options: ScopeOption[] = [WIDE_OPTION, ...tracks.map((t) => ({ kind: "track" as const, track: t }))];

  return (
    <ChecklistPopover
      trigger={(open) => <PillTrigger label={label} size={size} open={open} />}
      items={options}
      getKey={(o) => (o.kind === "wide" ? "wide" : o.track.id)}
      renderLabel={(o) => (o.kind === "wide" ? "Whole tournament" : o.track.name)}
      isSelected={(o) => (o.kind === "wide" ? scope.wide : scope.trackIds.includes(o.track.id))}
      // Unticking the only thing ticked would leave an empty scope, which is
      // how a role gets removed — not something a menu about *where* should do.
      isDisabled={(o) => (o.kind === "wide"
        ? scope.wide
        : !scope.wide && scope.trackIds.length === 1 && scope.trackIds[0] === o.track.id)}
      disabledReason={() => "Pick somewhere else first"}
      onToggle={(o) => onChange(nextScope(scope, o))}
      width={200}
      align="left"
    />
  );
}
