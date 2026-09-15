import { ReactNode } from "react";
import Link from "next/link";
import { AvatarCircle } from "@/components/ui/AvatarCircle";
import { formatPhone } from "@/lib/auth";
import { IconEdit } from "@/components/ui/Icons";
import styles from "@/components/profile/Profile.module.css";

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
  /**
   * Badges set below the contact line — account state an admin needs beside
   * the name (role, status, email verification). A slot rather than fields on
   * this component: /profile/[id] and MemberPanel show the same header to
   * people with no business seeing any of it.
   */
  badges?: ReactNode;
}

export function ProfileHeader({ user, showEditButton = false, badges }: ProfileHeaderProps) {
  const fullName =
    user.first_name && user.last_name
      ? `${user.first_name} ${user.last_name}`
      : user.email;

  return (
    <div className={styles.header}>
      {/* Flat grid children, not a nested text column: on mobile the name
          stays beside the avatar while contact and badges span their own
          rows, which nesting them would make impossible. */}
      <div className={styles.headerRow}>
        <div className={styles.avatar}>
          <AvatarCircle user={user} size={96} />
        </div>

        <div className={styles.nameBlock}>
          <div className={styles.name}>{fullName}</div>
          {user.pronouns && (
            <div className={styles.pronouns}>{user.pronouns}</div>
          )}
        </div>

        <div className={styles.contact}>
          <span className={styles.contactItem}>{user.email}</span>
          {user.phone && (
            <>
              <span className={styles.divider} />
              <span className={styles.contactItem}>{formatPhone(user.phone)}</span>
            </>
          )}
        </div>

        {badges && (
          <div className={styles.badges}>{badges}</div>
        )}

        {showEditButton && (
          <Link
            href="/settings/account"
            title="Edit account settings"
            className={styles.editLink}
          >
            <IconEdit size={13} />
          </Link>
        )}
      </div>
    </div>
  );
}
