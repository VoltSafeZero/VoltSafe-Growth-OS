# VoltSafe Growth OS — Navigation Phase 4: Remaining More Group Decision Plan

**Date:** 2026-06-27  
**Status:** Decision document only — no code changes  
**Author:** Navigation cleanup series (Phases 1–3 complete)  
**Context:** After Phases 1–3, the More group has been reduced from 16 to 11 items. These remaining 11 require product or information-architecture decisions before they can be moved safely.

---

## 1. Executive Summary

Phases 1–3 resolved the easy cases:

- **Phase 1** — removed nav items that rendered the wrong page, eliminated a duplicate, fixed a personal-tools-in-admin bug, renamed Channels → Ecosystem.
- **Phase 2** — clarified 5 confusing labels without touching any routes or components.
- **Phase 3** — moved 5 items to obviously better groups (Daily Execution → Work, Price Lists → Pipeline, Territory Routing / Support Tickets / Winter Support → Operations).

The 11 items remaining in More are different. Each one has at least one of these complications:

1. **Audience ambiguity** — it is unclear whether the feature is for all users, power users, sales managers, executives, or admins only. Moving it to the wrong group would bury it for its actual users or expose it to users who should not act on it.
2. **Structural dependency** — it belongs in a group (e.g., "Revenue") that does not yet exist in the sidebar, and creating that group requires a product decision.
3. **Feature consolidation opportunity** — two items (Automations + Task Rules) may be better as one item with tabs inside a single page, which would require a UI change before the nav move makes sense.
4. **Role-gating gap** — some items (Score Feedback, Data Quality) are probably admin/ops-facing but are not currently gated at the frontend route level. Moving them to a visible group before deciding their audience could surface config tools to the wrong users.

**These items should not be moved blindly.** The wrong move creates a worse outcome than leaving them in More temporarily: a nav item in the wrong group is harder to find than one in a catch-all.

---

## 2. Remaining More Inventory

### 2.1 Revenue Hub

| Field | Value |
|---|---|
| **Current label** | Revenue Hub |
| **Current route** | `/revenue` |
| **Component** | `client/src/pages/revenue.tsx` |
| **Page title** | "Revenue Hub" |
| **What it does** | MRR dashboard: active accounts, hardware contracts, slip rollout phases, monthly recurring revenue breakdown. Financial overview rather than deal-level pipeline. |
| **Who uses it** | Sales leadership, executives, finance. Not operational/field users. Nav flag: `advisorHidden:true`, `permKey:"crm"`. |
| **Recommended destination** | Insights group OR a new "Revenue" section |
| **Recommended action** | **Product decision needed** — see §3 |
| **Risk** | Low (the move itself is low risk once the destination is decided) |
| **Reason** | Three revenue tools (Hub, Ops, Sim) belong together. Must decide: Insights tab, Pipeline extension, or standalone Revenue group. |

---

### 2.2 Revenue Ops

| Field | Value |
|---|---|
| **Current label** | Revenue Ops |
| **Current route** | `/revenue-ops` |
| **Component** | `client/src/pages/revenue-ops.tsx` |
| **Page title** | "Revenue Ops" |
| **What it does** | Plan commit tracking, gap-to-plan analysis, AI-recommended close actions, monthly commit history snapshots. Management reporting layer, not daily CRM. |
| **Who uses it** | Revenue/sales operations managers, CRO, executive leadership. Nav flag: `advisorHidden:true`. |
| **Recommended destination** | Same group as Revenue Hub |
| **Recommended action** | **Product decision needed** — see §3 |
| **Risk** | Low |
| **Reason** | Same audience as Revenue Hub. Should travel together. |

---

### 2.3 Revenue Simulator

