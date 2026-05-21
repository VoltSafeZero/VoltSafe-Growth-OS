---
name: Mail Trust Strip
description: Architecture and constraints for the MailTrustStrip sidebar component added to the Gmail inbox UI.
---

## What it is
A compact, always-visible status strip at the bottom of the Gmail inbox sidebar (`client/src/components/inbox/mail-trust-strip.tsx`) that shows Gmail connection/sync/send state without any new backend calls.

## Data sources (all pre-existing)
- `connectedAccount.authStatus` + `lastSyncAt` + `syncErrorMessage` — from `accountsQuery` (30s poll)
- `healthById.get(connectedAccount.id).status` — from `accountsHealthQuery` ("green"|"amber"|"red", 30s poll)
- `scheduledQuery.data?.some(e => e.status === "failed")` — `hasFailedScheduled` prop
- `trustEvent` state — transient events fired by `ComposeDialog` mutations via `onTrustEvent` prop

## TrustEvent propagation pattern
- `TrustEvent` type defined and imported from `mail-trust-strip.tsx` into `gmail-inbox.tsx`
- `ComposeDialog` accepts `onTrustEvent?: (event: TrustEvent) => void` prop
- Fired from: `sendMutation.mutationFn` (sending), `onSuccess` (sent), `onError` (send-failed / send-failed-draft-saved), `draftMutation.mutationFn` (draft-saving), `onSuccess` (draft-saved)
- `retryScheduledMutation.onError` in `GmailInboxPage` calls `setTrustEvent` directly (no prop needed — same scope)
- Auto-clear timers: sent=3s, draft-saved=2.5s, failures=6s; always clear previous timer before setting new one

## Priority order (strip state machine)
1. Transient trust event (sending/sent/draft-saving/draft-saved/send-failed-draft-saved/send-failed/scheduled-failed)
2. auth not active → "Gmail reconnect required" + Reconnect link
3. healthStatus red → "Sync error"
4. healthStatus amber → "Sync delayed"
5. hasFailedScheduled → "Scheduled send failed"
6. Default healthy → "Connected to Gmail · synced X ago"

## Placement
Inside the existing "Account status footer" `<div>` at the bottom of the left sidebar, rendered BEFORE the `{connectedAccount && (` block. Uses `border-b border-border/25` to separate from the existing account row below it.

**Why:** Keeps it always visible regardless of which tab/view is active; minimal footprint (28px row); doesn't interfere with email list, compose, or filters above.

## Tests
`tests/mail-trust-strip.test.cjs` — 56 source-grep assertions covering all states and wiring. Run with `node tests/mail-trust-strip.test.cjs`.
