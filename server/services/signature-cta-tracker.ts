/**
 * signature-cta-tracker.ts — Server-side CTA link wrapping for outbound emails.
 *
 * At send time:
 *   1. Extracts the signature section (between <!--vs-sig-start--> markers).
 *   2. Looks up tracked CTAs for the sending user.
 *   3. Replaces matching destination URLs with /track/signature-click/<token> redirects.
 *   4. Inserts signature_cta_clicks rows (pre-send, no gmail_message_id yet).
 *   5. Also processes body CTAs marked with data-vs-cta-id attribute (outside sig section).
 *
 * injectTracking() already skips URLs containing "/track/" so these won't be
 * double-wrapped by the general email tracking layer.
 */

import crypto from "crypto";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { esc, hashIp, isBotUserAgent } from "../tracking";

const SIG_START = "<!--vs-sig-start-->";
const SIG_END   = "<!--vs-sig-end-->";

export function isSafeCtaUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Split email HTML into [before-sig, sig-content, after-sig].
 * Returns null if no markers found (no wrapping needed).
 */
function splitSigSection(html: string): [string, string, string] | null {
  const si = html.indexOf(SIG_START);
  const ei = html.indexOf(SIG_END, si);
  if (si === -1 || ei === -1) return null;
  return [
    html.slice(0, si),
    html.slice(si + SIG_START.length, ei),
    html.slice(ei + SIG_END.length),
  ];
}

/**
 * Wrap signature CTA links in the email HTML with tracked redirect URLs.
 * Also processes body CTAs marked with data-vs-cta-id attribute.
 * Non-fatal — returns original HTML on any error.
 *
 * @param html           Full email HTML (body + sig section with markers)
 * @param userId         Sender user ID
 * @param recipientEmail Primary recipient email address
 * @param baseUrl        Protocol + host for building redirect URLs
 * @returns Modified HTML and list of generated token strings
 */
export async function wrapSignatureCtaLinks(
  html: string,
  userId: number,
  recipientEmail: string,
  baseUrl: string,
): Promise<{ html: string; tokens: string[] }> {
  const split = splitSigSection(html);
  // When there are no signature markers we still process body CTAs, so fall
  // back to treating the full html as "before" with an empty sig section.
  const [before, sigHtml, after] = split ?? [html, "", ""];

  // Fetch all tracking-enabled CTAs for this user
  const ctaRows = (await db.execute(sql.raw(`
    SELECT id, signature_id, name, destination_url
    FROM email_signature_ctas
    WHERE user_id = ${userId} AND tracking_enabled = TRUE
    ORDER BY id ASC
  `))).rows as any[];

  const tokens: string[] = [];

  // ── 1. Signature section: wrap destination URL matches ──────────────────
  // (Only applies when signature markers were found)
  let wrappedSig = sigHtml;

  if (split && ctaRows.length > 0) {
    for (const cta of ctaRows) {
      const destUrl: string = cta.destination_url;
      if (!isSafeCtaUrl(destUrl)) continue;

      // Escape special regex chars in the destination URL
      const escapedDest = destUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const linkRe = new RegExp(
        `(<a\\b[^>]*\\bhref=["'])${escapedDest}(["'][^>]*>)`,
        "gi",
      );

      if (!linkRe.test(wrappedSig)) continue;
      linkRe.lastIndex = 0;

      const token = crypto.randomUUID();
      const trackUrl = `${baseUrl}/track/signature-click/${token}`;
      wrappedSig = wrappedSig.replace(linkRe, `$1${trackUrl}$2`);

      try {
        await db.execute(sql.raw(`
          INSERT INTO signature_cta_clicks
            (token, signature_cta_id, signature_id, sent_by_user_id,
             recipient_email, cta_name, destination_url, created_at)
          VALUES (
            '${esc(token)}',
            ${cta.id},
            ${cta.signature_id != null ? cta.signature_id : "NULL"},
            ${userId},
            '${esc(recipientEmail)}',
            '${esc(String(cta.name))}',
            '${esc(destUrl)}',
            NOW()
          )
        `));
        tokens.push(token);
      } catch (err) {
        console.error("[cta-tracker] sig token insert failed (non-fatal):", err);
      }
    }
  }

  // ── 2. Body section: wrap anchors marked with data-vs-cta-id ────────────
  // These are CTAs manually inserted into the email body by the composer.
  // This runs whether or not signature markers are present.
  let wrappedBefore = before;

  const bodyCTARe = /<a\b[^>]*\bdata-vs-cta-id="(\d+)"[^>]*>/gi;
  let bMatch: RegExpExecArray | null;
  const bodyCtaMatches: Array<{ tag: string; ctaId: number }> = [];

  // Collect all matches first (avoid re-entrancy issues)
  bodyCTARe.lastIndex = 0;
  while ((bMatch = bodyCTARe.exec(before)) !== null) {
    bodyCtaMatches.push({ tag: bMatch[0], ctaId: Number(bMatch[1]) });
  }

  for (const { tag, ctaId } of bodyCtaMatches) {
    // Look up the CTA record by id — only wrap if tracking_enabled = TRUE to match
    // the same policy as the signature-section step 1 above.
    const [cta] = (await db.execute(sql.raw(`
      SELECT id, signature_id, name, destination_url
      FROM email_signature_ctas
      WHERE id = ${ctaId} AND user_id = ${userId} AND tracking_enabled = TRUE
      LIMIT 1
    `))).rows as any[];

    if (!cta) continue;
    const destUrl: string = cta.destination_url;
    if (!isSafeCtaUrl(destUrl)) continue;

    const token = crypto.randomUUID();
    const trackUrl = `${baseUrl}/track/signature-click/${token}`;

    // Replace the href value inside this specific anchor tag
    const newTag = tag.replace(/\bhref="[^"]*"/, `href="${trackUrl}"`);
    // Replace only the first occurrence of this exact tag string
    const tagIdx = wrappedBefore.indexOf(tag);
    if (tagIdx !== -1) {
      wrappedBefore = wrappedBefore.slice(0, tagIdx) + newTag + wrappedBefore.slice(tagIdx + tag.length);
    }

    try {
      await db.execute(sql.raw(`
        INSERT INTO signature_cta_clicks
          (token, signature_cta_id, signature_id, sent_by_user_id,
           recipient_email, cta_name, destination_url, created_at)
        VALUES (
          '${esc(token)}',
          ${cta.id},
          ${cta.signature_id != null ? cta.signature_id : "NULL"},
          ${userId},
          '${esc(recipientEmail)}',
          '${esc(String(cta.name))}',
          '${esc(destUrl)}',
          NOW()
        )
      `));
      tokens.push(token);
    } catch (err) {
      console.error("[cta-tracker] body CTA token insert failed (non-fatal):", err);
    }
  }

  // Re-inject the sig markers that splitSigSection consumed.
  // extractCtaInlineImages (called after this) relies on <!--vs-sig-start-->
  // to choose the full-src-URL scan path. Without the markers it falls back to
  // the legacy bare-filename path, which builds a regex that can't match
  // absolute CTA image URLs and leaves CID parts orphaned in the MIME tree.
  const sigPart = split ? SIG_START + wrappedSig + SIG_END : "";
  return { html: wrappedBefore + sigPart + after, tokens };
}