| Field | Value |
|---|---|
| **Current label** | Revenue Simulator |
| **Current route** | `/revenue-sim` |
| **Component** | `client/src/pages/revenue-sim.tsx` |
| **Page title** | "Revenue Simulator" |
| **What it does** | Scenario planning: adjust deal counts, ASP, close rates; project revenue vs. actuals. Saved scenario management. Interactive what-if modeling. |
| **Who uses it** | Sales managers, revenue ops, executives doing scenario planning. Nav flag: `advisorHidden:true`. |
| **Recommended destination** | Same group as Revenue Hub |
| **Recommended action** | **Product decision needed** — see §3 |
| **Risk** | Low |
| **Reason** | Same audience, same theme. Should travel with the suite. |

---

### 2.4 Relationship Intelligence

| Field | Value |
|---|---|
| **Current label** | Relationship Intelligence |
| **Current route** | `/intelligence/rel-intelligence` |
| **Component** | `client/src/pages/relationship-intelligence.tsx` |
| **Page title** | "Relationship Intelligence" |
| **What it does** | Contact warmth scoring, dormant lead detection, multi-threaded relationship views (who on our team knows who at an account). Focuses on relationship health, not pipeline stage. |
| **Who uses it** | Account executives, CS managers, sales leaders. No permission gate — accessible to all authenticated users. |
| **Recommended destination** | Insights group |
| **Recommended action** | **Move to Insights** — low risk, no permission change needed |
| **Risk** | Low |
| **Reason** | Insights already has Executive Dashboard, Executive Copilot, Revenue Intelligence, Territory & Geo, Source Attribution — all analytical lenses. Relationship Intelligence is the same type of tool. No audience ambiguity. |

---

### 2.5 Score Feedback

| Field | Value |
|---|---|
| **Current label** | Score Feedback |
| **Current route** | `/scores/feedback` |
| **Component** | `client/src/pages/score-feedback.tsx` |
| **Page title** | "Score Feedback Loop" |
| **What it does** | Collects human-confirmed outcomes (deal closed, lead converted, churn occurred) to improve the predictive scoring models. Shows model accuracy, lets users submit "true outcome" data for 6 scoring models. |
| **Who uses it** | Ops/admin users who manage scoring system accuracy. Not a daily CRM tool. Nav flag: `advisorHidden:true`. No frontend permission gate beyond advisor block. |
| **Recommended destination** | Admin group OR Insights group with a role gate |
| **Recommended action** | **Role/permission decision needed** — see §6 |
| **Risk** | Medium — moving to Admin hides it from non-admin ops users; moving to Insights with no gate exposes it too broadly |
| **Reason** | Score Feedback is a system-accuracy tool. It is not harmful for general users to see their own submitted feedback, but submitting incorrect outcomes could pollute models. Needs a decision on whether it should be ops/admin-only or general-user-facing. |

---

### 2.6 Digest Settings

| Field | Value |
|---|---|
| **Current label** | Digest Settings |
| **Current route** | `/alerts-digest` |
| **Component** | `client/src/pages/alerts-digest.tsx` |
| **Page title** | "Alerts & Digest" (note: page title still uses old naming — consider updating to match "Digest Settings") |
| **What it does** | Personal notification digest configuration: cadence (daily/weekly), notification channels, quiet hours, section-level alert toggles, alert rule management. |
| **Who uses it** | All users — this is a personal settings tool. No permission gate. |
| **Recommended destination** | A future "Settings" or "Preferences" section, OR remain in More temporarily |
| **Recommended action** | **Keep in More temporarily** — until a user-settings home exists |
| **Risk** | Low — no harm in More; the label already says "Settings" |
| **Reason** | Digest Settings is logically a personal preferences page. It would ideally live near Email Signatures and AI Voice Profiles (now in Work). However, creating a dedicated "Settings" section or adding it to Work would require deciding whether Work becomes a mixed work+settings section. Safer to wait until a user preferences home is defined. |

---

### 2.7 Data Quality

