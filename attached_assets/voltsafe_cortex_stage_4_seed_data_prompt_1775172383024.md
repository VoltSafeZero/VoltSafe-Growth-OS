# VoltSafe Cortex - Stage 4 Seed Data and Test Records Prompt

Create a **safe seed-data and test-record strategy** for VoltSafe Cortex.

This is **not** permission to overwrite, delete, replace, or reset the current CMS database.

This stage exists so the new UI does not render empty or awkward during development, while protecting the existing CMS data.

## Primary Objective
Add development-safe sample content and fallback demo records **without losing, masking, corrupting, or replacing any existing production or legacy CMS data**.

## Non-Negotiable Rules
1. Do not truncate existing tables.
2. Do not reseed the database destructively.
3. Do not overwrite real records with fake records.
4. Do not change primary keys of existing records.
5. Do not delete attachments, notes, quotes, tickets, contacts, or accounts.
6. All seed/demo records must be clearly marked as demo/test/dev content.
7. If the environment is production-like, seed only if explicitly allowed by a feature flag or admin setting.
8. Prefer seed scripts that are idempotent.

## Best Practice Approach
Use one or both of these approaches:

### Option A: UI Placeholder States
Where possible, use elegant empty states and sample layout skeletons instead of writing fake data into the database.

### Option B: Safe Demo Records
If actual records are needed for layout testing, create clearly tagged demo records using:
- `is_demo = true`
- `record_source = "seed_script"`
- name prefixes like `[DEMO]`
- dedicated demo owner account/user if helpful

## Required Environment Safety
Only run seed creation if one of these is true:
- development environment
- staging environment
- explicit admin approval
- feature flag like `ALLOW_DEMO_SEEDING=true`

If production environment is detected:
- do not seed automatically
- exit safely with a warning/log message

## Seed Data Goals
Create enough linked sample data so these screens feel complete:
- Home
- Accounts list/detail
- Contacts list/detail
- Opportunities list/detail
- Quotes list/detail
- Tickets list/detail
- Tasks
- Projects
- Strategy pages
- Documents / Assets / Intelligence

## Seed Record Design Rules
- all demo records should be realistic for VoltSafe
- all demo records should be internally consistent
- link demo accounts to demo contacts, opportunities, quotes, tickets, tasks, and projects
- use clean, professional naming
- clearly mark all demo records as demo

## Suggested Demo Account Types
Create sample records for:
- Marina
- Marina Group
- Port / Harbor
- OEM
- Government / Grant body
- Strategic Partner
- Association

## Suggested Demo Accounts
Use examples like:
- [DEMO] Royal Vancouver Marina
- [DEMO] Pacific Coast Harbor Group
- [DEMO] Port of Cascadia
- [DEMO] BlueCurrent OEM Systems
- [DEMO] Coastal Electrification Program
- [DEMO] Marina Innovation Association
- [DEMO] Shoreline Technology Partners

Do not use names that conflict with real live records if those already exist in the current CMS.

## Suggested Demo Contacts
Create linked contacts such as:
- Marina Manager
- Dockmaster
- Operations Director
- CFO / Procurement Lead
- Innovation Director
- Government Program Manager
- OEM Business Development Lead

All contacts should:
- belong to accounts
- have title, email, phone, and relationship type
- include recent activity where appropriate

## Suggested Demo Opportunities
Create a few pipeline records across stages:
- New Lead
- Qualified
- Discovery
- Proposal
- Verbal / Procurement
- Won
- Nurture

Each should include:
- linked account
- owner
- estimated value
- expected close date
- next step
- summary

## Suggested Demo Quotes
Create a few quote records with statuses:
- Draft
- Sent
- Under Review
- Approved

Each should link to:
- account
- optionally opportunity
- amount
- issue date
- expiry date

## Suggested Demo Tickets
Create a few support tickets related to the VoltSafe Marine Control Dashboard.

Categories:
- Dashboard Bug
- Access / Login
- Billing Issue
- Training / How-To
- Data / Reporting
- Configuration

Statuses:
- New
- Open
- In Progress
- Waiting on Customer
- Resolved

Severity mix:
- Low
- Medium
- High
- Critical

Example subjects:
- [DEMO] Dashboard login access issue
- [DEMO] Billing export mismatch
- [DEMO] User permissions not updating
- [DEMO] Slip usage report confusion
- [DEMO] Need operator training walkthrough

## Suggested Demo Projects
Create sample projects such as:
- [DEMO] Lighthouse Marina Pilot Prep
- [DEMO] OEM Licensing Outreach Q3
- [DEMO] Grant Submission Package
- [DEMO] Competitive Landscape Refresh
- [DEMO] DOCKS Expo Planning

## Suggested Demo Tasks
Create linked tasks across records:
- follow-up call
- quote review
- prepare proposal
- send grant materials
- respond to support ticket
- update partnership notes

## Suggested Demo Documents
Create metadata records or placeholder file references for:
- sales deck
- marina brochure
- quote attachment
- grant brief
- competitive comparison
- meeting notes
- support SOP

Do not disturb existing document storage.
If no real file is attached, use safe placeholder metadata rather than broken file links.

## Suggested Demo Activities
Create realistic activities like:
- call logged
- meeting summary
- follow-up note
- ticket update
- quote sent
- partnership intro meeting

These should populate timelines and dashboards.

## Suggested Demo Saved Views
Create a few useful saved views:
- My Accounts
- Pilot / Lighthouse
- Open Opportunities
- Quotes Expiring Soon
- Critical Tickets
- Overdue Tasks
- Active Partnerships

## Implementation Requirements
### 1. Idempotent Seed Script
Build seed logic so repeated runs do not create duplicates.

Good approaches:
- look up by unique demo slug
- look up by stable external key
- look up by `[DEMO]` naming convention plus object type

### 2. Demo Flagging
Where practical, add fields such as:
- `is_demo`
- `seed_key`
- `record_source`

If schema changes are not desirable yet, use tags:
- `demo`
- `seeded`

### 3. Isolation
Demo records should be easy to:
- filter out
- hide in production views
- remove later if needed

### 4. No Destructive Operations
Seed script must not:
- reset sequences recklessly
- wipe tables
- update non-demo records
- reassign ownership of real records

## Optional Better Alternative
Where the UI only needs layout completeness, prefer:
- placeholder cards
- empty state examples
- component-level mock data in development mode only

This is often safer than database seeding.

## Suggested Deliverables
1. `seed_data_plan`
2. `seed_script`
3. `demo_record_naming_rules`
4. `environment_guardrails`
5. `cleanup_script_for_demo_records_only`
6. `documentation_on_how_to_run_safely`

## Cleanup Rules
If a cleanup script is provided, it must:
- only remove records marked `is_demo=true` or tagged `demo`
- never touch real records
- log what it removes
- support dry-run mode first

## Acceptance Criteria
- new UI screens have enough linked content to feel complete
- existing CMS data remains untouched
- demo/test records are clearly marked
- seed script is idempotent
- seed script is environment-aware
- demo data can be filtered or cleaned up safely

## Final Instruction
Treat existing CMS data as untouchable unless explicitly migrated through the migration plan.

Stage 4 is only for:
- safe demo data
- test records
- UI completeness
- development support

Do not use this stage to replace or rewrite real business data.
