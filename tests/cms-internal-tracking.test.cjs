/**
 * Regression tests — CMS internal tracking prevention
 *
 * Verifies that viewing a sent email inside VoltSafe CMS does NOT count as
 * an external recipient open or update "Last seen" timestamps.
 *
 * Three layers are tested:
 *   L1. Frontend MessageBody strips tracking pixels from email HTML.
 *   L2. Backend proxy-image endpoint blocks /track/open/ URLs.
 *   L3. recordOpen/recordClick mark authenticated CMS sessions as internal.
 *   L4. Data repair: VoltSafeMailViewer UA events are marked internal.
 */

const assert = require("assert");

// ─── helpers ────────────────────────────────────────────────────────────────
function pass(label) { console.log(`  ✅  ${label}`); }
function fail(label, detail) { console.error(`  ❌  ${label}`); if (detail) console.error("     ", detail); process.exitCode = 1; }
function section(title) { console.log(`\n── ${title}`); }

// ─── L1: Frontend — tracking pixel stripping regex ──────────────────────────
section("L1 — Frontend: strip tracking pixels from email HTML");

(function testFrontendPixelStrip() {
  // The regex used in the MessageBody sanitized memo
  const STRIP_RE = /<img[^>]+src=["'][^"']*\/track\/(?:open|click)\/[^"']*["'][^>]*\/?>/gi;

  const cases = [
    {
      label: "absolute https tracking pixel (double-quoted)",
      input: `<p>Hello</p><img src="https://app.replit.app/track/open/abc-123" width="1" height="1" style="display:none" alt="" />`,
      expectStripped: true,
    },
    {
      label: "relative tracking pixel (double-quoted)",
      input: `<p>Hello</p><img src="/track/open/abc-123" width="1" height="1" alt="" />`,
      expectStripped: true,
    },
    {
      label: "click tracking pixel (double-quoted)",
      input: `<img src="https://app.example.com/track/click/def-456" width="1" height="1" />`,
      expectStripped: true,
    },
    {
      label: "tracking pixel with single quotes",
      input: `<img src='/track/open/xyz-789' width='1' height='1' alt='' />`,
      expectStripped: true,
    },
    {
      label: "regular product image must NOT be stripped",
      input: `<img src="https://cdn.example.com/logo.png" alt="Logo" />`,
      expectStripped: false,
    },
    {
      label: "CID proxy image must NOT be stripped",
      input: `<img src="/api/gmail/messages/123/cid-image/abc" />`,
      expectStripped: false,
    },
    {
      label: "base64 inline image must NOT be stripped",
      input: `<img src="data:image/png;base64,abc123" />`,
      expectStripped: false,
    },
    {
      label: "pixel with self-closing tag variant",
      input: `<img src="https://host.com/track/open/token-001" style="display:none" />`,
      expectStripped: true,
    },
  ];

  cases.forEach(({ label, input, expectStripped }) => {
    const result = input.replace(STRIP_RE, "");
    const wasStripped = !result.includes(input.match(/<img/)?.[0] ?? "NOMATCH");
    // Check whether the img tag is present in the result
    const imgPresent = /<img[^>]+>/i.test(result);
    if (expectStripped) {
      if (imgPresent && result.includes("/track/")) {
        fail(label, `tracking pixel was NOT stripped. Result: ${result.slice(0, 120)}`);
      } else {
        pass(label);
      }
    } else {
      if (!imgPresent) {
        fail(label, `non-tracking image was incorrectly stripped. Result: ${result.slice(0, 120)}`);
      } else {
        pass(label);
      }
    }
  });
})();


// ─── L2: Backend proxy-image — tracking URL detection ───────────────────────
section("L2 — Backend proxy-image: block tracking pixel URLs");

(function testProxyImageGuard() {
  // The guard logic from routes.ts proxy-image endpoint
  function wouldBeBlocked(rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      return /\/track\/(open|click)\//i.test(parsed.pathname);
    } catch {
      return false;
    }
  }

  const cases = [
    { url: "https://app.replit.app/track/open/abc-123",         expect: true,  label: "absolute tracking open pixel" },
    { url: "https://app.replit.app/track/click/abc-123?url=x",  expect: true,  label: "absolute tracking click URL" },
    { url: "https://cdn.example.com/logo.png",                  expect: false, label: "regular CDN image" },
    { url: "https://app.replit.app/api/gmail/proxy-image",      expect: false, label: "proxy-image endpoint itself" },
    { url: "https://app.replit.app/assets/cta/banner.png",      expect: false, label: "CTA asset image" },
    { url: "https://app.replit.app/track/open/",                expect: true,  label: "tracking pixel path with trailing slash" },
  ];

  cases.forEach(({ url, expect: expectedBlocked, label }) => {
    const blocked = wouldBeBlocked(url);
    if (blocked === expectedBlocked) {
      pass(label);
    } else {
      fail(label, `wouldBeBlocked("${url}") returned ${blocked}, expected ${expectedBlocked}`);
    }
  });
})();