| Field | Value |
|---|---|
| **Current label** | Data Quality |
| **Current route** | `/data-quality` |
| **Component** | `client/src/pages/data-quality.tsx` |
| **Page title** | References a quality score ring and issue counts |
| **What it does** | CRM data hygiene tooling: detects missing fields, duplicate candidates, data freshness issues, incomplete records. Shows a quality score and actionable issue list. Nav flags: `permKey:"crm"`, `advisorHidden:true`. |
| **Who uses it** | CRM admins, data ops, sales ops who maintain data integrity. Not a daily sales user tool. |
| **Recommended destination** | Admin group OR Operations group (ops-facing) |
| **Recommended action** | **Role/permission decision needed** — see §6 |
| **Risk** | Medium — Admin gate hides it from non-admin ops users who legitimately need it; Operations places it near field tools which is the wrong audience |
| **Reason** | Data Quality is a maintenance/hygiene tool. It already has `permKey:"crm"` which limits it to CRM users. The open question is whether it needs an additional admin gate or if CRM-edit users should see it. |

---

### 2.8 Task Rules

| Field | Value |
|---|---|
| **Current label** | Task Rules |
| **Current route** | `/automation/tasks` |
| **Component** | `client/src/pages/task-rules-settings.tsx` |
| **Page title** | "Task Rules" (inferred from h1 at line 248) |
| **What it does** | Automation rules specifically for tasks: CRM event triggers → task creation. Separate from the general Automations builder but same conceptual category. Configuration/admin tool, not daily use. |
| **Who uses it** | Ops/admin users setting up automation. Not a daily sales tool. No permission gate beyond auth. |
| **Recommended destination** | Tab inside Automations page, OR Admin group |
| **Recommended action** | **Consolidation decision needed** — see §4 |
| **Risk** | Low-medium — merging into Automations as a tab is a small UI change; moving to Admin alone is a clean nav change |
| **Reason** | Task Rules is conceptually a subset of Automations. Running two separate sidebar entries for what could be one tabbed page adds nav clutter. See §4 for full analysis. |

---

### 2.9 Automations

| Field | Value |
|---|---|
| **Current label** | Automations |
| **Current route** | `/automations` |
| **Component** | `client/src/pages/automations.tsx` |
| **Page title** | "Automations" (h1 at line 676) |
| **What it does** | Full rule-based automation engine: triggers (CRM events, time-based), conditions, multi-action sequences, templates, run history logs. More powerful than Task Rules. |
| **Who uses it** | Power users, admins, ops who configure CRM automations. No permission gate beyond auth. |
| **Recommended destination** | Admin group OR remain in More with Task Rules merged into it as a tab |
| **Recommended action** | **Consolidation decision needed** — see §4 |
| **Risk** | Low (wherever it lands, the move itself is safe) |
| **Reason** | Automations and Task Rules serve the same config/ops audience. The consolidation question must be answered first, then placement follows. |

---

### 2.10 Training

| Field | Value |
|---|---|
| **Current label** | Training |
| **Current route** | `/training` |
| **Component** | `client/src/pages/training-hub.tsx` |
| **Page title** | Video playlist titles (no single h1 — browsable catalog) |
| **What it does** | Curated video training playlists by topic with progress tracking. Some videos are pending external hosting. |
| **Who uses it** | All users — onboarding, skill development. No permission gate. |
| **Recommended destination** | A "Learn" group alongside Help, OR remain in More |
| **Recommended action** | **Keep in More temporarily** OR **move with Help to a "Learn" group** — see §5 |
| **Risk** | Low |
| **Reason** | Training and Help naturally pair together as a "Learn / Support" section. Creating a micro-group for 2 items is valid only if the resulting "Learn" group would be clearly discoverable. If not, staying in More is fine for now. |

---

### 2.11 Help

| Field | Value |
|---|---|
| **Current label** | Help |
| **Current route** | `/help` |
| **Component** | `client/src/pages/help-center.tsx` |
| **Page title** | "Help Center" |
| **What it does** | In-app help center: markdown-rendered documentation, search, category browsing. |
| **Who uses it** | All users. No permission gate. |
| **Recommended destination** | Paired with Training |
| **Recommended action** | **Keep in More temporarily** OR **move with Training to a "Learn" group** — see §5 |
| **Risk** | Low |
| **Reason** | Same as Training — these two should travel together. |

