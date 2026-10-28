"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ChecklistPopover } from "@/components/ui/ChecklistPopover";
import { Dropdown } from "@/components/ui/Dropdown";
import { IconChevronDown, IconChevronRight, IconPlus, IconX } from "@/components/ui/Icons";
import {
  formsApi,
  type PersonRef,
  type RolePrerequisite,
  type TournamentFormPrerequisites,
} from "@/lib/api";
import { personName } from "@/lib/personDisplay";

export interface RoleOption {
  id: number;
  label: string;
}

/** Conditions that name at least one role — the only ones the API accepts. */
export function completeConditions(value: TournamentFormPrerequisites): RolePrerequisite[] {
  return value.roles.filter((condition) => condition.ids.length > 0);
}

const TEXT = { fontFamily: "var(--font-sans)", fontSize: "13px" } as const;
const MUTED = { ...TEXT, fontSize: "12px", color: "var(--color-text-tertiary)" } as const;

/** Role conditions a member must all pass to see a form, with the members
 *  they currently let through. */
export function PrerequisiteEditor({
  tournamentId,
  value,
  onChange,
  roles,
  locked = false,
  showMatching = true,
}: {
  tournamentId: number;
  value: TournamentFormPrerequisites;
  onChange: (value: TournamentFormPrerequisites) => void;
  roles: RoleOption[];
  locked?: boolean;
  /** The live "Matching members" list under the conditions. */
  showMatching?: boolean;
}) {
  const conditions = value.roles;

  function update(index: number, patch: Partial<RolePrerequisite>) {
    onChange({ roles: conditions.map((c, i) => (i === index ? { ...c, ...patch } : c)) });
  }

  function toggleRole(index: number, roleId: number) {
    const ids = conditions[index].ids;
    update(index, {
      ids: ids.includes(roleId) ? ids.filter((id) => id !== roleId) : [...ids, roleId],
    });
  }

  const labelOf = (id: number) => roles.find((r) => r.id === id)?.label ?? "a deleted role";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      {conditions.length === 0 && (
        <p style={MUTED}>No conditions — every member can see this form.</p>
      )}
      {conditions.map((condition, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: conditions have no id; rows only append or drop
          key={index}
          style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}
        >
          <span style={{ ...TEXT, width: "64px", color: "var(--color-text-secondary)" }}>
            {index === 0 ? "Must" : "and"}
          </span>
          <Dropdown
            value={condition.inverse ? "lacks" : "has"}
            onChange={(v) => update(index, { inverse: v === "lacks" })}
            options={[
              { value: "has", label: "have" },
              { value: "lacks", label: "not have" },
            ]}
            size="sm"
            width={110}
            locked={locked}
          />
          <Dropdown
            value={condition.match}
            onChange={(v) => update(index, { match: v as RolePrerequisite["match"] })}
            options={[
              { value: "any", label: "any of" },
              { value: "all", label: "all of" },
            ]}
            size="sm"
            width={90}
            locked={locked}
          />
          <div style={{ flex: 1, minWidth: "140px" }}>
            <ChecklistPopover
              trigger={
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  fullWidth
                  disabled={locked}
                  style={{
                    justifyContent: "flex-start",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {condition.ids.length > 0 ? (
                    condition.ids.map(labelOf).join(", ")
                  ) : (
                    <span style={{ color: "var(--color-text-tertiary)" }}>Pick roles…</span>
                  )}
                </Button>
              }
              items={roles}
              getKey={(role) => role.id}
              renderLabel={(role) => role.label}
              isSelected={(role) => condition.ids.includes(role.id)}
              onToggle={(role) => toggleRole(index, role.id)}
              emptyMessage="This tournament has no roles yet."
              searchable
              width={240}
            />
          </div>
          {!locked && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              iconOnly
              title="Remove condition"
              onClick={() => onChange({ roles: conditions.filter((_, i) => i !== index) })}
            >
              <IconX size={12} />
            </Button>
          )}
        </div>
      ))}
      {!locked && (
        <div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() =>
              onChange({ roles: [...conditions, { ids: [], match: "any", inverse: false }] })
            }
          >
            <IconPlus size={13} /> Add condition
          </Button>
        </div>
      )}
      {showMatching && <MatchingMembers tournamentId={tournamentId} value={value} />}
    </div>
  );
}

function MatchingMembers({
  tournamentId,
  value,
}: {
  tournamentId: number;
  value: TournamentFormPrerequisites;
}) {
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<PersonRef[] | null>(null);
  // Rows still missing roles don't narrow anything yet, matching what Save sends.
  const query = JSON.stringify(completeConditions(value));

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      formsApi
        .previewPrerequisites(tournamentId, { roles: JSON.parse(query) })
        .then((refs) => {
          if (!cancelled) setMembers(refs);
        })
        .catch(() => {});
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [tournamentId, query]);

  return (
    <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: "8px" }}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen(!open)}
        style={{ paddingLeft: 0 }}
      >
        {open ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
        Matching members{members ? ` (${members.length})` : ""}
      </Button>
      {open && members && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "4px",
            maxHeight: "220px",
            overflowY: "auto",
            padding: "4px 0 0 18px",
          }}
        >
          {members.length === 0 && <span style={MUTED}>No members match.</span>}
          {members.map((member) => (
            <div
              key={member.user_id ?? member.membership_id}
              style={{ display: "flex", gap: "8px" }}
            >
              <span style={TEXT}>{personName(member)}</span>
              <span style={MUTED}>
                {(member.roles ?? []).map((role) => role.label).join(", ") || "No roles"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
