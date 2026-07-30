/**
 * Canonical set of valid document use-case keys.
 *
 * Both the server-side validation (POST /api/documents/link,
 * POST /api/attachments) and the client-side picker (ASSET_USE_CASES in
 * documents.tsx) derive from this list, so a typo or stale key is caught
 * in exactly one place.
 *
 * "all" is intentionally excluded — it is a UI-only filter sentinel that
 * is never stored in the database.
 */
export const VALID_USE_CASES = [
  "sales",
  "product",
  "proof",
  "quotes",
  "brand",
  "internal",
  "general",
] as const;

export type UseCase = (typeof VALID_USE_CASES)[number];

export const VALID_USE_CASE_SET = new Set<string>(VALID_USE_CASES);
