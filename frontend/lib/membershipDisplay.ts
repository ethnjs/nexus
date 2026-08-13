import { MembershipSource, MembershipStatus } from "@/lib/api";

export const SOURCE_LABELS: Record<MembershipSource, string> = {
  join_code: "Invite",
  public: "Public",
  manual: "Manual",
};

export const STATUS_VARIANT: Record<MembershipStatus, "interested" | "confirmed"> = {
  interested: "interested",
  confirmed: "confirmed",
};
