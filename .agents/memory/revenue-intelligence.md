---
name: Revenue Intelligence System
description: HubSpot-style revenue intelligence — champion scoring, buying committee, account heatmap, follow-up opportunities, momentum. Pure computation layer over existing engagement tables.
---

## What was built
Full revenue intelligence engine surfacing buying committees, champions, account engagement scores, momentum trends, and follow-up opportunities — no new DB tables, all computed from existing engagement data.

## Scoring weights (locked — tests pin these)
- Open = 1, Click = 3, Demo/Video link = 8, CTA = 5, Reply = 10, Meeting = 20
- TO recipient: 1.5×, CC: 1.0×, BCC: 0.8×
- 7-day recency: 1.5×, 30-day: 1.2×

## Role classification thresholds
- Champion: relScore ≥ 0.7 AND score ≥ 15 AND (opens ≥ 3 OR replies ≥ 1)
- Emerging Champion: relScore ≥ 0.4 AND score ≥ 8
- Decision Maker: title contains CEO/CFO/COO/VP/Director/President/Owner (even with low score)
- Stakeholder: score ≥ 4
- Observer: any opens/clicks but below stakeholder threshold

## Account-to-thread linkage
Uses `email_threads.primary_account_id` — most reliable. For per-contact scoring, falls back to joining `email_tracking_pixels.recipient_email` to `contacts.email` when `email_recipients` rows are absent (historical pre-backfill data).

## Key files
- `server/services/revenue-intelligence.ts` — core engine, all exported functions
- `client/src/pages/revenue-intelligence.tsx` — Revenue Command Center page (`/revenue-intelligence`)
- `tests/revenue-intelligence.test.js` — 55 source-grep checks

## API routes (all under `/api/revenue-intelligence/`)
- `GET /command-center` — all sections for the page
- `GET /heatmap?limit=` — lightweight per-account scores
- `GET /follow-up-opportunities?limit=` — gone-quiet accounts
- `GET /account/:accountId` — full AccountIntelligence for account page
- `GET /account/:accountId/committee` — BuyingCommittee only
- `GET /thread/:threadId/most-engaged` — top contact for thread widget

## UI integration
- `ThreadEngagementWidget` — adds "Most Engaged" champion card + "Buying Committee" section when expanded (lazy-loaded, only fires when expanded=true)
- `AccountProfilePage` — `AccountIntelligencePanel` component renders before Engagement card; returns null if no engagement data (safe for new accounts)
- `nav-config.ts` — entry in intelligence section with `Zap` icon, `permKey: "crm"`, `advisorHidden: true`

## How to apply
- Any new engagement count query MUST include `AND is_internal IS NOT TRUE AND is_bot=FALSE`
- Account score = min(100, sum(sqrt(champion_scores)) * 4) — sublinear to prevent one-contact dominance
- Momentum: compare opens_30d vs opens_prev30d; ≥25% up = accelerating, ≤-25% = cooling, no 30d activity = dormant
- Follow-up criteria: ≥3 opens AND last activity 7-90 days ago (gone quiet but not ancient)
