---
name: Mobile/Tablet Responsive Audit
description: Breakpoint strategy and all files changed during the mobile+tablet responsiveness audit.
---

## Rule: Tablet breakpoint is `lg` (1024px), not `md` (768px)

`useIsMobile` returns `true` for viewports < 1024px. Tablets (iPad, 768–1023px) get the mobile nav bottom bar, not the desktop sidebar.

**Why:** The 768px `md:` breakpoint left tablets with a cramped partial-desktop layout — sidebar visible but too narrow, touch targets too small, dialogs clipping content.

**How to apply:**
- Any layout that should switch between "sidebar present" and "mobile nav" must use `lg:` not `md:`.
- The sidebar wrapper in `App.tsx` is `hidden lg:flex`. Bottom padding is `pb-20 lg:pb-0`.
- The header uses `hidden lg:block` (desktop search bar) and `lg:hidden` (mobile search icon/panel).
- The `sidebar.tsx` internal `md:` classes are harmless — they only render when `isMobile` is false (≥1024px).
- Gmail inbox and Documents pages keep their own internal `md:` breakpoints — those are intentional 3-pane layout switches, not related to the nav breakpoint.

## Files changed

- `client/src/hooks/use-mobile.tsx` — MOBILE_BREAKPOINT 768 → 1024
- `client/src/App.tsx` — AppShell: `hidden lg:flex` sidebar, `pb-20 lg:pb-0` main content
- `client/src/components/dashboard/header.tsx` — GlobalSearch `hidden lg:block`; mobile search panel `lg:hidden`; mobile search icon button `lg:hidden`
- `client/src/components/ui/dialog.tsx` — DialogContent default classes: `max-h-[90dvh] overflow-y-auto`; close button `h-8 w-8` min touch target
- `client/src/components/dashboard/mobile-nav.tsx` — "more" panel uses inline style `bottom: calc(4rem + env(safe-area-inset-bottom, 0px))` instead of fixed `bottom-16`
- `client/src/pages/contacts.tsx` — header: `p-4 sm:p-6`, title+search row: `flex-col sm:flex-row`
- `client/src/pages/accounts.tsx` — action row: added `flex-wrap`
- `client/src/pages/tickets.tsx` — header: `p-4 sm:p-6`
- `client/src/pages/quotes.tsx` — form header: `px-4 sm:px-6 pt-4 sm:pt-6`; form body: `px-4 sm:px-6 py-4 sm:py-5`; footer: `px-4 sm:px-6 py-3 sm:py-4 flex-wrap gap-2`
- `client/src/pages/documents.tsx` — header: `p-4 sm:p-6`
- `client/src/pages/admin-users.tsx` — header: `p-4 sm:p-6`; filters bar: `px-4 sm:px-6`
- `client/src/pages/projects.tsx` — tab content area: `px-4 sm:px-6`

## Pattern for page headers

Standard responsive page header:
```
<div className="p-4 sm:p-6 border-b border-border/50">
  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 flex-wrap">
```

For action rows with multiple buttons:
```
<div className="flex items-center gap-2 flex-wrap">
```
