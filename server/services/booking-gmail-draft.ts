/**
 * Phase J — Create Gmail Draft from Booking Draft Assistant
 *
 * Thin orchestration layer that:
 *   1. Re-uses Phase I owner-scoping & CRM context loading (via
 *      `generateFollowupDraft`) — guaranteeing identical 403/404 semantics.
 *   2. Optionally overrides subject/body with values the user edited in the
 *      modal (the spec requires "if subject/body provided, use edited modal
 *      text").
 *   3. Calls the existing `saveDraft` helper from server/gmail.ts which uses
 *      `gmail.users.drafts.create` — by Google API contract this NEVER sends
 *      an email; it only stores a draft in the user's Drafts folder.
 *
 * No mail-send paths are reachable from this module: there is zero import of
 * `sendEmail`, `users.messages.send`, SMTP, scheduled-emails, or any send
 * pathway.
 */

import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { emailAccounts, users, tasks } from "@shared/schema";
import { saveDraft } from "../gmail";
import {
  generateFollowupDraft,
  type Tone,
  type DraftOutput,
} from "./booking-draft-assistant";
import { CommandActionError, type ActionKind } from "./booking-command-actions";

/**
 * Phase K — Draft Approval Queue source identifier.
 * Exported so the queue endpoints can filter on `tasks.source` without a
 * magic string. We deliberately use a DIFFERENT source value AND DIFFERENT
 * sourceMeta keys (draftKind / draftRecipientId) than Phase H so that the
 * Phase H suppression query in `pendingActionKeysFor()` (which matches on
 * sourceMeta.recipientId + sourceMeta.kind) NEVER incorrectly hides
 * command-center cards just because a draft was created.
 */
export const DRAFT_APPROVAL_TASK_SOURCE = "booking_draft_approval";

export interface GmailDraftInput {
  callerUserId:    number;
  callerIsAdmin:   boolean;
  kind:            ActionKind;
  recipientId:     number;
  bookingLinkId?:  number;
  tone?:           Tone;
  /** Edited subject from the modal. If absent, generated text is used. */
  subject?:        string;
  /** Edited body from the modal. If absent, generated text is used. */
  body?:           string;
  /** Optional explicit mailbox to use; defaults to caller's own active Gmail. */
  asAccountId?:    number;
}

/**
 * Self-contained mailbox resolver + edit-access gate.
 *
 * Phase J lives outside the `registerRoutes` closure (it's currently registered
 * inside `registerConfluenceRoutes` after Phase H/I) so it cannot reach the
 * shared `resolveAccount` / `requireAccountEditAccess` helpers. We re-implement
 * the same rules here against the canonical `email_accounts` and
 * `users.permissions.mail_team` tables.
 *
 * Edit-access rules (mirror of `requireAccountEditAccess`):
 *   - Owner of mailbox            → allowed
 *   - Caller is admin/master_admin → allowed
 *   - Otherwise                    → must have users.permissions.mail_team[id].edit === true
 *   View-only grants are NEVER sufficient.
 */
