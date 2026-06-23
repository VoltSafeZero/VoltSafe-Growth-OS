/**
 * Public/free email domain guard for CRM email identifier linking.
 *
 * Public domains MUST NOT be used as domain-level CRM identifiers because
 * matching @gmail.com to a single marina would be catastrophically wrong.
 * They ARE allowed as specific email addresses (e.g. boatbnbsd@gmail.com).
 */

export const PUBLIC_EMAIL_DOMAINS = new Set<string>([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "zoho.com",
  "mail.com",
  "gmx.com",
  "yandex.com",
  "comcast.net",
  "telus.net",
  "shaw.ca",
  "rogers.com",
  "bell.net",
  "sympatico.ca",
  "hey.com",
]);

export function isPublicDomain(domain: string): boolean {
  return PUBLIC_EMAIL_DOMAINS.has(domain.toLowerCase().trim());
}

export type NormalizedIdentifier =
  | { type: "domain"; value: string }
  | { type: "email";  value: string }
  | { type: "invalid"; value: string; reason: string };

/**
 * Normalize raw user input to a clean domain or email address.
 *
 * Examples:
 *   "@boatbnb.com"                    → { type:"domain", value:"boatbnb.com" }
 *   "https://www.boatbnb.com/contact" → { type:"domain", value:"boatbnb.com" }
 *   "mailto:user@boatbnb.com"         → { type:"email",  value:"user@boatbnb.com" }
 *   "User@BoatBNB.com"                → { type:"email",  value:"user@boatbnb.com" }
 *   "www.boatbnb.com"                 → { type:"domain", value:"boatbnb.com" }
 *   "junk"                            → { type:"invalid", ... }
 */
export function normalizeIdentifierInput(raw: string): NormalizedIdentifier {
  const trimmed = raw.trim();
  if (!trimmed) return { type: "invalid", value: "", reason: "Empty input" };

  let s = trimmed;

  if (s.toLowerCase().startsWith("mailto:")) {
    s = s.slice(7).trim();
  }

  // Strip leading @ FIRST so "@domain.com" is treated as a domain, not a broken email
  if (s.startsWith("@") && !s.slice(1).includes("@")) {
    s = s.slice(1);
  }

  if (s.includes("@")) {
    const normalized = s.toLowerCase().trim();
    const emailRegex = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(normalized)) {
      return { type: "invalid", value: normalized, reason: "Invalid email address format" };
    }
    return { type: "email", value: normalized };
  }

  s = s.replace(/^@/, "");
  s = s.replace(/^https?:\/\//i, "");
  s = s.replace(/^www\./i, "");
  s = s.split("/")[0].split("?")[0].split("#")[0].split(":")[0];
  s = s.toLowerCase().trim();

  const domainRegex = /^[a-z0-9]([a-z0-9\-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9\-]*[a-z0-9])?)+$/;
  if (!domainRegex.test(s)) {
    return { type: "invalid", value: s, reason: "Invalid domain format" };
  }

  return { type: "domain", value: s };
}
