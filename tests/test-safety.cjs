/**
 * tests/test-safety.cjs
 *
 * Shared test-safety guard.
 *
 * Provides helpers that prevent test code from accidentally mutating real
 * application data. All fixture emails must end in an approved domain suffix
 * so that any accidental escape outside the test harness is immediately
 * identifiable and causes no cross-contamination with production data.
 *
 * Usage:
 *   const { assertFixtureDomain, safeFixtureEmail } = require('./test-safety.cjs');
 *   safeFixtureEmail('mbswitch-1234@example.invalid');  // ✓
 *   safeFixtureEmail('trevor@voltsafe.com');            // ✗ throws
 */

"use strict";

/** Domains that are safe to create, mutate, and delete inside tests. */
const FIXTURE_DOMAINS = [
  "example.invalid",   // RFC 2606 — guaranteed unreachable
  "voltsafe.invalid",  // test-only variant for in-suite clarity
  "mailtest.invalid",
];

/**
 * Asserts that `email` ends in an approved fixture domain.
 * Throws a hard error if it does not — use this before any INSERT/UPDATE/DELETE
 * that targets a user or email_account row.
 *
 * @param {string} email
 */
function assertFixtureDomain(email) {
  if (typeof email !== "string" || !email.includes("@")) {
    throw new Error(`TEST SAFETY: invalid email argument: ${JSON.stringify(email)}`);
  }
  const domain = email.split("@").pop().toLowerCase();
  const allowed = FIXTURE_DOMAINS.some(
    (d) => domain === d || domain.endsWith("." + d),
  );
  if (!allowed) {
    throw new Error(
      `TEST SAFETY VIOLATION: attempt to mutate real email "${email}". ` +
      `Test fixtures must use a domain from: ${FIXTURE_DOMAINS.join(", ")}. ` +
      `Never mutate @voltsafe.com, @hyalos.com, @gmail.com, or any real address.`,
    );
  }
}

/**
 * Returns `email` after asserting it is safe.  Use as a pass-through in query
 * arguments so the check is inline and cannot be accidentally skipped.
 *
 * @param {string} email
 * @returns {string}
 */
function safeFixtureEmail(email) {
  assertFixtureDomain(email);
  return email;
}

/**
 * Generates a unique fixture email address that is safe to use in tests.
 *
 * @param {string} prefix  - short slug identifying the test (e.g. "mbswitch")
 * @param {string} [label] - optional label appended before the @  (e.g. "viewer")
 * @returns {string}
 */
function fixtureEmail(prefix, label) {
  const tag = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const local = label ? `${tag}-${label}` : tag;
  return `${local}@example.invalid`;
}

/**
 * Throws if NODE_ENV suggests production and the call looks like a test mutation.
 * Provides a belt-and-suspenders guard when TEST_DATABASE_URL is not set.
 */
function assertTestEnvironment() {
  const env = process.env.NODE_ENV || "";
  if (env === "production") {
    throw new Error(
      "TEST SAFETY: refusing to run test mutations in NODE_ENV=production.",
    );
  }
}

module.exports = { assertFixtureDomain, safeFixtureEmail, fixtureEmail, assertTestEnvironment, FIXTURE_DOMAINS };
