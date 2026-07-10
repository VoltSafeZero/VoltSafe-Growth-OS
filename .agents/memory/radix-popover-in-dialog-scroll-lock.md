---
name: Radix Popover-in-Dialog scroll-lock trap
description: Why a Popover's own scrollable list stops scrolling when the Popover lives inside a Radix Dialog/Sheet, and the fix pattern.
---

## The trap

Radix Dialog/Sheet uses `react-remove-scroll` to body-lock the page while open. That lock only allows wheel/touch scrolling for descendants of the dialog's own content node (or explicit registered "shards"). Radix Popover/DropdownMenu/Select content portals to `<body>` by default — landing *outside* the dialog's content node — so any wheel event fired over a scrollable list inside that popover gets silently `preventDefault()`'d by the lock. The list renders correctly and looks scrollable (has `overflow-y-auto`, has enough content) but nothing happens on scroll/wheel. Click-based interaction still works, which makes this bug easy to miss in a cursory check.

**Why:** this is a known Radix interaction, not a bug unique to any one component. It reproduces for *any* Radix popover-family component (`Popover`, `DropdownMenu`, `Select`, `Combobox`) nested inside a `Dialog`/`Sheet`/`AlertDialog`, whenever the inner list is tall enough to need scrolling.

## The fix pattern

1. Give the inner popover-content component (e.g. a shared `PopoverContent` wrapper) an optional `container?: HTMLElement | null` prop, forwarded to Radix's `<Portal container={...}>`.
2. In the dialog, capture a ref to the dialog's own content div (`ref={setPopoverContainer}`) and expose it via React context to descendants.
3. Have every popover usage inside that dialog read the container from context and pass it down, so the popover portals *inside* the dialog's content node instead of `<body>` — inside the scroll-lock's allowed boundary.

**How to apply:** whenever a new dropdown/select/popover is added inside an existing Dialog/Sheet in this codebase, wire the same `container` prop through — don't assume Radix "just works" for scrollable popover content inside a dialog. Verify with a source-grep test asserting the `container=` wiring and `max-h-[...] overflow-y-auto` on the list, since headless jsdom tests won't catch missing scroll behavior.
