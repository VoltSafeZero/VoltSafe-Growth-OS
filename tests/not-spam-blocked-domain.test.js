#!/usr/bin/env node
/**
 * RETIRED — Commit 2 (domain-filter machinery removal)
 *
 * This test verified the inboxOther / email_filters rescue path:
 *   B1a. Not Spam on a true Gmail-SPAM message
 *   B1b. Not Spam on a blocked-domain (inboxOther) message: client called
 *        DELETE /api/email-filters/:id to permanently remove the domain block.
 *   B1c. Page-refresh persistence: two consecutive fresh GETs confirm domain absent.
 *
 * The inboxOther overlay, filtersQuery, rescuedFromSpam state, and the
 * email_filters rescue branch inside notSpamMutation.onSuccess were all
 * removed in Commit 2.  The email_filters routes and table rows still
 * exist (Commit 3 retires the rows), but the client no longer reads or
 * writes them.
 *
 * B1a coverage is retained in tests/mark-spam-derived-columns.test.cjs
 * (C5–C9) which verifies the not-spam pipeline end-to-end.
 */
console.log("not-spam-blocked-domain: RETIRED (domain-filter machinery removed in Commit 2)");
console.log("Coverage moved to: tests/mark-spam-derived-columns.test.cjs (C5-C9)");
process.exit(0);
