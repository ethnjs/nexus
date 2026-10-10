"use client";

import type { DuosmiumRole, TorusRole } from "@/lib/api";
import type { BuiltinInfo } from "@/lib/exports/builtins";
import { EXTERNAL_SYSTEMS } from "@/lib/exports/externalSystems";
import { SettingsRow, SettingsSection } from "@/components/settings/SettingsRow";
import { ButtonGroup } from "@/components/ui/ButtonGroup";
import { Dropdown } from "@/components/ui/Dropdown";

const roleOptions = (field: "torus_role" | "duosmium_role") => Object.entries(
  EXTERNAL_SYSTEMS.find((s) => s.field === field)!.roles,
).map(([value, info]) => ({ value, label: info.label }));

const TORUS_OPTIONS = roleOptions("torus_role");
const DUOSMIUM_OPTIONS = roleOptions("duosmium_role");

interface BuiltinOptionsProps {
  builtin:       BuiltinInfo;
  tracks:        { id: number; name: string }[];
  trackId:       number | null;
  onTrackChange: (trackId: number) => void;
  divisions:     string[];
  division:      string;
  onDivisionChange: (division: string) => void;
  torusRole:     TorusRole;
  onTorusRoleChange: (role: TorusRole) => void;
  duosmiumRoles: DuosmiumRole[];
  onDuosmiumRolesChange: (roles: DuosmiumRole[]) => void;
}

/** The few choices a built-in preset takes. Only the ones it uses render. */
export function BuiltinOptions({
  builtin, tracks, trackId, onTrackChange, divisions, division, onDivisionChange,
  torusRole, onTorusRoleChange, duosmiumRoles, onDuosmiumRolesChange,
}: BuiltinOptionsProps) {
  const rows: { label: string; control: React.ReactNode }[] = [];

  // A one-track tournament has nothing to pick; the track is implied.
  if (builtin.usesTrack && tracks.length > 1) {
    rows.push({
      label: "Track",
      control: (
        <Dropdown
          fullWidth
          value={trackId === null ? "" : String(trackId)}
          onChange={(value) => onTrackChange(Number(value))}
          options={tracks.map((t) => ({ value: String(t.id), label: t.name }))}
        />
      ),
    });
  }
  if (builtin.id === "torus") {
    rows.push({
      label: "TORUS role",
      control: (
        <Dropdown fullWidth value={torusRole} onChange={(v) => onTorusRoleChange(v as TorusRole)} options={TORUS_OPTIONS} />
      ),
    });
  }
  if (builtin.id === "duosmium") {
    rows.push({
      label: "Duosmium roles",
      control: (
        <ButtonGroup
          options={DUOSMIUM_OPTIONS}
          value={duosmiumRoles}
          onChange={(value) => {
            const role = value as DuosmiumRole;
            onDuosmiumRolesChange(duosmiumRoles.includes(role)
              ? duosmiumRoles.filter((r) => r !== role)
              : [...duosmiumRoles, role]);
          }}
        />
      ),
    });
  }
  // A Duosmium tournament is one division; hidden when there's only one.
  if (builtin.usesDivision && divisions.length > 1) {
    rows.push({
      label: "Division",
      control: (
        <ButtonGroup
          options={divisions.map((d) => ({ value: d, label: `Division ${d}` }))}
          value={division}
          onChange={onDivisionChange}
        />
      ),
    });
  }

  if (rows.length === 0) return null;
  return (
    <SettingsSection title={builtin.label}>
      {rows.map((row, i) => (
        <SettingsRow key={row.label} label={row.label} last={i === rows.length - 1}>
          {row.control}
        </SettingsRow>
      ))}
    </SettingsSection>
  );
}