---

## 3. Revenue Suite Decision

### The four items

- **Revenue Hub** (`/revenue`) — MRR/financial overview dashboard
- **Revenue Ops** (`/revenue-ops`) — plan commit and gap-to-plan tracking
- **Revenue Simulator** (`/revenue-sim`) — scenario modeling and deal simulation
- **Relationship Intelligence** (`/intelligence/rel-intelligence`) — contact warmth and relationship health

All four have `advisorHidden:true`. Revenue Hub additionally has `permKey:"crm"`.

### Analysis

**Q1: Should these move under existing Pipeline?**

No. Pipeline is a transaction-processing section (creating deals, moving stages, managing quotes). Revenue Hub, Ops, and Simulator are backward-looking financial reporting and forward-looking financial modeling tools. Mixing them into Pipeline would create a section that is half CRM data-entry and half financial analytics — a confusing blend.

The exception is Price Lists (already moved to Pipeline in Phase 3) — pricing is closely tied to quote-building and fits. Revenue Hub/Ops/Sim do not.

**Q2: Should these move under existing Insights?**

Partially yes — this is the better option if no new group is created.

The Insights group currently contains: Executive Dashboard, Source Attribution, Executive Copilot, Revenue Intelligence, Territory & Geo. These are all analytical views with no state-changing CRM actions. The Revenue suite (Hub, Ops, Sim) fits this pattern — they are read-heavy analytical tools.

However, Insights is already 5 items. Adding 4 more (Hub, Ops, Sim, Rel. Intelligence) = 9 items. That is a large group and may reduce discoverability for all items.

**Relationship Intelligence** fits Insights cleanly with no audience ambiguity. This one should move regardless of what happens with the Revenue triple.

**Q3: Should they become a new top-level Revenue group?**

This is the cleanest long-term IA if the Revenue tools are high-frequency for leadership. A "Revenue" section (between Insights and Ecosystem) containing Hub + Ops + Sim, possibly with Revenue Intelligence moved from Insights into it, would create a dedicated financial operations home.

The cost: a new top-level group means one more section in the sidebar. With 8 sections already (Today, Work, Pipeline, Operations, Insights, Ecosystem, More, Admin), a 9th group adds cognitive load unless the Revenue tools are genuinely primary navigation destinations.

**Q4: Are they used enough to justify top-level visibility?**

Revenue Hub, Ops, and Simulator are primarily used by sales leadership and executives — they are not daily CRM-entry tools. If the majority of daily users are sales reps (not managers), these tools would be top-level nav items that most users ignore. However, the users who DO use them (CROs, VPs of Sales, revenue ops) use them frequently.

The advisor block (`advisorHidden:true`) already prevents non-sales roles from seeing them. The audience gating is there; the question is just where they live for the people who can see them.

**Q5: Are they overlapping with Pipeline Snapshot / Opportunities / Accounts?**

No direct overlap:

| Tool | Overlap? | Distinction |
|---|---|---|
| Revenue Hub vs Pipeline Snapshot | Partial — both show deal/revenue data | Snapshot is stage-by-stage deal tracking (what are we working on now); Revenue Hub is MRR/contracted revenue over time (what have we locked in) |
| Revenue Ops vs Opportunities | None | Revenue Ops is plan-vs-actuals management; Opportunities is individual lead management |
| Revenue Simulator vs Pipeline | None | Simulator is scenario modeling; Pipeline is current-state tracking |

These are additive intelligence tools, not duplicates.

**Recommendation for Revenue suite**

**Option A (preferred if Revenue tools are high-frequency for leadership):** Create a new "Revenue" top-level group containing Revenue Hub, Revenue Ops, Revenue Simulator. Move Relationship Intelligence to Insights. This gives financial leadership a clear home.

**Option B (preferred if simplicity is the priority):** Move all four into Insights, making it the umbrella "Intelligence & Analytics" section. Rename Insights → "Intelligence" if the expanded scope warrants it. Keep 9 items in one large group.

