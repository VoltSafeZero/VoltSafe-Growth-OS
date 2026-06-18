/**
 * Behavioral tests for the inboxQueryKey helper and INBOX_QK_PREFIX constant.
 *
 * Verifies that the helper produces exactly the same 6-part array that the
 * previous inline expression produced, for every meaningful combination of
 * crmFilter and inboxCategory. Also pins the 2-part INBOX_QK_PREFIX so a
 * future edit cannot silently break prefix-matching for setQueriesData calls.
 *
 * These are pure-logic tests — no HTTP, no DB.
 */

"use strict";

// We import the compiled output via ts-node / tsx inline evaluation because
// the helper is a pure TypeScript module with no runtime deps.
const { execSync } = require("child_process");

function importHelper() {
  const code = `
    import { inboxQueryKey, INBOX_QK_PREFIX } from "./client/src/lib/inbox-query-key.ts";
    const result = {
      // crmFilter="all" (normal mode) — all combinations of inboxCategory
      all_all:      inboxQueryKey("", null, "all", "all"),
      all_people:   inboxQueryKey("", null, "people", "all"),
      all_updates:  inboxQueryKey("", null, "updates", "all"),
      all_promotions: inboxQueryKey("", null, "promotions", "all"),
      all_social:   inboxQueryKey("", null, "social", "all"),
      all_forums:   inboxQueryKey("", null, "forums", "all"),
      // crmFilter="unread" — category MUST be normalised to "all"
      unread_all:   inboxQueryKey("", null, "all", "unread"),
      unread_people: inboxQueryKey("", null, "people", "unread"),
      // with searchQuery
      search_all:   inboxQueryKey("voltsafe", 1, "all", "all"),
      search_unread: inboxQueryKey("voltsafe", 1, "people", "unread"),
      // activeAccountId variants
      account_num:  inboxQueryKey("", 42, "all", "all"),
      account_all:  inboxQueryKey("", "all", "all", "all"),
      account_null: inboxQueryKey("", null, "all", "all"),
      // prefix
      prefix: INBOX_QK_PREFIX,
    };
    process.stdout.write(JSON.stringify(result));
  `;
  const output = execSync(`npx tsx --eval '${code.replace(/'/g, "'\\''")}' 2>/dev/null`, {
    timeout: 15000,
    encoding: "utf8",
  });
  return JSON.parse(output);
}

let data;
try {
  data = importHelper();
} catch (e) {
  console.error("FATAL: could not import helper —", e.message);
  process.exit(1);
}

let passed = 0;
let failed = 0;

function check(description, actual, expected) {
  const actualStr = JSON.stringify(actual);
  const expectedStr = JSON.stringify(expected);
  if (actualStr === expectedStr) {
    console.log(`  ✓ ${description}`);
    passed++;
  } else {
    console.log(`  ✗ ${description}`);
    console.log(`    expected: ${expectedStr}`);
    console.log(`    actual:   ${actualStr}`);
    failed++;
  }
}

console.log("\n[1] INBOX_QK_PREFIX — 2-part constant");
check("prefix is [\"/api/gmail/messages\",\"inbox\"]",
  data.prefix, ["/api/gmail/messages", "inbox"]);

console.log("\n[2] Normal mode (crmFilter≠\"unread\") — category passes through, crmSegment=\"all\"");
check("all_all:      [\"/api/gmail/messages\",\"inbox\",\"\",null,\"all\",\"all\"]",
  data.all_all, ["/api/gmail/messages", "inbox", "", null, "all", "all"]);
check("all_people:   […,\"people\",\"all\"]",
  data.all_people, ["/api/gmail/messages", "inbox", "", null, "people", "all"]);
check("all_updates:  […,\"updates\",\"all\"]",
  data.all_updates, ["/api/gmail/messages", "inbox", "", null, "updates", "all"]);
check("all_promotions:[…,\"promotions\",\"all\"]",
  data.all_promotions, ["/api/gmail/messages", "inbox", "", null, "promotions", "all"]);
check("all_social:   […,\"social\",\"all\"]",
  data.all_social, ["/api/gmail/messages", "inbox", "", null, "social", "all"]);
check("all_forums:   […,\"forums\",\"all\"]",
  data.all_forums, ["/api/gmail/messages", "inbox", "", null, "forums", "all"]);

console.log("\n[3] Unread mode (crmFilter=\"unread\") — category ALWAYS normalised to \"all\", crmSegment=\"unread\"");
check("unread_all:   category=\"all\"→\"all\", crmFilter→\"unread\"",
  data.unread_all, ["/api/gmail/messages", "inbox", "", null, "all", "unread"]);
check("unread_people: category=\"people\" forced to \"all\", crmFilter→\"unread\"",
  data.unread_people, ["/api/gmail/messages", "inbox", "", null, "all", "unread"]);

console.log("\n[4] searchQuery passes through to slot [2]");
check("search_all:   slot[2]=\"voltsafe\", slot[3]=1, slot[4]=\"all\", slot[5]=\"all\"",
  data.search_all, ["/api/gmail/messages", "inbox", "voltsafe", 1, "all", "all"]);
check("search_unread: slot[2]=\"voltsafe\", slot[3]=1, slot[4]=\"all\", slot[5]=\"unread\"",
  data.search_unread, ["/api/gmail/messages", "inbox", "voltsafe", 1, "all", "unread"]);

console.log("\n[5] activeAccountId variants — number / \"all\" / null all preserved");
check("account_num:  slot[3]=42",
  data.account_num, ["/api/gmail/messages", "inbox", "", 42, "all", "all"]);
check("account_all:  slot[3]=\"all\"",
  data.account_all, ["/api/gmail/messages", "inbox", "", "all", "all", "all"]);
check("account_null: slot[3]=null",
  data.account_null, ["/api/gmail/messages", "inbox", "", null, "all", "all"]);

console.log("\n[6] Prefix is a strict 2-element prefix of every full key");
const fullKey = data.all_all;
const prefix = data.prefix;
const prefixMatches = prefix.every((v, i) => fullKey[i] === v);
check("prefix[0..1] equals fullKey[0..1]", prefixMatches, true);

console.log("\n[7] Key length is always exactly 6");
const keyCases = [
  data.all_all, data.all_people, data.all_updates,
  data.unread_all, data.unread_people,
  data.search_all, data.account_num,
];
keyCases.forEach((key, i) => {
  check(`case ${i}: key.length === 6`, key.length, 6);
});

console.log(`\n${"─".repeat(60)}`);
console.log(`Results: ${passed + failed} checks — ${passed} passed, ${failed} failed`);
if (failed === 0) console.log("All checks passed ✓");
process.exit(failed === 0 ? 0 : 1);
