"use client";

import { MembershipLunch } from "@/lib/api";
import { formatDate } from "@/lib/timeFormat";
import { ProfileCard } from "@/components/profile/ProfileCard";
import { SectionHeading } from "@/components/profile/SectionHeading";
import { PanelField, FieldValue, FieldList } from "@/components/profile/PanelField";

interface LunchSectionProps {
  lunch: MembershipLunch[];
}

export function LunchSection({ lunch }: LunchSectionProps) {
  if (lunch.length === 0) return null;

  return (
    <ProfileCard>
      <SectionHeading title="Lunch">
        <PanelField label="Selections">
          <FieldList>
            {lunch.map((sel, i) => (
              <FieldValue key={i}>
                {formatDate(sel.date)} — {sel.category}: {sel.label}
              </FieldValue>
            ))}
          </FieldList>
        </PanelField>
      </SectionHeading>
    </ProfileCard>
  );
}