**Option C (minimal change):** Move only Relationship Intelligence to Insights now (clear win). Leave Revenue Hub/Ops/Sim in More until the group question is decided. This is the safest incremental step.

---

## 4. Automation Consolidation Decision

### The two items

- **Automations** (`/automations`) — full rule engine: triggers, conditions, multi-action, templates, run logs
- **Task Rules** (`/automation/tasks`) — narrower: triggers → task creation only

### Analysis

**Q1: Are these separate features or should Task Rules become a tab inside Automations?**

They are the same category of feature (event-triggered rule automation) at different scopes:
- Automations: broad — can trigger emails, CRM updates, task creation, notifications, multiple actions
- Task Rules: narrow — only creates tasks

Task Rules is a sub-capability that the Automations engine could theoretically subsume. In many CRM products, task-specific automation rules live inside a tabbed automation builder rather than as a separate page.

However, Task Rules has its own dedicated component (`task-rules-settings.tsx`) rather than being a mode of `automations.tsx`. Merging them as a tab requires a frontend change — not purely a nav position change.

**Q2: Who uses them?**

Both are setup/configuration tools used by ops/admin users who design automation flows. Neither is a daily-use tool for sales reps. Both lack a frontend permission gate (auth required, but no section gate). Neither has `advisorHidden`.

**Q3: Are they admin/config tools or general work tools?**

Admin/config. These are not daily action tools — they are automation *setup* tools. A sales rep interacts with the *results* of automations (tasks appear, emails send), not the automation builder itself.

**Recommended destination**

| Option | Pros | Cons |
|---|---|---|
| **Tab inside Automations** | Reduces nav to 1 item; logical grouping | Requires frontend component change — not a Phase 4 nav-only move |
| **Both in Admin** | Consistent with "config tools go in Admin" pattern | Admin is already 8 items; Automations is arguably power-user, not admin-only |
| **Automations in More, Task Rules as tab** | Keeps nav clean when consolidation is done | Still requires a frontend change to absorb Task Rules |
| **Both stay in More temporarily** | Zero risk, no frontend change | 2 items consuming nav slots for same-category tools |

**Recommendation:** Do the tab consolidation (Task Rules → tab inside Automations page) first as a small frontend change, then move the single Automations item to an appropriate group (Operations or Admin). This reduces two nav slots to one before deciding placement.

If tab consolidation is not prioritized, both items should temporarily move to **Admin** — they are config tools, not work tools, and Admin is a better home than More.

---

## 5. Learn / Support Decision

### The two items

- **Training** (`/training`) — video training catalog with progress tracking
- **Help** (`/help`) — markdown-based in-app help center

### Analysis

**Q1: Should these become a "Learn" group?**

They are the strongest candidate for a micro-group because:
1. They are the only "consume information about the product" tools in the nav.
2. Neither requires any CRM permission or advisor restriction — they are universal.
3. They naturally pair: "watch a video" (Training) + "read the docs" (Help).
4. A two-item "Learn" group with a Book or GraduationCap icon would be instantly scannable.

A two-item group is small but not too small — the Insights group started as 5 items; Today's direct-link section has 1 desktop item (just the link). A "Learn" section with 2 items is reasonable.

**Q2: Should they move to Library once Library exists?**

The audit does not show a "Library" section in the current nav. If a Library is introduced in a future phase (possibly housing Document Hub, Knowledge Assets, and reference materials), Training and Help could logically join it. But waiting for a Library that doesn't exist yet means they stay in More indefinitely.

**Q3: Should they stay in More for now?**

They can, but they are two of the most universally useful tools in the product (everyone needs Help; most users benefit from Training). Burying them in a catch-all drawer reduces their discoverability for new and returning users.

**Q4: Are they general-user-facing?**

Yes. No permission gate. No advisor restriction. Appropriate for every role.

**Recommendation:** Create a minimal "Learn" section in the nav with Training + Help. This is a low-risk, high-value move — two items, no permission changes, clear grouping rationale. The only decision is placement: at the bottom of the sidebar above Admin (similar to Help in most products), or embedded somewhere else.

