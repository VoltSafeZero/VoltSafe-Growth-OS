---
name: Modal/dialog horizontal overflow root cause
description: Why Radix dialogs/sheets/drawers can develop horizontal scrollbars even when content looks like it should wrap, and the general-purpose fix.
---

Radix `DialogContent`/`SheetContent`/`DrawerContent`/`AlertDialogContent` set `overflow-y-auto` without an explicit `overflow-x`. Per the CSS spec, setting one axis to a non-visible value forces the other axis to compute to `auto` as well, so the panel silently gains a horizontal scrollbar the moment any descendant refuses to shrink.

The descendant refusal is usually a flex child (a text column, a title/description row) that has no `min-width: 0`. Flex items default to `min-width: auto`, so their intrinsic content width (a long subject line, an unbroken token) can force the row wider than the dialog — and `truncate`/`line-clamp` utilities don't fix this because they only clip once the box already has a definite width, which flex never gives it.

**Why:** discovered while fixing "Save Email to Cortex" modal overflow — `truncate` on the subject line did nothing because the parent flex row had no width constraint.

**How to apply:** for any modal/sheet/drawer primitive, set `overflow-x-hidden` explicitly (don't rely on `overflow-y-auto` alone) and cap width with `max-w-[calc(100vw-2rem)]`; on flex children carrying long text, add `min-w-0 flex-1`; use `break-words [overflow-wrap:anywhere]` for wrapping instead of `truncate` when the requirement is "must stay visible, not clipped." A global CSS backstop (`[role="dialog"], [role="alertdialog"] { overflow-x: hidden; max-width: 100vw } [role="dialog"] * { min-width: 0 }`) catches call sites that can't all be audited individually.
