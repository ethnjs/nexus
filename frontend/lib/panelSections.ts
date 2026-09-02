import { DisplayConfigSection, MembershipCustomAnswer } from "@/lib/api";

// Mirrors the backend's DEFAULT_SECTION_ORDER (PANEL_SECTIONS) — kept in sync
// by hand, same as displayConfigSurfaces.ts, since there's no shared codegen.
export const DEFAULT_SECTION_ORDER = [
  "membership",
  "availability",
  "lunch",
  "event_preferences",
  "custom_responses",
  "education",
  "competition_experience",
  "volunteer_experience",
  "logistics",
] as const;

export const CUSTOM_SECTION_PREFIX = "custom:";

export function isCustomSection(id: string): boolean {
  return id.startsWith(CUSTOM_SECTION_PREFIX);
}

/**
 * The sections to render, in order, with hidden ones dropped.
 *
 * A built-in section missing from the saved list still renders — appended in
 * default order — so adding a new section type never needs a config migration
 * and never silently disappears for tournaments that saved before it existed.
 * A saved id that no longer exists is dropped for the mirror-image reason.
 */
export function orderedSections(saved: DisplayConfigSection[] | null | undefined): DisplayConfigSection[] {
  const savedList = saved ?? [];
  const seen = new Set(savedList.map((section) => section.id));
  const known = new Set<string>(DEFAULT_SECTION_ORDER);

  const kept = savedList.filter((section) => known.has(section.id) || isCustomSection(section.id));
  const missing = DEFAULT_SECTION_ORDER
    .filter((id) => !seen.has(id))
    .map((id) => ({ id } as DisplayConfigSection));

  return [...kept, ...missing].filter((section) => !section.hidden);
}

/** Field ids turned off within one section, as a set for cheap lookup. */
export function hiddenFieldsOf(section: DisplayConfigSection | undefined): Set<string> {
  return new Set(section?.hidden_fields ?? []);
}

/**
 * Splits custom-form answers between the TD-made sections they've been
 * assigned to and the built-in Custom Responses section, which holds whatever
 * is left. An answer assigned to a section that has since been deleted falls
 * back to the remainder rather than vanishing.
 */
export function splitCustomAnswers(
  answers: MembershipCustomAnswer[],
  sections: DisplayConfigSection[],
): { assigned: Map<string, MembershipCustomAnswer[]>; unassigned: MembershipCustomAnswer[] } {
  const sectionByFieldKey = new Map<string, string>();
  for (const section of sections) {
    if (!isCustomSection(section.id)) continue;
    for (const fieldKey of section.fields ?? []) sectionByFieldKey.set(fieldKey, section.id);
  }

  const assigned = new Map<string, MembershipCustomAnswer[]>();
  const unassigned: MembershipCustomAnswer[] = [];
  for (const answer of answers) {
    const sectionId = sectionByFieldKey.get(`form_field:${answer.field_id}`);
    if (sectionId === undefined) {
      unassigned.push(answer);
      continue;
    }
    const bucket = assigned.get(sectionId);
    if (bucket) bucket.push(answer);
    else assigned.set(sectionId, [answer]);
  }
  return { assigned, unassigned };
}
