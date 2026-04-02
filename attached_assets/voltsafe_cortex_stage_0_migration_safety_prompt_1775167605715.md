# VoltSafe Cortex - Stage 0 Migration Safety Prompt

Use this prompt before making any structural changes.

## Objective
Refactor and simplify the existing VoltSafe CMS into the new VoltSafe Cortex information architecture **without losing any existing data, records, relationships, pages, notes, files, or functionality**.

This is **not** a greenfield rebuild. This is a migration-safe refactor of an existing system.

## Non-Negotiable Rules
1. Do not delete existing tables, collections, fields, pages, routes, or stored data.
2. Do not rename or overwrite production data structures until a safe mapping layer exists.
3. Preserve every current record and relationship.
4. Create backups/snapshots before any schema or routing changes.
5. Build the new IA as a compatibility layer first, then migrate views gradually.
6. Existing CMS data must remain accessible during and after the refactor.
7. If any old item does not clearly map to the new structure, preserve it in a legacy bucket until manually reviewed.
8. Use additive migration steps first, destructive cleanup only after validation.

## Required Pre-Work
Before implementing anything:
- inspect the current schema, routes, components, and stored data
- inventory all existing sidebar tabs, pages, models, and relationships
- inventory all data fields currently in use
- identify naming collisions
- identify which current objects map to new objects
- identify which items should remain as legacy aliases or saved views
- produce a migration map before changing UI or schema

## Deliverables Required Before Refactor
Create these first:
1. `current_system_inventory`
2. `data_model_diff`
3. `route_mapping_plan`
4. `legacy_to_new_tab_mapping`
5. `backup_and_restore_plan`
6. `rollback_plan`

## Required Safety Process
### Step 1: Snapshot
Create a full backup/export of:
- database
- CMS content
- uploaded files
- environment config if relevant

### Step 2: Inventory
Document:
- current nav items
- current pages/screens
- current models/tables
- current field names
- current linked relationships
- current integrations

### Step 3: Mapping
Map old objects into new structure.

Use this mapping baseline:
- Marina Accounts -> Accounts
- Organizations -> Accounts
- People -> Contacts
- Marina Leads -> Opportunities
- Quotes -> Quotes
- Tickets -> Support > Tickets
- Calendar -> Execution > Calendar
- Communications -> Execution > Communications
- Assets -> Knowledge > Assets
- Research & Innovation -> Strategy > Research
- Strategic Industry -> Strategy > Industry
- Distribution & Channel -> Strategy > Partnerships
- Technology & Integrations -> Strategy or Admin > Integrations depending on meaning
- OEM & Licensing -> Strategy > OEM & Licensing
- Government & Grants -> Strategy > Government & Grants
- Pilot & Lighthouse Marinas -> saved view/filter, not top-level nav
- Regions -> saved view/filter/tag, not top-level nav
- Jira / Confluence / Gmail -> Admin > Integrations, or linked utilities, not top-level nav

### Step 4: Additive Build
Implement new objects, new routes, and new navigation first without removing old ones.

### Step 5: Compatibility Layer
Add compatibility behavior:
- legacy nav aliases
- route redirects
- data adapters
- field mappers
- fallback loaders for old record shapes

### Step 6: Validation
Validate:
- record counts before and after
- linked relationship counts before and after
- file attachment counts before and after
- sample record integrity across all major object types
- navigation parity for existing content

### Step 7: Cleanup
Only after validation:
- hide obsolete nav items
- archive legacy views
- keep migration logs
- never hard delete data unless explicitly approved after verification

## Required Technical Guardrails
- use migrations, not manual destructive edits
- keep legacy IDs if possible
- preserve created_at / updated_at history if possible
- preserve ownership fields
- preserve attachments and notes
- use feature flags for new navigation rollout
- support rollback to the old nav if needed

## Acceptance Criteria
The refactor is only complete when:
- no existing data is lost
- no records are orphaned
- all major old objects can still be found in the new IA
- legacy records remain searchable
- old routes either still work or redirect cleanly
- all attachments and notes remain linked
- support tickets, quotes, accounts, contacts, and opportunities remain intact

## Important
You cannot guarantee zero data loss by assumption.
You must reduce risk by:
- backing up first
- diffing before and after
- validating counts
- preserving old structures until migration is proven safe

Start by generating the system inventory and migration map before changing the interface.
