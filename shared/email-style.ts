/**
 * email-style.ts — VoltSafe Mail outbound style constants.
 *
 * Single source of truth for the font, size, color, and spacing applied to
 * every outbound email body. Imported by both:
 *   • client/src/lib/email-format.ts      (paste handler + HTML builder)
 *   • server/services/email-html-normalizer.ts  (pre-send safety net)
 *
 * Keeping these in one place means a style update automatically propagates
 * to the composer, the send path, and the draft-save path with no drift.
 */

export const VOLTSAFE_FONT_FAMILY = "Arial,Helvetica,sans-serif";
export const VOLTSAFE_FONT_SIZE   = "14px";
export const VOLTSAFE_BODY_COLOR  = "#111111";
export const VOLTSAFE_LINE_HEIGHT = "1.6";
export const VOLTSAFE_LINK_COLOR  = "#00C1DE";

/**
 * Inline CSS applied to the outer wrapper <div> of every outbound email body.
 * Must stay in sync with the finger-print checks inside normalizeOutboundHtml.
 */
export const VOLTSAFE_BODY_STYLE =
  `font-family:${VOLTSAFE_FONT_FAMILY};font-size:${VOLTSAFE_FONT_SIZE};color:${VOLTSAFE_BODY_COLOR};` +
  `line-height:${VOLTSAFE_LINE_HEIGHT};margin-bottom:24px;`;