If Trevor prefers to defer this, keep both in More. Do not split them across groups.

---

## 6. Settings / Config Decision

### The three items

- **Digest Settings** (`/alerts-digest`) — personal notification preferences
- **Data Quality** (`/data-quality`) — CRM data hygiene tooling (permKey: "crm", advisorHidden)
- **Score Feedback** (`/scores/feedback`) — predictive score accuracy feedback (advisorHidden)

### Analysis

**Q1: Are these admin/config tools?**

Mixed:
- **Digest Settings** — personal settings (each user configures their own digest). Not admin.
- **Data Quality** — ops/admin tool. Correcting CRM data quality is a data governance task, not a daily sales action.
- **Score Feedback** — system maintenance tool. Submitting outcome data to improve scoring models is an ops/admin task.

**Q2: Are they personal settings?**

- **Digest Settings** — yes, fully personal.
- **Data Quality** — no, it affects the shared CRM data quality score visible to all.
- **Score Feedback** — partially personal (a user confirms outcomes on their own deals), but the effect is systemic (model accuracy).

**Q3: Are they ops/data quality tools?**

- **Digest Settings** — no.
- **Data Quality** — yes, primary use case.
- **Score Feedback** — yes, secondary use case.

**Q4: Should they be visible to all users?**

- **Digest Settings** — yes. Every user should be able to configure their own digest.
- **Data Quality** — no. CRM data governance is not a daily-user activity. Should be gated by CRM-edit permission at minimum (already has `permKey:"crm"`).
- **Score Feedback** — borderline. Sales reps confirming their own deal outcomes is useful; exposing the model accuracy metrics and training interface to all users adds noise.

**Q5: Should they be gated by role?**

- **Digest Settings** — no gate needed.
- **Data Quality** — already has `permKey:"crm"`; consider adding an ops/admin flag if the audience is truly narrow.
- **Score Feedback** — consider an admin flag. The feedback submission itself is user-level, but the model accuracy view and training interface look like admin instrumentation.

**Recommended decisions**

| Item | Recommended action | Destination |
|---|---|---|
| Digest Settings | Move to Work alongside Email Signatures/AI Voice Profiles (all personal productivity settings) | Work group |
| Data Quality | Keep in More temporarily OR move to Admin if ops-admin-only is confirmed | More or Admin |
| Score Feedback | Move to Insights if general-user-facing; Admin if ops/admin-only | Needs decision |

---

## 7. Recommended Final IA After Decisions

> **This is a proposal only. Do not implement.**

If all decisions above are resolved as recommended, the sidebar would look like:

```
TODAY          (direct link → /today)
  [mobile] Today / Field Mode / Nearby

WORK
  Mission Control · My Travel · Work Calendar · Inbox · CURRENTS · Tasks
  Calendar · Meeting Notes · Activity Feed
  Email Signatures · AI Voice Profiles · Digest Settings  ← personal settings cluster

PIPELINE       (gate: crm permission, advisorHidden)
  Snapshot · Leads · Accounts · Contacts · Quotes · Renewals
  Accounts Won · Booking Outreach · Booking Analytics · Notes · Price Lists

OPERATIONS
  Install Workflows · Procurement · Deployments · Projects · Events
  Communications · Document Hub · Knowledge Assets
  Territory Routing · Support Tickets · Winter Support

INSIGHTS
  Executive Dashboard · Source Attribution · Executive Copilot
  Revenue Intelligence · Territory & Geo
  Relationship Intelligence  ← moved from More

REVENUE        (new group — advisorHidden, if Option A chosen for §3)
  Revenue Hub · Revenue Ops · Revenue Simulator

ECOSYSTEM      (gate: partnerships permission, advisorHidden)
  Industry Partnerships · Dealers / Resellers · Strategic Alliances
  Investors · Government & Grants · Referrals · Media & Tradeshows

LEARN          (new group — no permission gate)
  Training · Help

MORE           (residual — ~4 items after moves)
  Automations  ← or moved to Admin once consolidated
  Score Feedback  ← or moved to Insights/Admin
  Data Quality  ← or moved to Admin

─ ADMIN ─      (adminOnly)
  Users · Role Manager · Task Hub Access · Integrations
  User Signatures · My Mailboxes · Global Search · Settings
```

