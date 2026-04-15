/**
 * pick — extract only the specified keys from an object.
 * Use this in route handlers to whitelist acceptable request body fields
 * before passing them to storage, preventing clients from overwriting
 * system-managed fields (author, timestamps, linked entity metadata, etc.).
 *
 * Applied to:
 *   PUT /api/notes/:id  — allows only "content"
 *
 * Usage:
 *   const safe = pick(req.body, ["content"]);
 */
export function pick<T extends object, K extends keyof T>(
  obj: T,
  keys: K[]
): Pick<T, K> {
  const result = {} as Pick<T, K>;
  for (const k of keys) {
    if (k in obj) result[k] = obj[k];
  }
  return result;
}
