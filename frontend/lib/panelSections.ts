import { DisplayConfigSection, MembershipCustomAnswer } from "@/lib/api";

// Mirrors the backend's DEFAULT_SECTION_ORDER (PANEL_SECTIONS) — kept in sync
// by hand, same as displayConfigSurfaces.ts, since there's no shared codegen.
export const DEFAULT_SECTION_ORDER = [
  "membership",
  "availability",
  "lunch",
  "event_preferences",
  "education",
  "competition_experience",
  "volunteer_experience",
  "logistics",
] as const;

export const CUSTOM_SECTION_PREFIX = "custom:";

// The one custom section a tournament starts with. Custom Responses used to
// be built in, which made it the only part of the panel a TD couldn't rename
// or delete; seeding it as a custom section makes it behave like any other.
export const DEFAULT_CUSTOM_SECTION_ID = `${CUSTOM_SECTION_PREFIX}all`;
export const DEFAULT_CUSTOM_SECTION_TITLE = "Custom Responses";

function defaultCustomSection(): DisplayConfigSection {
  // No `fields`: this one is a catch-all (see splitCustomAnswers), so a
  // question added to a form next month shows up without anyone assigning it.
  return { id: DEFAULT_CUSTOM_SECTION_ID, title: DEFAULT_CUSTOM_SECTION_TITLE };
}

export function isCustomSection(id: string): boolean {
  return id.startsWith(CUSTOM_SECTION_PREFIX);
}

/**
 * Every section a tournament has, in order, hidden ones included.
 *
 * A built-in section missing from the saved list is appended in default order,
 * so adding a new section type never needs a config migration and never
 * silently disappears for tournaments that saved before it existed. A saved id
 * that no longer resolves is dropped for the mirror-image reason — that's what
 * retires a section that used to be built in, like the old "custom_responses".
 *
 * The editor wants this (a hidden section still has to be reachable to turn
 * back on); the panel wants orderedSections, which drops the hidden ones.
 */
export function resolveSections(saved: DisplayConfigSection[] | null | undefined): DisplayConfigSection[] {
  // Nothing saved: the built-ins in default order, plus the seeded catch-all.
  // Deleting it is a real saved state, so an empty saved list is respected.
  const savedList: DisplayConfigSection[] = saved ?? [
    ...DEFAULT_SECTION_ORDER.map((id) => ({ id } as DisplayConfigSection)),
    defaultCustomSection(),
  ];
  const seen = new Set(savedList.map((section) => section.id));
  const known = new Set<string>(DEFAULT_SECTION_ORDER);

  const kept = savedList.filter((section) => known.has(section.id) || isCustomSection(section.id));
  const missing = DEFAULT_SECTION_ORDER
    .filter((id) => !seen.has(id))
    .map((id) => ({ id } as DisplayConfigSection));

  return [...kept, ...missing];
}

/** As resolveSections, with the sections the TD turned off dropped. */
export function orderedSections(saved: DisplayConfigSection[] | null | undefined): DisplayConfigSection[] {
  return resolveSections(saved).filter((section) => !section.hidden);
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

  // Whatever no section claimed lands in the catch-all — when it's still
  // there. A TD who deleted it chose for those answers not to show.
  const catchAll = sections.find((section) => section.id === DEFAULT_CUSTOM_SECTION_ID)?.id;

  const assigned = new Map<string, MembershipCustomAnswer[]>();
  const unassigned: MembershipCustomAnswer[] = [];
  for (const answer of answers) {
    const sectionId = sectionByFieldKey.get(`form_field:${answer.field_id}`) ?? catchAll;
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
