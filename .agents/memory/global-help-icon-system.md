---
name: Global CMS help/info icon system
description: Where the reusable info-icon help system lives and how permission-scoped help content works.
---

Built a single reusable `FieldHelp` component (`client/src/components/help/field-help.tsx`)
backed by a centralized registry (`client/src/lib/help-content.ts`, keyed by
`helpKey`) instead of scattering tooltip copy across every page. Missing keys
never crash — `getHelpContent()` always returns a safe fallback entry and
only warns in dev.

**Permission scoping pattern:** `HelpEntry.restrictedToEmails?: string[]`
lets a help entry stay hidden from everyone except an explicit email list,
falling back to the generic message for anyone else — same shape as the
Learn-tab `restrictedToEmails` pattern (see capital-cfo-onboarding-seed.md).
Reuse this field for any future per-person or per-role help content instead
of inventing a new mechanism; it composes cleanly with the existing
`audience` field (`all-users` / `capital-users` / `cfo-onboarding` / etc.)
used for coarser module-level scoping.

**Rollout is intentionally partial, not exhaustive.** First pass covers:
sidebar module labels (Today/Currents/Work/Pipeline/Operations/Insights/
Marketing/Capital/Feed-CORTEX/Learn) and the spec's required example CRM/
global-action entries (Create, Search, Filter, Sort, Owner, Priority,
Status, Last Touch, Next Action, AI Summary, Archive, Delete) plus Capital
metrics. Extending coverage to remaining pages (CRM tables, Currents,
Work/Tasks UI, Calendar, AI Copilot) is just adding more `HELP_CONTENT`
entries and dropping `<FieldHelp helpKey="..." />` next to the label — no
new plumbing needed.
