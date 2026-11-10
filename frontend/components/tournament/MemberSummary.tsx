import type { ReactNode } from "react";
import { AvatarCircle } from "@/components/ui/AvatarCircle";
import { Badge } from "@/components/ui/Badge";
import type { PersonRef } from "@/lib/api";
import { personName, personRoles } from "@/lib/personDisplay";

/** A member's avatar beside their name, with their roles as badges under it. */
export function MemberSummary({
  member,
  size = "sm",
  name,
}: {
  member: PersonRef;
  size?: "sm" | "lg";
  /** Replaces the plain name, e.g. with a heading. */
  name?: ReactNode;
}) {
  const roles = personRoles(member) ?? [];

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: size === "lg" ? "12px" : "8px",
        minWidth: 0,
      }}
    >
      <AvatarCircle user={member} size={size} />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: "4px",
          minWidth: 0,
        }}
      >
        {name ?? (
          <span
            style={{
              maxWidth: "100%",
              fontFamily: "var(--font-sans)",
              fontSize: "13px",
              fontWeight: 500,
              color: "var(--color-text-primary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {personName(member)}
          </span>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
          {roles.length > 0 ? (
            roles.map((role) => (
              <Badge key={role.id ?? role.label} variant="default">
                {role.label}
              </Badge>
            ))
          ) : (
            <span
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: "12px",
                color: "var(--color-text-tertiary)",
              }}
            >
              No roles
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
