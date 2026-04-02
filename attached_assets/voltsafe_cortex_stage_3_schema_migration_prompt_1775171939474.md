# VoltSafe Cortex - Stage 3 Schema and Data Migration Prompt

Implement schema evolution and data mapping for VoltSafe Cortex carefully.

This is **not** a destructive rewrite.
This is a migration-safe evolution of the current CMS data model.

## Primary Goal
Create a cleaner scalable CRM-first schema while preserving all current data and relationships.

## Rule 1
Do not delete or overwrite existing production data structures until:
- a full backup exists
- a mapping plan exists
- migration scripts are tested
- validation passes

## Schema Direction
Use or evolve toward these major objects:

- users
- accounts
- contacts
- opportunities
- quotes
- activities
- tasks
- projects
- tickets
- documents
- assets
- partnerships
- licensing_records
- grant_records
- research_records
- industry_records
- notes
- tags
- record_tags
- saved_views
- communications
- optional sites

## Migration Strategy
### Phase A - Inventory
Inspect existing schema and document:
- current tables / collections / models
- current field names
- current relationships
- nullability and required fields
- legacy object names
- attachment/file storage links

### Phase B - Mapping
Prepare a mapping table from old model names to new model names.

Minimum mapping:
- marina_accounts -> accounts
- organizations -> accounts
- people -> contacts
- marina_leads -> opportunities
- quotes -> quotes
- tickets -> tickets
- communications -> communications
- assets -> assets
- research_innovation -> research_records
- strategic_industry -> industry_records or partnerships depending on use
- oem_licensing -> licensing_records
- government_grants -> grant_records

If direct replacement is risky, create new views or adapters first instead of moving data immediately.

### Phase C - Additive Schema
Add any new missing tables/collections and foreign keys without dropping legacy ones.

### Phase D - Data Migration Scripts
Create idempotent migration scripts that:
- copy or map legacy records into new structures
- preserve IDs where possible
- preserve created_at / updated_at where possible
- preserve owner relationships
- preserve attachments
- preserve notes
- preserve legacy references in mapping tables if needed

### Phase E - Compatibility Layer
Build adapters so the UI can read:
- old shape data
- new shape data
- mixed transitional state safely

### Phase F - Validation
Run validation checks:
- total record counts before/after
- linked record counts before/after
- attachment counts before/after
- spot-check at least 10 sample records for each core object
- compare old and new route/page outputs

### Phase G - Progressive Cutover
Only after validation:
- point new UI pages to new schema or adapters
- hide legacy UI
- keep rollback path available

## Core Table Guidance

### users
- id
- name fields
- email
- role
- team
- title
- active status
- timestamps

### accounts
- id
- name
- account_type
- status
- owner_user_id
- location fields
- website / email / phone
- summary fields
- timestamps

### contacts
- id
- account_id
- owner_user_id
- name
- title
- contact fields
- relationship_type
- relationship_strength
- timestamps

### opportunities
- id
- account_id
- owner_user_id
- name
- stage
- status
- estimated_value
- probability_percent
- expected_close_date
- summary
- next_step
- timestamps

### quotes
- id
- account_id
- opportunity_id
- owner_user_id
- quote_number
- status
- amount
- dates
- terms
- timestamps

### tickets
- id
- ticket_number
- subject
- description
- account_id
- contact_id
- assigned_user_id
- category
- status
- severity
- priority
- source
- escalation_status
- sla_due_at
- resolution_summary
- timestamps

### activities
- universal timeline table
- linkable to account/contact/opportunity/quote/project/ticket/etc.

### tasks
- task with nullable links to major objects

### projects
- internal initiatives with optional linked account/opportunity

### documents
- files linked to major records

### communications
- structured comms logs

### notes
- internal notes linked to major records

### partnerships
- strategic relationships

### licensing_records
- OEM/licensing pipeline

### grant_records
- grants and public funding

### research_records
- research and compliance notes

### industry_records
- market and ecosystem tracking

## Required Helper Structures
- opportunity_contacts join table
- tags + record_tags
- saved_views
- optional migration_map table if needed

## Recommended Optional Table
### migration_map
Use this if needed to preserve legacy IDs.

Fields:
- id
- legacy_table_name
- legacy_record_id
- new_table_name
- new_record_id
- migrated_at
- notes

## Required Output from This Stage
1. schema diff plan
2. migration scripts
3. compatibility adapters
4. validation scripts
5. rollback notes
6. migration log

## Acceptance Criteria
- no existing data is lost
- no attachments are orphaned
- key records remain linked
- old and new shapes can coexist during rollout
- new UI reads data correctly
- rollback path remains possible

## Important
You cannot honestly guarantee zero data loss in advance.
You can dramatically reduce the risk by:
- backing everything up
- using additive migrations
- validating counts and sample records
- keeping legacy structures until proven safe

Start with schema inventory and migration map. Do not jump straight to destructive changes.
