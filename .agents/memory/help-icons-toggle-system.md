---
name: Contextual help toggle architecture
description: Durable rules for building a global, per-user show/hide toggle for contextual help icons and for nesting interactive icons in nav rows.
---

A global "show/hide all help icons" preference should be enforced in one shared rendering component, not checked separately on every page that renders help icons. The component itself returns nothing when the preference is off.
**Why:** centralizing the check means every future help surface automatically respects the preference with zero extra wiring, and there's no risk of a page forgetting the check.
**How to apply:** any new "hide this UI element globally per user" feature should look for (or create) a single shared component boundary to gate on, rather than sprinkling conditionals.

An icon/button placed next to a clickable nav row (link) must be a sibling of that link, never nested inside it.
**Why:** nesting an interactive icon inside an anchor/link breaks click semantics — clicking the icon also triggers the outer navigation.
**How to apply:** when adding per-row icons (info, actions, badges) to a list of nav links, wrap the link and the icon in a shared flex container instead of putting the icon inside the link.

Additive raw-SQL column migrations that run at server startup only take effect after the server process actually restarts.
**Why:** one-off scripts/test workflows that query the affected table will fail with "column does not exist" if run against a still-running (pre-migration) process.
**How to apply:** after adding a new additive column via a startup migration, restart the main app workflow before re-running any dependent test suite or script.