async function resolveMailboxForEditOrThrow(
  callerUserId: number,
  callerIsAdmin: boolean,
  asAccountId?: number,
): Promise<{ acctOwnerUserId: number; accountId: number }> {
  let acct: typeof emailAccounts.$inferSelect | undefined;
  if (asAccountId != null) {
    [acct] = await db.select().from(emailAccounts)
      .where(eq(emailAccounts.id, asAccountId)).limit(1);
    if (!acct || acct.isActive === false) {
      throw new CommandActionError(403, "Mailbox not accessible.");
    }
  } else {
    // Default: caller's own PERSONAL active Gmail. Exact mirror of
    // server/routes.ts `getUserGmailAccount()` — we MUST exclude is_shared=true
    // here, otherwise a team inbox the caller happens to own (user_id=me,
    // is_shared=true) could win the LIMIT 1 race and we'd accidentally drop a
    // draft into a shared mailbox when the user expected their personal one.
    // To target a shared mailbox the client must explicitly pass asAccountId.
    [acct] = await db.select().from(emailAccounts)
      .where(and(
        eq(emailAccounts.userId, callerUserId),
        eq(emailAccounts.isActive, true),
        eq(emailAccounts.isShared, false),
        eq(emailAccounts.provider, "gmail"),
      ))
      .orderBy(emailAccounts.id)
      .limit(1);
    if (!acct) {
      throw new CommandActionError(403,
        "No personal Gmail mailbox connected. Connect Gmail or pass asAccountId for a shared mailbox you can edit.");
    }
  }
  const isOwner = acct.userId === callerUserId;
  if (isOwner || callerIsAdmin) {
    return { acctOwnerUserId: acct.userId, accountId: acct.id };
  }
  // Non-owner non-admin: shared + explicit edit grant required.
  if (!acct.isShared) {
    throw new CommandActionError(403, "Mailbox not accessible.");
  }
  const [u] = await db.select({ permissions: users.permissions })
    .from(users).where(eq(users.id, callerUserId)).limit(1);
  const mt = ((u?.permissions as any)?.mail_team ?? {}) as Record<string, { view?: boolean; edit?: boolean }>;
  if (mt[String(acct.id)]?.edit !== true) {
    throw new CommandActionError(403, "Edit access required for this mailbox.");
  }
  return { acctOwnerUserId: acct.userId, accountId: acct.id };
}

export interface GmailDraftResult {
  draftId:   string;
  /** Gmail message id (deep-linkable in Gmail UI). */
  messageId: string | null;
  threadId:  string | null;
  to:        string;
  subject:   string;
  body:      string;
  source:    "edited" | "generated";
  context:   DraftOutput["context"];
  /** Phase K — id of the approval-queue task row created alongside the draft. */
  approvalTaskId: number;
  meta: {
    kind: ActionKind;
    tone: Tone;
    sentEmail: false;        // explicit guarantee — saveDraft never sends
    gmailAccountId?: number;
  };
}

const MAX_SUBJECT_LEN = 998;   // RFC 5322 line-length limit minus header name
const MAX_BODY_LEN    = 100_000;

function trimmedString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length === 0 ? null : s;
}

