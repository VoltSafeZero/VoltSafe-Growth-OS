/**
 * Centralized help-content registry for the global VoltSafe CMS help/info icon system.
 *
 * Do not scatter help copy across dozens of files — add new entries here and
 * reference them by `helpKey` from the `<FieldHelp helpKey="..." />` component
 * (client/src/components/help/field-help.tsx).
 *
 * `restrictedToEmails` mirrors the Learn-tab pattern: if set, only those exact
 * emails (case-insensitive) see this entry; everyone else gets the generic
 * fallback content from FieldHelp instead of the restricted copy.
 */

export type HelpAudience = "all-users" | "capital-users" | "admin-only" | "cfo-onboarding";

export interface HelpEntry {
  title: string;
  shortDescription: string;
  detailedDescription?: string;
  module: string;
  audience: HelpAudience;
  /** Only these exact emails (case-insensitive) may see this entry's content. */
  restrictedToEmails?: string[];
  /** Optional external/internal "Learn more" link. */
  learnMoreUrl?: string;
  /** Marks the underlying value as sample/draft/synced/AI-generated/etc. */
  valueNature?: "real" | "sample" | "draft" | "synced" | "ai-generated" | "system-generated";
}

export const HELP_CONTENT: Record<string, HelpEntry> = {
  // ── Sidebar / navigation ────────────────────────────────────────────────
  "nav.today": {
    title: "Today",
    shortDescription: "Your personalized daily command center — top priorities, alerts, and suggested actions for right now.",
    module: "Today",
    audience: "all-users",
  },
  "nav.currents": {
    title: "Currents",
    shortDescription: "Team chat — channels, DMs, mentions, and reactions. Think of it as VoltSafe's internal Slack.",
    module: "Currents",
    audience: "all-users",
  },
  "nav.work": {
    title: "Work",
    shortDescription: "Tasks and boards — plan, assign, and track work across the team using Kanban or list views.",
    module: "Work",
    audience: "all-users",
  },
  "nav.pipeline": {
    title: "Pipeline",
    shortDescription: "Your CRM — leads, accounts, contacts, and opportunities moving through the sales process.",
    module: "Pipeline",
    audience: "all-users",
  },
  "nav.operations": {
    title: "Operations",
    shortDescription: "Procurement, manufacturing, and deployment tracking for hardware rollouts.",
    module: "Operations",
    audience: "all-users",
  },
  "nav.insights": {
    title: "Insights",
    shortDescription: "Reporting and analytics across CRM, marketing, and revenue performance.",
    module: "Insights",
    audience: "all-users",
  },
  "nav.ecosystem": {
    title: "Ecosystem",
    shortDescription: "Partnerships, integrations, and relationship intelligence across the wider VoltSafe network.",
    module: "Ecosystem",
    audience: "all-users",
  },
  "nav.marketing": {
    title: "Marketing",
    shortDescription: "Campaigns, sequences, and attribution — see which marketing activity leads to pipeline and revenue.",
    module: "Marketing",
    audience: "all-users",
  },
  "nav.capital": {
    title: "Capital",
    shortDescription: "Fundraising workspace — investor pipeline, data room, follow-ups, and board reporting.",
    module: "Capital",
    audience: "capital-users",
  },
  "nav.feedCortex": {
    title: "Feed / CORTEX",
    shortDescription: "The AI-assisted activity feed — CORTEX surfaces relevant updates, summaries, and suggested next steps.",
    module: "Feed",
    audience: "all-users",
  },
  "nav.learn": {
    title: "Learn",
    shortDescription: "Training hub — role-based video playlists and onboarding lessons for VoltSafe CMS.",
    module: "Learn",
    audience: "all-users",
  },

  // ── CRM / Pipeline ──────────────────────────────────────────────────────
  "crm.lead": {
    title: "Lead",
    shortDescription: "A potential customer who hasn't yet been qualified into a full account/opportunity.",
    module: "Pipeline",
    audience: "all-users",
  },
  "crm.account": {
    title: "Account",
    shortDescription: "A company or organization VoltSafe sells to or supports — the parent record for contacts and deals.",
    module: "Pipeline",
    audience: "all-users",
  },
  "crm.contact": {
    title: "Contact",
    shortDescription: "An individual person at an account — who you actually talk to.",
    module: "Pipeline",
    audience: "all-users",
  },
  "crm.stage": {
    title: "Stage",
    shortDescription: "Where this record sits in its lifecycle — e.g. New, Qualified, Proposal, Closed Won.",
    detailedDescription: "Update the stage whenever the real-world status changes. Stage drives pipeline reporting, so an out-of-date stage makes forecasts wrong.",
    module: "Pipeline",
    audience: "all-users",
  },
  "crm.owner": {
    title: "Owner",
    shortDescription: "The owner is the person responsible for moving this item forward. If no owner is assigned, the item usually becomes digital furniture.",
    module: "Pipeline",
    audience: "all-users",
  },
  "crm.priority": {
    title: "Priority",
    shortDescription: "Priority shows how urgent or important this item is. High-priority items should be handled first.",
    module: "Pipeline",
    audience: "all-users",
  },
  "crm.score": {
    title: "Score",
    shortDescription: "A rule-based score estimating quality or likelihood to close, computed from deterministic signals — not a black box.",
    module: "Pipeline",
    audience: "all-users",
    valueNature: "system-generated",
  },
  "crm.source": {
    title: "Source",
    shortDescription: "Where this record originally came from — e.g. referral, inbound form, campaign, cold outreach.",
    module: "Pipeline",
    audience: "all-users",
  },
  "crm.lastTouch": {
    title: "Last Touch",
    shortDescription: "Last touch shows the most recent meaningful interaction. If it is old, the relationship may be cooling off.",
    module: "Pipeline",
    audience: "all-users",
  },
  "crm.nextAction": {
    title: "Next Action",
    shortDescription: "Next action is the next concrete step. Good next actions are specific, assigned, and dated.",
    module: "Pipeline",
    audience: "all-users",
  },
  "crm.aiSummary": {
    title: "AI Summary",
    shortDescription: "AI Summary gives a quick explanation of the record based on available activity and context. Review it before relying on it. AI is helpful, not a sworn witness.",
    module: "Pipeline",
    audience: "all-users",
    valueNature: "ai-generated",
  },
  "crm.activity": {
    title: "Activity",
    shortDescription: "A timeline of everything that's happened on this record — emails, calls, notes, and status changes.",
    module: "Pipeline",
    audience: "all-users",
  },
  "action.create": {
    title: "Create",
    shortDescription: "Creates a new item in this section. Depending on where you are, this may create a lead, task, investor, report, event, or other record. If you are unsure, check the form title before saving. Buttons are sneaky like that.",
    module: "Global",
    audience: "all-users",
  },
  "action.edit": {
    title: "Edit",
    shortDescription: "Opens this record for editing. Changes save when you confirm — nothing is saved automatically as you type unless noted.",
    module: "Global",
    audience: "all-users",
  },
  "action.archive": {
    title: "Archive",
    shortDescription: "Archive removes the item from active views without permanently deleting it.",
    module: "Global",
    audience: "all-users",
  },
  "action.delete": {
    title: "Delete",
    shortDescription: "Delete removes the item or moves it to trash, depending on the module. Use carefully. The undo fairy has limited working hours.",
    module: "Global",
    audience: "all-users",
  },
  "action.search": {
    title: "Search",
    shortDescription: "Search filters the current page or module. Use it to quickly find records, people, companies, messages, files, or tasks.",
    module: "Global",
    audience: "all-users",
  },
  "action.filter": {
    title: "Filter",
    shortDescription: "Filters narrow what you see without deleting anything. If something disappears, clear filters before assuming the system ate it.",
    module: "Global",
    audience: "all-users",
  },
  "action.sort": {
    title: "Sort",
    shortDescription: "Sort changes the order of the list. It does not edit the records.",
    module: "Global",
    audience: "all-users",
  },
  "crm.status": {
    title: "Status",
    shortDescription: "Status shows where this item currently stands. Update it when the real-world situation changes.",
    module: "Global",
    audience: "all-users",
  },

  // ── Currents (chat) ─────────────────────────────────────────────────────
  "currents.channel": {
    title: "Channel",
    shortDescription: "A topic-based space for team conversation — like a chat room for a project, team, or subject.",
    module: "Currents",
    audience: "all-users",
  },
  "currents.privateChannel": {
    title: "Public / Private Channel",
    shortDescription: "Public channels are visible to everyone; private channels are only visible to invited members.",
    module: "Currents",
    audience: "all-users",
  },
  "currents.message": {
    title: "Message",
    shortDescription: "A single chat message posted to a channel or direct message thread.",
    module: "Currents",
    audience: "all-users",
  },
  "currents.reply": {
    title: "Reply",
    shortDescription: "Starts a threaded reply to a specific message, keeping side-discussions organized.",
    module: "Currents",
    audience: "all-users",
  },
  "currents.pin": {
    title: "Pin",
    shortDescription: "Pins an important message to the top of the channel so it doesn't get lost in the scroll.",
    module: "Currents",
    audience: "all-users",
  },
  "currents.reaction": {
    title: "Reaction",
    shortDescription: "A quick emoji response to a message — a lightweight way to acknowledge without replying.",
    module: "Currents",
    audience: "all-users",
  },
  "currents.mentions": {
    title: "Mentions",
    shortDescription: "@-mentioning someone notifies them directly, even if they've muted the channel.",
    module: "Currents",
    audience: "all-users",
  },

  // ── Work / Tasks ────────────────────────────────────────────────────────
  "work.taskTitle": {
    title: "Task Title",
    shortDescription: "A short, specific description of the work to be done.",
    module: "Work",
    audience: "all-users",
  },
  "work.status": {
    title: "Status",
    shortDescription: "Where the task currently stands — e.g. To Do, In Progress, Done.",
    module: "Work",
    audience: "all-users",
  },
  "work.assignee": {
    title: "Assignee",
    shortDescription: "The person responsible for completing this task.",
    module: "Work",
    audience: "all-users",
  },
  "work.dueDate": {
    title: "Due Date",
    shortDescription: "When this task needs to be finished. Overdue tasks are flagged so nothing quietly slips.",
    module: "Work",
    audience: "all-users",
  },
  "work.board": {
    title: "Board",
    shortDescription: "A Kanban-style view grouping tasks into columns by status.",
    module: "Work",
    audience: "all-users",
  },
  "work.blocked": {
    title: "Blocked",
    shortDescription: "This task can't move forward until something else is resolved — check the linked blocker.",
    module: "Work",
    audience: "all-users",
  },

  // ── Learn ───────────────────────────────────────────────────────────────
  "learn.lesson": {
    title: "Lesson",
    shortDescription: "A single training video covering one feature or workflow.",
    module: "Learn",
    audience: "all-users",
  },
  "learn.markComplete": {
    title: "Mark Complete",
    shortDescription: "Marks this lesson as watched so your progress is tracked. It's stored locally in your browser.",
    module: "Learn",
    audience: "all-users",
  },
  "learn.progress": {
    title: "Progress",
    shortDescription: "How much of this playlist you've completed so far.",
    module: "Learn",
    audience: "all-users",
  },

  // ── AI Copilot ──────────────────────────────────────────────────────────
  "copilot.prompt": {
    title: "Prompt",
    shortDescription: "What you ask the AI Copilot — the more specific, the better the answer.",
    module: "AI Copilot",
    audience: "all-users",
  },
  "copilot.confidence": {
    title: "Confidence",
    shortDescription: "How confident the AI is in this suggestion, based on the data it had available. Low confidence means double-check before acting.",
    module: "AI Copilot",
    audience: "all-users",
    valueNature: "ai-generated",
  },
  "copilot.applySuggestion": {
    title: "Apply Suggestion",
    shortDescription: "Applies the AI's suggested action. You can always undo or edit afterward — the AI doesn't have final say.",
    module: "AI Copilot",
    audience: "all-users",
  },

  // ── Capital ─────────────────────────────────────────────────────────────
  "capital.targetAmount": {
    title: "Target Amount",
    shortDescription: "The total amount this round is trying to raise.",
    module: "Capital",
    audience: "capital-users",
  },
  "capital.minimumCloseTarget": {
    title: "Minimum Close Target",
    shortDescription: "The smallest amount that still lets you close the round and deploy funds.",
    module: "Capital",
    audience: "capital-users",
  },
  "capital.committedTotal": {
    title: "Committed Total",
    shortDescription: "Sum of investor commitments marked 'Committed' — money you can count on.",
    module: "Capital",
    audience: "capital-users",
  },
  "capital.softCircledTotal": {
    title: "Soft Circled Total",
    shortDescription: "Sum of investor interest marked 'Soft Circled' — verbal interest, not yet legally committed.",
    module: "Capital",
    audience: "capital-users",
  },
  "capital.weightedPipeline": {
    title: "Weighted Pipeline",
    shortDescription: "Estimated realistic capital based on investor stage and probability.",
    detailedDescription: "Weighted pipeline estimates how much money is realistically likely to close. For example, a $500k investor at 40% confidence counts as $200k weighted pipeline.",
    module: "Capital",
    audience: "capital-users",
  },
  "capital.valuationCap": {
    title: "Valuation Cap",
    shortDescription: "The maximum valuation used to convert this SAFE/note into equity in a future priced round.",
    module: "Capital",
    audience: "capital-users",
  },
  "capital.discountRate": {
    title: "Discount Rate",
    shortDescription: "The discount this round's investors get versus the price paid by investors in the next priced round.",
    module: "Capital",
    audience: "capital-users",
  },
  "capital.probability": {
    title: "Probability",
    shortDescription: "Our estimate of how likely this investor is to close, based on stage and engagement.",
    module: "Capital",
    audience: "capital-users",
  },
  "capital.pipelineStage": {
    title: "Pipeline Stage",
    shortDescription: "Where this investor sits in the fundraising pipeline, from first outreach to closed.",
    module: "Capital",
    audience: "capital-users",
  },
  "capital.engagementScore": {
    title: "Engagement",
    shortDescription: "A rollup of recent investor activity — deck views, data room opens, replies — showing who's warm.",
    module: "Capital",
    audience: "capital-users",
  },
  "capital.followUpDue": {
    title: "Follow-Up Due",
    shortDescription: "The date this follow-up needs action. Overdue follow-ups are flagged so nothing falls through the cracks.",
    module: "Capital",
    audience: "capital-users",
  },
  "capital.dataRoomFolder": {
    title: "Data Room Folder",
    shortDescription: "A grouping of diligence materials (e.g. Financials, Legal) shared with investors during due diligence.",
    module: "Capital",
    audience: "capital-users",
  },
  "capital.isConfidential": {
    title: "Confidential",
    shortDescription: "Confidential materials require an explicit investor-portal share — they aren't included by default.",
    module: "Capital",
    audience: "capital-users",
  },
  "capital.weeklyBrief": {
    title: "Weekly Brief",
    shortDescription: "An auto-generated summary of this week's fundraising activity — new investors, engagement, and follow-ups.",
    module: "Capital",
    audience: "capital-users",
    valueNature: "system-generated",
  },
  "capital.boardUpdate": {
    title: "Board Update",
    shortDescription: "A formatted update for your board covering round progress, runway, and key risks.",
    module: "Capital",
    audience: "capital-users",
    valueNature: "system-generated",
  },
  "capital.cfoClosingReport": {
    title: "CFO Closing Report",
    shortDescription: "A closing-focused report showing committed vs. target, remaining gap, and follow-ups blocking close.",
    module: "Capital",
    audience: "capital-users",
    valueNature: "system-generated",
  },
  "capital.sampleData": {
    title: "Sample Data",
    shortDescription: "This Capital module ships with sample investors, a sample round, and sample follow-ups so you can learn the workflow before adding real fundraising data.",
    detailedDescription: "Everything labeled 'Sample' was created by the CFO onboarding seed package (capital_cfo_onboarding_seed_v1) and is only ever visible to Trevor and Scott, same as the rest of the Capital module. It's safe to explore, edit, or delete — it isn't counted in real reporting once you replace it with your own round.",
    module: "Capital",
    audience: "cfo-onboarding",
    restrictedToEmails: ["trevor@voltsafe.com", "scott@voltsafe.com"],
    valueNature: "sample",
  },
};

export type HelpKey = keyof typeof HELP_CONTENT;

/** Generic fallback shown when a helpKey has no registered content. */
export const HELP_FALLBACK: HelpEntry = {
  title: "Help",
  shortDescription: "Help content for this field has not been added yet.",
  module: "Global",
  audience: "all-users",
};

/**
 * Look up help content by key, applying email-based restriction.
 * Returns the fallback (never throws / never crashes the page) if the key
 * is missing, or if the entry is restricted and `userEmail` doesn't match.
 */
export function getHelpContent(helpKey: string, userEmail?: string | null): HelpEntry {
  const entry = HELP_CONTENT[helpKey];
  if (!entry) {
    if (import.meta.env?.DEV) {
      // eslint-disable-next-line no-console
      console.warn(`[help-content] Missing helpKey: "${helpKey}" — showing fallback copy.`);
    }
    return HELP_FALLBACK;
  }
  if (entry.restrictedToEmails && entry.restrictedToEmails.length > 0) {
    const email = userEmail?.toLowerCase();
    const allowed = !!email && entry.restrictedToEmails.some((e) => e.toLowerCase() === email);
    if (!allowed) return HELP_FALLBACK;
  }
  return entry;
}
