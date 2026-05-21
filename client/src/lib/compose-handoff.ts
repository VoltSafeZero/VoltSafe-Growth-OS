/**
 * compose-handoff.ts
 *
 * Module-level in-memory handoff for passing a compose payload from the AI
 * Summary "Suggested Email" modal to the Gmail inbox compose window.
 *
 * Why not sessionStorage?
 *   sessionStorage is blocked or isolated in iframe-based dev environments
 *   (e.g. Replit preview).  The storage API throws a SecurityError which our
 *   try/catch silently swallows, so the payload is never written and compose
 *   never opens.
 *
 * Why not URL params?
 *   URL-param useEffect fires after mount; if the component is kept warm by
 *   the router the effect may not re-run.  URL params also require openDraft()
 *   to succeed — an extra async round-trip that can fail independently.
 *
 * A JS module variable is loaded once per SPA session and is synchronously
 * readable at any point — no storage APIs, no async, no race conditions.
 */

export interface ComposeHandoff {
  to: string;
  cc?: string;
  subject: string;
  body: string;
}

let _pending: ComposeHandoff | null = null;

/** Write a pending compose payload before navigating to the inbox. */
export function setPendingCompose(data: ComposeHandoff): void {
  console.log("[compose-handoff] setPendingCompose", { to: data.to, subject: data.subject, bodyLen: data.body?.length });
  _pending = data;
}

/**
 * Read and clear the pending compose payload.
 * Returns null if nothing is pending.
 * Clears the pending value so a subsequent call returns null.
 */
export function takePendingCompose(): ComposeHandoff | null {
  const p = _pending;
  _pending = null;
  if (p) {
    console.log("[compose-handoff] takePendingCompose — found payload", { to: p.to, subject: p.subject, bodyLen: p.body?.length });
  }
  return p;
}