/**
 * Update gmail_message_id on pre-inserted signature_cta_clicks rows.
 * Called after Gmail send API returns the message ID.
 */
export async function updateSignatureCtaMessageIds(
  tokens: string[],
  gmailMessageId: string,
): Promise<void> {
  if (tokens.length === 0) return;
  const tokenList = tokens.map(t => `'${esc(t)}'`).join(", ");
  await db.execute(sql.raw(`
    UPDATE signature_cta_clicks
    SET gmail_message_id = '${esc(gmailMessageId)}'
    WHERE token IN (${tokenList})
  `));
}

/**
 * Record a click on a signature CTA token.
 * Logs to signature_cta_click_events, increments click_count, creates CRM activity.
 */
export async function recordSignatureCtaClick(
  token: string,
  ip: string | undefined,
  userAgent: string | undefined,
): Promise<string | null> {
  const isBot   = isBotUserAgent(userAgent);
  const ipHash  = ip ? hashIp(ip) : null;

  // Fetch the click record
  const [row] = (await db.execute(sql.raw(`
    SELECT id, destination_url, cta_name, sent_by_user_id, recipient_email,
           signature_cta_id, click_count
    FROM signature_cta_clicks WHERE token = '${esc(token)}' LIMIT 1
  `))).rows as any[];

  if (!row) return null;

  // Dedupe: same ip_hash within 60 seconds = duplicate
  let isDup = false;
  if (!isBot && ipHash) {
    const [last] = (await db.execute(sql.raw(`
      SELECT id FROM signature_cta_click_events
      WHERE token = '${esc(token)}' AND ip_hash = '${esc(ipHash)}' AND is_bot = FALSE
        AND occurred_at > NOW() - INTERVAL '60 seconds'
      ORDER BY occurred_at DESC LIMIT 1
    `))).rows as any[];
    isDup = Boolean(last);
  }

  await db.execute(sql.raw(`
    INSERT INTO signature_cta_click_events
      (token, ip_hash, user_agent, is_bot, is_duplicate, occurred_at)
    VALUES (
      '${esc(token)}',
      ${ipHash ? `'${esc(ipHash)}'` : "NULL"},
      ${userAgent ? `'${esc(userAgent.slice(0, 500))}'` : "NULL"},
      ${isBot}, ${isDup}, NOW()
    )
  `));

  if (!isBot && !isDup) {
    await db.execute(sql.raw(`
      UPDATE signature_cta_clicks
      SET click_count = click_count + 1, last_clicked_at = NOW()
      WHERE token = '${esc(token)}'
    `));

    // CRM activity: look up contact by recipient_email for attribution
    try {
      const [contact] = (await db.execute(sql.raw(`
        SELECT id FROM contacts WHERE LOWER(email) = '${esc(row.recipient_email.toLowerCase())}'
        LIMIT 1
      `))).rows as any[];

      const ctaName = row.cta_name ?? "CTA";
      const summary = `Clicked "${ctaName}" in email signature`;
      if (contact) {
        await db.execute(sql.raw(`
          INSERT INTO activities (type, summary, linked_object_type, linked_object_id,
            contact_id, created_by, created_at, metadata)
          VALUES (
            'email_cta_click',
            '${esc(summary)}',
            'contact', ${contact.id}, ${contact.id},
            ${row.sent_by_user_id},
            NOW(),
            '${esc(JSON.stringify({
              token,
              destinationUrl: row.destination_url,
              ctaName: row.cta_name,
              recipientEmail: row.recipient_email,
            }))}'::jsonb
          )
        `));
      }
    } catch (actErr) {
      console.error("[cta-tracker] activity write failed (non-fatal):", actErr);
    }
  }

  return row.destination_url as string;
}
