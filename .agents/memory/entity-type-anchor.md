---
name: Entity Type Anchor System
description: How the marina anchor icon on leads is determined — entity_type column, not marina_id.
---

## Rule
The teal marina anchor icon on leads MUST use `isMarinaEntity(lead)` from `crm-taxonomy.ts`.
**Never** base the anchor on `lead.marinaId`, `source`, or import status alone.

## Why
Imported leads got `marina_id` from `marina_directory` import but manually-created marina leads had `marina_id=NULL`. This caused inconsistent anchor display. The `entity_type` column is the canonical, user-editable truth.

## Key Files
- `client/src/lib/crm-taxonomy.ts` — `ENTITY_TYPE_OPTIONS`, `MARINA_ENTITY_TYPES`, `isMarinaEntity()`
- `shared/schema.ts` — `entityType: text("entity_type")` on leads table (nullable)
- `migrations/0034_entity_type.sql` — backfills existing records; idempotent
- `tests/entity-type-anchor.test.cjs` — 39-check suite

## MARINA_ENTITY_TYPES (show anchor)
`marina`, `marina_group`, `port_authority`

## Backward compat
`isMarinaEntity()` falls back to `!!marinaId` when `entityType` is null/empty — so records
backfilled before migration 0034 runs still get the anchor via marina_id.

## Conversion handler (routes.ts)
`ENTITY_TYPE_ORG_MAP` maps lead entityType → account orgType default.
Caller-supplied `reqOrgType` always wins (`reqOrgType ?? entityDerivedOrgType`).

## How to apply
Any new place that shows an anchor or "marina-class" badge on leads must call `isMarinaEntity()`.
New entity types that should show the anchor → add to `MARINA_ENTITY_TYPES` in crm-taxonomy.ts.
