---
name: Deterministic CJS Test Pattern
description: How to convert a live-server + real-sleep .cjs test into a deterministic, server-free test using inline function replication and a fake clock.
---

## The pattern

When a `.cjs` test file has TTL/expiry behavior that requires real `sleep()` calls AND makes live HTTP calls, use this three-section structure:

**Part 1 — Inline replica with injectable clock**
Copy the pure logic functions from the TypeScript source into the `.cjs` test as plain JS. Replace every `Date.now()` call with `_clock()`, where `_clock` is a module-level variable. Expose `setFakeClock(ms)` and `advanceFakeClock(ms)` helpers. Test all TTL behavior by setting/advancing the fake clock — no real waits needed.

```js
let _clock = () => Date.now();
function setFakeClock(ms) { _clock = () => ms; }
function advanceFakeClock(ms) { const prev = _clock(); _clock = () => prev + ms; }

function readActiveTypers(key) {
  const entries = _store.get(key) || [];
  const now = _clock();           // <-- injectable, not Date.now()
  return entries.filter(e => e.expiresAt > now);
}
```

**Part 2 — Source-grep of the TS source**
Verify the production TypeScript file actually contains the logic the inline replica assumes. This prevents the replica from drifting silently. Key patterns to grep for:
- The exact constant values (e.g. `TYPING_TTL_MS\s*=\s*7_000`)
- The expiry filter expression (`e.expiresAt > now`)
- The dedup pattern (`e.userId !== userId`)
- The requireAuth guard near the route registration
- The 400/404/403 error messages

**Part 3 — Source-grep of the frontend**
Verify UI copy, component structure, polling config, and indicator placement using `src.indexOf()` ordering checks.

## Why

`.cjs` test files run with plain `node` and cannot `require()` TypeScript modules. Extracting the TS module to a `.cjs` companion creates duplication. Inline replication with source-grep verification gives the same coverage with no duplication and no transpilation dependency.

## How to apply

When you see a `.cjs` test with:
- `await sleep(N_000)` where N > 1
- `await fetch("http://localhost:5000/...")`
- Real user login for test setup

Replace with:
1. Inline replica of the pure functions (typically < 20 lines)
2. Fake clock with `setFakeClock` / `advanceFakeClock`
3. Source-grep Part 2 to pin the production constants and logic
4. Source-grep Part 3 for frontend assertions

Target: < 200ms total runtime, zero network calls, zero real timers.
