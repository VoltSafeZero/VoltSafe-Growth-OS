---
name: Marketing Campaigns Module
description: Phase 16 — marketing/campaigns feature; key patterns and gotchas.
---

## Structure
- 7 DB tables in `migrations/0022_marketing_campaigns.sql` (applied)
- Schema in `shared/schema.ts` at end of file
- 19 backend routes in `server/routes.ts` inside `registerRoutes()` function
- 6 frontend pages under `client/src/pages/marketing-*.tsx` + `campaign-detail.tsx`
- Nav section "Marketing" in `client/src/lib/nav-config.ts` with permKey: "crm"
- 6 lazy routes in `client/src/App.tsx` under `/marketing/*`

## Critical Gotcha
When appending to `server/routes.ts` via heredoc/bash, the code lands AFTER the closing `}` of `registerRoutes()`. This causes `ReferenceError: app is not defined` at runtime. Fix: truncate file before closing `}` with `head -n N`, append routes, then re-add the closing `}` and final boot call.

**Why:** `routes.ts` is 36k+ lines; its function body ends at line ~36307; any append goes after that.

## Schema imports in routes.ts
Marketing table imports were added to the existing `from "@shared/schema"` block at the top of routes.ts (around line 44). New tables: `marketingCampaigns, campaignEmails, campaignSegments, campaignTemplates, campaignSuppression` + corresponding insert schemas.
