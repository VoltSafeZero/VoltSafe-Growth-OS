# VoltSafe Cortex - Stage 2 UI Pages Prompt

Build the core page layouts for VoltSafe Cortex inside the existing CMS.

This is not a rebuild from scratch.
Use the new information architecture, but preserve existing data bindings and compatibility.

## Priority Screens to Implement
1. Home
2. CRM > Accounts list
3. CRM > Account detail
4. CRM > Opportunities list
5. CRM > Opportunity detail
6. Support > Tickets list
7. Support > Ticket detail
8. Execution > Tasks
9. Execution > Projects
10. CRM > Contacts list/detail
11. CRM > Quotes list/detail

## Global Layout
Use:
- left sidebar with primary nav
- top bar with search, quick add, notifications, user menu
- page header with title, subtitle, actions
- contextual tabs on detail pages
- dark premium B2B SaaS styling
- clean spacing and soft borders
- cards + tables + timelines

## Home Page
### Header
- Title: Home
- Subtitle: Company overview and recent activity
- Actions:
  - New Account
  - New Opportunity
  - New Ticket

### Sections
- KPI cards:
  - Open Opportunities
  - Quote Value in Play
  - Open Support Tickets
  - Tasks Due This Week
  - Active Strategic Initiatives
  - Upcoming Meetings
- Pipeline Snapshot
- Support Snapshot
- Recent Activity
- Upcoming Calendar
- Recently Updated Accounts
- Open Quotes
- Strategic Relationship Activity

## CRM > Accounts List
### Header
- Title: Accounts
- Subtitle: Manage customers, partners, and organizations
- Actions:
  - New Account
  - Import
  - Filters

### Filters
- search
- account type
- owner
- region
- status
- saved views

### Saved Views
- All Accounts
- Marinas
- Partners
- OEMs
- Government
- Recently Updated
- High Priority
- Pilot / Lighthouse

### Table Columns
- Account Name
- Type
- Primary Contact
- Owner
- Status
- Region
- Last Activity
- Open Opportunities
- Open Tickets

## CRM > Account Detail
### Header
- Account name
- account type badge
- status badge
- actions:
  - Add Contact
  - New Opportunity
  - New Quote
  - New Ticket

### Tabs
- Overview
- Contacts
- Opportunities
- Quotes
- Communications
- Support
- Documents
- Activity

### Overview Layout
Top summary cards:
- Open Opportunities
- Active Quotes
- Open Support Tickets
- Last Activity

Main layout:
Left:
- Account Summary
- Opportunity Snapshot
- Recent Communications

Right:
- Key Contacts
- Support Snapshot
- Activity Timeline

## CRM > Opportunities List
### Views
- table view
- kanban pipeline view

### Stages
- New Lead
- Qualified
- Discovery
- Proposal
- Verbal / Procurement
- Won
- Lost
- Nurture

### Opportunity Card Fields
- name
- account
- estimated value
- owner
- expected close
- stage
- stale indicator

## CRM > Opportunity Detail
### Tabs
- Overview
- Account
- Contacts
- Quotes
- Tasks
- Notes
- Activity

### Overview
Top strip:
- value
- stage
- expected close
- owner
- probability

Main layout:
Left:
- summary
- deal notes
- next steps

Right:
- linked contacts
- open tasks
- recent activity

## Support > Tickets List
### Header
- Title: Tickets
- Subtitle: Customer support requests and issue tracking
- Actions:
  - New Ticket
  - Export
  - Filters

### Summary Cards
- Open Tickets
- Critical Tickets
- Waiting on Customer
- Overdue / Escalated

### Filters
- search
- status
- severity
- category
- assigned owner
- account
- saved views

### Saved Views
- All Tickets
- Open
- Critical
- Waiting on Customer
- Dashboard Issues
- Billing Issues
- Recently Updated
- My Tickets

### Table Columns
- Ticket ID
- Subject
- Account
- Contact
- Category
- Status
- Severity
- Assigned To
- Created
- Last Updated

## Support > Ticket Detail
### Header
- Ticket ID + Subject
- status badge
- severity badge
- actions:
  - Assign
  - Change Status
  - Add Internal Note
  - Resolve Ticket

### Tabs
- Overview
- Account
- Contact
- Internal Notes
- Activity
- Attachments
- Resolution

### Overview Layout
Top strip:
- Status
- Severity
- Category
- Assigned Owner
- Created Date
- SLA / Due Target

Main layout:
Left:
- Issue Summary
- Conversation / Updates
- Attachments

Right:
- Linked Account
- Linked Contact
- Ticket Meta
- Related Tickets

## Execution > Tasks
### Header
- Title: Tasks
- Subtitle: Work queue and follow-through
- Actions:
  - New Task

### Summary Cards
- Due Today
- Overdue
- Assigned to Me
- Completed This Week

### Views
- table
- board
- my tasks

### Columns
- Task
- Linked Record
- Owner
- Priority
- Due Date
- Status

## Execution > Projects
### Header
- Title: Projects
- Subtitle: Coordinated workstreams and internal initiatives
- Actions:
  - New Project

### Filters
- type
- owner
- status
- linked account
- saved views

### Project Types
- Pilot
- Lighthouse
- Partnership
- Grant
- Internal Initiative
- Research Project
- Event
- Marketing / Content

### Detail Tabs
- Overview
- Tasks
- Timeline
- Documents
- Notes
- Activity

## CRM > Contacts
List columns:
- Name
- Account
- Title
- Email
- Phone
- Relationship Type
- Last Activity
- Open Tickets

Contact detail tabs:
- Overview
- Activity
- Communications
- Support
- Notes

## CRM > Quotes
List columns:
- Quote #
- Account
- Opportunity
- Status
- Amount
- Issue Date
- Expiry Date
- Owner

Quote detail tabs:
- Overview
- Linked Opportunity
- Documents
- Activity

## Important Build Rules
- do not break existing data sources
- connect new pages to current data where possible
- preserve legacy fields even if hidden
- use adapters/mappers if old and new field names differ
- do not hard delete old UI until replacement is validated
- keep routes and components modular

## Acceptance Criteria
- new core pages exist and are navigable
- list/detail patterns are consistent
- linked records work
- support section is first-class
- old data still appears correctly in new pages
