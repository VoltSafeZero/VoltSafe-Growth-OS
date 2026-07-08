---
name: canSend Unified-Mode Guard Order
description: In gmail-inbox.tsx, the canSend IIFE must check activeAccountId==="all" BEFORE the authStatus guard to prevent an expired work account from forcing the entire unified inbox into View-Only mode.
---

## Rule

In the `canSend` IIFE (client/src/pages/gmail-inbox.tsx), the `activeAccountId === "all"` branch MUST come first, before any `authStatus` check.

**Correct order:**
```typescript
const canSend = (() => {
  if (activeAccountId === "all") {
    return (accountsQuery.data ?? []).some((a) => a.isOwner && a.authStatus === "active");
  }
  if (connectedAccount?.authStatus !== "active") return false;
  // ...shared account permission checks...
  return true;
})();
```

**Why:** In unified "All Inboxes" mode, `connectedAccount` resolves to `findDefaultAccount()` which returns the work/personal account. If that one account has `authStatus="expired"`, the old guard (`authStatus !== "active"` check first) returned `false` immediately — forcing View-Only on the entire unified inbox even when other owned active accounts (private Gmail accounts) existed.

**How to apply:** Any time you modify the `canSend` logic, preserve this order: unified-mode check first, per-account authStatus check second. The unified-mode check uses `.some()` across all accounts, not the single `connectedAccount` reference.
