---
name: Contextual help expansion + per-user toggle
description: How the richer HelpEntry schema, subnav help icons, and the per-user showHelpIcons preference fit together (Task #78).
---

- `HelpEntry` (client/src/lib/help-content.ts) grew optional fields (whatToDo, whyItMatters, owner, updateCadence, goodLooksLike, commonMistakes, relatedActions) — all backward compatible, so old entries with just title/shortDescription still render fine.
- `FieldHelp` is the single gate: it returns `null` when `currentUser.showHelpIcons === false`, so no per-page manual checks are needed. New help surfaces should just render `<FieldHelp helpKey=... />` and trust the gate.
- Sidebar subnav help icons (`SUBNAV_HELP_KEYS` in app-sidebar.tsx) must be a **sibling** of the item's `<Link>`, never nested inside it — nesting an interactive icon inside an anchor breaks click semantics (the icon click would also navigate). The existing section-level pattern (`SECTION_HELP_KEYS`) already did this correctly; copy that structure, not a naive "icon inside the row" placement.
- `showHelpIcons` was added as a plain boolean column (not folded into the existing `permissions`/`widgetVisibility` JSONB blobs) — simpler for a single on/off preference, consistent with the project's "additive column via raw SQL migration" convention.
- **Gotcha:** after adding a raw-SQL migration column in `server/index.ts`, one-off test scripts/workflows that query `users.*` will fail with `column does not exist` until the "Start application" workflow actually restarts and runs the migration. Restart the app workflow before re-running dependent test suites.