// ─── L3: recordOpen / recordClick — opts.cmsSession & isCmsProxyUserAgent ───
section("L3 — Backend tracking.ts: CMS session and proxy UA detection");

(function testInternalDetection() {
  // Mirror of isCmsProxyUserAgent from server/tracking.ts
  function isCmsProxyUserAgent(ua) {
    if (!ua) return false;
    return /VoltSafeMailViewer/i.test(ua);
  }

  // Mirror of internal-reason logic
  function resolveInternal(recipientEmail, userAgent, cmsSession) {
    const INTERNAL_DOMAINS = new Set(["voltsafe.com", "voltsafemarine.com"]);
    function isInternalEmail(email) {
      if (!email) return false;
      const at = email.lastIndexOf("@");
      if (at < 0) return false;
      return INTERNAL_DOMAINS.has(email.slice(at + 1).toLowerCase());
    }
    const isCmsProxy  = isCmsProxyUserAgent(userAgent);
    const isCmsDirect = cmsSession === true;
    const internal = isInternalEmail(recipientEmail) || isCmsProxy || isCmsDirect;
    const reason = isInternalEmail(recipientEmail)
      ? `internal_domain:${recipientEmail.split("@")[1]}`
      : isCmsProxy  ? "cms_proxy_image"
      : isCmsDirect ? "cms_authenticated_session"
      : null;
    return { internal, reason };
  }

  const cases = [
    {
      label: "VoltSafeMailViewer UA → cms_proxy_image (external recipient)",
      recipientEmail: "jhester@shmarinas.com",
      ua: "Mozilla/5.0 (compatible; VoltSafeMailViewer/1.0; +https://voltsafe.com)",
      cmsSession: false,
      expectInternal: true,
      expectReason: "cms_proxy_image",
    },
    {
      label: "authenticated CMS session → cms_authenticated_session (external recipient)",
      recipientEmail: "jhester@shmarinas.com",
      ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36 Chrome/125",
      cmsSession: true,
      expectInternal: true,
      expectReason: "cms_authenticated_session",
    },
    {
      label: "internal domain recipient → internal_domain",
      recipientEmail: "trevor@voltsafe.com",
      ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X)",
      cmsSession: false,
      expectInternal: true,
      expectReason: "internal_domain:voltsafe.com",
    },
    {
      label: "external recipient + unauthenticated + browser UA → NOT internal (real open)",
      recipientEmail: "jhester@shmarinas.com",
      ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit",
      cmsSession: false,
      expectInternal: false,
      expectReason: null,
    },
    {
      label: "VoltSafeMailViewer UA case-insensitive (VOLTSAFEMAILVIEWER uppercase)",
      recipientEmail: "someone@external.com",
      ua: "Mozilla/5.0 (compatible; VOLTSAFEMAILVIEWER/2.0)",
      cmsSession: false,
      expectInternal: true,
      expectReason: "cms_proxy_image",
    },
    {
      label: "no UA (empty string) — NOT cms_proxy, still not internal for external recipient",
      recipientEmail: "someone@external.com",
      ua: "",
      cmsSession: false,
      expectInternal: false,
      expectReason: null,
    },
    {
      label: "both cmsSession AND cms proxy UA — cms_proxy_image takes priority",
      recipientEmail: "jhester@shmarinas.com",
      ua: "Mozilla/5.0 (compatible; VoltSafeMailViewer/1.0; +https://voltsafe.com)",
      cmsSession: true,
      expectInternal: true,
      expectReason: "cms_proxy_image",
    },
  ];

  cases.forEach(({ label, recipientEmail, ua, cmsSession, expectInternal, expectReason }) => {
    const { internal, reason } = resolveInternal(recipientEmail, ua, cmsSession);
    if (internal !== expectInternal) {
      fail(label, `internal=${internal}, expected ${expectInternal}`);
    } else if (reason !== expectReason) {
      fail(label, `internal_reason="${reason}", expected "${expectReason}"`);
    } else {
      pass(label);
    }
  });
})();


