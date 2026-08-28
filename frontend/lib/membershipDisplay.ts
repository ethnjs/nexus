import { MembershipSource } from "@/lib/api";

export const SOURCE_LABELS: Record<MembershipSource, string> = {
  join_code: "Invite",
  public: "Public",
  manual: "Manual",
};
