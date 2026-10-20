import { ApiError } from "@/lib/api";

export type BuilderLoadFailure = "no-access" | "not-found" | { message: string };

// The builder pages load through a manager-only route alongside the
// respondent one, and the two fail differently for a member on a draft (403
// vs. 404). These are staff pages, so No access wins: only non-members and
// missing forms get the 404.
export function builderLoadFailure(reasons: unknown[], fallback: string): BuilderLoadFailure {
  const statuses = reasons.map((r) => (r instanceof ApiError ? r.status : null));
  if (statuses.includes(403)) return "no-access";
  if (statuses.includes(404)) return "not-found";
  const first = reasons[0];
  return { message: first instanceof ApiError ? first.message : fallback };
}
