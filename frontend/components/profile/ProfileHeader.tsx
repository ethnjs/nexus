import { AvatarCircle } from "@/components/ui/AvatarCircle";

interface ProfileHeaderUser {
  first_name?: string | null;
  last_name?: string | null;
  email: string;
  pronouns?: string | null;
}

interface ProfileHeaderProps {
  user: ProfileHeaderUser;
}

export function ProfileHeader({ user }: ProfileHeaderProps) {
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
      </div>
    </div>
  );
}