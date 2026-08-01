/**
 * use-current-users.ts — Canonical user-search hook for all Currents pickers.
 *
 * Used by:
 *   - New Direct Message search
 *   - Group DM member picker
 *   - Channel Add Member picker
 *   - Channel Members search
 *   - Message/thread @mention autocomplete (via useMentionComposer)
 *   - CMS-wide MentionInput (via useMentionComposer)
 *
 * Rules enforced here (belt-and-suspenders; server also applies them):
 *   - Strips one leading @ — so "@scott" finds "Scott Carlson"
 *   - Trims whitespace
 *   - "@" alone or empty string → lists all eligible users
 *   - Returns the @all virtual broadcast entry when query matches
 *     "all", "everyone", or "team"
 *   - Active users only (enforced server-side)
 *   - Partial name/email matching (enforced server-side)
 *   - Deterministic ranking (enforced server-side: ORDER BY name ASC)
 *   - Deduplication by user ID (enforced server-side)
 */

import { useQuery } from "@tanstack/react-query";

export type CurrentUser = {
  id: number;       // 0 = @all virtual broadcast entry
  name: string;
  email: string;
  avatarUrl: string | null;
  department: string | null;
  isAll?: boolean;
};

/**
 * Normalize a raw search string before sending to /api/current/users.
 * Strips one leading @ and trims whitespace.
 */
export function normalizeUserQuery(raw: string): string {
  return raw.trim().replace(/^@/, "");
}

/**
 * Fetch the list of eligible teammates matching `rawQuery`.
 *
 * @param rawQuery  Raw input value (may include a leading @).
 * @param enabled   Set to false to suppress the query (e.g. while typing debounce).
 * @param includeAll  If false, the virtual @all entry is excluded from results.
 *                    Default true. Pass false for pickers that don't support @all
 *                    (e.g. New DM, Add Member).
 */
export function useCurrentUsers(
  rawQuery: string,
  enabled = true,
  includeAll = true
) {
  const q = normalizeUserQuery(rawQuery);

  const query = useQuery<CurrentUser[]>({
    queryKey: ["/api/current/users", q],
    queryFn: () =>
      fetch(`/api/current/users?q=${encodeURIComponent(q)}`, { credentials: "include" })
        .then((r) => r.json()),
    enabled,
    staleTime: 10_000,
  });

  // The server already prepends the @all virtual entry when appropriate.
  // If the caller wants @all excluded (DM picker, Add Member), filter it out.
  const data = includeAll
    ? (query.data ?? [])
    : (query.data ?? []).filter((u) => !u.isAll);

  return { ...query, data };
}
