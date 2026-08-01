/**
 * use-current-users.ts — Canonical user-search hook for all Currents pickers.
 *
 * Used by (or should be used by) every Currents user-search surface:
 *   - Channel creation / edit member picker  (MemberPickerInline)
 *   - Private-channel Add Member picker      (MemberPickerInline)
 *   - Members tab search                     (client-side filter, no API call)
 *   - New Direct Message search              (NewDmDialog)
 *   - Group DM add-member picker             (GroupMemberDialog)
 *   - Channel/thread @mention autocomplete   (useComposerMentions)
 *   - CMS-wide MentionInput                  (useMentionComposer)
 *
 * Normalization rules (belt-and-suspenders; server also applies these):
 *   - Strips one leading @ — so "@scott" is identical to "scott"
 *   - Trims whitespace before sending
 *
 * @all virtual entry:
 *   - Injected CLIENT-SIDE when includeAll=true (server returns real users only)
 *   - Shown when query is empty, or matches "all" / "everyone" / "team"
 *   - id=0 is the sentinel; callers must never send id=0 to /api/current/dm
 *
 * @param rawQuery    Raw input value (may include leading @).
 * @param enabled     Pass false to suppress the query entirely.
 * @param includeAll  Pass false for pickers that must never show @all
 *                    (New DM, Add Member, channel picker). Default true.
 */

import { useQuery } from "@tanstack/react-query";

export type CurrentUser = {
  id: number;          // 0 = @all virtual broadcast entry
  name: string;
  email: string;
  avatarUrl: string | null;
  department: string | null;
  isAll?: boolean;
};

/** The @all virtual broadcast entry (id=0). Never send this ID to the server. */
const ALL_ENTRY: CurrentUser = {
  id: 0,
  name: "all",
  email: "",
  avatarUrl: null,
  department: null,
  isAll: true,
};

/**
 * Normalize a raw search string before sending to /api/current/users.
 * Strips one leading @ and trims whitespace.
 */
export function normalizeUserQuery(raw: string): string {
  return raw.trim().replace(/^@/, "");
}

/**
 * Whether a given normalized query should show the @all entry.
 * Matches empty string, "all", "everyone", "team" (prefix match).
 */
function shouldShowAll(q: string): boolean {
  return (
    !q ||
    "all".startsWith(q) ||
    "everyone".startsWith(q) ||
    "team".startsWith(q)
  );
}

export function useCurrentUsers(
  rawQuery: string,
  enabled = true,
  includeAll = true
) {
  const q = normalizeUserQuery(rawQuery);

  const query = useQuery<CurrentUser[]>({
    queryKey: ["/api/current/users", q],
    queryFn: () =>
      fetch(`/api/current/users?q=${encodeURIComponent(q)}`, {
        credentials: "include",
      }).then((r) => r.json()),
    enabled,
    staleTime: 10_000,
  });

  const rawData = (query.data ?? []).filter((u) => !u.isAll); // strip any stale @all from cache

  // @all is always injected client-side; server never returns it
  let data: CurrentUser[];
  if (includeAll && shouldShowAll(q)) {
    data = [ALL_ENTRY, ...rawData];
  } else {
    data = rawData;
  }

  return { ...query, data };
}
