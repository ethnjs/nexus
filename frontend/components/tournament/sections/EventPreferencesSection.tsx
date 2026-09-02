"use client";

import { useState } from "react";
import { MembershipEventPreference, MembershipEventPreferenceOption } from "@/lib/api";
import { Badge } from "@/components/ui/Badge";
import { unslug } from "@/lib/textFormat";
import { Banner } from "@/components/ui/Banner";
import { ProfileCard } from "@/components/profile/ProfileCard";
import { SectionHeading } from "@/components/profile/SectionHeading";
import { PanelField, FieldValue, FieldList } from "@/components/profile/PanelField";

interface EventPreferencesSectionProps {
  eventPreferences: MembershipEventPreference[];
}

function eventLabel(event: { name: string | null; division: string | null }): string {
  return `${event.name ?? "Unknown event"}${event.division ? ` ${event.division}` : ""}`;
}

function StaleTag() {
  return <Badge variant="warning">Out of date</Badge>;
}

function Rank({ rank }: { rank: number | null }) {
  if (rank === null) return null;
  return (
    <span style={{ fontFamily: "var(--font-sans)", fontSize: "14px", fontWeight: 500, color: "var(--color-text-primary)" }}>
      {rank}.
    </span>
  );
}

// A single-event option is just that event — showing the option's label
// instead would only repeat it. Multi-event options collapse to the label and
// open on click, since one option can group 20+ events.
function OptionRow({ option, open, onToggle }: {
  option: MembershipEventPreferenceOption;
  open: boolean;
  onToggle: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  if (option.events.length <= 1) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
        <Rank rank={option.rank} />
        {option.events.length === 1
          ? <Badge variant="default">{eventLabel(option.events[0])}</Badge>
          : <FieldValue>{option.label}</FieldValue>}
        {option.is_archived && <StaleTag />}
      </div>
    );
  }

  return (
    <div>
      <div
        onClick={onToggle}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: "flex", alignItems: "center", gap: "6px", cursor: "pointer",
          // Pulled left by its own padding so the text still lines up with
          // the non-expandable rows above and below it.
          padding: "3px 6px", margin: "0 -6px", borderRadius: "var(--radius-sm)",
          background: hovered ? "var(--color-accent-subtle)" : "transparent",
          transition: "background 120ms ease",
        }}
      >
        <Rank rank={option.rank} />
        <FieldValue>{option.label}</FieldValue>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--color-text-tertiary)" }}>
          {option.events.length}
        </span>
        {option.is_archived && <StaleTag />}
      </div>
      {/* 0fr -> 1fr animates to the content's natural height, which a
          max-height transition can't do without a hardcoded guess. */}
      <div style={{
        display: "grid", gridTemplateRows: open ? "1fr" : "0fr",
        transition: "grid-template-rows 180ms ease",
      }}>
        <div style={{ overflow: "hidden" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", padding: "6px 0 2px 14px" }}>
            {option.events.map((event) => (
              <Badge key={event.id} variant="default">{eventLabel(event)}</Badge>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// Open state lives here rather than per row so a key can only have one
// option expanded at a time.
function PreferenceKey({ pref }: { pref: MembershipEventPreference }) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <PanelField label={unslug(pref.key)}>
      <FieldList>
        {pref.options.map((option, i) => {
          const id = option.option_id ?? `orphan-${i}`;
          return (
            <OptionRow
              key={id}
              option={option}
              open={openId === id}
              onToggle={() => setOpenId((current) => (current === id ? null : id))}
            />
          );
        })}
      </FieldList>
    </PanelField>
  );
}

export function EventPreferencesSection({ eventPreferences }: EventPreferencesSectionProps) {

  // An archived option means the form question changed after this answer was
  // given, so what's shown no longer matches what the form would ask today.
  const hasStale = eventPreferences.some((pref) => pref.options.some((o) => o.is_archived));

  return (
    <ProfileCard>
      <SectionHeading title="Event Preferences">
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {hasStale && (
            <Banner
              variant="warning"
              message="Some of these answers were given to a question that has since changed and may be out of date."
            />
          )}
          {eventPreferences.length === 0 && <FieldValue muted>No info yet</FieldValue>}
          {eventPreferences.map((pref) => <PreferenceKey key={pref.key} pref={pref} />)}
        </div>
      </SectionHeading>
    </ProfileCard>
  );
}