**More group would reduce from 11 → ~3 residual items,** which could then be dissolved or absorbed into their final homes.

---

## 8. Decision Checklist for Trevor

Before any Phase 4 implementation begins, confirm these decisions:

**Revenue suite (§3):**
- [ ] **Should Revenue Hub / Revenue Ops / Revenue Simulator get a new top-level "Revenue" group?** *(Option A)* — OR should they move into the existing Insights group? *(Option B)* — OR should Relationship Intelligence move now and Revenue tools wait? *(Option C)*
- [ ] **Should Relationship Intelligence move to Insights now regardless of the Revenue decision?** (Recommended: yes — low risk, clear fit)

**Automations (§4):**
- [ ] **Should Task Rules become a tab inside the Automations page?** (Requires a small frontend change before the nav move)
- [ ] If tab consolidation is not done yet: **should both Automations and Task Rules move to Admin?**

**Learn/Help (§5):**
- [ ] **Should Training and Help form a standalone "Learn" section?** (Two items, universal access, low risk)
- [ ] Or stay in More until a Library is defined?

**Settings/config (§6):**
- [ ] **Should Digest Settings move to Work** (alongside Email Signatures / AI Voice Profiles)?
- [ ] **Should Data Quality be admin-only?** Or is it an ops-user tool that should stay visible to CRM-edit users in Operations?
- [ ] **Should Score Feedback be visible to general users in Insights, or restricted to admins?**

---

## 9. Recommended Implementation Phases

After Trevor confirms the decisions above, the work can proceed in these safe, ordered phases:

### Phase 4A — Relationship Intelligence to Insights *(zero debate, low risk)*
- Move `Relationship Intelligence` from More to Insights group.
- Nav-config-only change. No new groups, no permission changes.
- Prerequisite: none — this can happen immediately.

### Phase 4B — Digest Settings + Learn group *(low risk)*
- Move `Digest Settings` to Work group (personal settings cluster).
- If approved: create `Learn` section with `Training` + `Help`.
- Nav-config-only changes. No permission changes.
- Prerequisite: Trevor confirms Digest Settings belongs in Work and Learn group is wanted.

### Phase 4C — Automation consolidation *(small frontend change)*
- Add a "Task Rules" tab inside `automations.tsx` (or link to `/automation/tasks` from within the page).
- Remove `Task Rules` as a standalone nav entry.
- Move `Automations` to Admin group (or keep in More if general-user access is desired).
- Prerequisite: Trevor confirms tab consolidation approach and final placement of Automations.

### Phase 4D — Revenue suite placement *(nav-only if new group, or Insights move)*
- If Option A: create new `Revenue` section in nav with Revenue Hub, Revenue Ops, Revenue Simulator.
- If Option B: add all three to Insights group (expand Insights to ~8–9 items).
- Nav-config-only change. No permission changes needed (existing `advisorHidden` flags carry over).
- Prerequisite: Trevor confirms Option A or B from §3.

### Phase 4E — Score Feedback and Data Quality *(permission decision first)*
- If Score Feedback is general-user-facing: move to Insights.
- If admin-only: move to Admin (or leave in More).
- If Data Quality stays ops-facing with CRM gate: move to Operations. If admin-only: move to Admin.
- Prerequisite: Trevor confirms audience for both tools.

### Phase 4F — More group retirement *(final cleanup)*
- After 4A–4E, More should have 0–2 residual items.
- If 0 items: remove the More section entirely.
- If 1–2 items: consider whether a catchall still makes sense or if those items have a natural home that wasn't yet decided.
- Prerequisite: all preceding phases complete.

---

*End of decision plan. No code was changed during this document's creation.*
