import { AvatarCircle } from "@/components/ui/AvatarCircle";
import { formatPhone } from "@/lib/auth";

interface ProfileHeaderUser {
  first_name?: string | null;
  last_name?: string | null;
  email: string;
  phone: string | null;
  pronouns?: string | null;
}

export function ProfileHeader({ user }: { user: ProfileHeaderUser }) {
  const fullName =
    user.first_name && user.last_name
      ? `${user.first_name} ${user.last_name}`
      : user.email;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
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
    </div>
  );
}