/**
 * Canonical inbox query key helpers.
 *
 * FULL KEY — use only in the inboxQuery useQuery declaration.
 *   Segments: [endpoint, "inbox", searchQuery, activeAccountId, categorySegment, crmSegment]
 *   When crmFilter="unread", category is normalised to "all" and crmSegment to "unread"
 *   so every category sub-tab shares one cache partition in unread mode.
 *
 * PREFIX — use in setQueriesData / invalidateQueries / any prefix-match operation.
 *   All inbox cache entries share this 2-part prefix regardless of the current
 *   search/account/category/crmFilter context.
 */

export type ActiveAccountId = number | "all" | null;

export function inboxQueryKey(
  searchQuery: string,
  activeAccountId: ActiveAccountId,
  inboxCategory: string,
  crmFilter: string,
): readonly [string, string, string, ActiveAccountId, string, string] {
  return [
    "/api/gmail/messages",
    "inbox",
    searchQuery,
    activeAccountId,
    crmFilter === "unread" ? "all" : inboxCategory,
    crmFilter === "unread" ? "unread" : "all",
  ] as const;
}

export const INBOX_QK_PREFIX = ["/api/gmail/messages", "inbox"] as const;
