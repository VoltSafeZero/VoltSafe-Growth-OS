# VoltSafe Cortex - Stage 1 Navigation Refactor Prompt

Implement the new navigation shell for VoltSafe Cortex inside the existing CMS.

This is a **migration-safe navigation refactor**, not a rebuild from scratch.

## Goal
Simplify the sidebar and reorganize the CMS around clear top-level categories while preserving access to all existing data.

## Rules
- do not delete existing data
- do not break existing pages
- build new nav first
- support legacy routes during transition
- old items can become subpages, saved views, or hidden legacy links
- preserve current functionality while improving UX

## New Primary Sidebar
Use this primary left navigation:

```text
Home
CRM
Strategy
Execution
Knowledge
Support
Admin
```

Keep it minimal and premium.

## Section Structure

### Home
Landing page for overview, metrics, recent activity, and shortcuts.

### CRM
Subnav:
- Accounts
- Contacts
- Opportunities
- Quotes
- Activity

### Strategy
Subnav:
- Partnerships
- OEM & Licensing
- Government & Grants
- Research
- Industry

### Execution
Subnav:
- Projects
- Tasks
- Calendar
- Communications

### Knowledge
Subnav:
- Documents
- Assets
- Intelligence

### Support
Subnav:
- Tickets
- Live Issues
- Escalations
- Knowledge Base

### Admin
Subnav:
- Integrations
- Settings

## Legacy Mapping Rules
Map current sections into the new structure without deleting them.

- Marina Accounts -> CRM > Accounts
- Organizations -> CRM > Accounts
- People -> CRM > Contacts
- Marina Leads -> CRM > Opportunities
- Quotes -> CRM > Quotes
- Dashboard -> Home
- Calendar -> Execution > Calendar
- Communications -> Execution > Communications
- Tickets -> Support > Tickets
- Strategic Industry -> Strategy > Industry
- Technology & Integrations -> Strategy or Admin > Integrations depending on meaning
- Distribution & Channel -> Strategy > Partnerships
- OEM & Licensing -> Strategy > OEM & Licensing
- Government & Grants -> Strategy > Government & Grants
- Research & Innovation -> Strategy > Research
- Assets -> Knowledge > Assets
- Events -> Strategy > Industry or Execution > Calendar depending on current usage
- Regions -> filter/tag/saved view, not top-level nav
- Pilot & Lighthouse Marinas -> saved view within CRM > Accounts or Execution > Projects
- Jira -> Admin > Integrations
- Confluence -> Admin > Integrations or Knowledge > Documents entry point
- Gmail Inbox -> Admin > Integrations or Execution > Communications connection
- Team Workload -> Execution > Tasks or Projects

## UI Requirements
- primary sidebar should only show the 7 main items
- when a main item is selected, show a contextual secondary nav or section landing page
- avoid giant persistent nav trees
- preserve a dark premium UI
- include a global search in the top bar
- include a quick create action in the top bar

## Quick Create Menu
- New Account
- New Contact
- New Opportunity
- New Quote
- New Task
- New Project
- New Ticket
- New Document

## Transition Requirements
- keep legacy URLs working where possible
- add redirects from old routes to new routes if safe
- keep legacy pages accessible behind a feature flag or legacy section until validated
- do not remove old nav items from code until new nav is verified

## Deliverables
1. new app shell with primary sidebar
2. section landing pages for each top-level area
3. secondary navigation for each area
4. legacy route compatibility
5. migration-safe mapping notes in code comments or config

## Acceptance Criteria
- all old data is still accessible
- sidebar is significantly cleaner
- every old top-level item is either mapped, preserved, or redirected
- no broken routes
- new nav feels calm, premium, and easier to scan