export async function createGmailDraftFromBooking(
  input: GmailDraftInput,
): Promise<GmailDraftResult> {
  // Validate edited override fields up-front (cheap, before any IO).
  let editedSubject: string | null = null;
  let editedBody:    string | null = null;
  if (input.subject !== undefined) {
    editedSubject = trimmedString(input.subject);
    if (editedSubject == null) {
      throw new CommandActionError(400, "subject must be a non-empty string when provided");
    }
    if (editedSubject.length > MAX_SUBJECT_LEN) {
      throw new CommandActionError(400, `subject exceeds ${MAX_SUBJECT_LEN} chars`);
    }
  }
  if (input.body !== undefined) {
    editedBody = trimmedString(input.body);
    if (editedBody == null) {
      throw new CommandActionError(400, "body must be a non-empty string when provided");
    }
    if (editedBody.length > MAX_BODY_LEN) {
      throw new CommandActionError(400, `body exceeds ${MAX_BODY_LEN} chars`);
    }
  }
  // Edited mode requires BOTH subject and body so we never half-overwrite.
  if ((editedSubject == null) !== (editedBody == null)) {
    throw new CommandActionError(400, "subject and body must be provided together when overriding");
  }

  // Phase I service does owner-scoping + CRM context load + template fallback
  // in one call. Throws CommandActionError(403/404) on its own.
  const generated = await generateFollowupDraft({
    callerUserId:  input.callerUserId,
    callerIsAdmin: input.callerIsAdmin,
    kind:          input.kind,
    recipientId:   input.recipientId,
    bookingLinkId: input.bookingLinkId,
    tone:          input.tone,
  });

  const isEdited = editedSubject != null && editedBody != null;
  const subject  = isEdited ? editedSubject! : generated.subject;
  const body     = isEdited ? editedBody!    : generated.body;

  // Mailbox resolution + edit-access gate (self-contained — see helper above).
  const mailbox = await resolveMailboxForEditOrThrow(
    input.callerUserId, input.callerIsAdmin, input.asAccountId,
  );

  // saveDraft → gmail.users.drafts.create — explicitly NOT a send.
  // We always send as the mailbox OWNER so OAuth tokens resolve correctly even
  // when an admin or grantee is acting on a shared mailbox they don't own.
  let draftRes: any;
  try {
    draftRes = await saveDraft(
      mailbox.acctOwnerUserId,
      generated.context.recipientEmail,
      subject,
      body,
      undefined,                          // threadId — none, this is a fresh draft
      undefined,                          // draftId — create new (not update)
      mailbox.accountId,
    );
  } catch (e: any) {
    // Surface as 503 so the route can pass through the same way the existing
    // /api/gmail/drafts route does on Gmail-not-connected errors.
    throw new CommandActionError(503, `Gmail draft creation failed: ${e?.message ?? "unknown"}`);
  }

  const draftId   = String(draftRes?.id ?? "");
  const messageId = draftRes?.message?.id ? String(draftRes.message.id) : null;
  const threadId  = draftRes?.message?.threadId ? String(draftRes.message.threadId) : null;
  if (!draftId) {
    throw new CommandActionError(503, "Gmail did not return a draft id");
  }

  // Phase K — write a Draft Approval Queue task row.
  //   ownerUserId = mailbox owner so queue scoping aligns with mailbox view
  //                 perms (admin / owner / mail_team[id].view=true).
  //   sourceMeta uses DIFFERENT keys (draftKind / draftRecipientId) than
  //                 Phase H so the existing suppression query never matches.
  const [approvalTask] = await db.insert(tasks).values({
    title:           `Review Gmail draft to ${generated.context.recipientEmail}`,
    description:     null,
    ownerUserId:     mailbox.acctOwnerUserId,
    createdByUserId: input.callerUserId,
    linkedObjectType: null,                     // queue rows live independently of CRM-task linking
    linkedObjectId:   null,
    accountId:       null,
    status:          "pending",
    priority:        "medium",
    aiSuggested:     !isEdited,                 // pure-generated drafts mark as AI-suggested
    source:          DRAFT_APPROVAL_TASK_SOURCE,
    sourceLabel:     generated.context.contactName
                       ?? generated.context.leadName
                       ?? generated.context.recipientEmail,
    sourceMeta: {
      source:           "booking_draft_approval",
      draftKind:        input.kind,             // intentionally NOT 'kind'
      draftRecipientId: input.recipientId,      // intentionally NOT 'recipientId'
      bookingLinkId:    input.bookingLinkId ?? null,
      draftId,
      messageId,
      threadId,
      gmailAccountId:   mailbox.accountId,
      recipientEmail:   generated.context.recipientEmail,
      subject,
      body,
      tone:             generated.meta.tone,
      isEdited,
    },
  }).returning({ id: tasks.id });
  const approvalTaskId = approvalTask.id;

  // Structured audit line — no PII beyond what's already in our logs.
  console.log(JSON.stringify({
    evt:           "booking_gmail_draft_created",
    callerUserId:  input.callerUserId,
    kind:          input.kind,
    recipientId:   input.recipientId,
    bookingLinkId: input.bookingLinkId ?? null,
    tone:          generated.meta.tone,
    source:        isEdited ? "edited" : "generated",
    gmailAcctId:   mailbox.accountId,
    draftId,
    messageId,
    approvalTaskId,
    sentEmail:     false,
  }));

  return {
    draftId, messageId, threadId,
    to:      generated.context.recipientEmail,
    subject, body,
    source:  isEdited ? "edited" : "generated",
    context: generated.context,
    approvalTaskId,
    meta: {
      kind:           input.kind,
      tone:           generated.meta.tone,
      sentEmail:      false,
      gmailAccountId: mailbox.accountId,
    },
  };
}
