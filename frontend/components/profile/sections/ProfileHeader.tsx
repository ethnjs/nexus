import Link from "next/link";
import { AvatarCircle } from "@/components/ui/AvatarCircle";
import { formatPhone } from "@/lib/auth";
import { IconEdit } from "@/components/ui/Icons";

interface ProfileHeaderUser {
  first_name?: string | null;
  last_name?: string | null;
  email: string;
  phone: string | null;
  pronouns?: string | null;
}

interface ProfileHeaderProps {
  user: ProfileHeaderUser;
  showEditButton?: boolean;
}

export function ProfileHeader({ user, showEditButton = false }: ProfileHeaderProps) {
  const fullName =
    user.first_name && user.last_name
      ? `${user.first_name} ${user.last_name}`
      : user.email;

  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: "20px", position: "relative" }}>
      <AvatarCircle user={user} size={96} />
      <div>
        <div style={{
          fontFamily: "var(--font-sans)", fontSize: "22px", fontWeight: 700,
          color: "var(--color-text-primary)",
        }}>
          {fullName}
        </div>
        {user.pronouns && (
          <div style={{
            fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 400,
            color: "var(--color-text-tertiary)", marginTop: "2px",
          }}>
            {user.pronouns}
          </div>
        )}
        <div style={{
          display: "flex", flexDirection: "row", alignItems: "center", gap: "10px",
          marginTop: "10px",
        }}>
          <span style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)" }}>
            {user.email}
          </span>
          {user.phone && (
            <>
              <span style={{ width: "1px", height: "12px", background: "var(--color-border)" }} />
              <span style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)" }}>
                {formatPhone(user.phone)}
              </span>
            </>
          )}
        </div>
      </div>

      {showEditButton && (
        <Link
          href="/settings/account"
          title="Edit account settings"
          style={{
            position: "absolute", top: 0, right: 0,
            width: "30px", height: "30px", borderRadius: "50%",
            border: "1px solid var(--color-border)", background: "var(--color-surface)",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "var(--color-text-secondary)", textDecoration: "none",
          }}
        >
          <IconEdit size={13} />
        </Link>
      )}
    </div>
  );
}