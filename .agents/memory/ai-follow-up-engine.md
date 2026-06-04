---
name: AI Follow-Up Engine
description: Phase 3 behaviour-driven follow-up engine — service, routes, component, and test patterns
---

# AI Follow-Up Engine

## Architecture
- Service: `server/services/ai-follow-up.ts`
  - `buildEngagementSummary(entityType, entityId, userId)` → `EngagementSummary`
  - `generateFollowUpEmail(params)` → calls generateSuggestedNextEmail with engagementSummary
  - `dismissInsight(entityType, entityId)` / `isInsightDismissed()` — in-memory Map (resets on restart, acceptable)
- 7 categories: hot / warm / re-engage / technical / commercial / dormant / neutral
- Routes registered in `server/routes.ts` near the follow-up engine section

## TECHNICAL_PATTERNS — "guide" REMOVED
"guide" was removed from TECHNICAL_PATTERNS because "Pricing Guide" incorrectly matched technical.
Current list: spec, pedestal, shore-power, shore_power, cert, install, compliance, technical, datasheet, data-sheet, manual, commissioning, wiring, electrical.

## Frontend
- `client/src/components/follow-up-insight-card.tsx` — standalone component, auto-fetches insight, renders category badge + stats + Generate/Dismiss
- Inserted at top of `EmailsTab` (covers all Lead/Contact/Account email tabs automatically)
- GeneratedEmailDialog shows AI draft with copy-to-clipboard; neutral category silently returns null

**Why:** neutral = no signal worth surfacing; avoids noise for contacts with zero engagement history.

## Test file
`tests/ai-follow-up.test.cjs` (76 checks) — must be .cjs (package.json type=module)