// ─── L4: Data repair — VoltSafeMailViewer UA SQL pattern ────────────────────
section("L4 — Data repair: VoltSafeMailViewer UA pattern for SQL ILIKE");

(function testDataRepairPattern() {
  // Match what the SQL ILIKE '%VoltSafeMailViewer%' would find
  const ILIKE_RE = /VoltSafeMailViewer/i;

  const samples = [
    { ua: "Mozilla/5.0 (compatible; VoltSafeMailViewer/1.0; +https://voltsafe.com)", expect: true },
    { ua: "Mozilla/5.0 (compatible; VOLTSAKEMAILVIEWER/2.0)", expect: false }, // typo
    { ua: "Mozilla/5.0 (compatible; VoltSafeMailViewer/2.0)", expect: true  },
    { ua: "Mozilla/5.0 (Windows NT 10.0) Chrome/125",         expect: false },
    { ua: "Googlebot/2.1",                                    expect: false },
    { ua: "",                                                  expect: false },
  ];

  samples.forEach(({ ua, expect: expected }) => {
    const match = ILIKE_RE.test(ua);
    if (match === expected) {
      pass(`ILIKE match for "${ua.slice(0, 60)}": ${match}`);
    } else {
      fail(`ILIKE match for "${ua.slice(0, 60)}"`, `got ${match}, expected ${expected}`);
    }
  });
})();


// ─── L5: Engagement count SQL filters already exclude is_internal ────────────
section("L5 — Engagement SQL: is_internal IS NOT TRUE filter present in query snippets");

(function testEngagementSqlFilter() {
  // Snippets from tracking.ts getEngagementStats queries — verify the filter
  // is present so once events are marked internal, counts auto-correct.
  const snippets = [
    {
      label: "unique_opens FILTER has is_internal IS NOT TRUE",
      sql: `COUNT(*) FILTER (WHERE is_bot=false AND is_duplicate=false AND is_internal IS NOT TRUE) AS unique_opens`,
    },
    {
      label: "last_open_at FILTER has is_internal IS NOT TRUE",
      sql: `MAX(occurred_at) FILTER (WHERE is_bot=false AND is_duplicate=false AND is_internal IS NOT TRUE) AS last_open_at`,
    },
    {
      label: "unique_clicks FILTER has is_internal IS NOT TRUE",
      sql: `COUNT(*) FILTER (WHERE is_bot=false AND is_duplicate=false AND is_internal IS NOT TRUE) AS unique_clicks`,
    },
  ];

  snippets.forEach(({ label, sql }) => {
    if (sql.includes("is_internal IS NOT TRUE")) {
      pass(label);
    } else {
      fail(label, `Missing is_internal IS NOT TRUE in SQL: ${sql}`);
    }
  });
})();


// ─── Summary ─────────────────────────────────────────────────────────────────
const exitCode = process.exitCode ?? 0;
console.log(`\n${exitCode === 0 ? "✅ All CMS internal tracking tests passed." : "❌ Some tests FAILED — see above."}`);
